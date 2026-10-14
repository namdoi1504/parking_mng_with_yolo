"""Use created_at for the same ten-minute hold on every active session."""
from alembic import op
import sqlalchemy as sa

revision = "e0f54d2b7a43"
down_revision = "d9e43c1a6f32"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column("parking_sessions", "is_reservation")


def downgrade():
    # The old distinction is intentionally discarded; restored sessions all use holds.
    op.add_column("parking_sessions", sa.Column("is_reservation", sa.Boolean(), nullable=False, server_default=sa.true()))
