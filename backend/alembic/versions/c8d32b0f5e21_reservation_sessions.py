"""Ten-minute reservations, sessions and confirmed occupancy metadata.

Revision ID: c8d32b0f5e21
Revises: b7c21a9e4d10
"""
from alembic import op
import sqlalchemy as sa

revision = "c8d32b0f5e21"
down_revision = "b7c21a9e4d10"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("cameras", sa.Column("ai_run_id", sa.String(36), nullable=True))
    op.add_column("cameras", sa.Column("ai_sequence", sa.Integer(), nullable=False, server_default="0"))
    op.alter_column("parking_slots", "status", existing_type=sa.String(20), nullable=True, server_default=None)
    for name, type_ in (("last_observed_occupancy", sa.String(20)), ("observed_at", sa.DateTime(timezone=True)),
                        ("observation_run_id", sa.String(36)), ("observation_backend_id", sa.String(36)),
                        ("last_empty_at", sa.DateTime(timezone=True))):
        op.add_column("parking_slots", sa.Column(name, type_, nullable=True))
    op.add_column("parking_slots", sa.Column("needs_reconciliation", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute("UPDATE parking_slots SET needs_reconciliation = true WHERE status IN ('RESERVED', 'OCCUPIED')")
    # Preserve old statuses/history; leave observation metadata unset until fresh AI evidence.
    session_definition = [
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("parking_slot_id", sa.Integer(), sa.ForeignKey("parking_slots.id"), nullable=False),
        sa.Column("customer_name", sa.String(100), nullable=False),
        sa.Column("phone_number", sa.String(30), nullable=False),
        sa.Column("license_plate", sa.String(30), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("reserved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reservation_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("arrived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("departed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("arrival_source", sa.String(20), nullable=True),
        sa.Column("departure_source", sa.String(20), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('RESERVED','PARKED','COMPLETED','CANCELLED','EXPIRED')", name="ck_session_status"),
        sa.CheckConstraint("(reserved_at IS NULL AND reservation_expires_at IS NULL) OR "
                           "(reserved_at IS NOT NULL AND reservation_expires_at > reserved_at)", name="ck_session_expiry"),
        sa.CheckConstraint("departed_at IS NULL OR arrived_at IS NULL OR departed_at >= arrived_at", name="ck_session_times")]
    inspector = None if op.get_context().as_sql else sa.inspect(op.get_bind())
    existing = bool(inspector and inspector.has_table("parking_sessions"))
    if existing:
        # Recover a matching unversioned empty table; never overwrite customer history.
        actual = {column["name"]: column for column in inspector.get_columns("parking_sessions")}
        expected = {column.name: column for column in session_definition if isinstance(column, sa.Column)}
        dialect = op.get_bind().dialect
        matches = actual.keys() == expected.keys() and all(
            actual[name]["type"].compile(dialect=dialect) == column.type.compile(dialect=dialect)
            and actual[name]["nullable"] == column.nullable for name, column in expected.items())
        if not matches or op.get_bind().execute(sa.text("SELECT COUNT(*) FROM parking_sessions")).scalar_one():
            raise RuntimeError("Existing unversioned parking_sessions requires manual reconciliation")
        checks = {item["name"] for item in inspector.get_check_constraints("parking_sessions")}
        if not {"ck_session_status", "ck_session_expiry", "ck_session_times"}.issubset(checks):
            raise RuntimeError("Existing session constraints do not match")
    else:
        op.create_table("parking_sessions", *session_definition)
    index_names = {index["name"] for index in inspector.get_indexes("parking_sessions")} if existing else set()
    for name in ("parking_slot_id", "phone_number", "license_plate", "reservation_expires_at"):
        if "ix_parking_sessions_" + name not in index_names:
            op.create_index("ix_parking_sessions_" + name, "parking_sessions", [name])
    if "uq_session_active_slot" not in index_names:
        op.create_index("uq_session_active_slot", "parking_sessions", ["parking_slot_id"], unique=True,
                    postgresql_where=sa.text("status IN ('RESERVED','PARKED')"),
                    sqlite_where=sa.text("status IN ('RESERVED','PARKED')"))
    op.alter_column("parking_events", "old_status", existing_type=sa.String(20), nullable=True)
    op.add_column("parking_events", sa.Column("parking_session_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_event_session", "parking_events", "parking_sessions", ["parking_session_id"], ["id"])
    op.create_index("ix_parking_events_parking_session_id", "parking_events", ["parking_session_id"])
    op.add_column("parking_events", sa.Column("source", sa.String(20), nullable=False, server_default="LEGACY"))


def downgrade():
    op.drop_column("parking_events", "source")
    op.drop_index("ix_parking_events_parking_session_id", table_name="parking_events")
    op.drop_constraint("fk_event_session", "parking_events", type_="foreignkey")
    op.drop_column("parking_events", "parking_session_id")
    # Null represents an uninitialized slot; downgrade loses this distinction.
    op.execute("UPDATE parking_events SET old_status = 'EMPTY' WHERE old_status IS NULL")
    op.alter_column("parking_events", "old_status", existing_type=sa.String(20), nullable=False)
    op.drop_table("parking_sessions")
    op.drop_column("parking_slots", "needs_reconciliation")
    for name in ("last_empty_at", "observation_backend_id", "observation_run_id", "observed_at", "last_observed_occupancy"):
        op.drop_column("parking_slots", name)
    op.execute("UPDATE parking_slots SET status = 'EMPTY' WHERE status IS NULL")
    op.alter_column("parking_slots", "status", existing_type=sa.String(20), nullable=False, server_default="EMPTY")
    op.drop_column("cameras", "ai_sequence")
    op.drop_column("cameras", "ai_run_id")
