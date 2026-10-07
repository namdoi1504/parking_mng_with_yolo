from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from . import models
from .config import settings
from .db import get_db

bearer = HTTPBearer(auto_error=False)


def unauthorized():
    return HTTPException(401, "Invalid or expired credentials", headers={"WWW-Authenticate": "Bearer"})


def create_access_token(user: models.User) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({
        "sub": str(user.id), "user_id": user.id, "role": user.role.name,
        "permissions": [p.code for p in user.role.permissions],
        "type": "access", "ver": user.token_version,
        "iat": now, "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    }, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def authenticate_token(token: str, db: Session) -> models.User:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM],
                             options={"require_exp": True, "require_sub": True})
        if payload.get("type") != "access":
            raise unauthorized()
        user_id = int(payload["sub"])
    except (JWTError, ValueError, TypeError, KeyError):
        raise unauthorized()
    user = db.get(models.User, user_id)
    if not user or user.status != "ACTIVE" or payload.get("ver") != user.token_version:
        raise unauthorized()
    return user


def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
                     db: Session = Depends(get_db)) -> models.User:
    if credentials is None:
        raise unauthorized()
    return authenticate_token(credentials.credentials, db)


def require_permission(code: str):
    def check(user: models.User = Depends(get_current_user)):
        # Consult DB so role changes take effect without waiting for JWT expiry.
        if code not in {p.code for p in user.role.permissions}:
            raise HTTPException(403, "Permission denied")
        return user
    return check


def revoke_user_tokens(db: Session, user: models.User):
    user.token_version += 1
    db.query(models.RefreshToken).filter_by(user_id=user.id, revoked=False).update({"revoked": True})


def require_admin(user: models.User = Depends(get_current_user)):
    """Use the current database role, not the role cached in the access token."""
    if user.role is None or user.role.name != "Administrator":
        raise HTTPException(403, "Administrator role required")
    return user
