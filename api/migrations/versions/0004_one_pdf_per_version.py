"""one PDF per invoice version

Revision ID: 0004
Revises: 0003
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint("uq_invoice_documents_version_id", "invoice_documents", ["version_id"])


def downgrade() -> None:
    op.drop_constraint("uq_invoice_documents_version_id", "invoice_documents")
