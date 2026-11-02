"""Serialize playback commands and drain inference/render work before acknowledging."""
from datetime import datetime, timezone
from threading import Condition, Lock, RLock
from uuid import uuid4


class PlaybackControl:
    def __init__(self, video, on_pause, on_resume, enabled=False, on_seek=None):
        self.video = video
        self.on_pause, self.on_resume = on_pause, on_resume
        self.enabled = enabled
        self.on_seek = on_seek
        self.seek_id = None
        self.seek_seconds = None
        self.seek_ready = True
        self.seek_snapshot = None
        self.work = RLock()
        self.render = RLock()
        self.commands = Lock()
        self.condition = Condition()
        self.state = "playing"
        self.owner = None
        self.pause_id = None
        self.paused_at = self.resumed_at = None
        self.generation = 0

    @property
    def blocked(self):
        with self.condition:
            return self.state != "playing"

    def wait(self, stop):
        with self.condition:
            self.condition.wait_for(lambda: self.state == "playing" or stop.is_set(), 1)
            return self.state == "playing" and not stop.is_set()

    def status(self):
        with self.condition:
            return dict(control_enabled=self.enabled, playback_state=self.state,
                        owner_backend_id=self.owner, pause_id=self.pause_id,
                        paused_at=self.paused_at, resumed_at=self.resumed_at,
                        seek_id=self.seek_id, seek_seconds=self.seek_seconds, seek_ready=self.seek_ready)

    def command(self, action, backend_id, seconds=None, request_id=None):
        if not self.enabled:
            raise ValueError("Video demo controls are disabled")
        with self.commands:
            if action == "seek":
                self.video.validate_seek(seconds)
                if not self.on_seek or not isinstance(request_id, str) or not request_id:
                    raise ValueError("Seek requires a request_id and a seek-capable agent")
                if request_id == self.seek_id and self.seek_snapshot is not None:
                    if self.owner != backend_id or seconds != self.seek_seconds or self.seek_snapshot is None:
                        raise ValueError("Seek request cannot be reused with another target or backend")
                    return {**self.status(), "seek_snapshot": self.seek_snapshot}
                with self.condition:
                    self.state = "seeking"
                self.video.pause()
                with self.work, self.render:
                    self.generation += 1
                    self.seek_ready = False
                    self.seek_id, self.seek_seconds, self.seek_snapshot = request_id, seconds, None
                    try:
                        snapshot = self.on_seek(seconds)
                        self.seek_id, self.seek_seconds, self.seek_snapshot = request_id, seconds, snapshot
                        self.owner = backend_id
                        self.pause_id = str(uuid4())
                        self.paused_at = datetime.now(timezone.utc).isoformat()
                        self.resumed_at = None
                    finally:
                        # On failure remain paused and fail closed until another seek succeeds.
                        with self.condition:
                            self.state = "paused"
                return {**self.status(), "seek_snapshot": snapshot}
            elif action == "confirm-seek":
                if self.owner != backend_id or request_id != self.seek_id or self.seek_snapshot is None:
                    raise ValueError("No matching seek to acknowledge")
                self.seek_ready = True
            elif action == "pause":
                with self.condition:
                    if self.state == "paused":
                        if self.owner != backend_id:
                            raise ValueError("Backend restarted; resume first to obtain fresh observations")
                        return self.status()
                    self.state = "pausing"
                self.video.pause()
                try:
                    # No new inference/render starts once state becomes pausing.
                    with self.work, self.render:
                        self.on_pause()
                        with self.condition:
                            self.owner = backend_id
                            self.pause_id = str(uuid4())
                            self.paused_at = datetime.now(timezone.utc).isoformat()
                            self.resumed_at = None
                            self.state = "paused"
                except Exception:
                    with self.condition:
                        self.state = "playing"
                        self.condition.notify_all()
                    self.video.resume()
                    raise
            elif action == "resume":
                if not self.seek_ready:
                    raise ValueError("Seek has not been applied by the backend; retry seek first")
                with self.work, self.render:
                    # Rebinding after a backend restart deliberately starts a new
                    # runtime clock; persisted observations still require refresh.
                    if self.owner not in (None, backend_id):
                        self.pause_id = self.paused_at = self.resumed_at = None
                    self.owner = backend_id
                    if self.blocked:
                        self.on_resume()
                        self.generation += 1
                        self.resumed_at = datetime.now(timezone.utc).isoformat()
                        self.video.resume()
                        with self.condition:
                            self.state = "playing"
                            self.condition.notify_all()
            else:
                raise ValueError("Only pause/resume/seek/confirm-seek are supported")
            return self.status()
