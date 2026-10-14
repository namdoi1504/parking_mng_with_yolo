from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from uuid import UUID, uuid4
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..db import get_db
from ..config import settings
from ..parking_cache import parking_cache
from .. import models
from ..services.parking_slots import (reconcile, slot_response, now_utc, utc, active_sessions, persist_observed_slots)
from ..schemas import (
    AIParkingStatusRequest,
    AIUpdateResult,
    ParkingMapResponse,
    ParkingSlotResponse,
    ParkingSummary,
    CameraSourceType,
    ROICoordinate,
)
from ..websocket_manager import manager
from .common import commit, get_or_404, lock_camera_creation, advance_camera_sequence

router = APIRouter(prefix="/api/ai", tags=["AI Engine"])


class SlotSyncItem(BaseModel):
    slot_code: str = Field(min_length=1, max_length=50)
    roi_coordinates: list[ROICoordinate]   # [{"x": float, "y": float}, ...]
    col: int = Field(default=0, ge=0)
    row: int = Field(default=0, ge=0)


class SlotSyncRequest(BaseModel):
    run_id: UUID | None = None
    camera_id: int = Field(gt=0, le=2147483647)
    camera_name: str = Field(default="Camera 1", min_length=1, max_length=100)
    camera_source_url: str = Field(default="file://parking_car.mp4", min_length=1, max_length=255)
    camera_source_type: CameraSourceType = CameraSourceType.VIDEO_FILE
    slots: list[SlotSyncItem]

    @model_validator(mode="after")
    def unique_codes(self):
        codes = [slot.slot_code for slot in self.slots]
        if len(codes) != len(set(codes)):
            raise ValueError("Duplicate slot codes")
        return self


class SlotSyncResult(BaseModel):
    run_id: str
    camera_id: int
    total: int
    created: int
    updated: int
    unchanged: int


@router.post(
    "/sync-slots",
    response_model=SlotSyncResult,
    summary="AI engine đồng bộ danh sách slot với DB khi khởi động"
)
def sync_slots(data: SlotSyncRequest, db: Session = Depends(get_db)):
    created = updated = unchanged = 0
    lock_camera_creation(db)

    camera = db.query(models.Camera).filter(models.Camera.id == data.camera_id).first()
    if camera is None:
        camera = models.Camera(
            id          = data.camera_id,
            name        = data.camera_name,
            source_type = data.camera_source_type.value,
            source_url  = data.camera_source_url,
            status      = "CONNECTED",
        )
        db.add(camera)
        db.flush()
        advance_camera_sequence(db)
        actual_camera_id = camera.id
    else:
        actual_camera_id = camera.id

    camera = db.query(models.Camera).filter_by(id=actual_camera_id).with_for_update().populate_existing().one()
    run_id = str(data.run_id) if data.run_id else camera.ai_run_id or str(uuid4())
    if camera.ai_run_id != run_id:
        camera.ai_run_id = run_id
        camera.ai_sequence = 0
    existing_slots = (
        db.query(models.ParkingSlot)
        .filter(models.ParkingSlot.camera_id == actual_camera_id)
        .all()
    )
    existing_by_code: dict[str, models.ParkingSlot] = {
        s.slot_code: s for s in existing_slots
    }

    conflicts = db.query(models.ParkingSlot.id).filter(
        models.ParkingSlot.slot_code.in_([slot.slot_code for slot in data.slots]),
        models.ParkingSlot.camera_id != actual_camera_id,
    ).first()
    if conflicts:
        raise HTTPException(409, "Slot code belongs to another camera")
    new_slots = []
    for item in data.slots:
        roi = [point.model_dump() for point in item.roi_coordinates]
        existing = existing_by_code.get(item.slot_code)
        if existing is None:
            new_slots.append(models.ParkingSlot(
                camera_id       = actual_camera_id,
                slot_code       = item.slot_code,
                roi_coordinates = roi,
                col = item.col,
                row = item.row,
                status          = None,
            ))
            created += 1
        else:
            if (existing.roi_coordinates, existing.col, existing.row) != (roi, item.col, item.row):
                existing.roi_coordinates = roi
                existing.col = item.col
                existing.row = item.row
                existing.observed_at = None
                updated += 1
            else:
                unchanged += 1

    if new_slots:
        db.add_all(new_slots)

    commit(db)

    parking_cache.invalidate()

    return SlotSyncResult(
        run_id = run_id,
        camera_id = actual_camera_id,
        total     = len(data.slots),
        created   = created,
        updated   = updated,
        unchanged = unchanged,
    )



@router.post(
    "/parking-status",
    response_model=AIUpdateResult,
    summary="AI engine gửi trạng thái từng slot về"
)
async def receive_parking_status(
    data: AIParkingStatusRequest,
    db: Session = Depends(get_db)
):
    """
    Endpoint dành riêng cho AI engine (YOLO).
    Nhận danh sách trạng thái slot → cập nhật DB → broadcast WebSocket đến FE.
    """
    result, ws_messages = await run_in_threadpool(apply_parking_status, data, db)
    # Publish only after the transaction succeeded, on the application's event loop.
    for msg in ws_messages:
        await manager.broadcast(msg)
    return result


