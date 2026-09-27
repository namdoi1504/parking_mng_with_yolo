import bcrypt

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app import models
from app.schemas import UserCreate, UserResponse


router = APIRouter(
    prefix="/users",
    tags=["users"]
)

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"),
    bcrypt.gensalt()).decode("utf-8")


@router.post(
    "/",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED
)
def create_user(
    data: UserCreate,
    db: Session = Depends(get_db)
):
    role = (
        db.query(models.Role)
        .filter(models.Role.id == data.role_id)
        .first()
    )

    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found",
        )

    existing_user = (
        db.query(models.User)
        .filter(models.User.username == data.username)
        .first()
    )
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already exists",
        )

    password_hash = hash_password(data.password)

    new_user = models.User(
        role_id=data.role_id,
        username=data.username,
        password_hash=password_hash,
        full_name=data.full_name,
        status=data.status.value
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user
