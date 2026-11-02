"""Process-local demo clock. Authentication and network freshness stay in real UTC."""
from datetime import datetime, timedelta, timezone
from threading import RLock
from time import monotonic

from . import observation_runtime
from .config import settings

# Serialize demo resets with manual writes and statistics snapshots.
demo_operation_lock = RLock()


def wall_now():
    return datetime.now(timezone.utc)


def stamp(value):
    result = datetime.fromisoformat(value)
    if result.tzinfo is None:
        raise ValueError("Demo timestamp requires UTC offset")
    return result.astimezone(timezone.utc)


class DemoClock:
    def __init__(self):
        self.lock = RLock()
        self.reset()

    def reset(self):
        with self.lock:
            self.offset = timedelta()
            self.paused_wall = None
            self.pause_id = None
            self.completed_pause_id = None
            self.run_id = None
            self.lease_until = 0.0
            self.playback = "starting"
            self.seeking = False

    def now(self):
        with self.lock:
            return (self.paused_wall or wall_now()) - self.offset

    def healthy(self):
        with self.lock:
            return not self.seeking and monotonic() < self.lease_until

    def begin_seek(self):
        with self.lock:
            self.seeking = True
            self.lease_until = 0.0

    def clear_seek(self):
        with self.lock:
            self.seeking = False

    def offline(self):
        with self.lock:
            self.lease_until = 0.0

    def observe(self, data):
        with self.lock:
            if not (data.get("running") and data.get("ready") and data.get("control_enabled")
                    and data.get("seek_ready", True)
                    and data.get("camera_id") == settings.VIDEO_DEMO_CAMERA_ID and data.get("run_id")):
                self.offline()
                return
            state = data.get("playback_state")
            if state not in ("playing", "paused"):
                self.offline()
                return
            owner = data.get("owner_backend_id")
            if owner not in (None, observation_runtime.backend_id):
                self.offline()
                return  # Explicit resume is required after a backend restart.
            if self.run_id and self.run_id != data["run_id"] and self.paused_wall:
                # AI restarted while paused: stop excluding time at reattachment.
                self.offset += wall_now() - self.paused_wall
                self.paused_wall = None
            self.run_id = data["run_id"]
            pause_id = data.get("pause_id")
            if pause_id and pause_id != self.completed_pause_id:
                paused = stamp(data["paused_at"])
                resumed = stamp(data["resumed_at"]) if data.get("resumed_at") else None
                tolerance = timedelta(seconds=2)
                if paused > wall_now() + tolerance or (resumed and resumed < paused - tolerance):
                    raise ValueError("Invalid pause timestamps")
                self.pause_id, self.paused_wall = pause_id, paused
                if resumed:
                    self.offset += resumed - paused
                    self.paused_wall = None
                    self.completed_pause_id = pause_id
            self.playback = state
            self.lease_until = monotonic() + 6.0
            if data.get("seek_ready", True):
                self.seeking = False

    def observation_time(self, observed_at, run_id):
        with self.lock:
            if self.paused_wall or not self.healthy() or self.run_id != str(run_id):
                raise ValueError("Demo playback is paused, unavailable or belongs to another AI run")
            return observed_at - self.offset

    def status(self):
        with self.lock:
            return dict(enabled=settings.VIDEO_DEMO_ENABLED, backend_id=observation_runtime.backend_id,
                        business_time=self.now().isoformat(), wall_time=wall_now().isoformat(),
                        paused=self.paused_wall is not None, healthy=self.healthy(),
                        excluded_pause_seconds=self.offset.total_seconds(),
                        run_id=self.run_id, playback_state=self.playback, seeking=self.seeking)


demo_clock = DemoClock()


def business_now():
    return demo_clock.now() if settings.VIDEO_DEMO_ENABLED else wall_now()