def apply_parking_status(data: AIParkingStatusRequest, db: Session):
    """Run the complete synchronous transaction off the streaming event loop."""
    messages = []
    try:
        camera = get_or_404(db, models.Camera, data.camera_id, lock=True)
        now = now_utc()
        observed_at = utc(data.observed_at)
        if camera.ai_run_id != str(data.run_id):
            raise HTTPException(409, "AI run is not active; sync slots first")
        if data.sequence <= camera.ai_sequence:
            raise HTTPException(409, "Duplicate or out-of-order observation")
        age = (now - observed_at).total_seconds()
        if age < 0 or age > settings.OBSERVATION_MAX_AGE_SECONDS:
            raise HTTPException(409, "Observation is stale or in the future")
        incoming_codes = [item.slot_code for item in data.parking_slots]
        rows = (db.query(models.ParkingSlot).filter(models.ParkingSlot.camera_id == camera.id,
                models.ParkingSlot.slot_code.in_(incoming_codes)).order_by(models.ParkingSlot.id)
                .with_for_update().populate_existing().all())
        by_code = {slot.slot_code: slot for slot in rows}
        sessions = active_sessions(db, [slot.id for slot in rows])
        # Timestamp order protects slots when a later sequence contains an older frame.
        if any(slot.observed_at and observed_at <= utc(slot.observed_at) for slot in rows):
            raise HTTPException(409, "Observation predates the latest confirmed frame")
        changed = unchanged = 0
        unknown_slots = []
        for item in data.parking_slots:
            slot = by_code.get(item.slot_code)
            if slot is None:
                unknown_slots.append(item.slot_code)
                continue
            did_change = reconcile(db, slot, item.status.value, observed_at, now, messages,
                                   confidence=item.confidence, session=sessions.get(slot.id))
            # A frame captured before a new booking must not replace its observation.
            if slot.observed_at == observed_at:
                slot.observation_run_id = camera.ai_run_id
            changed += int(did_change)
            unchanged += int(not did_change)
        camera.ai_sequence = data.sequence
        persist_observed_slots(db, rows)
        commit(db)
    except Exception:
        db.rollback()
        raise
    # Even unchanged occupancy refreshes observation age and reservation metadata.
    parking_cache.invalidate()
    return AIUpdateResult(camera_id=data.camera_id, received_slots=len(data.parking_slots),
                          changed_slots=changed, unchanged_slots=unchanged,
                          unknown_slots=unknown_slots, reserved_skipped_slots=[]), messages



@router.get(
    "/summary",
    response_model=ParkingSummary,
    summary="Tổng hợp trạng thái bãi đỗ"
)
def get_parking_summary(db: Session = Depends(get_db)):
    return get_parking_map(db).summary


@router.get(
    "/map",
    response_model=ParkingMapResponse,
    summary="Bản đồ bãi đỗ đầy đủ (summary + từng slot)"
)
def get_parking_map(db: Session = Depends(get_db)):
    snapshot = parking_cache.get(lambda: load_parking_map(db), settings.PARKING_CACHE_TTL_SECONDS)
    # Readiness can expire without a DB write; do not serve cached readiness forever.
    now = now_utc()
    slots = [item.model_copy(update={"observation_ready": bool(item.observation_ready and item.observed_at
             and 0 <= (now - utc(item.observed_at)).total_seconds() <= settings.OBSERVATION_MAX_AGE_SECONDS)})
             for item in snapshot.slots]
    available = sum(item.status == "EMPTY" and item.observation_ready and item.active_session_id is None and not item.needs_reconciliation
                    for item in slots)
    return snapshot.model_copy(update={"slots": slots,
              "summary": snapshot.summary.model_copy(update={"available_slots": available})})


def load_parking_map(db: Session):
    slots = db.query(models.ParkingSlot).order_by(models.ParkingSlot.slot_code).all()
    cameras = {camera.id: camera for camera in db.query(models.Camera).all()}
    sessions = {session.parking_slot_id: session for session in db.query(models.ParkingSession).filter(
        models.ParkingSession.status.in_(("RESERVED", "PARKED"))).all()}
    total    = len(slots)
    occupied = sum(1 for s in slots if s.status == "OCCUPIED")
    empty    = sum(1 for s in slots if s.status == "EMPTY")
    reserved = sum(1 for s in slots if s.status == "RESERVED")
    unknown  = sum(1 for s in slots if s.status == "UNKNOWN")

    return ParkingMapResponse(
        summary=ParkingSummary(
            total_slots    = total,
            empty_slots    = empty,
            occupied_slots = occupied,
            reserved_slots = reserved,
            unknown_slots  = unknown,
            has_unknown_alert = unknown > 0,
            uninitialized_slots = sum(s.status is None for s in slots),
        ),
        slots=[slot_response(s, sessions.get(s.id), camera=cameras.get(s.camera_id)) for s in slots],
    )


@router.get("/unknown-slots", response_model=list[ParkingSlotResponse])
def get_unknown_slots(camera_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(models.ParkingSlot).filter_by(status="UNKNOWN")
    if camera_id is not None:
        get_or_404(db, models.Camera, camera_id)
        query = query.filter_by(camera_id=camera_id)
    return [slot_response(slot, camera=db.get(models.Camera, slot.camera_id))
            for slot in query.order_by(models.ParkingSlot.id).all()]
