"""Slot/session lifecycle. All writers lock camera, slot, then active session."""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import inspect, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.attributes import set_committed_value
from sqlalchemy.orm import Session

from .. import models, observation_runtime
from ..config import settings
from ..parking_cache import parking_cache
from ..schemas import ParkingSlotResponse

_UNSET = object()
RESERVATION_DURATION = timedelta(minutes=10)


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def now_utc():
    return datetime.now(timezone.utc)


def active_session(db, slot_id):
    return (db.query(models.ParkingSession).filter(models.ParkingSession.parking_slot_id == slot_id,
            models.ParkingSession.is_active.is_(True)).with_for_update().populate_existing().first())


def observation_ready(slot, now=None, camera=None):
    now = now or now_utc()
    return bool(slot.observed_at and slot.observation_backend_id == observation_runtime.backend_id
                and (camera is None or slot.observation_run_id == camera.ai_run_id)
                and 0 <= (utc(now) - utc(slot.observed_at)).total_seconds() <= settings.OBSERVATION_MAX_AGE_SECONDS)


def slot_response(slot, session=None, now=None, camera=None):
    result = ParkingSlotResponse.model_validate(slot)
    result.observation_ready = observation_ready(slot, now, camera)
    if session and session.is_active:
        result.active_session_id = session.id
        result.reservation_expires_at = reservation_deadline(session)
    return result


def lock_slot(db, slot_id):
    camera_id = db.query(models.ParkingSlot.camera_id).filter_by(id=slot_id).scalar()
    if camera_id is None:
        raise HTTPException(404, "ParkingSlot not found")
    camera = db.query(models.Camera).filter_by(id=camera_id).with_for_update().populate_existing().one()
    slot = db.query(models.ParkingSlot).filter_by(id=slot_id).with_for_update().populate_existing().one()
    return camera, slot


def reservation_deadline(session):
    return utc(session.created_at) + RESERVATION_DURATION


def within_reservation(session, stamp):
    return bool(session and
                timedelta(0) <= utc(stamp) - utc(session.created_at) < RESERVATION_DURATION)


def session_message(session):
    deadline = reservation_deadline(session)
    return {"type": "PARKING_SESSION_CHANGED", "session_id": session.id,
            "parking_slot_id": session.parking_slot_id, "is_active": session.is_active,
            "reservation_expires_at": deadline.isoformat() if deadline else None}


def set_status(db, slot, target, stamp, messages, session=None, source="AI", confidence=None):
    old = slot.status
    if old == target:
        return False
    slot.status = target
    slot.updated_at = stamp
    db.add(models.ParkingEvent(parking_slot_id=slot.id, parking_session_id=session.id if session else None,
                              old_status=old, new_status=target, event_time=stamp, source=source,
                              confidence=confidence if confidence is not None else 1.0))
    messages.append({"type": "SLOT_STATUS_CHANGED", "parking_slot_id": slot.id,
                     "slot_code": slot.slot_code, "camera_id": slot.camera_id,
                     "old_status": old, "new_status": target, "confidence": confidence,
                     "event_time": utc(stamp).isoformat()})
    return True


def finish_session(session, slot, now, messages, *, source="AI"):
    session.is_active = False
    messages.append(session_message(session))


def reconcile(db, slot, occupancy, observed_at, now, messages, *, source="AI", confidence=None, session=_UNSET):
    if session is _UNSET:
        session = active_session(db, slot.id)
    if session and utc(observed_at) < utc(session.created_at):
        return False
    within = within_reservation(session, observed_at)
    # Past the hold, only an already-present vehicle keeps its session.
    if (occupancy == "OCCUPIED" and session and not within
            and not (slot.status == "OCCUPIED" and slot.last_observed_occupancy == "OCCUPIED")):
        finish_session(session, slot, now, messages)
        session = None
    slot.last_observed_occupancy = occupancy
    slot.observed_at = slot.updated_at = observed_at
    slot.observation_backend_id = observation_runtime.backend_id
    if slot.needs_reconciliation and slot.status == "RESERVED" and session is None:
        return False
    if occupancy == "EMPTY":
        if slot.last_empty_at is None or slot.status in ("OCCUPIED", "UNKNOWN"):
            slot.last_empty_at = observed_at
        if within_reservation(session, now):
            target = "RESERVED"
        else:
            if session:
                finish_session(session, slot, now, messages)
            target = "EMPTY"
    else:
        target = "OCCUPIED" if session else "UNKNOWN"
        slot.last_empty_at = None
    return set_status(db, slot, target, observed_at, messages, session, source, confidence)


