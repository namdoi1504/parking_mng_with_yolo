"""Standalone local lab. Never mount this app in the production API."""
from datetime import date, datetime, timedelta, timezone
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import json
import asyncio
from io import BytesIO
from threading import RLock
from uuid import uuid4
from time import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.concurrency import run_in_threadpool

from . import models, observation_runtime
from .db import Base
from .schemas import ParkingCustomerInput
from .schemas import ParkingSessionResponse, ParkingEventResponse
from .services.parking_slots import (
    active_session, expire_reservations, manual_action, reconcile, slot_response, utc,
)

spec = spec_from_file_location("lab_observation", Path(__file__).resolve().parents[2] / "AI/datasets/observation.py")
observation = module_from_spec(spec)
spec.loader.exec_module(observation)


def step(label, kind, expected, active, *, value=None, error=None):
    return dict(label=label, kind=kind, expected=expected, active=active, value=value, error=error)


RESERVE = step("Điều phối giữ ô cho khách demo", "reserve", "RESERVED", True)
ARRIVE = step("AI xác nhận có xe ổn định", "observe", "OCCUPIED", True, value="OCCUPIED")
LEAVE = step("AI xác nhận xe rời, vẫn trong hạn giữ", "observe", "RESERVED", True, value="EMPTY")
EXPIRE = step("Tiến 11 phút, duy trì quan sát AI và chạy quét hết hạn", "advance_fresh", "EMPTY", False, value=660)
SCENARIOS = {
    "arrival": ("Đặt trước → xe đến", "AI tự xác nhận khách đến mà không bấm nút đến.", [RESERVE, ARRIVE]),
    "hold": ("Giữ chỗ nhưng ô vẫn trống", "Tín hiệu EMPTY không xóa giữ chỗ còn hạn.", [RESERVE, step("AI tiếp tục báo ô trống", "observe", "RESERVED", True, value="EMPTY")]),
    "expiry": ("Khách không đến → hết hạn", "Đồng hồ demo tiến nhanh; dùng bộ quét hết hạn thật.", [RESERVE, EXPIRE]),
    "direct": ("Khách đỗ trực tiếp", "Xe chưa đăng ký được ghi nhận UNKNOWN trước khi gắn khách.", [step("AI phát hiện xe chưa có phiên", "observe", "UNKNOWN", False, value="OCCUPIED"), step("Điều phối đăng ký xe đang đỗ", "check-in", "OCCUPIED", True)]),
    "cancel": ("Hủy giữ chỗ", "Điều phối hủy giữ chỗ khi camera xác nhận ô trống.", [RESERVE, step("Điều phối hủy lượt giữ", "cancel-reservation", "EMPTY", False)]),
    "return": ("Xe rời rồi quay lại trong hạn", "Vẫn dùng cùng phiên; không gia hạn 10 phút.", [RESERVE, ARRIVE, LEAVE, ARRIVE]),
    "departure": ("Xe rời sau thời hạn", "Xe còn đỗ giữ phiên; rời sau hạn sẽ tự đóng.", [RESERVE, ARRIVE, step("Tiến 11 phút khi xe vẫn có mặt", "advance_fresh", "OCCUPIED", True, value=660), step("AI ghi nhận xe rời sau hạn", "observe", "EMPTY", False, value="EMPTY")]),
    "checkout": ("Checkout sau khi xe rời", "Người điều phối đóng phiên khi camera xác nhận trống.", [RESERVE, ARRIVE, LEAVE, step("Điều phối checkout", "check-out", "EMPTY", False)]),
    "duplicate": ("Hai yêu cầu đặt cùng ô", "Hai yêu cầu nối tiếp: lượt sau bị từ chối 409. Không phải kiểm thử cạnh tranh PostgreSQL.", [RESERVE, step("Khách thứ hai yêu cầu cùng ô", "reserve", "RESERVED", True, error=409)]),
    "unsafe_checkout": ("Checkout khi xe còn trong ô", "Backend từ chối giải phóng ô khi vẫn có xe.", [RESERVE, ARRIVE, step("Thử checkout khi AI vẫn báo có xe", "check-out", "OCCUPIED", True, error=409)]),
    "stale": ("Mất tín hiệu quan sát AI", "Mô phỏng quan sát cũ, không mô phỏng mất mạng trình duyệt.", [step("Tiến 30 giây không nhận quan sát mới", "advance", "EMPTY", False, value=30), step("Thử đặt khi dữ liệu AI đã cũ", "reserve", "EMPTY", False, error=409), step("Khôi phục quan sát ô trống", "observe", "EMPTY", False, value="EMPTY"), RESERVE]),
    "unstable": ("Nhận diện chập chờn", "Dùng ObservationStabilizer thật, ngưỡng có xe 0,5 giây.", [RESERVE, step("Tín hiệu có/trống đổi liên tục, chưa đủ ổn định", "unstable", "RESERVED", True), ARRIVE]),
}

