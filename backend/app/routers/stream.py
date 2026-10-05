"""Authenticated gateway to the loopback-only AI preview service."""

import json
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, build_opener

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse
from starlette.background import BackgroundTask

from ..oauth2 import require_permission

router = APIRouter(prefix="/ai-stream", tags=["AI video"],
                   dependencies=[Depends(require_permission("parking:view"))])
UPSTREAM = "http://127.0.0.1:8001"


def open_preview(path):
    try:
        # Keep the target fixed and bypass machine-wide HTTP proxies.
        return build_opener(ProxyHandler({})).open(UPSTREAM + path, timeout=12)
    except HTTPError as exc:
        code = exc.code
        exc.close()
        raise HTTPException(503 if code == 503 else 502, "AI video is unavailable") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise HTTPException(503, "AI preview service is not connected") from exc


@router.get("/status")
def status():
    with open_preview("/status") as upstream:
        try:
            payload = upstream.read(65537)
            if len(payload) > 65536:
                raise ValueError("Oversized status")
            data = json.loads(payload)
        except (ValueError, TimeoutError, OSError) as exc:
            raise HTTPException(502, "Invalid AI preview status") from exc
    return Response(json.dumps(data), media_type="application/json",
                    headers={"Cache-Control": "no-store"})


@router.get("/video")
def video():
    upstream = open_preview("/video")
    content_type = upstream.headers.get("Content-Type", "")
    if not content_type.lower().startswith("multipart/x-mixed-replace"):
        upstream.close()
        raise HTTPException(502, "Invalid AI video response")

    def chunks():
        # Reconnect periodically so login expiry and permission changes are checked.
        deadline = time.monotonic() + 60
        try:
            while time.monotonic() < deadline:
                chunk = upstream.read1(65536)
                if not chunk:
                    break
                yield chunk
        except (TimeoutError, OSError):
            return
        finally:
            upstream.close()

    return StreamingResponse(chunks(), media_type=content_type,
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
                             background=BackgroundTask(upstream.close))
