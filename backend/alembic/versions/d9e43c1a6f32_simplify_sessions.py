"""Simplify sessions to active/type flags and creation time.

Prepared only; removing columns discards detailed session timestamps/status.
"""
from alembic import op
import sqlalchemy as sa

revision = "d9e43c1a6f32"
down_revision = "c8d32b0f5e21"
branch_labels = None
depends_on = None
REMOVED = ("status", "reserved_at", "reservation_expires_at", "arrived_at", "departed_at",
           "ended_at", "cancelled_at", "arrival_source", "departure_source", "updated_at")


def upgrade():
    op.add_column("parking_sessions", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("parking_sessions", sa.Column("is_reservation", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.execute("UPDATE parking_sessions SET is_active = status IN ('RESERVED','PARKED'), "
               "is_reservation = reserved_at IS NOT NULL, created_at = COALESCE(reserved_at, created_at)")
    op.drop_index("uq_session_active_slot", table_name="parking_sessions")
    op.drop_index("ix_parking_sessions_reservation_expires_at", table_name="parking_sessions")
    for name in ("ck_session_status", "ck_session_expiry", "ck_session_times"):
        op.drop_constraint(name, "parking_sessions", type_="check")
    for name in REMOVED:
        op.drop_column("parking_sessions", name)
    op.create_index("uq_session_active_slot", "parking_sessions", ["parking_slot_id"], unique=True,
                    postgresql_where=sa.text("is_active = true"), sqlite_where=sa.text("is_active = 1"))


def downgrade():
    # Dropped historical detail cannot be reconstructed for existing sessions.
    if not op.get_context().as_sql and op.get_bind().execute(sa.text("SELECT COUNT(*) FROM parking_sessions")).scalar_one():
        raise RuntimeError("Cannot restore removed session history; restore a backup instead")
    op.drop_index("uq_session_active_slot", table_name="parking_sessions")
    op.add_column("parking_sessions", sa.Column("status", sa.String(20), nullable=False))
    for name in REMOVED[1:]:
        if name in ("arrival_source", "departure_source"):
            column = sa.Column(name, sa.String(20), nullable=True)
        elif name == "updated_at":
            column = sa.Column(name, sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
        else:
            column = sa.Column(name, sa.DateTime(timezone=True), nullable=True)
        op.add_column("parking_sessions", column)
    op.create_check_constraint("ck_session_status", "parking_sessions", "status IN ('RESERVED','PARKED','COMPLETED','CANCELLED','EXPIRED')")
    op.create_check_constraint("ck_session_expiry", "parking_sessions", "(reserved_at IS NULL AND reservation_expires_at IS NULL) OR (reserved_at IS NOT NULL AND reservation_expires_at > reserved_at)")
    op.create_check_constraint("ck_session_times", "parking_sessions", "departed_at IS NULL OR arrived_at IS NULL OR departed_at >= arrived_at")
    op.create_index("ix_parking_sessions_reservation_expires_at", "parking_sessions", ["reservation_expires_at"])
    op.create_index("uq_session_active_slot", "parking_sessions", ["parking_slot_id"], unique=True,
                    postgresql_where=sa.text("status IN ('RESERVED','PARKED')"), sqlite_where=sa.text("status IN ('RESERVED','PARKED')"))
    op.drop_column("parking_sessions", "is_reservation")
    op.drop_column("parking_sessions", "is_active")
