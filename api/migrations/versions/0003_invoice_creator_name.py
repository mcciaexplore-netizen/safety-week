"""snapshot the creator's name on the invoice (users are not readable across branches under RLS)

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("invoices", sa.Column("created_by_name", sa.String(200), server_default="", nullable=False))
    op.create_index("ix_invoices_branch_updated", "invoices", ["branch_id", "updated_at"])


def downgrade() -> None:
    op.drop_index("ix_invoices_branch_updated", table_name="invoices")
    op.drop_column("invoices", "created_by_name")
