from datetime import datetime, timedelta, timezone
import pytest
from app import models
from app.statistics import aggregate_stats

NOW = datetime(2026, 9, 29, 10, 31, tzinfo=timezone.utc)


def test_aggregate_persistent_states_boundary_and_idempotency(database):
    with database() as db:
        camera = models.Camera(name="C1", source_url="file://test", source_type="VIDEO_FILE")
        db.add(camera)
        db.flush()
        slots = [models.ParkingSlot(camera_id=camera.id, slot_code=str(i), roi_coordinates=[],
                 status=status, created_at=NOW-timedelta(hours=2))
                 for i, status in enumerate(["OCCUPIED", "EMPTY", "UNKNOWN", "RESERVED"])]
        db.add_all(slots)
        db.flush()
        # Slot 1 became empty after the snapshot boundary; it was occupied at 10:30.
        db.add(models.ParkingEvent(parking_slot_id=slots[1].id, old_status="OCCUPIED", new_status="EMPTY",
                                   event_time=NOW, confidence=1))
        # A slot created after the boundary must not inflate capacity.
        db.add(models.ParkingSlot(camera_id=camera.id, slot_code="late", roi_coordinates=[],
                                  status="EMPTY", created_at=NOW))
        db.commit()
    aggregate_stats(now=NOW, session_factory=database)
    aggregate_stats(now=NOW, session_factory=database)
    with database() as db:
        row = db.query(models.ParkingStatistic).one()
        assert (row.occupied_count, row.available_count, row.total_count) == (2, 0, 4)
        assert row.utilization_rate == 50
        assert row.period_start.minute == 15 and row.period_end.minute == 30


def test_hourly_daily_camera_weighting_and_missing_data(client, database, headers):
    with database() as db:
        db.add_all([models.Camera(id=i, name=str(i), source_url="file://test") for i in (1, 2)])
        db.flush()
        for cid, occupied, available, total in [(1, 1, 1, 2), (2, 0, 8, 8)]:
            db.add(models.ParkingStatistic(camera_id=cid, period_start=NOW.replace(minute=0),
                period_end=NOW.replace(minute=15), occupied_count=occupied,
                available_count=available, total_count=total, utilization_rate=100*occupied/total))
        db.commit()
    result = client.get("/api/stats/hourly?date=2026-09-29", headers=headers)
    assert result.status_code == 200 and len(result.json()) == 24
    assert result.json()[10] == {"hour": 10, "occupied": 1, "available": 9, "utilization": 10, "samples": 1}
    assert result.json()[0]["utilization"] is None
    filtered = client.get("/api/stats/hourly?date=2026-09-29&camera_id=1", headers=headers).json()
    assert filtered[10]["utilization"] == 50
    daily = client.get("/api/stats/daily?from=2026-09-29&to=2026-09-30", headers=headers).json()
    assert daily[0]["avg_utilization"] == 10 and daily[1]["avg_utilization"] is None
    assert client.get("/api/stats/daily?from=2026-09-30&to=2026-09-29", headers=headers).status_code == 422
    assert client.get("/api/stats/hourly?date=2026-09-29&camera_id=999", headers=headers).status_code == 404
    assert client.get("/api/stats/realtime", headers=headers).json() == client.get("/api/ai/summary").json()


def test_scheduler_lifecycle(client, monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.config import settings
    monkeypatch.setattr(settings, "STATS_SCHEDULER_ENABLED", True)
    with TestClient(app):
        assert app.state.scheduler.running
        assert app.state.scheduler.get_job("parking-stats") is not None


def test_invalid_aggregation_period():
    with pytest.raises(ValueError):
        aggregate_stats(period_minutes=17)