LAYOUT = json.loads((Path(__file__).resolve().parents[2] / "AI/datasets/slots_config.json").read_text(encoding="utf-8"))


class SelectScenario(BaseModel):
    scenario: str = Field(max_length=40)


class Command(BaseModel):
    run_id: str
    cursor: int = Field(ge=0)


class Lab:
    def __init__(self):
        self.lock = RLock()
        self.engine = None
        self.reset("arrival")

    def reset(self, name):
        if name not in SCENARIOS:
            raise HTTPException(422, "Unknown scenario")
        with self.lock:
            if self.engine is not None:
                self.engine.dispose()
            self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
            @event.listens_for(self.engine, "connect")
            def enable_foreign_keys(connection, _):
                connection.execute("PRAGMA foreign_keys=ON")
            Base.metadata.create_all(self.engine)
            self.factory = sessionmaker(bind=self.engine, autoflush=False)
            self.name, self.run_id, self.cursor = name, str(uuid4()), 0
            self.now = datetime.now(timezone.utc).replace(microsecond=0)
            self.log = []
            self.stabilizer = observation.ObservationStabilizer()
            with self.factory() as db:
                role = models.Role(id=1, name="Lab only")
                db.add(role); db.flush()
                db.add(models.User(id=1, role_id=1, username="lab-only", full_name="Khách demo", password_hash="not-a-login-account", status="INACTIVE"))
                db.add(models.Camera(id=1, name="Camera mô phỏng", source_url="lab://signals", ai_run_id=self.run_id))
                db.flush()
                for index, item in enumerate(LAYOUT):
                    occupancy = "OCCUPIED" if index > 0 and index % 3 == 0 else "EMPTY"
                    db.add(models.ParkingSlot(id=index + 1, camera_id=1, slot_code=item["slot_code"],
                        roi_coordinates=[{"x": point[0], "y": point[1]} for point in item["points"]], row=item["row"], col=item["col"],
                        status="UNKNOWN" if occupancy == "OCCUPIED" else "EMPTY", created_at=self.now, updated_at=self.now,
                        last_empty_at=self.now if occupancy == "EMPTY" else None, last_observed_occupancy=occupancy,
                        observed_at=self.now, observation_run_id=self.run_id, observation_backend_id=observation_runtime.backend_id))
                db.commit()
            return self.snapshot()

    def observe(self, occupancy):
        with self.factory() as db:
            slot = db.get(models.ParkingSlot, 1)
            messages = []
            reconcile(db, slot, occupancy, self.now, self.now, messages)
            db.commit()
        return messages

    def execute(self, command):
        with self.lock:
            if command.run_id != self.run_id or command.cursor != self.cursor:
                raise HTTPException(409, "Demo changed; reload before running the next step")
            steps = SCENARIOS[self.name][2]
            if self.cursor >= len(steps):
                return self.snapshot()
            action = steps[self.cursor]
            before = self.snapshot()["slot"]["status"]
            self.now += timedelta(seconds=2)
            error, messages, notes = None, [], []
            try:
                kind = action["kind"]
                if kind == "observe":
                    # Feed a stable signal through the same AI confirmation component.
                    start = self.now.timestamp()
                    self.stabilizer.update([{"slot_code": "DEMO-01", "status": action["value"]}], start)
                    duration = 1.5 if action["value"] == "EMPTY" else 0.5
                    self.now += timedelta(seconds=duration)
                    confirmed = self.stabilizer.update([{"slot_code": "DEMO-01", "status": action["value"]}], self.now.timestamp())
                    if not confirmed:
                        raise RuntimeError("Stable signal was not confirmed")
                    messages = self.observe(confirmed[0]["status"])
                    notes.append(f"AI xác nhận sau {duration:g} giây mô phỏng")
                elif kind in ("advance", "advance_fresh"):
                    self.now += timedelta(seconds=action["value"])
                    if kind == "advance_fresh":
                        with self.factory() as db:
                            for slot in db.query(models.ParkingSlot).all():
                                slot.observed_at = self.now
                            db.commit()
                        notes.append("Mô phỏng camera tiếp tục gửi quan sát ổn định suốt khoảng thời gian này")
                    messages = expire_reservations(now=self.now, session_factory=self.factory)
                elif kind == "unstable":
                    for occupancy in ("OCCUPIED", "EMPTY", "OCCUPIED", "EMPTY", "OCCUPIED"):
                        self.now += timedelta(seconds=0.1)
                        confirmed = self.stabilizer.update([{"slot_code": "DEMO-01", "status": occupancy}], self.now.timestamp())
                        notes.append(f"{occupancy}: {'đã xác nhận' if confirmed else 'chưa xác nhận'}")
                        if confirmed:
                            messages.extend(self.observe(occupancy))
                else:
                    customer = ParkingCustomerInput(customer_name="Khách Demo", phone_number="0900000000", license_plate="DEMO01")
                    with self.factory() as db:
                        _, messages = manual_action(db, 1, kind, 1, customer, now=self.now)
            except HTTPException as exc:
                error = {"status": exc.status_code, "detail": str(exc.detail)}
            snapshot = self.snapshot()
            passed = (snapshot["slot"]["status"] == action["expected"]
                and bool(snapshot["active_session"]) == action["active"]
                and (error["status"] if error else None) == action["error"])
            self.log.append(dict(index=self.cursor + 1, label=action["label"], time=self.now.isoformat(),
                before=before, after=snapshot["slot"]["status"], expected=action["expected"], passed=passed,
                error=error, messages=messages, notes=notes))
            self.cursor += 1
            return self.snapshot()

    def snapshot(self):
        with self.lock, self.factory() as db:
            slot = db.get(models.ParkingSlot, 1)
            session = active_session(db, 1)
            slots = slot_response(slot, session, self.now, db.get(models.Camera, 1)).model_dump(mode="json")
            sessions = [{"id": item.id, "is_active": item.is_active, "created_at": utc(item.created_at).isoformat(),
                "customer_name": item.customer_name, "phone_number": item.phone_number, "license_plate": item.license_plate}
                for item in db.query(models.ParkingSession).order_by(models.ParkingSession.id).all()]
            events = [{"id": item.id, "old_status": item.old_status, "new_status": item.new_status,
                "source": item.source, "event_time": utc(item.event_time).isoformat()}
                for item in db.query(models.ParkingEvent).order_by(models.ParkingEvent.id).all()]
            return dict(scenario=self.name, run_id=self.run_id, cursor=self.cursor, time=self.now.isoformat(),
                slot=slots, active_session=session.id if session else None, sessions=sessions, events=events,
                steps=[dict(label=item["label"], expected=item["expected"]) for item in SCENARIOS[self.name][2]], log=list(self.log))

    def parking_map(self):
        with self.lock, self.factory() as db:
            sessions = {item.parking_slot_id: item for item in db.query(models.ParkingSession).filter_by(is_active=True).all()}
            camera = db.get(models.Camera, 1)
            slots = [slot_response(item, sessions.get(item.id), self.now, camera).model_dump(mode="json")
                for item in db.query(models.ParkingSlot).order_by(models.ParkingSlot.id).all()]
            counts = {status: sum(item["status"] == status for item in slots) for status in ("EMPTY", "OCCUPIED", "UNKNOWN", "RESERVED")}
            summary = dict(total_slots=len(slots), empty_slots=counts["EMPTY"], occupied_slots=counts["OCCUPIED"],
                unknown_slots=counts["UNKNOWN"], reserved_slots=counts["RESERVED"], has_unknown_alert=counts["UNKNOWN"] > 0,
                available_slots=sum(item["status"] == "EMPTY" and item["observation_ready"] and not item["active_session_id"] for item in slots), uninitialized_slots=0)
            return dict(slots=slots, summary=summary)

    def api_request(self, path, method, params, body):
        with self.lock, self.factory() as db:
            if method == "GET" and path in ("api/ai/map", "api/ai/summary", "api/stats/realtime"):
                result = self.parking_map()
                return result if path == "api/ai/map" else result["summary"]
            if method == "GET" and path == "ai-stream/status":
                occupied = db.query(models.ParkingSlot).filter_by(last_observed_occupancy="OCCUPIED").count()
                ready = slot_response(db.get(models.ParkingSlot, 1), now=self.now, camera=db.get(models.Camera, 1)).observation_ready
                return dict(camera_id=1, source_name="Khung tín hiệu mô phỏng", ready=True, running=True,
                    frame_id=self.cursor, frame_age_seconds=0, updated_at=time(), fps=2, video_fps=2,
                    media_seconds=self.cursor, occupied=occupied, empty=len(LAYOUT)-occupied,
                    sync_ok=ready, sync_at=time(), analysis_age_ms=0 if ready else 30000, analysis_stale=not ready)
            if method == "GET" and path == "parking-sessions":
                from .routers.parking_sessions import list_sessions
                result = list_sessions(page=int(params.get("page", 1)), page_size=int(params.get("page_size", 20)),
                    is_active=None if "is_active" not in params else params["is_active"] == "true",
                    parking_slot_id=int(params["parking_slot_id"]) if params.get("parking_slot_id") else None,
                    license_plate=params.get("license_plate"), phone_number=params.get("phone_number"),
                    created_from=datetime.fromisoformat(params["created_from"]) if params.get("created_from") else None,
                    created_to=datetime.fromisoformat(params["created_to"]) if params.get("created_to") else None, db=db)
                result["data"] = [ParkingSessionResponse.model_validate(item).model_dump(mode="json") for item in result["data"]]
                return result
            parts = path.split("/")
            if method == "GET" and len(parts) in (2, 3) and parts[0] == "parking-sessions":
                from .routers.parking_sessions import get_session, session_events
                session_id = int(parts[1])
                if len(parts) == 2:
                    return ParkingSessionResponse.model_validate(get_session(session_id, db)).model_dump(mode="json")
                if parts[2] == "events":
                    result = session_events(session_id, page=int(params.get("page", 1)), page_size=int(params.get("page_size", 10)), db=db)
                    result["data"] = [ParkingEventResponse.model_validate(item).model_dump(mode="json") for item in result["data"]]
                    return result
            if method == "POST" and len(parts) == 3 and parts[0] in ("parking-slots", "parking-sessions"):
                action, slot_id, expected = parts[2], int(parts[1]), None
                if parts[0] == "parking-sessions":
                    session = db.get(models.ParkingSession, slot_id)
                    if not session or action != "check-out":
                        raise HTTPException(404, "Demo session not found")
                    expected, slot_id = session.id, session.parking_slot_id
                customer = ParkingCustomerInput.model_validate(body) if action in ("reserve", "check-in") else None
                self.now += timedelta(seconds=1)
                result, _ = manual_action(db, slot_id, action, 1, customer, now=self.now, expected_session_id=expected)
                return result.model_dump(mode="json")
            if method == "GET" and path in ("api/stats/hourly", "api/stats/daily"):
                from .routers.stats import hourly, daily
                from .statistics import aggregate_stats
                aggregate_stats(now=self.now, session_factory=self.factory)
                camera_id = int(params["camera_id"]) if params.get("camera_id") else None
                offset = int(params.get("utc_offset_minutes", 0))
                if path.endswith("hourly"):
                    return hourly(date=date.fromisoformat(params["date"]), camera_id=camera_id, utc_offset_minutes=offset, db=db)
                return daily(from_date=date.fromisoformat(params["from"]), to_date=date.fromisoformat(params["to"]), camera_id=camera_id, utc_offset_minutes=offset, db=db)
            raise HTTPException(404, "Endpoint is not available in the isolated demo")

    def frame(self):
        from PIL import Image, ImageDraw
        with self.lock, self.factory() as db:
            image = Image.new("RGB", (1920, 1080), "#cbd6dd")
            draw = ImageDraw.Draw(image)
            for x in (145, 330, 540, 715, 895, 1075, 1255, 1440, 1620, 1800):
                draw.line([(x, 360), (x, 1020)], fill="white", width=3)
            draw.line([(20, 956), (880, 956)], fill="white", width=3)
            for slot in db.query(models.ParkingSlot).order_by(models.ParkingSlot.id).all():
                points = [(p["x"], p["y"]) for p in slot.roi_coordinates]
                occupied = slot.last_observed_occupancy == "OCCUPIED"
                draw.polygon(points, fill="#edd2d5" if occupied else "#d6eee6", outline="#cc4151" if occupied else "#11875e", width=2)
                xs, ys = [p[0] for p in points], [p[1] for p in points]
                cx, cy = sum(xs)/len(xs), sum(ys)/len(ys)
                if occupied:
                    width, height = min(20, (max(xs)-min(xs))*0.4), min(12, (max(ys)-min(ys))*0.5)
                    draw.rounded_rectangle((cx-width, cy-height, cx+width, cy+height), radius=4, fill="#305975")
                draw.text((min(xs)+2, min(ys)+2), slot.slot_code, fill="#375164")
            draw.rectangle((0, 0, 1920, 68), fill="#173b50")
            draw.text((25, 23), f"MO PHONG TIN HIEU AI | CAMERA 1 | SLOT 001 | {self.now.isoformat()}", fill="white")
            image = image.resize((960, 540))
            buffer = BytesIO(); image.save(buffer, format="JPEG", quality=85)
            return buffer.getvalue()


