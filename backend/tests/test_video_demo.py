import io
import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app import demo_runtime, models, observation_runtime
from app.config import settings
from app.demo_runtime import demo_clock
from app.routers import parking
from app.services import video_demo
from app.services.parking_slots import expire_reservations, utc

CUSTOMER = {"customer_name": "Demo", "phone_number": "0900000000", "license_plate": "DEMO01"}


@pytest.fixture
def demo(client, monkeypatch):
    monkeypatch.setattr(settings, "VIDEO_DEMO_ENABLED", True)
    monkeypatch.setattr(settings, "VIDEO_DEMO_CAMERA_ID", 7)
    monkeypatch.setattr(settings, "VIDEO_DEMO_CONTROL_TOKEN", "x" * 32)
    now = [datetime.now(timezone.utc)]
    monkeypatch.setattr(demo_runtime, "wall_now", lambda: now[0])
    monkeypatch.setattr(parking, "wall_now", lambda: now[0])
    demo_clock.reset()
    run = str(uuid4())
    remote = dict(camera_id=7, run_id=run, running=True, ready=True,
                  control_enabled=True, playback_state="playing", owner_backend_id=None,
                  paused_at=None, resumed_at=None, pause_id=None, duration_seconds=120,
                  frame_id=1, media_seconds=0, seek_ready=True)
    class Opener:
        def open(self, request, timeout):
            action = None
            if request.data:
                assert request.get_header("X-demo-control") == "x" * 32
                body = json.loads(request.data)
                action = body["action"]
                remote["owner_backend_id"] = body["backend_id"]
                if body["action"] == "pause" and remote["playback_state"] != "paused":
                    remote.update(playback_state="paused", pause_id=str(uuid4()),
                                  paused_at=now[0].isoformat(), resumed_at=None)
                elif body["action"] == "resume" and remote["playback_state"] == "paused":
                    remote.update(playback_state="playing", resumed_at=now[0].isoformat())
                elif action == "seek" and remote.get("seek_id") != body["request_id"]:
                    remote.update(run_id=str(uuid4()), frame_id=remote["frame_id"]+1,
                                  playback_state="paused", paused_at=now[0].isoformat(), resumed_at=None,
                                  pause_id=str(uuid4()), seek_id=body["request_id"],
                                  seek_ready=False, seek_seconds=body["seconds"], media_seconds=body["seconds"])
                    remote["seek_snapshot"] = {"run_id": remote["run_id"], "frame_id": remote["frame_id"],
                        "observed_at": now[0].isoformat(), "parking_slots": [{"slot_code": "A1",
                        "status": "EMPTY" if body["seconds"] < 30 else "OCCUPIED"}]}
                elif action == "confirm-seek":
                    assert body["request_id"] == remote["seek_id"]
                    remote["seek_ready"] = True
            data = dict(remote)
            if action != "seek":
                data.pop("seek_snapshot", None)
            return io.BytesIO(json.dumps(data).encode())
    monkeypatch.setattr(video_demo, "build_opener", lambda *_: Opener())
    assert client.post("/api/ai/sync-slots", json={"camera_id": 7, "run_id": run,
        "slots": [{"slot_code": "A1", "roi_coordinates": []}]}).status_code == 200
    video_demo.status()
    yield now, remote
    demo_clock.reset()


def seek(client, headers, seconds, request_id=None):
    return client.post("/api/video-demo/seek", headers=headers,
                       json={"seconds": seconds, "request_id": request_id or str(uuid4())})


