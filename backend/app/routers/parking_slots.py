from fastapi import APIRouter, Depends, Path
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..db import get_db
from ..oauth2 import require_admin
from ..schemas import ParkingSlotResponse
from ..services.parking_slots import transition_slot
from ..websocket_manager import manager

router = APIRouter(prefix="/parking-slots", tags=["Parking reservations"],
                   dependencies=[Depends(require_admin)])


async def _transition(db, slot_id, expected, target):
    response, message = await run_in_threadpool(transition_slot, db, slot_id, expected, target)
    await manager.broadcast(message)
    return response


@router.post("/{slot_id}/reserve", response_model=ParkingSlotResponse)
async def reserve(slot_id: int = Path(gt=0), db: Session = Depends(get_db)):
    return await _transition(db, slot_id, "EMPTY", "RESERVED")


@router.post("/{slot_id}/cancel-reservation", response_model=ParkingSlotResponse)
async def cancel_reservation(slot_id: int = Path(gt=0), db: Session = Depends(get_db)):
    return await _transition(db, slot_id, "RESERVED", "EMPTY")


@router.post("/{slot_id}/confirm-arrival", response_model=ParkingSlotResponse)
async def confirm_arrival(slot_id: int = Path(gt=0), db: Session = Depends(get_db)):
    return await _transition(db, slot_id, "RESERVED", "OCCUPIED")
