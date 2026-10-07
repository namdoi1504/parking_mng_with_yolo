"""Manual slot transitions. Keep lock order consistent with AI ingestion."""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..parking_cache import parking_cache
from ..schemas import ParkingSlotResponse


def transition_slot(db: Session, slot_id: int, expected: str, target: str):
    try:
        camera_id = db.query(models.ParkingSlot.camera_id).filter_by(id=slot_id).scalar()
        if camera_id is None:
            raise HTTPException(404, "ParkingSlot not found")
        camera = db.query(models.Camera).filter_by(id=camera_id).with_for_update().first()
        if camera is None:
            raise HTTPException(404, "Camera not found")
        slot = (db.query(models.ParkingSlot).filter_by(id=slot_id)
                .with_for_update().populate_existing().first())
        if slot is None:
            raise HTTPException(404, "ParkingSlot not found")
        if slot.status != expected:
            raise HTTPException(409, f"Expected {expected}, current status is {slot.status}")

        event_time = datetime.now(timezone.utc)
        slot.status = target
        slot.updated_at = event_time
        db.add(models.ParkingEvent(parking_slot_id=slot.id, old_status=expected,
                                   new_status=target, event_time=event_time, confidence=1.0))
        message = {"type": "SLOT_STATUS_CHANGED", "parking_slot_id": slot.id,
                   "slot_code": slot.slot_code, "camera_id": camera_id,
                   "old_status": expected, "new_status": target,
                   "confidence": None, "event_time": event_time.isoformat()}
        response = ParkingSlotResponse.model_validate(slot)
        db.commit()
    except Exception:
        db.rollback()
        raise
    parking_cache.invalidate()
    return response, message
