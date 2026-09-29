import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Response
from sqlalchemy import update
from sqlalchemy.orm import Session
from .. import models, schemas
from ..config import settings
from ..db import get_db
from ..oauth2 import create_access_token, get_current_user, revoke_user_tokens, unauthorized
from ..utils import verify

router = APIRouter(prefix="/auth", tags=["Authentication"])
# Use a real hash for unknown usernames too.
DUMMY_HASH = "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW"


def token_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def issue_tokens(db: Session, user: models.User) -> schemas.TokenResponse:
    raw = secrets.token_urlsafe(48)
    db.add(models.RefreshToken(user_id=user.id, token_hash=token_hash(raw),
                              expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)))
    return schemas.TokenResponse(access_token=create_access_token(user), refresh_token=raw)


def no_cache(response: Response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


@router.post("/login", response_model=schemas.TokenResponse)
def login(data: schemas.LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(models.User).filter_by(username=data.username).with_for_update().first()
    valid = verify(data.password, user.password_hash if user else DUMMY_HASH)
    if not valid or not user or user.status != "ACTIVE":
        raise unauthorized()
    result = issue_tokens(db, user)
    db.commit()
    no_cache(response)
    return result


@router.post("/refresh", response_model=schemas.TokenResponse)
def refresh(data: schemas.RefreshRequest, response: Response, db: Session = Depends(get_db)):
    digest = token_hash(data.refresh_token)
    stored = db.query(models.RefreshToken).filter_by(token_hash=digest).first()
    if not stored:
        raise unauthorized()
    # Serialize refresh with password changes, locking and logout for this user.
    user = db.query(models.User).filter_by(id=stored.user_id).with_for_update().first()
    if not user or user.status != "ACTIVE":
        raise unauthorized()
    claimed = db.execute(update(models.RefreshToken).where(
        models.RefreshToken.id == stored.id, models.RefreshToken.revoked.is_(False),
        models.RefreshToken.expires_at > datetime.now(timezone.utc),
    ).values(revoked=True).execution_options(synchronize_session=False))
    if claimed.rowcount != 1:
        db.rollback()
        raise unauthorized()
    result = issue_tokens(db, user)
    db.commit()
    no_cache(response)
    return result


@router.post("/logout", status_code=204)
def logout(current: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    user = db.query(models.User).filter_by(id=current.id).with_for_update().populate_existing().one()
    revoke_user_tokens(db, user)
    db.commit()
    return Response(status_code=204)
