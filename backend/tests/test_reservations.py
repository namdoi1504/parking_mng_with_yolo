from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Event
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import event, text

from app import models, observation_runtime
from app.parking_cache import parking_cache
from app.routers.parking import apply_parking_status
from app.schemas import AIParkingStatusRequest, ParkingCustomerInput
from app.services.parking_slots import manual_action, expire_reservations, utc
from app.websocket_manager import manager

CUSTOMER = {"customer_name": " Nguyen Van A ", "phone_number": "0901234567", "license_plate": "51A-123.45"}


@pytest.fixture
def slot(client, observer):
    assert client.post("/api/ai/sync-slots", json={"camera_id": 7, "slots": [
        {"slot_code": "A1", "roi_coordinates": []}]}).status_code == 200
    assert observer("EMPTY").status_code == 200
    return client.get("/api/ai/map").json()["slots"][0]["id"]


def reserve(client, headers, slot):
    return client.post(f"/parking-slots/{slot}/reserve", headers=headers, json=CUSTOMER)


def state(client):
    return client.get("/api/ai/map").json()["slots"][0]["status"]


def elapse(database, slot, minutes=11):
    # Move a real booking window into the past while leaving current observations fresh.
    with database() as db:
        session = db.query(models.ParkingSession).filter_by(parking_slot_id=slot).one()
        shift = timedelta(minutes=minutes)
        session.reserved_at = utc(session.reserved_at) - shift
        session.reservation_expires_at = utc(session.reservation_expires_at) - shift
        if session.arrived_at:
            session.arrived_at = utc(session.arrived_at) - shift
        db.commit()


@pytest.mark.parametrize("action", ["reserve", "check-in", "cancel-reservation", "confirm-arrival"])
def test_admin_only(client, database, headers, slot, action):
    url = f"/parking-slots/{slot}/{action}"
    assert client.post(url, json=CUSTOMER).status_code == 401
    with database() as db:
        admin = db.query(models.User).filter_by(username="admin").one()
        admin.role = models.Role(name="Operator", permissions=list(admin.role.permissions))
        db.commit()
    assert client.post(url, headers=headers, json=CUSTOMER).status_code == 403
    assert client.get("/parking-sessions", headers=headers).status_code == 403


@pytest.mark.parametrize("action", ["reserve", "check-in", "cancel-reservation", "confirm-arrival"])
def test_missing_slot(client, headers, action):
    assert client.post(f"/parking-slots/999/{action}", headers=headers, json=CUSTOMER).status_code == 404


def test_reservation_requires_customer_and_fresh_empty(client, headers):
    client.post("/api/ai/sync-slots", json={"camera_id": 7, "slots": [{"slot_code": "A1", "roi_coordinates": []}]})
    slot = client.get("/api/ai/map").json()["slots"][0]
    assert slot["status"] is None and slot["observation_ready"] is False
    assert client.post(f"/parking-slots/{slot['id']}/reserve", headers=headers).status_code == 422
    assert reserve(client, headers, slot["id"]).status_code == 409
    assert client.post(f"/parking-slots/{slot['id']}/reserve", headers=headers,
                       json={**CUSTOMER, "customer_name": "  "}).status_code == 422


