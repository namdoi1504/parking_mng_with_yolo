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


def test_ai_camera_isolation_unknown_alert_and_events(client, database):
    sync(client)
    sync(client, camera=8, code="B1")
    payload = {"camera_id": 8, "parking_slots": [
        {"slot_code": "A1", "status": "OCCUPIED"}, {"slot_code": "B1", "status": "UNKNOWN", "confidence": 0.4}]}
    first = client.post("/api/ai/parking-status", json=payload)
    assert first.status_code == 200
    assert first.json()["unknown_slots"] == ["A1"] and first.json()["changed_slots"] == 1
    assert client.post("/api/ai/parking-status", json=payload).json()["unchanged_slots"] == 1
    assert client.get("/api/ai/summary").json()["has_unknown_alert"] is True
    assert client.get("/api/ai/map").json()["summary"]["has_unknown_alert"] is True
    assert [s["slot_code"] for s in client.get("/api/ai/unknown-slots?camera_id=8").json()] == ["B1"]
    with database() as db:
        assert db.query(models.ParkingSlot).filter_by(slot_code="A1").one().status == "EMPTY"
        assert db.query(models.ParkingEvent).count() == 1
    assert client.post("/api/ai/parking-status", json={"camera_id": 999, "parking_slots": []}).status_code == 404


def test_websocket_auth_broadcast_and_revocation(client, headers, tokens):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/parking"):
            pass
    sync(client)
    with client.websocket_connect("/ws/parking", subprotocols=["parking", "bearer."+tokens["access_token"]]) as ws:
        assert ws.accepted_subprotocol == "parking"
        assert client.post("/api/ai/parking-status", json={"camera_id": 7, "parking_slots": [
            {"slot_code": "A1", "status": "OCCUPIED"}]}).status_code == 200
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
