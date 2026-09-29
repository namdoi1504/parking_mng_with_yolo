"""Explicit, repeatable bootstrap. Run: python -m app.seed --admin-username admin"""
import argparse
import getpass
from . import models
from .db import SessionLocal
from .schemas import UserCreate
from .utils import hash_password

PERMISSIONS = {
    "user:view": "View users", "user:manage": "Manage users",
    "role:manage": "Manage roles and permissions", "camera:view": "View cameras",
    "camera:manage": "Manage cameras", "parking:view": "View parking",
    "parking:manage": "Manage parking", "report:view": "View reports",
}


def seed_permissions(db):
    existing = {p.code: p for p in db.query(models.Permission).all()}
    for code, name in PERMISSIONS.items():
        if code not in existing:
            permission = models.Permission(code=code, name=name, module=code.split(":")[0])
            db.add(permission)
            existing[code] = permission
    db.flush()
    return [existing[code] for code in PERMISSIONS]


def bootstrap_admin(db, username, password, full_name="Administrator"):
    permissions = seed_permissions(db)
    existing = db.query(models.User).filter_by(username=username).first()
    if existing:
        raise ValueError("Username already exists; no existing account was modified")
    role = db.query(models.Role).filter_by(name="Administrator").first()
    if not role:
        role = models.Role(name="Administrator", description="Backend administrator")
        db.add(role)
        db.flush()
    for permission in permissions:
        if permission not in role.permissions:
            role.permissions.append(permission)
    data = UserCreate(role_id=role.id, username=username, password=password, full_name=full_name)
    user = models.User(role_id=role.id, username=data.username, full_name=data.full_name,
                       password_hash=hash_password(data.password), status="ACTIVE")
    db.add(user)
    db.flush()
    return user


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--admin-username")
    args = parser.parse_args()
    with SessionLocal() as db:
        try:
            if args.admin_username:
                password = getpass.getpass("New administrator password: ")
                if password != getpass.getpass("Confirm password: "):
                    parser.error("Passwords do not match")
                bootstrap_admin(db, args.admin_username, password)
            else:
                seed_permissions(db)
            db.commit()
        except ValueError as exc:
            db.rollback()
            parser.error(str(exc))
    print("Bootstrap complete")


if __name__ == "__main__":
    main()
