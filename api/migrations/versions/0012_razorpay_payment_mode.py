"""payment mode RAZORPAY (offline payments at a branch are taken through Razorpay too)

Revision ID: 0012
Revises: 0011
"""

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

OLD = "mode IN ('CASH', 'UPI', 'CARD', 'NET_BANKING', 'OTHER')"
NEW = "mode IN ('CASH', 'RAZORPAY', 'UPI', 'CARD', 'NET_BANKING', 'OTHER')"


def upgrade() -> None:
    op.drop_constraint("ck_invoice_payments_mode", "invoice_payments", type_="check")
    op.create_check_constraint("ck_invoice_payments_mode", "invoice_payments", NEW)


def downgrade() -> None:
    op.execute("UPDATE invoice_payments SET mode = 'OTHER' WHERE mode = 'RAZORPAY'")
    op.drop_constraint("ck_invoice_payments_mode", "invoice_payments", type_="check")
    op.create_check_constraint("ck_invoice_payments_mode", "invoice_payments", OLD)
