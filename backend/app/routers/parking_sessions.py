from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .. import models, schemas
from ..db import get_db
from ..oauth2 import require_admin
from ..services.parking_slots import manual_action
from ..websocket_manager import manager
from .common import get_or_404

router = APIRouter(prefix="/parking-sessions", tags=["Parking sessions"],
                   dependencies=[Depends(require_admin)])


@router.get("", response_model=schemas.ParkingSessionListResponse)
def list_sessions(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                  status: schemas.ParkingSessionStatus | None = None,
                  parking_slot_id: int | None = Query(None, gt=0),
                  license_plate: str | None = Query(None, max_length=30),
                  phone_number: str | None = Query(None, max_length=30),
                  created_from: datetime | None = None, created_to: datetime | None = None,
                  db: Session = Depends(get_db)):
    for stamp in (created_from, created_to):
        if stamp is not None and (stamp.tzinfo is None or stamp.utcoffset() is None):
            raise HTTPException(422, "Time filters require a timezone")
    if created_from and created_to and created_to <= created_from:
        raise HTTPException(422, "created_to must be after created_from")
    query = db.query(models.ParkingSession)
    if status:
        query = query.filter_by(status=status.value)
    if parking_slot_id:
        query = query.filter_by(parking_slot_id=parking_slot_id)
    if license_plate:
        plate = license_plate.upper().replace(" ", "").replace("-", "").replace(".", "")
        query = query.filter_by(license_plate=plate)
    if phone_number:
        query = query.filter_by(phone_number=phone_number.strip())
    if created_from:
        query = query.filter(models.ParkingSession.created_at >= created_from)
    if created_to:
        query = query.filter(models.ParkingSession.created_at < created_to)
    total = query.count()
    return {"data": query.order_by(models.ParkingSession.id.desc()).offset((page-1)*page_size).limit(page_size).all(),
            "meta": {"page": page, "page_size": page_size, "total": total,
                     "total_pages": (total + page_size - 1)//page_size}}


@router.get("/{session_id}", response_model=schemas.ParkingSessionResponse)
def get_session(session_id: int = Path(gt=0), db: Session = Depends(get_db)):
    return get_or_404(db, models.ParkingSession, session_id)


@router.get("/{session_id}/events", response_model=schemas.ParkingEventListResponse)
def session_events(session_id: int = Path(gt=0), page: int = Query(1, ge=1),
                   page_size: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    get_or_404(db, models.ParkingSession, session_id)
    query = db.query(models.ParkingEvent).filter_by(parking_session_id=session_id)
    total = query.count()
    return {"data": query.order_by(models.ParkingEvent.event_time, models.ParkingEvent.id).offset(
        (page-1)*page_size).limit(page_size).all(), "meta": {"page": page, "page_size": page_size,
        "total": total, "total_pages": (total + page_size - 1)//page_size}}


@router.post("/{session_id}/check-out", response_model=schemas.ParkingSlotResponse)
async def check_out(session_id: int = Path(gt=0), db: Session = Depends(get_db), user=Depends(require_admin)):
    def execute():
        session = get_or_404(db, models.ParkingSession, session_id)
        return manual_action(db, session.parking_slot_id, "check-out", user.id, expected_session_id=session_id)
    response, messages = await run_in_threadpool(execute)
    for message in messages:
        await manager.broadcast(message)
    return response
