from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app import models
from app.schemas import (
    AIParkingStatusRequest,
    AIUpdateResult,
    ParkingMapResponse,
    ParkingSlotResponse,
    ParkingSummary,
)
from app.websocket_manager import manager

router = APIRouter(prefix="/api/ai", tags=["AI Engine"])


# Schema nội bộ cho sync (không cần thêm vào schemas.py)
class SlotSyncItem(BaseModel):
    slot_code: str
    roi_coordinates: list[dict]   # [{"x": float, "y": float}, ...]
    col: int = 0
    row: int = 0


class SlotSyncRequest(BaseModel):
    camera_id: int
    # Thông tin camera — tự tạo nếu chưa có trong DB
    camera_name: str = "Camera 1"
    camera_source_url: str = "file://parking_car.mp4"
    camera_source_type: str = "VIDEO_FILE"
    slots: list[SlotSyncItem]


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
    """
    Upsert toàn bộ slot từ slots_config.json vào DB.
    - Slot chưa có → INSERT
    - Slot đã có → UPDATE roi_coordinates nếu thay đổi
    Tự động thích nghi với số lượng slot bất kỳ.
    """
    created = updated = unchanged = 0

    # ① Đảm bảo camera tồn tại trước (tránh FK violation)
    camera = db.query(models.Camera).filter(models.Camera.id == data.camera_id).first()
    if camera is None:
        camera = models.Camera(
            name        = data.camera_name,
            source_type = data.camera_source_type,
            source_url  = data.camera_source_url,
            status      = "CONNECTED",
        )
        db.add(camera)
        db.flush()
        actual_camera_id = camera.id
    else:
        actual_camera_id = camera.id

    # ② Lấy TẤT CẢ slot hiện có của camera này bằng 1 query
    existing_slots = (
        db.query(models.ParkingSlot)
        .filter(models.ParkingSlot.camera_id == actual_camera_id)
        .all()
    )
    existing_by_code: dict[str, models.ParkingSlot] = {
        s.slot_code: s for s in existing_slots
    }

    # ③ Phân loại: cần tạo mới vs cập nhật
    new_slots = []
    for item in data.slots:
        existing = existing_by_code.get(item.slot_code)
        if existing is None:
            new_slots.append(models.ParkingSlot(
                camera_id       = actual_camera_id,
                slot_code       = item.slot_code,
                roi_coordinates = item.roi_coordinates,
                status          = "EMPTY",
            ))
            created += 1
        else:
            if existing.roi_coordinates != item.roi_coordinates:
                existing.roi_coordinates = item.roi_coordinates
                updated += 1
            else:
                unchanged += 1

    # ④ Bulk insert slots mới (1 câu SQL duy nhất)
    if new_slots:
        db.add_all(new_slots)

    db.commit()

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
    changed       = 0
    unchanged     = 0
    unknown_slots = []

    # ── 1 query lấy toàn bộ slot liên quan (thay vì 470 query riêng lẻ) ──
    incoming_codes = [s.slot_code for s in data.parking_slots]
    slot_rows = (
        db.query(models.ParkingSlot)
        .filter(models.ParkingSlot.slot_code.in_(incoming_codes))
        .all()
    )
    slot_by_code: dict[str, models.ParkingSlot] = {s.slot_code: s for s in slot_rows}

    new_events: list[models.ParkingEvent] = []
    ws_messages: list[dict] = []

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
                "event_time"      : datetime.now(timezone.utc).isoformat(),
            })
            changed += 1
        else:
            unchanged += 1

    # ── Bulk insert events (1 câu SQL) ──
    if new_events:
        db.add_all(new_events)

    db.commit()

    # ── Broadcast WebSocket sau commit ──
    for msg in ws_messages:
        await manager.broadcast(msg)

    return AIUpdateResult(
        camera_id       = data.camera_id,
        received_slots  = len(data.parking_slots),
        changed_slots   = changed,
        unchanged_slots = unchanged,
        unknown_slots   = unknown_slots,
    )



@router.get(
    "/summary",
    response_model=ParkingSummary,
    summary="Tổng hợp trạng thái bãi đỗ"
)
def get_parking_summary(db: Session = Depends(get_db)):
    """
    FE gọi lúc load trang để lấy trạng thái ban đầu.
    Sau đó dùng WebSocket để nhận update real-time.
    """
    slots = db.query(models.ParkingSlot).all()
    total    = len(slots)
    occupied = sum(1 for s in slots if s.status == "OCCUPIED")
    empty    = sum(1 for s in slots if s.status == "EMPTY")
    reserved = sum(1 for s in slots if s.status == "RESERVED")
    unknown  = sum(1 for s in slots if s.status == "UNKNOWN")

    return ParkingSummary(
        total_slots    = total,
        empty_slots    = empty,
        occupied_slots = occupied,
        reserved_slots = reserved,
        unknown_slots  = unknown,
    )


@router.get(
    "/map",
    response_model=ParkingMapResponse,
    summary="Bản đồ bãi đỗ đầy đủ (summary + từng slot)"
)
def get_parking_map(db: Session = Depends(get_db)):
    """
    FE gọi để render bản đồ toàn bộ bãi đỗ.
    Trả về summary + danh sách slot với tọa độ ROI và trạng thái.
    """
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
        ),
        slots=[ParkingSlotResponse.model_validate(s) for s in slots],
    )
