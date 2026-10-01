"""Loopback-only MJPEG preview for processed AI frames, not a production gateway."""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


class FrameStore:
    """Keep only the latest JPEG so slow viewers cannot accumulate a backlog."""

    def __init__(self, camera_id: int, source_name: str) -> None:
        self.condition = threading.Condition()
        self.jpeg: bytes | None = None
        self.sequence = 0
        self.stopped = False
        self.metadata: dict[str, Any] = {
            "camera_id": camera_id, "source_name": source_name,
            "source_type": "VIDEO_FILE", "frame_id": 0, "updated_at": None,
            "fps": 0, "media_seconds": 0, "occupied": 0, "empty": 0,
            "sync_ok": None, "sync_at": None,
        }

    def publish(self, jpeg: bytes, **metadata: Any) -> None:
        with self.condition:
            self.jpeg = jpeg
            self.sequence += 1
            self.metadata.update(metadata, updated_at=time.time())
            self.condition.notify_all()

    def sync_result(self, success: bool) -> None:
        with self.condition:
            self.metadata.update(sync_ok=success, sync_at=time.time())

    def status(self) -> dict[str, Any]:
        with self.condition:
            age = time.time() - self.metadata["updated_at"] if self.jpeg else None
            return {**self.metadata, "ready": self.jpeg is not None,
                    "running": not self.stopped, "frame_age_seconds": age}

    def stop(self) -> None:
        with self.condition:
            self.stopped = True
            self.condition.notify_all()


def create_server(store: FrameStore, port: int = 8001) -> ThreadingHTTPServer:
    viewers = threading.BoundedSemaphore(4)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            # Do not spam the AI console for health polling or log request URLs.
            return

        def reply(self, code: int, content_type: str, body: bytes) -> None:
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            path = urlsplit(self.path).path
            try:
                if path == "/":
                    self.reply(200, "text/html; charset=utf-8",
                               Path(__file__).with_name("stream_preview.html").read_bytes())
                elif path == "/status":
                    self.reply(200, "application/json", json.dumps(store.status()).encode())
                elif path == "/frame.jpg":
                    with store.condition:
                        jpeg = store.jpeg
                    self.reply(200 if jpeg else 503, "image/jpeg" if jpeg else "text/plain",
                               jpeg or b"Waiting for the first processed frame")
                elif path == "/video":
                    self.stream()
                else:
                    self.reply(404, "text/plain", b"Not found")
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                return

        def stream(self) -> None:
            if not viewers.acquire(blocking=False):
                self.reply(503, "text/plain", b"Too many preview viewers")
                return
            try:
                if not store.status()["ready"]:
                    self.reply(503, "text/plain", b"Waiting for the first processed frame")
                    return
                self.connection.settimeout(10)
                self.send_response(200)
                self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                previous = -1
                while True:
                    with store.condition:
                        store.condition.wait_for(lambda: store.stopped or store.sequence != previous,
                                                 timeout=10)
                        if store.stopped:
                            break
                        if store.sequence == previous:
                            continue
                        jpeg, previous = store.jpeg, store.sequence
                    if jpeg:
                        self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                         + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n")
                        self.wfile.flush()
            finally:
                viewers.release()

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server
