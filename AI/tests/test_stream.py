"""No GPU, video, backend writes or third-party dependencies needed."""
import json
import threading
import unittest
from http.client import HTTPConnection

from AI.datasets.stream_server import FrameStore, create_server


class StreamTests(unittest.TestCase):
    def setUp(self):
        self.store = FrameStore(1, "sample.mp4")
        self.server = create_server(self.store, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)

    def tearDown(self):
        self.connection.close()
        self.store.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_waiting_snapshot_is_not_a_video(self):
        self.connection.request("GET", "/frame.jpg")
        response = self.connection.getresponse()
        self.assertEqual(response.status, 503)
        self.assertIn(b"Waiting", response.read())

    def test_latest_frame_replaces_old_frame(self):
        self.store.publish(b"old", frame_id=1)
        self.store.publish(b"new", frame_id=2)
        self.connection.request("GET", "/frame.jpg")
        response = self.connection.getresponse()
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("Content-Type"), "image/jpeg")
        self.assertEqual(response.read(), b"new")
        self.assertEqual(self.store.sequence, 2)

    def test_status_reports_actual_frame_and_sync(self):
        self.store.publish(b"jpeg", frame_id=3, empty=188, occupied=282)
        self.store.sync_result(False)
        self.connection.request("GET", "/status")
        response = self.connection.getresponse()
        status = json.loads(response.read())
        self.assertTrue(status["ready"])
        self.assertEqual(status["frame_id"], 3)
        self.assertFalse(status["sync_ok"])
        self.assertGreaterEqual(status["frame_age_seconds"], 0)
        self.store.stop()
        self.assertFalse(self.store.status()["running"])

    def test_mjpeg_has_boundary_and_jpeg_bytes(self):
        self.store.publish(b"jpeg")
        self.connection.request("GET", "/video")
        response = self.connection.getresponse()
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("Content-Type"), "multipart/x-mixed-replace; boundary=frame")
        expected = b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 4\r\n\r\njpeg\r\n"
        self.assertEqual(response.read(len(expected)), expected)

    def test_no_arbitrary_file_serving(self):
        self.connection.request("GET", "/parking_car.mp4")
        response = self.connection.getresponse()
        self.assertEqual(response.status, 404)
        response.read()


if __name__ == "__main__":
    unittest.main()