def create_lab_app():
    app = FastAPI(title="Isolated parking scenario lab", docs_url=None, redoc_url=None)
    lab = Lab()
    app.state.lab = lab

    @app.get("/scenario-lab/catalog")
    def catalog():
        return [{"id": name, "title": item[0], "description": item[1]} for name, item in SCENARIOS.items()]

    @app.get("/scenario-lab/state")
    def state():
        return lab.snapshot()

    @app.post("/scenario-lab/reset")
    def reset(payload: SelectScenario):
        return lab.reset(payload.scenario)

    @app.post("/scenario-lab/next")
    def next_step(payload: Command):
        return lab.execute(payload)

    @app.get("/scenario-lab/api/ai-stream/video")
    async def video(request: Request):
        async def frames():
            while not await request.is_disconnected():
                frame = await run_in_threadpool(lab.frame)
                yield b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(frame)).encode() + b"\r\n\r\n" + frame + b"\r\n"
                await asyncio.sleep(0.5)
        return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame")

    @app.api_route("/scenario-lab/api/{path:path}", methods=["GET", "POST"])
    async def production_contract(path: str, request: Request):
        try:
            raw = await request.body() if request.method == "POST" else b""
            body = json.loads(raw) if raw else None
            return await run_in_threadpool(lab.api_request, path, request.method, dict(request.query_params), body)
        except (ValueError, KeyError) as exc:
            raise HTTPException(422, "Invalid demo request") from exc

    return app
