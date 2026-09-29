import pytest
from app import models
from app.seed import seed_permissions


def test_user_crud_pagination_and_validation(client, headers):
    body = {"role_id": 1, "username": "operator", "password": "secret123", "full_name": "Operator"}
    created = client.post("/users/", headers=headers, json=body)
    assert created.status_code == 201
    user_id = created.json()["id"]
    assert "password_hash" not in created.json()
    assert client.post("/users/", headers=headers, json=body).status_code == 409
    assert client.post("/users/", headers=headers, json={**body, "username": "other", "role_id": 999}).status_code == 404
    assert client.post("/users/", headers=headers, json={**body, "password": "é"*37}).status_code == 422
    page = client.get("/users/?page=2&page_size=1", headers=headers).json()
    assert page["meta"]["total"] == 2 and page["data"][0]["id"] == user_id
    detail = client.get(f"/users/{user_id}", headers=headers).json()
    assert detail["role"]["permissions"]
    assert client.put(f"/users/{user_id}", headers=headers, json={"full_name": "New name"}).status_code == 200
    assert client.put(f"/users/{user_id}", headers=headers, json={"full_name": None}).status_code == 422
    assert client.patch(f"/users/{user_id}/status", headers=headers, json={"status": "INACTIVE"}).status_code == 200
    filtered = client.get("/users/?status=INACTIVE", headers=headers).json()
    assert filtered["meta"]["total"] == 1
    assert client.delete(f"/users/{user_id}", headers=headers).status_code == 204
    assert client.get(f"/users/{user_id}", headers=headers).status_code == 404


def test_roles_permissions_and_seed(client, database, headers):
    with database() as db:
        seed_permissions(db)
        seed_permissions(db)
        db.commit()
        assert db.query(models.Permission).count() == 8
    permission = client.post("/permissions/", headers=headers,
                             json={"code": "custom:view", "name": "Custom", "module": "custom"})
    assert permission.status_code == 201
    pid = permission.json()["id"]
    role = client.post("/roles/", headers=headers, json={"name": "Operator"})
    assert role.status_code == 201
    rid = role.json()["id"]
    assert client.post("/roles/", headers=headers, json={"name": "Operator"}).status_code == 409
    for _ in range(2):
        assigned = client.post(f"/roles/{rid}/permissions", headers=headers, json={"permission_id": pid})
        assert assigned.status_code == 200 and len(assigned.json()["permissions"]) == 1
    assert client.get(f"/roles/{rid}", headers=headers).json()["permissions"][0]["id"] == pid
    assert client.put(f"/roles/{rid}", headers=headers, json={"description": "Updated"}).status_code == 200
    assert client.put(f"/permissions/{pid}", headers=headers, json={"name": "Changed"}).status_code == 200
    assert len(client.get("/permissions/?module=custom", headers=headers).json()) == 1
    assert client.delete("/roles/1", headers=headers).status_code == 409
    assert client.delete(f"/roles/{rid}/permissions/{pid}", headers=headers).status_code == 204
    assert client.delete(f"/roles/{rid}", headers=headers).status_code == 204


def test_camera_crud_and_dependency_guard(client, headers):
    body = {"name": "Camera", "source_type": "RTSP", "source_url": "rtsp://example"}
    response = client.post("/cameras/", headers=headers, json=body)
    assert response.status_code == 201
    cid = response.json()["id"]
    assert client.get(f"/cameras/{cid}", headers=headers).status_code == 200
    assert client.put(f"/cameras/{cid}", headers=headers, json={"name": "Renamed"}).status_code == 200
    assert client.put(f"/cameras/{cid}", headers=headers, json={"source_url": None}).status_code == 422
    assert client.patch(f"/cameras/{cid}/status", headers=headers, json={"status": "DISCONNECTED"}).status_code == 200
    assert client.get("/cameras/?status=DISCONNECTED", headers=headers).json()["meta"]["total"] == 1
    assert client.delete(f"/cameras/{cid}", headers=headers).status_code == 204
    sync = client.post("/api/ai/sync-slots", json={"camera_id": 42, "slots": [{"slot_code": "A1", "roi_coordinates": []}]})
    assert sync.status_code == 200
    assert client.delete("/cameras/42", headers=headers).status_code == 409


@pytest.mark.parametrize("method,path,body", [
    ("get", "/roles/", None), ("get", "/permissions/", None), ("get", "/cameras/", None),
    ("get", "/api/stats/hourly?date=2026-09-29", None), ("get", "/api/stats/realtime", None),
    ("post", "/users/", {"role_id": 1, "username": "new", "password": "secret123", "full_name": "New"}),
])
def test_management_requires_auth(client, method, path, body):
    assert client.request(method, path, json=body).status_code == 401
