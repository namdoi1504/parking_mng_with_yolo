from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..db import get_db
from ..config import settings
from ..parking_cache import parking_cache
from .. import models
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

    db.query(models.Camera).filter_by(id=actual_camera_id).with_for_update().one()
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
                status          = "EMPTY",
            ))
            created += 1
        else:
            if (existing.roi_coordinates, existing.col, existing.row) != (roi, item.col, item.row):
                existing.roi_coordinates = roi
                existing.col = item.col
                existing.row = item.row
                updated += 1
            else:
                unchanged += 1

    if new_slots:
        db.add_all(new_slots)

    commit(db)

    if created or updated:
        parking_cache.invalidate()

    return SlotSyncResult(
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
    get_or_404(db, models.Camera, data.camera_id, lock=True)
    changed       = 0
    unchanged     = 0
    unknown_slots = []

    incoming_codes = [s.slot_code for s in data.parking_slots]
    slot_rows = (
        db.query(models.ParkingSlot)
        .filter(models.ParkingSlot.slot_code.in_(incoming_codes),
                models.ParkingSlot.camera_id == data.camera_id)
        .order_by(models.ParkingSlot.id)
        .with_for_update()
        .all()
    )
    slot_by_code: dict[str, models.ParkingSlot] = {s.slot_code: s for s in slot_rows}

    new_events: list[models.ParkingEvent] = []
    ws_messages: list[dict] = []

    event_time = datetime.now(timezone.utc)
    for slot_data in data.parking_slots:
        slot = slot_by_code.get(slot_data.slot_code)

        if not slot:
            unknown_slots.append(slot_data.slot_code)
            continue

        old_status = slot.status

        if old_status != slot_data.status.value:
            slot.status = slot_data.status.value

            new_events.append(models.ParkingEvent(
                parking_slot_id = slot.id,
                event_time      = event_time,
                old_status      = old_status,
                new_status      = slot_data.status.value,
                confidence      = slot_data.confidence if slot_data.confidence is not None else 1.0,
            ))
            ws_messages.append({
                "type"            : "SLOT_STATUS_CHANGED",
                "parking_slot_id" : slot.id,
                "slot_code"       : slot.slot_code,
                "camera_id"       : data.camera_id,
                "old_status"      : old_status,
                "new_status"      : slot_data.status.value,
                "confidence"      : slot_data.confidence,
                "event_time"      : event_time.isoformat(),
            })
            changed += 1
        else:
            unchanged += 1

    if new_events:
        db.add_all(new_events)

    commit(db)

    if changed:
        parking_cache.invalidate()

    return AIUpdateResult(
        camera_id       = data.camera_id,
        received_slots  = len(data.parking_slots),
        changed_slots   = changed,
        unchanged_slots = unchanged,
        unknown_slots   = unknown_slots,
    ), ws_messages



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
    return parking_cache.get(lambda: load_parking_map(db), settings.PARKING_CACHE_TTL_SECONDS)


def load_parking_map(db: Session):
    slots = db.query(models.ParkingSlot).order_by(models.ParkingSlot.slot_code).all()
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
        ),
        slots=[ParkingSlotResponse.model_validate(s) for s in slots],
    )


@router.get("/unknown-slots", response_model=list[ParkingSlotResponse])
def get_unknown_slots(camera_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(models.ParkingSlot).filter_by(status="UNKNOWN")
    if camera_id is not None:
        get_or_404(db, models.Camera, camera_id)
        query = query.filter_by(camera_id=camera_id)
    return query.order_by(models.ParkingSlot.id).all()
