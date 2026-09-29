from datetime import datetime, timedelta, timezone
from jose import jwt
from app import models
from app.config import settings
from app.routers.auth import token_hash
from app.utils import hash_password


def test_login_rotate_logout(client, database, tokens, headers):
    claims = jwt.decode(tokens["access_token"], settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    assert claims["user_id"] == 1 and "role:manage" in claims["permissions"]
    with database() as db:
        stored = db.query(models.RefreshToken).one()
        assert stored.token_hash == token_hash(tokens["refresh_token"])
        assert stored.token_hash != tokens["refresh_token"]
    refreshed = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refreshed.status_code == 200
    assert refreshed.headers["cache-control"] == "no-store"
    assert refreshed.json()["refresh_token"] != tokens["refresh_token"]
    assert client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401
    assert client.post("/auth/logout", headers=headers).status_code == 204
    assert client.get("/users/", headers=headers).status_code == 401
    assert client.post("/auth/refresh", json={"refresh_token": refreshed.json()["refresh_token"]}).status_code == 401


def test_invalid_credentials_and_expiry(client, database, tokens):
    for username, password in [("admin", "wrong"), ("missing", "wrong"), ("admin", "x"*73)]:
        assert client.post("/auth/login", json={"username": username, "password": password}).status_code == 401
    assert client.get("/users/").status_code == 401
    assert client.get("/users/", headers={"Authorization": "Bearer broken"}).status_code == 401
    claims = jwt.decode(tokens["access_token"], settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    claims["exp"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    expired = jwt.encode(claims, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    assert client.get("/users/", headers={"Authorization": "Bearer " + expired}).status_code == 401
    with database() as db:
        db.query(models.RefreshToken).update({"expires_at": datetime.now(timezone.utc)-timedelta(days=1)})
        db.commit()
    assert client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401


def test_db_permissions_override_old_jwt(client, database, headers):
    with database() as db:
        role = db.get(models.Role, 1)
        role.permissions = [p for p in role.permissions if p.code != "user:view"]
        db.commit()
    assert client.get("/users/", headers=headers).status_code == 403
    assert client.get("/cameras/", headers=headers).status_code == 200


def test_lock_and_unlock_do_not_resurrect_tokens(client, database, tokens, headers):
    assert client.patch("/users/1/status", headers=headers, json={"status": "INACTIVE"}).status_code == 200
    assert client.get("/users/", headers=headers).status_code == 401
    assert client.post("/auth/login", json={"username": "admin", "password": "Admin-test-password"}).status_code == 401
    assert client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401
    with database() as db:
        db.get(models.User, 1).status = "ACTIVE"
        db.commit()
    assert client.get("/users/", headers=headers).status_code == 401


def test_password_change_revokes_sessions(client, tokens, headers):
    assert client.put("/users/1", headers=headers, json={"password": "new-password"}).status_code == 200
    assert client.get("/users/", headers=headers).status_code == 401
    assert client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401
    assert client.post("/auth/login", json={"username": "admin", "password": "new-password"}).status_code == 200


def test_concurrent_refresh_has_one_winner(client, database, tokens):
    import pytest
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    if database.kw["bind"].dialect.name != "postgresql":
        pytest.skip("Requires PostgreSQL row locks")
    barrier = Barrier(2)
    def refresh_once():
        barrier.wait(timeout=5)
        return client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: refresh_once(), range(2)))
    assert sorted(results) == [200, 401]
    with database() as db:
        assert db.query(models.RefreshToken).filter_by(revoked=False).count() == 1
