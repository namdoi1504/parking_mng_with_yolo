"""Bounded latest-frame pipeline: video playback never waits for inference."""

import threading
import time
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class VideoFrame:
    sequence: int
    epoch: int
    media_seconds: float
    captured_at: float
    image: np.ndarray


class LatestVideo:
    """One decoder owns VideoCapture; consumers skip old frames, never queue."""

    def __init__(self, source: str) -> None:
        self.cap = cv2.VideoCapture(source)
        if not self.cap.isOpened():
            self.cap.release()
            raise RuntimeError(f"Cannot open video: {source}")
        self.fps = self.cap.get(cv2.CAP_PROP_FPS) or 30
        self.total = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.condition = threading.Condition()
        self.stopping = threading.Event()
        self.latest: VideoFrame | None = None
        self.error: Exception | None = None
        self.thread = threading.Thread(target=self._decode, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def get(self, previous: int = -1) -> VideoFrame | None:
        with self.condition:
            self.condition.wait_for(lambda: self.stopping.is_set() or self.error is not None
                                    or (self.latest is not None and self.latest.sequence != previous), 1)
            if self.error is not None:
                raise RuntimeError("Video decoder failed") from self.error
            return self.latest if self.latest and self.latest.sequence != previous else None

    def close(self) -> None:
        self.stopping.set()
        with self.condition:
            self.condition.notify_all()
        self.thread.join(timeout=5)

    def _decode(self) -> None:
        started = time.perf_counter()
        sequence, epoch = 0, -1
        try:
            while not self.stopping.is_set():
                tick = int((time.perf_counter() - started) * self.fps)
                current_epoch = tick // self.total if self.total else 0
                target = tick % self.total if self.total else tick
                position = int(self.cap.get(cv2.CAP_PROP_POS_FRAMES))
                if current_epoch != epoch or target < position or target - position > self.fps:
                    self.cap.set(cv2.CAP_PROP_POS_FRAMES, target)
                else:
                    for _ in range(max(0, target - position)):
                        if not self.cap.grab():
                            break
                ok, image = self.cap.read()
                if not ok:
                    raise RuntimeError("Cannot decode video frame")
                epoch = current_epoch
                sequence += 1
                sample = VideoFrame(sequence, epoch, target / self.fps, time.perf_counter(), image)
                with self.condition:
                    self.latest = sample
                    self.condition.notify_all()
                self.stopping.wait(max(0, started + (tick + 1) / self.fps - time.perf_counter()))
        except Exception as error:
            with self.condition:
                self.error = error
                self.condition.notify_all()
        finally:
            self.cap.release()


class SlotRenderer:
    """Cache scaled polygons and static labels; render at preview resolution."""

    COLORS = {"EMPTY": (129, 185, 14), "OCCUPIED": (232, 103, 40),
              "RESERVED": (17, 159, 245), "UNKNOWN": (72, 69, 239)}

    def __init__(self, regions: list[dict], slot_map: dict[int, str],
                 image_shape: tuple, width: int = 1280) -> None:
        height, original_width = image_shape[:2]
        self.scale = min(1.0, width / original_width)
        self.size = (round(original_width * self.scale), round(height * self.scale))
        self.polygons = [(slot_map[i], np.rint(np.array(r["points"]) * self.scale)
                          .astype(np.int32).reshape(-1, 1, 2))
                         for i, r in enumerate(regions) if i in slot_map]
        self.labels = np.zeros((self.size[1], self.size[0], 3), dtype=np.uint8)
        for code, polygon in self.polygons:
            center = polygon[:, 0].mean(axis=0).astype(int)
            label = code.zfill(3) if code.isdigit() else code
            cv2.putText(self.labels, label, (center[0] - 8, center[1] + 3),
                        cv2.FONT_HERSHEY_SIMPLEX, .23, (255, 255, 255), 1, cv2.LINE_AA)
        self.label_rows, self.label_cols = np.nonzero(self.labels[:, :, 0])
        self.label_pixels = self.labels[self.label_rows, self.label_cols]

    def draw(self, image: np.ndarray, statuses: list[dict], boxes: np.ndarray) -> np.ndarray:
        frame = cv2.resize(image, self.size) if self.scale != 1 else image.copy()
        # A single bulk GPU->CPU transfer happened before this call.
        for box in boxes:
            x1, y1, x2, y2 = (box * self.scale).astype(int)
            cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 80, 180), 1)
        status_map = {s["slot_code"]: s["status"] for s in statuses}
        overlay = frame.copy()
        outlines = []
        for code, polygon in self.polygons:
            color = self.COLORS[status_map.get(code, "UNKNOWN")]
            cv2.fillPoly(overlay, [polygon], color)
            outlines.append((polygon, color))
        cv2.addWeighted(overlay, .25, frame, .75, 0, frame)
        for polygon, color in outlines:
            cv2.polylines(frame, [polygon], True, color, 1)
        frame[self.label_rows, self.label_cols] = self.label_pixels
        return frame
