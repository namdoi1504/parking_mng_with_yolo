"""Bounded latest-frame pipeline: video playback never waits for inference."""

import math
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

    def __init__(self, source: str, playback_speed: float = 1.0) -> None:
        if not math.isfinite(playback_speed) or playback_speed <= 0:
            raise ValueError("playback_speed must be finite and positive")
        self.playback_speed = playback_speed
        self.cap = cv2.VideoCapture(source)
        if not self.cap.isOpened():
            self.cap.release()
            raise RuntimeError(f"Cannot open video: {source}")
        self.fps = self.cap.get(cv2.CAP_PROP_FPS) or 30
        self.total = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.playback_fps = self.fps * self.playback_speed
        self.condition = threading.Condition()
        self.stopping = threading.Event()
        self.latest: VideoFrame | None = None
        self.paused_at: float | None = None
        self.paused_seconds = 0.0
        self._sequence = 0
        self._seek_revision = 0
        self._seek_origin = 0.0
        self._seek_target = 0
        self._seek_epoch = 0
        self.error: Exception | None = None
        self.thread = threading.Thread(target=self._decode, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def pause(self) -> None:
        with self.condition:
            if self.paused_at is None:
                self.paused_at = time.perf_counter()
            self.condition.notify_all()

    def resume(self) -> None:
        with self.condition:
            if self.paused_at is not None:
                self.paused_seconds += time.perf_counter() - self.paused_at
                self.paused_at = None
                self.latest = None  # Never analyze a buffered pre-pause frame.
            self.condition.notify_all()

    @property
    def duration_seconds(self):
        return self.total / self.fps if self.total else 0.0

    def validate_seek(self, seconds):
        if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or not math.isfinite(seconds):
            raise ValueError("Seek position must be a finite number of seconds")
        if not self.total or not 0 <= seconds < self.duration_seconds:
            raise ValueError("Seek position must be within the video duration")

    def seek(self, seconds):
        self.validate_seek(seconds)
        with self.condition:
            if self.paused_at is None:
                raise ValueError("Pause the decoder before seeking")
            target = min(int(seconds * self.fps), self.total - 1)
            if not self.cap.set(cv2.CAP_PROP_POS_FRAMES, target):
                raise ValueError("Video source does not support seeking")
            ok, image = self.cap.read()
            if not ok:
                raise ValueError("Cannot decode the requested video frame")
            captured = time.perf_counter()
            self._sequence += 1
            self._seek_epoch = (self.latest.epoch if self.latest else self._seek_epoch) + 1
            self._seek_revision += 1
            self._seek_target = target
            self._seek_origin = captured - target / self.playback_fps - self.paused_seconds
            self.paused_at = captured
            self.latest = VideoFrame(self._sequence, self._seek_epoch, target / self.fps, captured, image)
            self.condition.notify_all()
            return self.latest

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
        revision, epoch, epoch_offset, last_tick = 0, -1, 0, -1
        try:
            while not self.stopping.is_set():
                with self.condition:
                    self.condition.wait_for(lambda: self.paused_at is None or self.stopping.is_set())
                    if self.stopping.is_set():
                        break
                    if revision != self._seek_revision:
                        revision = self._seek_revision
                        started, last_tick = self._seek_origin, self._seek_target
                        epoch = epoch_offset = self._seek_epoch
                    origin = started + self.paused_seconds
                tick = int((time.perf_counter() - origin) * self.playback_fps)
                # Event.wait may wake just before the next frame deadline. Re-reading
                # the same tick would seek backward into a compressed video GOP.
                if tick <= last_tick:
                    self.stopping.wait(max(.001, origin + (last_tick + 1) / self.playback_fps
                                           - time.perf_counter()))
                    continue
                with self.condition:
                    if (self.paused_at is not None or origin != started + self.paused_seconds
                            or revision != self._seek_revision):
                        continue
                    current_epoch = epoch_offset + (tick // self.total if self.total else 0)
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
                    last_tick = tick
                    self._sequence += 1
                    sample = VideoFrame(self._sequence, epoch, target / self.fps, time.perf_counter(), image)
                    with self.condition:
                        if self.paused_at is None:
                            self.latest = sample
                            self.condition.notify_all()
                self.stopping.wait(max(0, origin + (tick + 1) / self.playback_fps - time.perf_counter()))
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