def active_sessions(db, slot_ids):
    if not slot_ids:
        return {}
    rows = db.query(models.ParkingSession).filter(models.ParkingSession.parking_slot_id.in_(slot_ids),
        models.ParkingSession.is_active.is_(True)).order_by(models.ParkingSession.parking_slot_id).with_for_update().populate_existing().all()
    return {row.parking_slot_id: row for row in rows}


def persist_observed_slots(db, slots):
    """Group identical changes into bulk UPDATEs rather than one remote query per ROI."""
    groups = {}
    fields = ("status", "updated_at", "last_observed_occupancy", "observed_at", "observation_run_id",
              "observation_backend_id", "last_empty_at")
    for slot in slots:
        state = inspect(slot)
        values = {name: getattr(slot, name) for name in fields if state.attrs[name].history.has_changes()}
        if not values:
            continue
        group = tuple(sorted(values.items()))
        groups.setdefault(group, []).append(slot.id)
        # The UPDATE below owns persistence; prevent an additional ORM row UPDATE.
        for name, value in values.items():
            set_committed_value(slot, name, value)
    for group, slot_ids in groups.items():
        db.execute(update(models.ParkingSlot).where(models.ParkingSlot.id.in_(slot_ids)).values(
            **dict(group)).execution_options(synchronize_session=False))

def expire_locked(db, slot, session, camera, now, messages):
    if (not session or within_reservation(session, now)
            or utc(now) < utc(session.created_at) or not observation_ready(slot, now, camera)):
        return
    if slot.last_observed_occupancy == "EMPTY":
        finish_session(session, slot, now, messages)
        set_status(db, slot, "EMPTY", now, messages, session, "EXPIRY")
    elif slot.status != "OCCUPIED":
        finish_session(session, slot, now, messages)
        set_status(db, slot, "UNKNOWN", now, messages, session, "EXPIRY")


def expire_reservations(*, now=None, session_factory=None):
    from ..db import SessionLocal
    factory = session_factory or SessionLocal
    now = now or now_utc()
    messages = []
    with factory() as db:
        camera_ids = [row[0] for row in db.query(models.ParkingSlot.camera_id).join(
            models.ParkingSession, models.ParkingSession.parking_slot_id == models.ParkingSlot.id).filter(
            models.ParkingSession.is_active.is_(True),
            models.ParkingSession.created_at <= now - RESERVATION_DURATION
        ).distinct().order_by(models.ParkingSlot.camera_id).all()]
    # One consistent camera lock order, independent of request processing.
    for camera_id in camera_ids:
        pending = []
        with factory() as db:
            try:
                camera = db.query(models.Camera).filter_by(id=camera_id).with_for_update().populate_existing().first()
                if camera is None:
                    continue
                ids = [row[0] for row in db.query(models.ParkingSession.parking_slot_id).join(
                    models.ParkingSlot, models.ParkingSlot.id == models.ParkingSession.parking_slot_id).filter(
                    models.ParkingSlot.camera_id == camera_id, models.ParkingSession.is_active.is_(True),
                    models.ParkingSession.created_at <= now - RESERVATION_DURATION).all()]
                slots = db.query(models.ParkingSlot).filter(models.ParkingSlot.id.in_(ids)).order_by(
                    models.ParkingSlot.id).with_for_update().populate_existing().all()
                sessions = active_sessions(db, ids)
                for slot in slots:
                    expire_locked(db, slot, sessions.get(slot.id), camera, now, pending)
                persist_observed_slots(db, slots)
                db.commit()
            except Exception:
                db.rollback()
                raise
        if pending:
            parking_cache.invalidate()
            messages.extend(pending)
    return messages


