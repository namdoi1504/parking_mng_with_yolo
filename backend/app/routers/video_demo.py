from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..oauth2 import require_admin
from ..schemas import VideoDemoStatus, VideoDemoSeekRequest, VideoDemoSeekResult
from ..db import get_db
from ..websocket_manager import manager
from ..services import video_demo

router = APIRouter(prefix="/api/video-demo", tags=["Video demo"],
                   dependencies=[Depends(require_admin)])


@router.get("/status", response_model=VideoDemoStatus)
def status():
    return video_demo.status()


@router.post("/pause", response_model=VideoDemoStatus)
def pause():
    return video_demo.control("pause")


@router.post("/resume", response_model=VideoDemoStatus)
def resume():
    return video_demo.control("resume")


@router.post("/seek", response_model=VideoDemoSeekResult)
async def seek(payload: VideoDemoSeekRequest, db: Session = Depends(get_db)):
    result = await run_in_threadpool(video_demo.seek, db, payload)
    if not result["replayed"]:
        await manager.broadcast({"type": "VIDEO_DEMO_SEEKED", "request_id": result["request_id"],
                                 "run_id": result["playback"]["run_id"], "reset": result["reset"]})
    return result
