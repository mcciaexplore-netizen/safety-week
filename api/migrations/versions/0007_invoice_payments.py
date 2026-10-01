"""structured payments: one or more (mode, amount, reference) rows per invoice, so a split payment
(e.g. part UPI, rest cash) can be recorded

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "invoice_payments",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mode", sa.String(12), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("reference", sa.String(200), nullable=False, server_default=""),
        sa.Column("line_order", sa.Integer, nullable=False),
        sa.CheckConstraint("mode IN ('CASH', 'UPI', 'CARD', 'NET_BANKING', 'OTHER')", name="ck_invoice_payments_mode"),
        sa.CheckConstraint("amount > 0", name="ck_invoice_payments_amount"),
    )
    op.create_index("ix_invoice_payments_invoice", "invoice_payments", ["invoice_id"])
    # same visibility as the invoice it belongs to (branch isolation)
    op.execute("ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY payments_via_invoice ON invoice_payments FOR ALL TO app_authenticated "
        "USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_payments.invoice_id)) "
        "WITH CHECK (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_payments.invoice_id))"
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_payments TO app_authenticated")


def downgrade() -> None:
    op.drop_table("invoice_payments")