def test_reservation_fields_and_customer_privacy(client, database, headers, slot, monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast", broadcast)
    result = reserve(client, headers, slot)
    assert result.status_code == 200 and result.json()["status"] == "RESERVED"
    assert reserve(client, headers, slot).status_code == 409
    session_id = result.json()["active_session_id"]
    detail = client.get(f"/parking-sessions/{session_id}", headers=headers).json()
    assert detail["customer_name"] == "Nguyen Van A" and detail["license_plate"] == "51A12345"
    assert detail["phone_number"] == "0901234567"
    assert datetime.fromisoformat(detail["reservation_expires_at"]) - datetime.fromisoformat(detail["reserved_at"]) == timedelta(minutes=10)
    assert detail["arrived_at"] is None
    for call in broadcast.call_args_list:
        assert not {"customer_name", "phone_number", "license_plate"} & call.args[0].keys()
    assert "phone_number" not in str(client.get("/api/ai/map").json())
    assert client.get("/parking-sessions").status_code == 401
    assert client.get("/parking-sessions?license_plate=51A-123.45", headers=headers).json()["meta"]["total"] == 1


def test_repeated_entry_within_window_then_departure_after_expiry(client, database, headers, observer, slot):
    result = reserve(client, headers, slot).json()
    session_id, deadline = result["active_session_id"], result["reservation_expires_at"]
    assert observer("OCCUPIED").json()["changed_slots"] == 1
    detail = client.get(f"/parking-sessions/{session_id}", headers=headers).json()
    first_arrival = detail["arrived_at"]
    assert state(client) == "OCCUPIED"
    assert observer("EMPTY").status_code == 200
    assert state(client) == "RESERVED"
    detail = client.get(f"/parking-sessions/{session_id}", headers=headers).json()
    assert detail["status"] == "PARKED" and detail["departed_at"] is None
    assert observer("OCCUPIED").status_code == 200
    detail = client.get(f"/parking-sessions/{session_id}", headers=headers).json()
    assert detail["arrived_at"] == first_arrival and detail["reservation_expires_at"] == deadline
    assert len(client.get(f"/parking-sessions/{session_id}/events", headers=headers).json()["data"]) == 4
    elapse(database, slot)
    assert expire_reservations(session_factory=database) == []
    assert state(client) == "OCCUPIED"
    assert observer("EMPTY").status_code == 200
    assert state(client) == "EMPTY"
    detail = client.get(f"/parking-sessions/{session_id}", headers=headers).json()
    assert detail["status"] == "COMPLETED" and detail["departed_at"] is not None
    assert observer("OCCUPIED").status_code == 200
    assert state(client) == "UNKNOWN"
    with database() as db:
        assert db.query(models.ParkingSession).count() == 1


@pytest.mark.parametrize("visited", [False, True])
def test_expiry_empty_without_new_ai_message(client, database, headers, observer, slot, visited):
    session_id = reserve(client, headers, slot).json()["active_session_id"]
    if visited:
        observer("OCCUPIED")
        observer("EMPTY")
    elapse(database, slot)
    messages = expire_reservations(session_factory=database)
    assert any(item.get("new_status") == "EMPTY" for item in messages)
    assert state(client) == "EMPTY"
    detail = client.get(f"/parking-sessions/{session_id}", headers=headers).json()
    assert detail["status"] == ("COMPLETED" if visited else "EXPIRED")
    assert (detail["departed_at"] is not None) == visited
    assert expire_reservations(session_factory=database) == []
    observer("OCCUPIED")
    assert state(client) == "UNKNOWN"


def test_first_arrival_after_deadline_is_unknown(client, database, headers, observer, slot):
    session_id = reserve(client, headers, slot).json()["active_session_id"]
    elapse(database, slot)
    assert observer("OCCUPIED").status_code == 200
    assert state(client) == "UNKNOWN"
    detail = client.get(f"/parking-sessions/{session_id}", headers=headers).json()
    assert detail["status"] == "EXPIRED" and detail["arrived_at"] is None


def test_exact_deadline(client, database, headers, slot):
    session_id = reserve(client, headers, slot).json()["active_session_id"]
    with database() as db:
        session = db.get(models.ParkingSession, session_id)
        deadline = utc(session.reservation_expires_at)
        slot_obj = db.get(models.ParkingSlot, slot)
        slot_obj.observed_at = deadline
        db.commit()
    assert expire_reservations(now=deadline, session_factory=database)
    assert state(client) == "EMPTY"


def test_restart_and_missing_camera_do_not_release_hold(client, database, headers, observer, slot):
    reserve(client, headers, slot)
    elapse(database, slot)
    observation_runtime.restart()
    parking_cache.invalidate()
    assert expire_reservations(session_factory=database) == []
    snapshot = client.get("/api/ai/map").json()
    assert snapshot["slots"][0]["status"] == "RESERVED"
    assert snapshot["slots"][0]["observation_ready"] is False
    assert snapshot["summary"]["available_slots"] == 0
    observer("EMPTY")
    assert state(client) == "EMPTY"


def test_stale_camera_metadata_expires_in_cache(client, database, slot, monkeypatch):
    import app.routers.parking as parking
    with database() as db:
        observed = utc(db.get(models.ParkingSlot, slot).observed_at)
    assert client.get("/api/ai/map").json()["slots"][0]["observation_ready"]
    monkeypatch.setattr(parking, "now_utc", lambda: observed + timedelta(seconds=16))
    snapshot = client.get("/api/ai/map").json()
    assert not snapshot["slots"][0]["observation_ready"] and snapshot["summary"]["available_slots"] == 0


def test_cancel_and_check_in_checkout(client, database, headers, observer, slot):
    assert reserve(client, headers, slot).status_code == 200
    assert client.post(f"/parking-slots/{slot}/cancel-reservation", headers=headers).status_code == 200
    observer("OCCUPIED")
    assert state(client) == "UNKNOWN"
    result = client.post(f"/parking-slots/{slot}/check-in", headers=headers, json=CUSTOMER)
    assert result.status_code == 200 and result.json()["status"] == "OCCUPIED"
    session_id = result.json()["active_session_id"]
    detail = client.get(f"/parking-sessions/{session_id}", headers=headers).json()
    assert detail["arrival_source"] == "LATE_UNKNOWN" and detail["arrived_at"] is None
    assert client.post(f"/parking-sessions/{session_id}/check-out", headers=headers).status_code == 409
    observer("EMPTY")
    assert state(client) == "EMPTY"
    assert client.post(f"/parking-sessions/{session_id}/check-out", headers=headers).status_code == 409
    detail = client.get(f"/parking-sessions/{session_id}", headers=headers).json()
    assert detail["status"] == "COMPLETED"


def test_checkout_ends_reentry_rights(client, headers, observer, slot):
    session_id = reserve(client, headers, slot).json()["active_session_id"]
    observer("OCCUPIED")
    observer("EMPTY")
    assert state(client) == "RESERVED"
    assert client.post(f"/parking-sessions/{session_id}/check-out", headers=headers).status_code == 200
    observer("OCCUPIED")
    assert state(client) == "UNKNOWN"


def test_failed_event_insert_rolls_back_slot_session_and_broadcast(client, database, headers, slot, monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast", broadcast)
    before = parking_cache._snapshot
    def fail_insert(*args):
        raise RuntimeError("injected event insert failure")
    event.listen(models.ParkingEvent, "before_insert", fail_insert)
    try:
        with pytest.raises(RuntimeError, match="injected"):
            reserve(client, headers, slot)
    finally:
        event.remove(models.ParkingEvent, "before_insert", fail_insert)
    with database() as db:
        assert db.get(models.ParkingSlot, slot).status == "EMPTY"
        assert db.query(models.ParkingSession).count() == 0
        assert db.query(models.ParkingEvent).count() == 1  # initial EMPTY observation
    assert parking_cache._snapshot is before
    broadcast.assert_not_awaited()


def test_old_frame_does_not_attach_to_new_booking(client, database, headers, observer, slot):
    with database() as db:
        old = utc(db.get(models.ParkingSlot, slot).observed_at) + timedelta(microseconds=1)
    reserve(client, headers, slot)
    assert observer("OCCUPIED", observed_at=old).status_code == 200
    assert state(client) == "RESERVED"
    with database() as db:
        assert db.query(models.ParkingSession).one().arrived_at is None


def test_postgres_concurrent_booking(database, client, slot):
    if database.kw["bind"].dialect.name != "postgresql":
        pytest.skip("Row-lock concurrency requires PostgreSQL")
    ready, release, attempted = Event(), Event(), Event()
    def worker(hold):
        with database() as db:
            db.execute(text("SET LOCAL lock_timeout = '8s'"))
            admin = db.query(models.User).filter_by(username="admin").one()
            if hold:
                def before_commit(_):
                    ready.set()
                    assert release.wait(10)
                event.listen(db, "before_commit", before_commit, once=True)
            else:
                def observe(conn, cursor, statement, params, context, many):
                    if "FOR UPDATE" in statement and "cameras" in statement:
                        attempted.set()
                event.listen(db.connection(), "before_cursor_execute", observe)
            try:
                return manual_action(db, slot, "reserve", admin.id, ParkingCustomerInput(**CUSTOMER))[0].status.value
            except HTTPException as exc:
                return exc.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(worker, True)
        try:
            assert ready.wait(5)
            second = pool.submit(worker, False)
            assert attempted.wait(5) and not second.done()
        finally:
            release.set()
        assert (first.result(timeout=10), second.result(timeout=10)) == ("RESERVED", 409)
    with database() as db:
        assert db.query(models.ParkingSession).count() == 1


def test_legacy_hold_is_not_silently_released_and_can_be_reconciled(client, database, headers, observer, slot):
    with database() as db:
        item = db.get(models.ParkingSlot, slot)
        item.status, item.needs_reconciliation = "RESERVED", True
        db.commit()
    parking_cache.invalidate()
    assert observer("EMPTY").status_code == 200
    assert state(client) == "RESERVED"
    assert reserve(client, headers, slot).status_code == 409
    assert client.post(f"/parking-slots/{slot}/reconcile", headers=headers).status_code == 200
    assert state(client) == "EMPTY"
    assert reserve(client, headers, slot).status_code == 200


def test_return_after_expiry_without_sweep_is_unknown(client, database, headers, observer, slot):
    session_id = reserve(client, headers, slot).json()["active_session_id"]
    observer("OCCUPIED")
    observer("EMPTY")
    assert state(client) == "RESERVED"
    elapse(database, slot)
    # Simulate a delayed expiry job: the next message already shows a returning car.
    assert observer("OCCUPIED").status_code == 200
    assert state(client) == "UNKNOWN"
    detail = client.get(f"/parking-sessions/{session_id}", headers=headers).json()
    assert detail["status"] == "COMPLETED" and detail["departed_at"] is not None


def test_new_booking_replaces_expired_empty_hold_atomically(client, database, headers, slot):
    first_id = reserve(client, headers, slot).json()["active_session_id"]
    elapse(database, slot)
    second = reserve(client, headers, slot)
    assert second.status_code == 200
    assert second.json()["active_session_id"] != first_id
    with database() as db:
        assert db.get(models.ParkingSession, first_id).status == "EXPIRED"
        assert db.query(models.ParkingSession).filter(models.ParkingSession.status.in_(("RESERVED", "PARKED"))).count() == 1
