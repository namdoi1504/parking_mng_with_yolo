import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# Never use live database credentials or signing keys in tests.
os.environ.update(DATABASE_HOSTNAME="localhost", DATABASE_PORT="5432", DATABASE_PASSWORD="test",
                  DATABASE_NAME="test", DATABASE_USERNAME="test", SECRET_KEY="test-only-secret-key-" * 3,
                  ALGORITHM="HS256", STATS_SCHEDULER_ENABLED="false")

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
    admin_engine = None
    if test_url:
        admin_engine = create_engine(test_url)
        with admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_engine(test_url, connect_args={"options": f"-csearch_path={schema}"})
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
    engine.dispose()
    if admin_engine:
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin_engine.dispose()


@pytest.fixture
def client(database, monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, "SessionLocal", database)
    def override_db():
        with database() as db:
            yield db
    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


@pytest.fixture
def tokens(client):
    response = client.post("/auth/login", json={"username": "admin", "password": "Admin-test-password"})
    assert response.status_code == 200
    return response.json()


@pytest.fixture
def headers(tokens):
    return {"Authorization": "Bearer " + tokens["access_token"]}