def test_seek_resets_only_demo_camera_and_rejects_late_run(client, headers, database, demo):
    now, remote = demo
    old_run = remote["run_id"]
    assert observe(client, now[0], remote).status_code == 200
    slot = client.get("/api/ai/map").json()["slots"][0]
    client.post(f"/parking-slots/{slot['id']}/reserve", headers=headers, json=CUSTOMER)
    with database() as db:
        user = db.query(models.User).filter_by(username="admin").one()
        db.add(models.Camera(id=8, name="Other", source_url="file://other"))
        db.flush()
        other = models.ParkingSlot(camera_id=8, slot_code="B1", roi_coordinates=[], status="OCCUPIED")
        db.add(other); db.flush()
        db.add(models.ParkingSession(parking_slot_id=other.id, created_by=user.id, **CUSTOMER))
        for camera_id in (7, 8):
            db.add(models.ParkingStatistic(camera_id=camera_id, period_start=now[0]-timedelta(minutes=15),
                period_end=now[0], occupied_count=1, available_count=0, total_count=1, utilization_rate=100))
        db.commit()
    response = seek(client, headers, 40)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["clock"]["paused"] and data["clock"]["healthy"]
    assert data["playback"]["seek_ready"] and data["playback"]["media_seconds"] == 40
    assert data["reset"]["deleted_sessions"] == 1 and data["reset"]["deleted_statistics"] == 1
    with database() as db:
        assert db.get(models.ParkingSlot, slot["id"]).status == "UNKNOWN"
        assert db.query(models.ParkingSession).count() == 1
        assert db.query(models.ParkingStatistic).one().camera_id == 8
        assert db.query(models.User).filter_by(username="admin").count() == 1
        assert db.query(models.ParkingEvent).filter_by(parking_slot_id=slot["id"]).one().source == "DEMO_SEEK"
        assert db.get(models.Camera, 7).ai_run_id == remote["run_id"] != old_run
    late = {**remote, "run_id": old_run}
    assert observe(client, now[0], late, 999).status_code == 409


def test_seek_retries_do_not_delete_new_booking(client, headers, database, demo):
    now, remote = demo
    key = str(uuid4())
    assert seek(client, headers, 5, key).status_code == 200
    slot = client.get("/api/ai/map").json()["slots"][0]
    assert slot["observation_ready"] and slot["status"] == "EMPTY"
    assert client.post(f"/parking-slots/{slot['id']}/reserve", headers=headers, json=CUSTOMER).status_code == 200
    again = seek(client, headers, 5, key)
    assert again.status_code == 200 and again.json()["replayed"]
    with database() as db:
        assert db.query(models.ParkingSession).one().is_active
    assert seek(client, headers, 6, key).status_code == 409
    assert seek(client, headers, 10).status_code == 200
    assert seek(client, headers, 5, key).status_code == 409


@pytest.mark.parametrize("failure_phase", ["before", "after"])
def test_seek_ack_failure_is_recoverable_and_blocks_actions(client, headers, database, demo, monkeypatch, failure_phase):
    from fastapi import HTTPException
    now, remote = demo
    original = video_demo.exchange
    failed = [False]
    def exchange(action=None, **parameters):
        if action == "confirm-seek" and not failed[0]:
            failed[0] = True
            if failure_phase == "after":
                original(action, **parameters)
            raise HTTPException(503, "Lost acknowledgement")
        return original(action, **parameters)
    monkeypatch.setattr(video_demo, "exchange", exchange)
    key = str(uuid4())
    assert seek(client, headers, 3, key).status_code == 503
    assert demo_clock.seeking and not demo_clock.healthy()
    assert client.post("/api/video-demo/resume", headers=headers).status_code == 409
    slot = client.get("/api/ai/map").json()["slots"][0]
    assert client.post(f"/parking-slots/{slot['id']}/reserve", headers=headers, json=CUSTOMER).status_code == 409
    assert seek(client, headers, 3, key).status_code == 200
    assert demo_clock.healthy() and not demo_clock.seeking


@pytest.mark.parametrize("seconds", [-1, 120, 9999])
def test_invalid_seek_does_not_reset_data(client, headers, database, demo, seconds):
    now, remote = demo
    assert observe(client, now[0], remote).status_code == 200
    slot = client.get("/api/ai/map").json()["slots"][0]
    client.post(f"/parking-slots/{slot['id']}/reserve", headers=headers, json=CUSTOMER)
    assert seek(client, headers, seconds).status_code == 422
    assert not demo_clock.seeking
    with database() as db:
        assert db.query(models.ParkingSession).one().is_active


def observe(client, now, remote, sequence=1, status="EMPTY"):
    return client.post("/api/ai/parking-status", json={"camera_id": 7, "run_id": remote["run_id"],
        "sequence": sequence, "observed_at": now.isoformat(),
        "parking_slots": [{"slot_code": "A1", "status": status}]})


def test_controls_disabled_and_admin_only(client, headers, database):
    assert client.post("/api/video-demo/pause").status_code == 401
    assert client.post("/api/video-demo/pause", headers=headers).status_code == 404
    assert client.post("/api/video-demo/seek", json={"seconds": 5}).status_code == 401
    assert seek(client, headers, 5).status_code == 404
    with database() as db:
        user = db.query(models.User).filter_by(username="admin").one()
        user.role = models.Role(name="Operator", permissions=list(user.role.permissions))
        db.commit()
    assert client.get("/api/video-demo/status", headers=headers).status_code == 403