def manual_action(db: Session, slot_id, action, user_id, customer=None, *, now=None, expected_session_id=None):
    supplied_now = now
    messages = []
    try:
        camera, slot = lock_slot(db, slot_id)
        now = utc(supplied_now) if supplied_now is not None else now_utc()
        session = active_session(db, slot.id)
        if expected_session_id is not None and (session is None or session.id != expected_session_id):
            raise HTTPException(409, "This session is no longer active")
        # Reconcile expired empty holds before accepting a new booking.
        expire_locked(db, slot, session, camera, now, messages)
        if session and not session.is_active:
            session = None
        ready = observation_ready(slot, now, camera)
        if action in ("reserve", "check-in"):
            if session:
                raise HTTPException(409, "Slot already has an active session")
            if not ready:
                raise HTTPException(409, "Fresh camera observation required")
            if action == "reserve" and (slot.needs_reconciliation or slot.status != "EMPTY" or slot.last_observed_occupancy != "EMPTY"):
                raise HTTPException(409, "Slot is not available")
            if action == "check-in" and ((slot.status != "UNKNOWN" and not slot.needs_reconciliation) or slot.last_observed_occupancy != "OCCUPIED"):
                raise HTTPException(409, "Confirm the vehicle in the slot before check-in")
            slot.needs_reconciliation = False
            values = customer.model_dump()
            session = models.ParkingSession(parking_slot_id=slot.id, created_by=user_id, **values,
                        is_active=True, created_at=now)
            db.add(session)
            db.flush()
            set_status(db, slot, "RESERVED" if action == "reserve" else "OCCUPIED", now,
                       messages, session, "MANUAL")
            messages.append(session_message(session))
        elif action == "reconcile":
            if session or not slot.needs_reconciliation:
                raise HTTPException(409, "No legacy slot to reconcile")
            if not ready:
                raise HTTPException(409, "Fresh camera observation required")
            slot.needs_reconciliation = False
            set_status(db, slot, "EMPTY" if slot.last_observed_occupancy == "EMPTY" else "UNKNOWN",
                       now, messages, source="MANUAL")
        elif action == "cancel-reservation":
            if not session or slot.status != "RESERVED":
                raise HTTPException(409, "No unarrived reservation to cancel")
            if not ready:
                raise HTTPException(409, "Fresh camera observation required")
            session.is_active = False
            set_status(db, slot, "EMPTY" if slot.last_observed_occupancy == "EMPTY" else "UNKNOWN",
                       now, messages, session, "MANUAL")
            messages.append(session_message(session))
        elif action == "confirm-arrival":
            if not within_reservation(session, now) or slot.status != "RESERVED":
                raise HTTPException(409, "No valid reservation awaiting arrival")
            if not ready or slot.last_observed_occupancy != "OCCUPIED":
                raise HTTPException(409, "Fresh occupied observation required")
            set_status(db, slot, "OCCUPIED", now, messages, session, "MANUAL")
            messages.append(session_message(session))
        elif action == "check-out":
            if not session:
                raise HTTPException(409, "No parked session")
            if not ready or slot.last_observed_occupancy != "EMPTY":
                raise HTTPException(409, "Fresh empty observation required before checkout")
            finish_session(session, slot, now, messages, source="MANUAL")
            set_status(db, slot, "EMPTY", now, messages, session, "MANUAL")
        else:
            raise HTTPException(422, "Unsupported action")
        response = slot_response(slot, session, now, camera)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Slot conflict or invalid reference")
    except Exception:
        db.rollback()
        raise
    parking_cache.invalidate()
    return response, messages
