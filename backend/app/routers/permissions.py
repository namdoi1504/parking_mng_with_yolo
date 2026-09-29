from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from .. import models, schemas
from ..db import get_db
from ..oauth2 import require_permission
from .common import apply_update, commit, get_or_404

router = APIRouter(prefix="/permissions", tags=["Permissions"], dependencies=[Depends(require_permission("role:manage"))])


@router.get("/", response_model=list[schemas.PermissionResponse])
def list_permissions(module: str | None = None, db: Session = Depends(get_db)):
    query = db.query(models.Permission)
    if module is not None:
        query = query.filter_by(module=module)
    return query.order_by(models.Permission.id).all()


@router.post("/", response_model=schemas.PermissionResponse, status_code=201)
def create_permission(data: schemas.PermissionCreate, db: Session = Depends(get_db)):
    permission = models.Permission(**data.model_dump())
    db.add(permission)
    commit(db)
    return permission


@router.put("/{permission_id}", response_model=schemas.PermissionResponse)
def update_permission(permission_id: int, data: schemas.PermissionUpdate, db: Session = Depends(get_db)):
    permission = get_or_404(db, models.Permission, permission_id)
    apply_update(permission, data, nullable={"description"})
    commit(db)
    return permission
