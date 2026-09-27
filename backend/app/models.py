from datetime import datetime
from sqlalchemy import (
    Integer, String, Float, DateTime, ForeignKey, UniqueConstraint,)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from .db import Base

class Role(Base):
    __tablename__ = 'roles'
    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True
    )
    name: Mapped[str] = mapped_column(
        String(50),
        unique=True
    )
    description: Mapped[str | None] = mapped_column(
        String(255),
        nullable = True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now()
    )


class Permission(Base):
    __tablename__ = 'permissions'
    id: Mapped[int] = mapped_column(
        Integer,
        primary_key = True,
        autoincrement=True
    )
    code: Mapped[str] = mapped_column(
        String(100),
        unique = True,
        nullable=False
    )
    name: Mapped[str] = mapped_column(
        String(50),
        nullable=False
    )
    description : Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )
class RolePermission(Base):
    __tablename__ = "role_permissions"

    role_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("roles.id", ondelete="CASCADE"),
        primary_key=True
    )

    permission_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("permissions.id", ondelete="CASCADE"),
        primary_key=True
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True
    )

    role_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("roles.id"),
        nullable=False
    )

    username: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False
    )

    password_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False
    )

    full_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default="ACTIVE"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now()
    )


class Camera(Base):
    __tablename__ = "cameras"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement = True
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False
    )

    source_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default="RTSP"
    )

    source_url: Mapped[str] = mapped_column(
        String(255),
        nullable=False
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default="CONNECTED"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now()
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )


class ParkingSlot(Base):
    __tablename__ = "parking_slots"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement = True
    )

    camera_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("cameras.id"),
        nullable=False,
        index=True
    )

    slot_code: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False
    )

    roi_coordinates: Mapped[dict | list] = mapped_column(
        JSONB,
        nullable=False
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default="EMPTY"
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )


class ParkingEvent(Base):
    __tablename__ = "parking_events"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement  = True
    )

    parking_slot_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("parking_slots.id"),
        nullable=False,
        index=True
    )

    old_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False
    )

    new_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False
    )

    confidence: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        server_default="1.0"
    )

    event_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        index=True
    )


class ParkingStatistic(Base):
    __tablename__ = "parking_statistics"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement = True
    )

    period_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )

    period_end: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )

    occupied_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default="0"
    )

    available_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default="0"
    )

    utilization_rate: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        server_default="0.0"
    )