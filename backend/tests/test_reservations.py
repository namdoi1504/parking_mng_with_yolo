from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Event
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import event, text

from app import models
from app.parking_cache import parking_cache
from app.routers.parking import apply_parking_status
from app.schemas import AIParkingStatusRequest
from app.services.parking_slots import transition_slot
from app.statistics import aggregate_stats
from app.websocket_manager import manager


@pytest.fixture
def slot(client):
    assert client.post("/api/ai/sync-slots", json={"camera_id": 7, "slots": [
        {"slot_code": "A1", "roi_coordinates": []}]}).status_code == 200
    return client.get("/api/ai/map").json()["slots"][0]["id"]


def ai(client, status):
    return client.post("/api/ai/parking-status", json={"camera_id": 7,
        "parking_slots": [{"slot_code": "A1", "status": status}]})


@pytest.mark.parametrize("action", ["reserve", "cancel-reservation", "confirm-arrival"])
def test_admin_only_and_missing_slot(client, database, headers, slot, action):
    url = f"/parking-slots/{slot}/{action}"
    assert client.post(url).status_code == 401
    assert client.post(url, headers={"Authorization": "Bearer invalid"}).status_code == 401
    with database() as db:
        admin = db.query(models.User).filter_by(username="admin").one()
        role = models.Role(name="Operator", permissions=list(admin.role.permissions))
        db.add(role)
        admin.role = role
        db.commit()
    # Even all permissions and an old JWT containing Administrator do not grant access.
    assert client.post(url, headers=headers).status_code == 403


@pytest.mark.parametrize("action", ["reserve", "cancel-reservation", "confirm-arrival"])
def test_missing_slot(client, headers, action):
    assert client.post(f"/parking-slots/999/{action}", headers=headers).status_code == 404


@pytest.mark.parametrize("initial", ["EMPTY", "RESERVED", "OCCUPIED", "UNKNOWN"])
@pytest.mark.parametrize("action,expected,target", [
    ("reserve", "EMPTY", "RESERVED"),
    ("cancel-reservation", "RESERVED", "EMPTY"),
    ("confirm-arrival", "RESERVED", "OCCUPIED"),
])
def test_transition_matrix(client, database, headers, slot, monkeypatch, initial, action, expected, target):
    with database() as db:
        db.get(models.ParkingSlot, slot).status = initial
        db.commit()
    parking_cache.invalidate()
    before = client.get("/api/ai/map").json()
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast", broadcast)
    response = client.post(f"/parking-slots/{slot}/{action}", headers=headers)
    valid = initial == expected
    assert response.status_code == (200 if valid else 409)
    after = client.get("/api/ai/map").json()
    with database() as db:
        assert db.get(models.ParkingSlot, slot).status == (target if valid else initial)
        events = db.query(models.ParkingEvent).all()
        assert len(events) == int(valid)
        if valid:
            assert (events[0].old_status, events[0].new_status) == (expected, target)
    if valid:
        assert response.json()["status"] == target
        assert after["slots"][0]["status"] == target
        assert after["summary"][target.lower() + "_slots"] == 1
        broadcast.assert_awaited_once()
        message = broadcast.call_args.args[0]
        assert (message["old_status"], message["new_status"]) == (expected, target)
        assert message["confidence"] is None
    else:
        assert before == after
        broadcast.assert_not_awaited()


def test_reserved_ai_skips_mixed_batch_and_sync_preserves_reservation(client, database, headers, slot, monkeypatch):
    assert client.post(f"/parking-slots/{slot}/reserve", headers=headers).status_code == 200
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast", broadcast)
    with database() as db:
        original_updated_at = db.get(models.ParkingSlot, slot).updated_at
    for status in ["EMPTY", "OCCUPIED", "UNKNOWN"]:
        response = ai(client, status)
        assert response.status_code == 200
        assert response.json() == {"camera_id": 7, "received_slots": 1, "changed_slots": 0,
            "unchanged_slots": 0, "unknown_slots": [], "reserved_skipped_slots": ["A1"]}
    assert ai(client, "RESERVED").status_code == 422
    broadcast.assert_not_awaited()
    with database() as db:
        assert db.get(models.ParkingSlot, slot).updated_at == original_updated_at
        assert db.query(models.ParkingEvent).count() == 1
    assert client.post("/api/ai/sync-slots", json={"camera_id": 7, "slots": [
        {"slot_code": "A1", "roi_coordinates": [], "col": 2},
        {"slot_code": "A2", "roi_coordinates": []},
        {"slot_code": "A3", "roi_coordinates": []}]}).status_code == 200
    mixed = client.post("/api/ai/parking-status", json={"camera_id": 7, "parking_slots": [
        {"slot_code": "A1", "status": "EMPTY"}, {"slot_code": "A2", "status": "OCCUPIED"},
        {"slot_code": "A3", "status": "EMPTY"}, {"slot_code": "missing", "status": "EMPTY"}]}).json()
    assert mixed == {"camera_id": 7, "received_slots": 4, "changed_slots": 1,
        "unchanged_slots": 1, "unknown_slots": ["missing"], "reserved_skipped_slots": ["A1"]}
    broadcast.assert_awaited_once()


