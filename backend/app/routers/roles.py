from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from .. import models, schemas
from ..db import get_db
from ..oauth2 import require_permission
from .common import apply_update, commit, get_or_404

router = APIRouter(prefix="/roles", tags=["Roles"], dependencies=[Depends(require_permission("role:manage"))])


@router.get("/", response_model=list[schemas.RoleWithPermissionsResponse])
def list_roles(db: Session = Depends(get_db)):
    return db.query(models.Role).order_by(models.Role.id).all()


@router.post("/", response_model=schemas.RoleWithPermissionsResponse, status_code=201)
def create_role(data: schemas.RoleCreate, db: Session = Depends(get_db)):
    role = models.Role(**data.model_dump())
    db.add(role)
    commit(db)
    return role


@router.get("/{role_id}", response_model=schemas.RoleWithPermissionsResponse)
def get_role(role_id: int, db: Session = Depends(get_db)):
    return get_or_404(db, models.Role, role_id)


@router.put("/{role_id}", response_model=schemas.RoleWithPermissionsResponse)
def update_role(role_id: int, data: schemas.RoleUpdate, db: Session = Depends(get_db)):
    role = get_or_404(db, models.Role, role_id)
    apply_update(role, data, nullable={"description"})
    commit(db)
    return role


@router.delete("/{role_id}", status_code=204)
def delete_role(role_id: int, db: Session = Depends(get_db)):
    role = get_or_404(db, models.Role, role_id)
    if db.query(models.User.id).filter_by(role_id=role_id).first():
        raise HTTPException(409, "Role is assigned to users")
    db.delete(role)
    commit(db)
    return Response(status_code=204)


@router.post("/{role_id}/permissions", response_model=schemas.RoleWithPermissionsResponse)
def assign_permission(role_id: int, data: schemas.AssignPermissionRequest, db: Session = Depends(get_db)):
    role = get_or_404(db, models.Role, role_id, lock=True)
    permission = get_or_404(db, models.Permission, data.permission_id)
    if permission not in role.permissions:
        role.permissions.append(permission)
    commit(db)
    return role


@router.delete("/{role_id}/permissions/{permission_id}", status_code=204)
def remove_permission(role_id: int, permission_id: int, db: Session = Depends(get_db)):
    role = get_or_404(db, models.Role, role_id, lock=True)
    permission = get_or_404(db, models.Permission, permission_id)
    if permission not in role.permissions:
        raise HTTPException(404, "Permission is not assigned to this role")
    role.permissions.remove(permission)
    commit(db)
    return Response(status_code=204)
