import pytest
from starlette.websockets import WebSocketDisconnect
from app import models


def sync(client, camera=7, code="A1"):
    return client.post("/api/ai/sync-slots", json={"camera_id": camera, "slots": [
        {"slot_code": code, "roi_coordinates": [{"x": 1, "y": 2}], "col": 3, "row": 4}]})


def test_sync_camera_id_coordinates_and_duplicates(client, database):
    response = sync(client)
    assert response.status_code == 200 and response.json()["camera_id"] == 7
    assert sync(client).json()["unchanged"] == 1
    slot = client.get("/api/ai/map").json()["slots"][0]
    assert slot["camera_id"] == 7 and (slot["col"], slot["row"]) == (3, 4)
    assert sync(client, camera=8).status_code == 409
    duplicates = {"camera_id": 7, "slots": [{"slot_code": "A", "roi_coordinates": []}]*2}
    assert client.post("/api/ai/sync-slots", json=duplicates).status_code == 422
    assert client.post("/api/ai/parking-status", json={"camera_id": 7, "parking_slots": [
        {"slot_code": "A1", "status": "EMPTY"}]*2}).status_code == 422
    changed = client.post("/api/ai/sync-slots", json={"camera_id": 7, "slots": [
        {"slot_code": "A1", "roi_coordinates": [], "col": 9, "row": 1}]})
    assert changed.json()["updated"] == 1


def test_ai_camera_isolation_unknown_alert_and_events(client, database, observer):
    sync(client)
    sync(client, camera=8, code="B1")
    slots = [{"slot_code": "A1", "status": "OCCUPIED"},
             {"slot_code": "B1", "status": "OCCUPIED", "confidence": 0.4}]
    first = observer("OCCUPIED", camera_id=8, slots=slots)
    assert first.status_code == 200
    assert first.json()["unknown_slots"] == ["A1"] and first.json()["changed_slots"] == 1
    assert observer("OCCUPIED", camera_id=8, slots=slots).json()["unchanged_slots"] == 1
    assert client.get("/api/ai/summary").json()["has_unknown_alert"] is True
    assert [s["slot_code"] for s in client.get("/api/ai/unknown-slots?camera_id=8").json()] == ["B1"]
    with database() as db:
        assert db.query(models.ParkingSlot).filter_by(slot_code="A1").one().status is None
        assert db.query(models.ParkingEvent).count() == 1
    assert observer("EMPTY", camera_id=999).status_code == 404


def test_websocket_auth_broadcast_and_revocation(client, headers, tokens, observer):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/parking"):
            pass
    sync(client)
    with client.websocket_connect("/ws/parking", subprotocols=["parking", "bearer."+tokens["access_token"]]) as ws:
        assert ws.accepted_subprotocol == "parking"
        assert observer("OCCUPIED").status_code == 200
        event = ws.receive_json()
        assert event["type"] == "SLOT_STATUS_CHANGED" and event["camera_id"] == 7
        assert client.post("/auth/logout", headers=headers).status_code == 204
        ws.send_text("ping")
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_text()
        assert closed.value.code == 1008


def test_explicit_sync_id_advances_camera_sequence(client, headers):
    assert sync(client, camera=42).status_code == 200
    result = client.post("/cameras/", headers=headers, json={"name": "Next", "source_url": "rtsp://example"})
    assert result.status_code == 201 and result.json()["id"] > 42


