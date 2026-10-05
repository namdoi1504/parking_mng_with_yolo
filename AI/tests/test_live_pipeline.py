"""Latest-frame playback and cached preview drawing, without backend writes."""
import time
import unittest
from unittest.mock import patch

import cv2
import numpy as np

from AI.datasets.live_pipeline import LatestVideo, SlotRenderer


class FakeCapture:
    def __init__(self, fail=False):
        self.position = 0
        self.fail = fail
        self.released = False

    def isOpened(self):
        return True

    def get(self, key):
        return {cv2.CAP_PROP_FPS: 100, cv2.CAP_PROP_FRAME_COUNT: 4,
                cv2.CAP_PROP_POS_FRAMES: self.position}.get(key, 0)

    def set(self, key, value):
        self.position = int(value)

    def grab(self):
        self.position += 1
        return True

    def read(self):
        self.position += 1
        return not self.fail, np.zeros((20, 30, 3), np.uint8)

    def release(self):
        self.released = True


class PipelineTests(unittest.TestCase):
    def test_early_timer_wakeup_does_not_seek_back_to_previous_frame(self):
        cap = FakeCapture()
        seeks = []
        original_set = cap.set
        def record_seek(key, value):
            seeks.append(value)
            return original_set(key, value)
        cap.set = record_seek
        with patch("AI.datasets.live_pipeline.cv2.VideoCapture", return_value=cap):
            video = LatestVideo("fake.mp4")
        clock = [0.0]
        class EarlyWake:
            calls = 0
            stopped = False
            def is_set(self):
                return self.stopped
            def wait(self, seconds):
                self.calls += 1
                # First sleep wakes one microsecond before the next tick.
                clock[0] += max(0, seconds - 1e-6) if self.calls == 1 else seconds
                self.stopped = self.calls >= 3
                return self.stopped
        video.stopping = EarlyWake()
        with patch("AI.datasets.live_pipeline.time.perf_counter", side_effect=lambda: clock[0]):
            video._decode()
        self.assertEqual(seeks, [0])
        self.assertEqual(video.latest.sequence, 2)
        self.assertTrue(cap.released)

    def test_slow_consumer_skips_frames_and_loop_has_new_epoch(self):
        cap = FakeCapture()
        with patch("AI.datasets.live_pipeline.cv2.VideoCapture", return_value=cap):
            video = LatestVideo("fake.mp4")
        video.start()
        try:
            first = video.get()
            deadline = time.monotonic() + 2
            while video.latest.epoch < 1 and time.monotonic() < deadline:
                time.sleep(.01)
            later = video.get(first.sequence)
            self.assertGreater(later.sequence, first.sequence + 1)
            self.assertGreater(later.epoch, first.epoch)
        finally:
            video.close()
        self.assertTrue(cap.released)
        self.assertFalse(video.thread.is_alive())

    def test_decoder_failure_is_reported_and_releases_capture(self):
        cap = FakeCapture(fail=True)
        with patch("AI.datasets.live_pipeline.cv2.VideoCapture", return_value=cap):
            video = LatestVideo("fake.mp4")
        video.start()
        try:
            with self.assertRaisesRegex(RuntimeError, "decoder failed"):
                video.get()
        finally:
            video.close()
        self.assertTrue(cap.released)

    def test_scaled_overlay_preserves_status_color_and_input(self):
        image = np.zeros((120, 200, 3), np.uint8)
        renderer = SlotRenderer([{"points": [[10, 10], [100, 10], [100, 100], [10, 100]]}],
                                {0: "001"}, image.shape, width=100)
        for status in ["EMPTY", "OCCUPIED", "UNKNOWN"]:
            frame = renderer.draw(image, [{"slot_code": "001", "status": status}], np.empty((0, 4)))
            self.assertEqual(frame.shape, (60, 100, 3))
            np.testing.assert_allclose(frame[10, 10], np.array(renderer.COLORS[status]) * .25, atol=1)
        self.assertFalse(image.any())


if __name__ == "__main__":
    unittest.main()