@pytest.mark.parametrize("action,next_status", [("cancel-reservation", "OCCUPIED"), ("confirm-arrival", "EMPTY")])
def test_admin_websocket_then_ai_resumes(client, headers, tokens, slot, action, next_status):
    with client.websocket_connect("/ws/parking", subprotocols=["parking", "bearer." + tokens["access_token"]]) as ws:
        for operation, target in [("reserve", "RESERVED"), (action, "EMPTY" if action == "cancel-reservation" else "OCCUPIED")]:
            assert client.post(f"/parking-slots/{slot}/{operation}", headers=headers).status_code == 200
            message = ws.receive_json()
            assert message["type"] == "SLOT_STATUS_CHANGED"
            assert message["parking_slot_id"] == slot and message["new_status"] == target
        assert ai(client, next_status).json()["changed_slots"] == 1
        assert ws.receive_json()["new_status"] == next_status


def test_ai_cannot_create_reserved(client, database, slot):
    assert ai(client, "RESERVED").status_code == 422
    with database() as db:
        assert db.get(models.ParkingSlot, slot).status == "EMPTY"
        assert db.query(models.ParkingEvent).count() == 0


def test_failed_event_insert_rolls_back_and_does_not_publish(client, database, headers, slot, monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast", broadcast)
    before = parking_cache._snapshot
    def fail_insert(*args):
        raise RuntimeError("injected event insert failure")
    event.listen(models.ParkingEvent, "before_insert", fail_insert)
    try:
        with pytest.raises(RuntimeError, match="injected"):
            client.post(f"/parking-slots/{slot}/reserve", headers=headers)
    finally:
        event.remove(models.ParkingEvent, "before_insert", fail_insert)
    with database() as db:
        assert db.get(models.ParkingSlot, slot).status == "EMPTY"
        assert db.query(models.ParkingEvent).count() == 0
    assert parking_cache._snapshot is before
    broadcast.assert_not_awaited()


def test_statistics_rewinds_confirmation_to_reserved(client, database, headers, slot):
    assert client.post(f"/parking-slots/{slot}/reserve", headers=headers).status_code == 200
    assert client.post(f"/parking-slots/{slot}/confirm-arrival", headers=headers).status_code == 200
    boundary = datetime(2026, 10, 7, 10, 30, tzinfo=timezone.utc)
    with database() as db:
        db.get(models.ParkingSlot, slot).created_at = boundary - timedelta(hours=1)
        events = db.query(models.ParkingEvent).order_by(models.ParkingEvent.id).all()
        events[0].event_time = boundary - timedelta(minutes=5)
        events[1].event_time = boundary + timedelta(seconds=5)
        db.commit()
    aggregate_stats(now=boundary + timedelta(minutes=1), session_factory=database)
    with database() as db:
        stat = db.query(models.ParkingStatistic).one()
        assert (stat.total_count, stat.available_count, stat.occupied_count) == (1, 0, 0)


@pytest.mark.parametrize("first,second", [("admin", "ai"), ("ai", "admin"), ("admin", "admin")])
def test_postgres_concurrent_transitions(database, client, slot, first, second):
    engine = database.kw["bind"]
    if engine.dialect.name != "postgresql":
        pytest.skip("Row-lock concurrency requires PostgreSQL")
    first_ready, release_first, second_attempted = Event(), Event(), Event()
    def hold_before_commit(db):
        first_ready.set()
        assert release_first.wait(10), "Timed out waiting to release first transaction"
    def worker(operation, hold):
        with database() as db:
            db.execute(text("SET LOCAL lock_timeout = '8s'"))
            if hold:
                event.listen(db, "before_commit", hold_before_commit, once=True)
            else:
                # Observe the second transaction attempting its camera lock.
                def observe(conn, cursor, statement, parameters, context, executemany):
                    if "FOR UPDATE" in statement and "cameras" in statement:
                        second_attempted.set()
                event.listen(db.connection(), "before_cursor_execute", observe)
            try:
                if operation == "admin":
                    return transition_slot(db, slot, "EMPTY", "RESERVED")[0].status.value
                result, _ = apply_parking_status(AIParkingStatusRequest(camera_id=7,
                    parking_slots=[{"slot_code": "A1", "status": "OCCUPIED"}]), db)
                return "skipped" if result.reserved_skipped_slots else "changed"
            except HTTPException as exc:
                return exc.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(worker, first, True)
        try:
            assert first_ready.wait(5)
            b = pool.submit(worker, second, False)
            assert second_attempted.wait(5)
            assert not b.done()
        finally:
            release_first.set()
        results = (a.result(timeout=10), b.result(timeout=10))
    expected = {("admin", "ai"): ("RESERVED", "skipped"),
                ("ai", "admin"): ("changed", 409),
                ("admin", "admin"): ("RESERVED", 409)}
    assert results == expected[first, second]
    with database() as db:
        assert db.query(models.ParkingEvent).count() == 1
        assert db.get(models.ParkingSlot, slot).status == ("OCCUPIED" if first == "ai" else "RESERVED")
