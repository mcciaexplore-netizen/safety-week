"""own sign-in (password hashes) and database file storage, replacing Supabase Auth and Storage

Neither table is granted to app_authenticated and both have row level security on, so the API's
per-request role can never read a password hash or a stored PDF directly.

Revision ID: 0010
Revises: 0009
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_credentials",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("failed_attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "stored_files",
        sa.Column("key", sa.String(300), primary_key=True),
        sa.Column("data", sa.LargeBinary, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.execute("ALTER TABLE user_credentials ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE stored_files ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("stored_files")
    op.drop_table("user_credentials")
