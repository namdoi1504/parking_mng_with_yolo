import pytest
from fastapi import HTTPException
from app.scenario_lab import Command, Lab, SCENARIOS, create_lab_app


@pytest.mark.parametrize("name", SCENARIOS)
def test_scenario_runs_real_lifecycle_and_expected_rejections(name):
    lab = Lab()
    snapshot = lab.reset(name)
    for _ in SCENARIOS[name][2]:
        snapshot = lab.execute(Command(run_id=snapshot["run_id"], cursor=snapshot["cursor"]))
        assert snapshot["log"][-1]["passed"], snapshot["log"][-1]
    assert len(snapshot["log"]) == len(SCENARIOS[name][2])
    assert lab.execute(Command(run_id=snapshot["run_id"], cursor=snapshot["cursor"])) == snapshot


def test_reset_isolates_data_and_rejects_stale_commands():
    lab = Lab()
    before = lab.snapshot()
    lab.execute(Command(run_id=before["run_id"], cursor=0))
    reset = lab.reset("direct")
    assert reset["sessions"] == [] and reset["events"] == [] and reset["cursor"] == 0
    assert reset["run_id"] != before["run_id"]
    with pytest.raises(HTTPException) as stale:
        lab.execute(Command(run_id=before["run_id"], cursor=1))
    assert stale.value.status_code == 409
    with pytest.raises(HTTPException):
        lab.reset("unknown")
    assert lab.snapshot()["run_id"] == reset["run_id"]


def test_app_only_exposes_isolated_lab_routes():
    from fastapi.testclient import TestClient
    with TestClient(create_lab_app()) as client:
        assert len(client.get("/scenario-lab/catalog").json()) == len(SCENARIOS)
        state = client.get("/scenario-lab/state").json()
        result = client.post("/scenario-lab/next", json={"run_id": state["run_id"], "cursor": 0})
        assert result.json()["slot"]["status"] == "RESERVED"
        assert client.post("/scenario-lab/next", json={"run_id": state["run_id"], "cursor": 0}).status_code == 409
        assert client.post("/scenario-lab/reset", json={"scenario": "cancel"}).json()["cursor"] == 0
        assert client.get("/parking-sessions").status_code == 404
        assert client.get("/api/ai/map").status_code == 404


def test_production_contract_runs_forms_and_history_on_demo_database():
    from fastapi.testclient import TestClient
    with TestClient(create_lab_app()) as client:
        root = "/scenario-lab/api"
        snapshot = client.get(root + "/api/ai/map").json()
        assert len(snapshot["slots"]) == 470
        assert snapshot["slots"][0]["slot_code"] == "001"
        assert snapshot["slots"][0]["roi_coordinates"]
        reserved = client.post(root + "/parking-slots/1/reserve", json={"customer_name": "Demo", "phone_number": "0900000000", "license_plate": "DEMO01"})
        assert reserved.status_code == 200
        assert reserved.json()["status"] == "RESERVED"
        session_id = reserved.json()["active_session_id"]
        sessions = client.get(root + "/parking-sessions?page=1&page_size=20&is_active=true").json()
        assert sessions["data"][0]["id"] == session_id
        assert client.get(root + f"/parking-sessions/{session_id}").json()["customer_name"] == "Demo"
        assert client.get(root + f"/parking-sessions/{session_id}/events?page=1&page_size=10").json()["meta"]["total"] == 1
        assert client.post(root + "/parking-slots/1/reserve", json={"customer_name": "Demo", "phone_number": "0900000000", "license_plate": "DEMO02"}).status_code == 409
        assert client.post(root + f"/parking-sessions/{session_id}/check-out").json()["status"] == "EMPTY"
        assert client.get(root + f"/parking-sessions/{session_id}").json()["is_active"] is False
        assert client.get(root + "/users").status_code == 404
        assert client.post(root + "/auth/login", json={}).status_code == 404
        assert client.get(root + "/api/stats/hourly?date=2026-10-14&utc_offset_minutes=420").status_code == 200
        assert client.get(root + "/ai-stream/status").json()["source_name"] == "Khung tín hiệu mô phỏng"
        frame = client.app.state.lab.frame()
        assert frame.startswith(b"\xff\xd8") and frame.endswith(b"\xff\xd9")
