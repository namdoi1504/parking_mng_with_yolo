import json
import threading
import time
import unittest
import cv2
from http.client import HTTPConnection
from unittest.mock import Mock, patch
from uuid import uuid4

from AI.datasets.playback_control import PlaybackControl
from AI.datasets.live_pipeline import LatestVideo
from AI.datasets.stream_server import FrameStore, create_server
from AI.tests.test_live_pipeline import FakeCapture


class PlaybackTests(unittest.TestCase):
    def test_seek_waits_for_backend_ack_and_retry_does_not_reanalyze(self):
        callback = Mock(return_value={"frame_id": 10, "parking_slots": []})
        control = PlaybackControl(Mock(), Mock(), Mock(), enabled=True, on_seek=callback)
        key = str(uuid4())
        first = control.command("seek", "backend", seconds=12.5, request_id=key)
        self.assertEqual(first["playback_state"], "paused")
        self.assertFalse(first["seek_ready"])
        self.assertIn("seek_snapshot", first)
        self.assertEqual(control.command("seek", "backend", seconds=12.5, request_id=key), first)
        callback.assert_called_once_with(12.5)
        with self.assertRaisesRegex(ValueError, "acknowledged|applied"):
            control.command("resume", "backend")
        with self.assertRaises(ValueError):
            control.command("seek", "backend", seconds=13, request_id=key)
        control.command("confirm-seek", "backend", request_id=key)
        control.command("resume", "backend")
        self.assertFalse(control.blocked)

    def test_failed_seek_stays_blocked_and_can_retry_same_id(self):
        callback = Mock(side_effect=[ValueError("Decode failed"), {"frame_id": 2}])
        control = PlaybackControl(Mock(), Mock(), Mock(), enabled=True, on_seek=callback)
        key = str(uuid4())
        with self.assertRaisesRegex(ValueError, "Decode failed"):
            control.command("seek", "backend", seconds=3, request_id=key)
        self.assertTrue(control.blocked)
        self.assertFalse(control.seek_ready)
        control.command("seek", "backend", seconds=3, request_id=key)
        self.assertEqual(callback.call_count, 2)

    def test_decoder_can_seek_forward_backward_and_resume_from_target(self):
        cap = FakeCapture()
        original = cap.get
        cap.get = lambda key: 100000 if key == cv2.CAP_PROP_FRAME_COUNT else original(key)
        with patch("AI.datasets.live_pipeline.cv2.VideoCapture", return_value=cap):
            video = LatestVideo("fake")
        video.start()
        try:
            first = video.get()
            video.pause()
            moved = video.seek(1.2)
            self.assertEqual(moved.media_seconds, 1.2)
            self.assertGreater(moved.sequence, first.sequence)
            self.assertGreater(moved.epoch, first.epoch)
            time.sleep(.10)
            self.assertEqual(video.latest.sequence, moved.sequence)
            video.resume()
            following = video.get(moved.sequence)
            self.assertGreater(following.media_seconds, 1.2)
            self.assertLess(following.media_seconds, 1.35)
            video.pause()
            back = video.seek(.3)
            self.assertEqual(back.media_seconds, .3)
            self.assertGreater(back.sequence, following.sequence)
            self.assertGreater(back.epoch, following.epoch)
            for position in (-1, float("nan"), video.duration_seconds):
                with self.assertRaises(ValueError):
                    video.seek(position)
            self.assertEqual(video.latest.sequence, back.sequence)
        finally:
            video.close()

    def test_pause_drains_inflight_work_and_is_idempotent(self):
        video, frozen, resumed = Mock(), Mock(), Mock()
        control = PlaybackControl(video, frozen, resumed, enabled=True)
        control.work.acquire()
        completed = threading.Event()
        def pause():
            control.command("pause", "backend")
            completed.set()
        thread = threading.Thread(target=pause)
        thread.start()
        try:
            self.assertFalse(completed.wait(.05))
            frozen.assert_not_called()
        finally:
            control.work.release()
        thread.join(2)
        self.assertTrue(completed.is_set())
        first = control.status()
        self.assertEqual(first["playback_state"], "paused")
        self.assertEqual(control.command("pause", "backend"), first)
        frozen.assert_called_once()
        with self.assertRaisesRegex(ValueError, "restarted"):
            control.command("pause", "other-backend")
        control.command("resume", "backend")
        control.command("resume", "backend")
        resumed.assert_called_once()
        self.assertFalse(control.blocked)
        self.assertEqual(control.generation, 1)
        self.assertIsNotNone(control.status()["resumed_at"])

    def test_disabled_and_failed_pause_does_not_leave_pipeline_blocked(self):
        control = PlaybackControl(Mock(), Mock(side_effect=ValueError("Not ready")), Mock())
        with self.assertRaisesRegex(ValueError, "disabled"):
            control.command("pause", "backend")
        control.enabled = True
        with self.assertRaisesRegex(ValueError, "Not ready"):
            control.command("pause", "backend")
        self.assertFalse(control.blocked)
        control.video.resume.assert_called_once()

    def test_decoder_freezes_and_resumes_without_skipping_pause_duration(self):
        cap = FakeCapture()
        original = cap.get
        cap.get = lambda key: 100000 if key == cv2.CAP_PROP_FRAME_COUNT else original(key)
        with patch("AI.datasets.live_pipeline.cv2.VideoCapture", return_value=cap):
            video = LatestVideo("fake")
        video.start()
        try:
            self.assertIsNotNone(video.get())
            video.pause()
            frozen = video.latest
            time.sleep(.25)
            self.assertEqual(video.latest.sequence, frozen.sequence)
            video.resume()
            next_frame = video.get(frozen.sequence)
            self.assertIsNotNone(next_frame)
            self.assertLess(next_frame.media_seconds - frozen.media_seconds, .12)
            self.assertGreater(next_frame.captured_at - frozen.captured_at, .20)
        finally:
            video.close()

    def test_http_control_requires_token_and_preserves_frame_identity(self):
        store = FrameStore(1, "video.mp4")
        store.control = PlaybackControl(Mock(), Mock(), Mock(), enabled=True)
        server = create_server(store, 0, "x" * 32)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        connection = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
        try:
            body = json.dumps({"action": "pause", "backend_id": "backend"})
            connection.request("POST", "/control", body, {"X-Demo-Control": "x"*32})
            response = connection.getresponse()
            self.assertEqual(response.status, 409)
            response.read()
            store.control.on_pause.assert_not_called()
            store.publish(b"jpeg", frame_id=9, media_seconds=2.0)
            connection.request("POST", "/control", body)
            response = connection.getresponse()
            self.assertEqual(response.status, 403)
            response.read()
            connection.request("POST", "/control", body, {"X-Demo-Control": "x"*32})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            paused = json.loads(response.read())
            self.assertEqual(paused["playback_state"], "paused")
            self.assertEqual(paused["frame_id"], 9)
            self.assertEqual(store.sequence, 1)
        finally:
            connection.close()
            store.stop()
            server.shutdown()
            server.server_close()
            thread.join(2)
