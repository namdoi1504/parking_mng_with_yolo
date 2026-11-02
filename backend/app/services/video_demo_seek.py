"""Apply a single frozen seek snapshot and discard only that demo camera's history."""
from datetime import timedelta
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import or_

from .. import models, observation_runtime, demo_runtime
from ..config import settings
from ..demo_runtime import stamp
from ..schemas import VideoDemoSeekSnapshot
from .parking_slots import reconcile, utc


def reset_snapshot(db, playback, request):
    try:
        snapshot = VideoDemoSeekSnapshot.model_validate(playback["seek_snapshot"])
        paused_at = stamp(playback["paused_at"])
        run_id = str(UUID(playback["run_id"]))
        tolerance = timedelta(seconds=2)
        obs_time = utc(snapshot.observed_at)
        if (playback.get("playback_state") != "paused"
                or playback.get("camera_id") != settings.VIDEO_DEMO_CAMERA_ID
                or playback.get("owner_backend_id") != observation_runtime.backend_id
                or playback.get("seek_id") != str(request.request_id)
                or run_id != str(snapshot.run_id) or playback.get("frame_id") != snapshot.frame_id
                or not (obs_time <= paused_at + tolerance and paused_at <= demo_runtime.wall_now() + tolerance)):
            raise ValueError("Seek snapshot does not match the frozen playback")
        by_code = {item.slot_code: item for item in snapshot.parking_slots}
        if not by_code or len(by_code) != len(snapshot.parking_slots):
            raise ValueError("Seek snapshot must contain unique slots")
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(503, "Invalid frozen seek snapshot; retry seek") from exc

    camera = db.query(models.Camera).filter_by(id=settings.VIDEO_DEMO_CAMERA_ID).with_for_update().populate_existing().first()
    if camera is None:
        raise HTTPException(409, "Wait for camera slot synchronization before seeking")
    slots = db.query(models.ParkingSlot).filter_by(camera_id=camera.id).order_by(
        models.ParkingSlot.id).with_for_update().populate_existing().all()
    if set(by_code) != {slot.slot_code for slot in slots}:
        raise HTTPException(409, "Seek snapshot and camera slot configuration do not match")
    if camera.ai_run_id == run_id:
        if any(slot.observation_run_id != run_id for slot in slots):
            raise HTTPException(409, "Seek run is incomplete; start a new seek request")
        # A commit may have succeeded before its HTTP acknowledgement was lost.
        return dict(deleted_sessions=0, deleted_events=0, deleted_statistics=0, initialized_slots=len(slots))
    if playback.get("seek_ready") is not False:
        raise HTTPException(409, "An unapplied seek must await backend acknowledgement")

    ids = [slot.id for slot in slots]
    session_ids = db.query(models.ParkingSession.id).filter(models.ParkingSession.parking_slot_id.in_(ids)).subquery()
    events = db.query(models.ParkingEvent).filter(or_(models.ParkingEvent.parking_slot_id.in_(ids),
        models.ParkingEvent.parking_session_id.in_(db.query(session_ids.c.id)))).delete(synchronize_session=False)
    sessions = db.query(models.ParkingSession).filter(models.ParkingSession.parking_slot_id.in_(ids)).delete(synchronize_session=False)
    statistics = db.query(models.ParkingStatistic).filter_by(camera_id=camera.id).delete(synchronize_session=False)
    camera.ai_run_id, camera.ai_sequence = run_id, 0
    observed_at = utc(snapshot.observed_at)
    for slot in slots:
        slot.status = slot.last_observed_occupancy = slot.observed_at = slot.last_empty_at = None
        slot.observation_run_id = slot.observation_backend_id = None
        slot.needs_reconciliation = False
        item = by_code[slot.slot_code]
        reconcile(db, slot, item.status.value, observed_at, paused_at, [], source="DEMO_SEEK",
                  confidence=item.confidence, session=None)
        slot.observation_run_id = run_id
    return dict(deleted_sessions=sessions, deleted_events=events,
                deleted_statistics=statistics, initialized_slots=len(slots))
