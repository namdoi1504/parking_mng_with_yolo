import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# Never use live database credentials or signing keys in tests.
os.environ.update(DATABASE_HOSTNAME="localhost", DATABASE_PORT="5432", DATABASE_PASSWORD="test",
                  DATABASE_NAME="test", DATABASE_USERNAME="test", SECRET_KEY="test-only-secret-key-" * 3,
                  ALGORITHM="HS256", STATS_SCHEDULER_ENABLED="false", RESERVATION_SCHEDULER_ENABLED="false")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from uuid import uuid4
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app import models
from app.db import Base, get_db
from app.main import app
from app.seed import bootstrap_admin


@pytest.fixture
def database():
    test_url = os.environ.get("TEST_POSTGRES_URL")
    schema = "parking_test_" + uuid4().hex
    admin_engine = engine = None
    try:
        if test_url:
            admin_engine = create_engine(test_url)
            with admin_engine.begin() as connection:
                connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            engine = create_engine(test_url)
            @event.listens_for(engine, "begin")
            def isolate(connection):
                # Transaction-pool connections can ignore libpq startup options.
                connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
                actual = connection.exec_driver_sql("SELECT current_schema()").scalar_one()
                if actual != schema:
                    raise RuntimeError("Refusing tests outside the disposable schema")
        else:
            engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
            @event.listens_for(engine, "connect")
            def foreign_keys(connection, _):
                connection.execute("PRAGMA foreign_keys=ON")
        Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine, autoflush=False)
        with factory() as db:
            bootstrap_admin(db, "admin", "Admin-test-password")
            db.commit()
        yield factory
    finally:
        if engine:
            engine.dispose()
        if admin_engine:
            with admin_engine.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin_engine.dispose()


@pytest.fixture
def client(database, monkeypatch):
    import app.main as main
    from app.parking_cache import parking_cache
    parking_cache.invalidate()
    monkeypatch.setattr(main, "SessionLocal", database)
    def override_db():
        with database() as db:
            yield db
    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()
    parking_cache.invalidate()


@pytest.fixture
def tokens(client):
    response = client.post("/auth/login", json={"username": "admin", "password": "Admin-test-password"})
    assert response.status_code == 200
    return response.json()


@pytest.fixture
def headers(tokens):
    return {"Authorization": "Bearer " + tokens["access_token"]}


@pytest.fixture
def observer(client, database):
    from datetime import datetime, timezone
    def send(status, *, camera_id=7, code="A1", observed_at=None, sequence=None, run_id=None, slots=None):
        with database() as db:
            camera = db.get(models.Camera, camera_id)
            run = run_id or (camera.ai_run_id if camera else "00000000-0000-0000-0000-000000000000")
            seq = sequence if sequence is not None else (camera.ai_sequence + 1 if camera else 1)
        return client.post("/api/ai/parking-status", json={"camera_id": camera_id, "run_id": run,
            "sequence": seq, "observed_at": (observed_at or datetime.now(timezone.utc)).isoformat(),
            "parking_slots": slots if slots is not None else [{"slot_code": code, "status": status}]})
    return send
