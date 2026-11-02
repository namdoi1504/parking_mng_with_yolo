"""Fixed loopback control gateway, serialized commands, and a short AI health lease."""
import json
import math
from collections import OrderedDict
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

from fastapi import HTTPException

from .. import observation_runtime
from ..config import settings
from ..demo_runtime import demo_clock, demo_operation_lock
from ..parking_cache import parking_cache

commands = Lock()
UPSTREAM = "http://127.0.0.1:8001"
completed_seeks = OrderedDict()


def reset():
    with commands:
        completed_seeks.clear()


def exchange(action=None, **parameters):
    if not settings.VIDEO_DEMO_ENABLED:
        raise HTTPException(404, "Video demo is disabled")
    headers, body = {}, None
    path = "/status"
    if action:
        path = "/control"
        headers = {"Content-Type": "application/json", "X-Demo-Control": settings.VIDEO_DEMO_CONTROL_TOKEN}
        body = json.dumps({"action": action, "backend_id": observation_runtime.backend_id, **parameters}).encode()
    request = Request(UPSTREAM + path, data=body, headers=headers)
    try:
        with build_opener(ProxyHandler({})).open(request, timeout=25 if action else 3) as response:
            limit = 4 * 1024 * 1024 if action == "seek" else 65536
            raw = response.read(limit + 1)
            if len(raw) > limit:
                raise ValueError("Oversized AI status")
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("Invalid AI status")
            if action not in ("seek", "confirm-seek"):
                demo_clock.observe(data)
            parking_cache.invalidate()
            return {"playback": data, "clock": demo_clock.status()}
    except HTTPError as exc:
        code = exc.code
        exc.close()
        demo_clock.offline()
        raise HTTPException(409 if code == 409 else 503, "AI rejected the demo command; check playback status") from exc
    except (URLError, OSError, TimeoutError, ValueError, KeyError, TypeError) as exc:
        demo_clock.offline()
        raise HTTPException(503, "AI demo is unavailable; manual actions require a healthy playback") from exc


def control(action):
    with commands:
        if action == "resume":
            demo_clock.clear_seek()
        elif demo_clock.seeking:
            raise HTTPException(409, "A seek is incomplete; retry seek before pause/resume")
        return exchange(action)


def seek(db, request):
    from .video_demo_seek import reset_snapshot
    key = str(request.request_id)
    with commands, demo_operation_lock:
        current = exchange()
        previous = completed_seeks.get(key)
        if previous:
            if previous["seconds"] != request.seconds or previous["run_id"] != current["playback"].get("run_id"):
                raise HTTPException(409, "Seek request_id is obsolete or used with another position")
            return {**current, "request_id": key, "reset": previous["reset"], "replayed": True}
        duration = current["playback"].get("duration_seconds", 0)
        if not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 0 <= request.seconds < duration:
            raise HTTPException(422, "seconds must be within the video duration")
        if not current["playback"].get("control_enabled") or not current["playback"].get("ready"):
            raise HTTPException(409, "Wait for the first video frame before seeking")
        demo_clock.begin_seek()
        parking_cache.invalidate()
        try:
            moved = exchange("seek", seconds=request.seconds, request_id=key)["playback"]
            counts = reset_snapshot(db, moved, request)
            db.commit()
            confirmed = exchange("confirm-seek", request_id=key)["playback"]
            if (confirmed.get("seek_id") != key or confirmed.get("run_id") != moved.get("run_id")
                    or not confirmed.get("seek_ready") or confirmed.get("playback_state") != "paused"):
                raise HTTPException(503, "Seek acknowledgement did not match; retry the same request_id")
            demo_clock.reset()
            demo_clock.observe(confirmed)
            parking_cache.invalidate()
            completed_seeks[key] = {"seconds": request.seconds, "run_id": confirmed["run_id"], "reset": counts}
            return {"playback": confirmed, "clock": demo_clock.status(),
                    "request_id": key, "reset": counts, "replayed": False}
        except Exception:
            db.rollback()
            demo_clock.begin_seek()
            parking_cache.invalidate()
            raise


def refresh():
    # Never let a slow pause command block lifespan's health sweep thread pool.
    if not commands.acquire(blocking=False):
        return
    try:
        exchange()
    except HTTPException:
        pass
    finally:
        commands.release()


def status():
    with commands:
        return exchange()
