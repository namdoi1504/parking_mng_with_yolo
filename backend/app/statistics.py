"""UTC quarter-hour end snapshots reconstructed from state-change events."""
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from . import models
from .db import SessionLocal


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def aggregate_stats(period_minutes=15, *, now=None, session_factory=SessionLocal):
    if period_minutes <= 0 or 60 % period_minutes:
        raise ValueError("period_minutes must divide 60")
    now = utc(now or datetime.now(timezone.utc))
    end = now.replace(minute=(now.minute // period_minutes) * period_minutes, second=0, microsecond=0)
    start = end - timedelta(minutes=period_minutes)
    with session_factory() as db:
        # A consistent event/slot snapshot even while the AI commits updates.
        if db.bind.dialect.name == "postgresql":
            db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"))
        slots = db.query(models.ParkingSlot).filter(models.ParkingSlot.created_at < end).all()
        states = {slot.id: slot.status for slot in slots}
        # Rewind changes after the exclusive end boundary, including delayed job execution.
        events = db.query(models.ParkingEvent).filter(models.ParkingEvent.event_time >= end).order_by(
            models.ParkingEvent.event_time.desc(), models.ParkingEvent.id.desc()).all()
        for event in events:
            if event.parking_slot_id in states:
                states[event.parking_slot_id] = event.old_status
        counts = defaultdict(lambda: {"occupied": 0, "available": 0, "total": 0})
        for slot in slots:
            item = counts[slot.camera_id]
            item["total"] += 1
            item["occupied"] += states[slot.id] == "OCCUPIED"
            item["available"] += states[slot.id] == "EMPTY"
        for camera_id, item in counts.items():
            values = dict(camera_id=camera_id, period_start=start, period_end=end,
                          occupied_count=item["occupied"], available_count=item["available"],
                          total_count=item["total"], utilization_rate=100 * item["occupied"] / item["total"])
            insert = pg_insert if db.bind.dialect.name == "postgresql" else sqlite_insert
            db.execute(insert(models.ParkingStatistic).values(**values).on_conflict_do_nothing(
                index_elements=["camera_id", "period_start", "period_end"]))
        db.commit()
        return len(counts)


def report_samples(db, start, end, camera_id=None):
    query = db.query(models.ParkingStatistic).filter(
        models.ParkingStatistic.period_start >= start,
        models.ParkingStatistic.period_start < end,
        models.ParkingStatistic.camera_id.is_not(None),
    )
    if camera_id is not None:
        query = query.filter_by(camera_id=camera_id)
    periods = defaultdict(lambda: [0, 0, 0])
    for row in query.all():
        bucket = periods[utc(row.period_start)]
        bucket[0] += row.occupied_count
        bucket[1] += row.available_count
        bucket[2] += row.total_count
    return periods


def summarize(samples):
    if not samples:
        return {"occupied": None, "available": None, "utilization": None, "samples": 0}
    return {"occupied": round(sum(s[0] for s in samples)/len(samples), 2),
            "available": round(sum(s[1] for s in samples)/len(samples), 2),
            "utilization": round(sum(100*s[0]/s[2] if s[2] else 0 for s in samples)/len(samples), 2),
            "samples": len(samples)}
