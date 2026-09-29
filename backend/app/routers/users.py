from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session
from .. import models, schemas
from ..db import get_db
from ..oauth2 import require_permission, revoke_user_tokens
from ..utils import hash_password
from .common import commit, get_or_404

router = APIRouter(prefix="/users", tags=["Users"])
view = Depends(require_permission("user:view"))
manage = Depends(require_permission("user:manage"))


@router.get("/", response_model=schemas.UserListResponse, dependencies=[view])
def list_users(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
               status: schemas.UserStatus | None = None, db: Session = Depends(get_db)):
    query = db.query(models.User)
    if status:
        query = query.filter(models.User.status == status.value)
    total = query.count()
    return {"data": query.order_by(models.User.id).offset((page-1)*page_size).limit(page_size).all(),
            "meta": {"page": page, "page_size": page_size, "total": total,
                     "total_pages": (total + page_size - 1)//page_size}}


@router.post("/", response_model=schemas.UserResponse, status_code=201, dependencies=[manage])
def create_user(data: schemas.UserCreate, db: Session = Depends(get_db)):
    get_or_404(db, models.Role, data.role_id)
    values = data.model_dump(mode="json", exclude={"password"})
    user = models.User(**values, password_hash=hash_password(data.password))
    db.add(user)
    commit(db)
    return user


@router.get("/{user_id}", response_model=schemas.UserDetailResponse, dependencies=[view])
def get_user(user_id: int, db: Session = Depends(get_db)):
    return get_or_404(db, models.User, user_id)


@router.put("/{user_id}", response_model=schemas.UserResponse, dependencies=[manage])
def update_user(user_id: int, data: schemas.UserUpdate, db: Session = Depends(get_db)):
    user = get_or_404(db, models.User, user_id, lock=True)
    values = data.model_dump(mode="json", exclude_unset=True)
    if any(value is None for value in values.values()):
        raise HTTPException(422, "User fields cannot be null")
    if "role_id" in values:
        get_or_404(db, models.Role, values["role_id"])
    if "password" in values:
        user.password_hash = hash_password(values.pop("password"))
    if {"password", "role_id", "status"} & data.model_fields_set:
        revoke_user_tokens(db, user)
    for key, value in values.items():
        setattr(user, key, value)
    commit(db)
    return user


@router.patch("/{user_id}/status", response_model=schemas.UserResponse, dependencies=[manage])
def update_status(user_id: int, data: schemas.UserStatusUpdate, db: Session = Depends(get_db)):
    user = get_or_404(db, models.User, user_id, lock=True)
    if user.status != data.status.value:
        revoke_user_tokens(db, user)
        user.status = data.status.value
    commit(db)
    return user


@router.delete("/{user_id}", status_code=204, dependencies=[manage])
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = get_or_404(db, models.User, user_id, lock=True)
    db.query(models.RefreshToken).filter_by(user_id=user_id).delete()
    db.delete(user)
    commit(db)
    return Response(status_code=204)