def test_map_summary_share_cache_and_updates_refresh_it(client, database, observer):
    from sqlalchemy import event
    from app.config import settings
    assert settings.PARKING_CACHE_TTL_SECONDS > 0
    assert sync(client).status_code == 200
    assert observer("EMPTY").status_code == 200
    engine = database.kw["bind"]
    reads = []

    def count_reads(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT") and "FROM parking_slots" in statement:
            reads.append(statement)

    event.listen(engine, "before_cursor_execute", count_reads)
    try:
        for _ in range(10):
            assert client.get("/api/ai/map").json()["summary"]["empty_slots"] == 1
        assert client.get("/api/ai/summary").json()["empty_slots"] == 1
        assert len(reads) == 1

        # Unchanged detections refresh observation age and invalidate the snapshot.
        assert observer("EMPTY").json()["unchanged_slots"] == 1
        reads.clear()
        assert client.get("/api/ai/map").json()["slots"][0]["status"] == "EMPTY"
        assert len(reads) == 1  # refreshed observation age invalidates snapshot

        assert observer("OCCUPIED").json()["changed_slots"] == 1
        reads.clear()
        assert client.get("/api/ai/summary").json()["unknown_slots"] == 1
        assert client.get("/api/ai/map").json()["slots"][0]["status"] == "UNKNOWN"
        assert len(reads) == 1

        result = client.post("/api/ai/sync-slots", json={"camera_id": 7, "slots": [
            {"slot_code": "A1", "roi_coordinates": [], "col": 9, "row": 1}]})
        assert result.json()["updated"] == 1
        reads.clear()
        slot = client.get("/api/ai/map").json()["slots"][0]
        assert (slot["col"], slot["row"], slot["roi_coordinates"]) == (9, 1, [])
        assert slot["status"] == "UNKNOWN" and len(reads) == 1

        assert sync(client, camera=8, code="B1").json()["created"] == 1
        reads.clear()
        assert client.get("/api/ai/summary").json()["total_slots"] == 2
        assert len(client.get("/api/ai/map").json()["slots"]) == 2
        assert len(reads) == 1

        # A rejected transaction must not replace the committed snapshot.
        assert sync(client, camera=9, code="A1").status_code == 409
        reads.clear()
        assert client.get("/api/ai/summary").json()["total_slots"] == 2
        assert reads == []
    finally:
        event.remove(engine, "before_cursor_execute", count_reads)


def test_parking_cache_expiry_disable_and_loader_failure(monkeypatch):
    import app.parking_cache as cache_module
    cache = cache_module.ParkingSnapshotCache()
    now = [0.0]
    monkeypatch.setattr(cache_module, "monotonic", lambda: now[0])
    calls = []
    def load():
        calls.append(1)
        return object()

    first = cache.get(load, 30)
    now[0] = 29
    assert cache.get(load, 30) is first and len(calls) == 1
    now[0] = 30
    assert cache.get(load, 30) is not first and len(calls) == 2
    cache.get(load, 0)
    cache.get(load, 0)
    assert len(calls) == 4
    now[0] = 60
    def failing_load():
        raise RuntimeError("database unavailable")
    with pytest.raises(RuntimeError):
        cache.get(failing_load, 30)
    assert cache.get(load, 30) is not first and len(calls) == 5


def test_cache_concurrent_misses_and_invalidation_during_load():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from app.parking_cache import ParkingSnapshotCache
    cache = ParkingSnapshotCache()
    started, release = Event(), Event()
    calls = []
    def load():
        calls.append(1)
        started.set()
        assert release.wait(3)
        return object()
    with ThreadPoolExecutor(max_workers=5) as pool:
        first = pool.submit(cache.get, load, 30)
        assert started.wait(3)
        followers = [pool.submit(cache.get, load, 30) for _ in range(4)]
        release.set()
        value = first.result(timeout=3)
        assert all(f.result(timeout=3) is value for f in followers)
    assert len(calls) == 1

    cache.invalidate()
    started.clear()
    release.clear()
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(cache.get, load, 30)
        assert started.wait(3)
        invalidation = pool.submit(cache.invalidate)
        release.set()
        pending.result(timeout=3)
        invalidation.result(timeout=3)
    before = len(calls)
    cache.get(load, 30)
    assert len(calls) == before + 1


@pytest.mark.parametrize("status", ["UNKNOWN", "RESERVED"])
def test_ai_only_accepts_physical_occupancy(client, observer, status):
    sync(client)
    assert observer(status).status_code == 422


def test_observation_identity_order_age_and_timezone(client, database, observer):
    from datetime import datetime, timedelta, timezone
    from uuid import uuid4
    response = sync(client)
    run_id = response.json()["run_id"]
    stamp = datetime.now(timezone.utc)
    assert observer("EMPTY", observed_at=stamp, sequence=1).status_code == 200
    assert observer("OCCUPIED", sequence=1).status_code == 409
    assert observer("OCCUPIED", observed_at=stamp, sequence=2).status_code == 409
    assert observer("OCCUPIED", run_id=str(uuid4()), sequence=2).status_code == 409
    assert observer("OCCUPIED", observed_at=stamp - timedelta(seconds=16), sequence=2).status_code == 409
    assert observer("OCCUPIED", observed_at=stamp + timedelta(hours=1), sequence=2).status_code == 409
    assert observer("OCCUPIED", observed_at=stamp.replace(tzinfo=None), sequence=2).status_code == 422
    assert observer("OCCUPIED", sequence=2).status_code == 200
    new_run = str(uuid4())
    assert client.post("/api/ai/sync-slots", json={"camera_id": 7, "run_id": new_run,
        "slots": [{"slot_code": "A1", "roi_coordinates": [{"x": 1, "y": 2}], "col": 3, "row": 4}]}).status_code == 200
    assert client.get("/api/ai/map").json()["slots"][0]["observation_ready"] is False
    assert observer("EMPTY", run_id=run_id, sequence=3).status_code == 409
    assert observer("EMPTY", sequence=1).status_code == 200


def test_large_camera_batch_uses_bounded_session_reads_and_updates(client, database, observer):
    from sqlalchemy import event
    codes = [f"slot-{index}" for index in range(470)]
    assert client.post("/api/ai/sync-slots", json={"camera_id": 7,
        "slots": [{"slot_code": code, "roi_coordinates": []} for code in codes]}).status_code == 200
    queries = []
    engine = database.kw["bind"]
    def record(conn, cursor, statement, params, context, many):
        queries.append(statement)
    event.listen(engine, "before_cursor_execute", record)
    try:
        response = observer("EMPTY", slots=[{"slot_code": code,
                    "status": "OCCUPIED" if index % 2 else "EMPTY"} for index, code in enumerate(codes)])
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert response.status_code == 200 and response.json()["changed_slots"] == 470
    session_reads = [query for query in queries if query.lstrip().upper().startswith("SELECT") and "FROM parking_sessions" in query]
    slot_updates = [query for query in queries if query.lstrip().upper().startswith("UPDATE parking_slots")]
    assert len(session_reads) == 1 and len(slot_updates) <= 4
    summary = client.get("/api/ai/summary").json()
    assert summary["empty_slots"] == summary["unknown_slots"] == 235
