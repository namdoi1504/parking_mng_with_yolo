"""Authentication, slot coordinates and per-camera statistics.

Revision ID: b7c21a9e4d10
Revises: 95c1ce0e60fd
"""
from alembic import op
import sqlalchemy as sa

revision = "b7c21a9e4d10"
down_revision = "95c1ce0e60fd"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"))
    op.create_table("refresh_tokens",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])
    op.add_column("parking_slots", sa.Column("col", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("parking_slots", sa.Column("row", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("parking_slots", sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    # Preserve known history; old slots without events have no earlier evidence.
    op.execute("UPDATE parking_slots s SET created_at = LEAST(s.created_at, s.updated_at, "
               "COALESCE((SELECT MIN(e.event_time) FROM parking_events e WHERE e.parking_slot_id = s.id), s.updated_at))")
    op.add_column("parking_statistics", sa.Column("camera_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_statistics_camera", "parking_statistics", "cameras", ["camera_id"], ["id"])
    op.create_index("ix_parking_statistics_camera_id", "parking_statistics", ["camera_id"])
    op.add_column("parking_statistics", sa.Column("total_count", sa.Integer(), nullable=False, server_default="0"))
    op.execute("UPDATE parking_statistics SET total_count = occupied_count + available_count")
    op.create_unique_constraint("uq_stat_camera_period", "parking_statistics", ["camera_id", "period_start", "period_end"])
    op.execute("""INSERT INTO permissions (code, name, module, description) VALUES
        ('user:view', 'View users', 'user', 'List and inspect users'),
        ('user:manage', 'Manage users', 'user', 'Create, edit and lock users'),
        ('role:manage', 'Manage roles', 'role', 'Manage roles and permissions'),
        ('camera:view', 'View cameras', 'camera', 'List and inspect cameras'),
        ('camera:manage', 'Manage cameras', 'camera', 'Create and edit cameras'),
        ('parking:view', 'View parking', 'parking', 'View parking and realtime updates'),
        ('parking:manage', 'Manage parking', 'parking', 'Manage parking slots'),
        ('report:view', 'View reports', 'report', 'View parking statistics')
        ON CONFLICT (code) DO NOTHING""")


def downgrade():
    # Keep permission data: existing deployments may have assigned these permissions.
    op.drop_constraint("uq_stat_camera_period", "parking_statistics", type_="unique")
    op.drop_column("parking_statistics", "total_count")
    op.drop_index("ix_parking_statistics_camera_id", table_name="parking_statistics")
    op.drop_constraint("fk_statistics_camera", "parking_statistics", type_="foreignkey")
    op.drop_column("parking_statistics", "camera_id")
    op.drop_column("parking_slots", "created_at")
    op.drop_column("parking_slots", "row")
    op.drop_column("parking_slots", "col")
    op.drop_index("ix_refresh_tokens_user_id", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
    op.drop_column("users", "token_version")
