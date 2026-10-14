from fastapi import APIRouter, Depends, Path
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..db import get_db
from ..oauth2 import require_admin
from ..schemas import ParkingSlotResponse, ParkingCustomerInput, ParkingCheckInInput
from ..services.parking_slots import manual_action
from ..websocket_manager import manager

router = APIRouter(prefix="/parking-slots", tags=["Parking reservations"],
                   dependencies=[Depends(require_admin)])


async def _action(db, slot_id, action, user, customer=None):
    response, messages = await run_in_threadpool(manual_action, db, slot_id, action, user.id, customer)
    for message in messages:
        await manager.broadcast(message)
    return response


@router.post("/{slot_id}/reserve", response_model=ParkingSlotResponse)
async def reserve(data: ParkingCustomerInput, slot_id: int = Path(gt=0),
                  db: Session = Depends(get_db), user=Depends(require_admin)):
    return await _action(db, slot_id, "reserve", user, data)


@router.post("/{slot_id}/check-in", response_model=ParkingSlotResponse)
async def check_in(data: ParkingCheckInInput, slot_id: int = Path(gt=0),
                   db: Session = Depends(get_db), user=Depends(require_admin)):
    return await _action(db, slot_id, "check-in", user, data)


@router.post("/{slot_id}/cancel-reservation", response_model=ParkingSlotResponse)
async def cancel_reservation(slot_id: int = Path(gt=0), db: Session = Depends(get_db), user=Depends(require_admin)):
    return await _action(db, slot_id, "cancel-reservation", user)


@router.post("/{slot_id}/confirm-arrival", response_model=ParkingSlotResponse)
async def confirm_arrival(slot_id: int = Path(gt=0), db: Session = Depends(get_db), user=Depends(require_admin)):
    return await _action(db, slot_id, "confirm-arrival", user)


@router.post("/{slot_id}/reconcile", response_model=ParkingSlotResponse)
async def reconcile_legacy(slot_id: int = Path(gt=0), db: Session = Depends(get_db), user=Depends(require_admin)):
    return await _action(db, slot_id, "reconcile", user)