def test_long_pause_preserves_observation_and_allows_booking(client, headers, database, demo):
    now, remote = demo
    assert observe(client, now[0], remote).status_code == 200
    slot = client.get("/api/ai/map").json()["slots"][0]
    assert client.post("/api/video-demo/pause", headers=headers).status_code == 200
    frozen = demo_clock.now()
    now[0] += timedelta(minutes=20)
    assert client.get("/api/video-demo/status", headers=headers).status_code == 200
    assert demo_clock.now() == frozen
    assert client.get("/api/ai/map").json()["slots"][0]["observation_ready"]
    response = client.post(f"/parking-slots/{slot['id']}/reserve", headers=headers, json=CUSTOMER)
    assert response.status_code == 200
    assert expire_reservations(session_factory=database) == []
    with database() as db:
        stored = db.get(models.ParkingSlot, slot["id"])
        assert utc(stored.observed_at) == datetime.fromisoformat(slot["observed_at"])
        assert db.query(models.ParkingSession).one().is_active
    # Late/in-flight observations may not change a paused slot.
    assert observe(client, now[0], remote, 2, "OCCUPIED").status_code == 409
    assert client.post("/api/video-demo/resume", headers=headers).status_code == 200
    assert demo_clock.now() == frozen
    # Idempotent resume/status must not subtract the pause twice.
    assert client.post("/api/video-demo/resume", headers=headers).status_code == 200
    now[0] += timedelta(seconds=2)
    assert demo_clock.now() == frozen + timedelta(seconds=2)
    assert observe(client, now[0], remote, 3, "OCCUPIED").status_code == 200
    assert client.get("/api/ai/map").json()["slots"][0]["status"] == "OCCUPIED"


def test_paused_unknown_slot_can_check_in(client, headers, demo):
    now, remote = demo
    assert observe(client, now[0], remote, status="OCCUPIED").status_code == 200
    slot = client.get("/api/ai/map").json()["slots"][0]
    client.post("/api/video-demo/pause", headers=headers)
    now[0] += timedelta(minutes=12)
    client.get("/api/video-demo/status", headers=headers)
    response = client.post(f"/parking-slots/{slot['id']}/check-in", headers=headers, json=CUSTOMER)
    assert response.status_code == 200 and response.json()["status"] == "OCCUPIED"


def test_expired_hold_freshness_and_health_still_enforced(client, headers, database, demo, monkeypatch):
    now, remote = demo
    assert observe(client, now[0], remote).status_code == 200
    slot = client.get("/api/ai/map").json()["slots"][0]
    client.post(f"/parking-slots/{slot['id']}/reserve", headers=headers, json=CUSTOMER)
    client.post("/api/video-demo/pause", headers=headers)
    now[0] += timedelta(minutes=20)
    client.post("/api/video-demo/resume", headers=headers)
    now[0] += timedelta(minutes=11)
    client.get("/api/video-demo/status", headers=headers)
    assert observe(client, now[0], remote, 2).status_code == 200
    assert client.get("/api/ai/map").json()["slots"][0]["status"] == "EMPTY"
    # Stale real source timestamps are rejected even if virtual time is young.
    assert observe(client, now[0]-timedelta(seconds=30), remote, 3).status_code == 409
    demo_clock.offline()
    assert not client.get("/api/ai/map").json()["slots"][0]["observation_ready"]
    assert client.post(f"/parking-slots/{slot['id']}/reserve", headers=headers, json=CUSTOMER).status_code == 409


def test_repeated_pauses_and_restart_do_not_accept_old_owner(client, headers, demo):
    now, remote = demo
    for minutes in (2, 3):
        client.post("/api/video-demo/pause", headers=headers)
        now[0] += timedelta(minutes=minutes)
        client.post("/api/video-demo/resume", headers=headers)
    assert demo_clock.offset == timedelta(minutes=5)
    remote.update(owner_backend_id="old-backend", playback_state="paused")
    demo_clock.observe(remote)
    assert not demo_clock.healthy()


def test_ai_outage_does_not_leave_pause_trusted(client, headers, demo, monkeypatch):
    now, remote = demo
    assert observe(client, now[0], remote).status_code == 200
    client.post("/api/video-demo/pause", headers=headers)
    remote["running"] = False
    client.get("/api/video-demo/status", headers=headers)
    assert not demo_clock.healthy()
    assert not client.get("/api/ai/map").json()["slots"][0]["observation_ready"]
