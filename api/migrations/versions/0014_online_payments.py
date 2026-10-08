"""online payments: Razorpay ids and payment time on orders; PENDING_PAYMENT order status; REFUNDED payment status

Revision ID: 0014
Revises: 0013
"""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("razorpay_order_id", sa.String(40), nullable=True))
    op.add_column("orders", sa.Column("razorpay_payment_id", sa.String(40), nullable=True))
    op.add_column("orders", sa.Column("razorpay_refund_id", sa.String(40), nullable=True))
    op.add_column("orders", sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("uq_orders_razorpay_order", "orders", ["razorpay_order_id"], unique=True)
    op.alter_column("orders", "status", type_=sa.String(20), existing_type=sa.String(12), existing_nullable=False, existing_server_default="PLACED")
    op.drop_constraint("ck_orders_status", "orders", type_="check")
    op.create_check_constraint("ck_orders_status", "orders", "status IN ('PENDING_PAYMENT', 'PLACED', 'READY', 'PICKED_UP', 'CANCELLED', 'EXPIRED')")
    op.drop_constraint("ck_orders_payment_status", "orders", type_="check")
    op.create_check_constraint("ck_orders_payment_status", "orders", "payment_status IN ('UNPAID', 'PAID', 'REFUNDED')")


def downgrade() -> None:
    op.execute("UPDATE orders SET status = 'EXPIRED' WHERE status = 'PENDING_PAYMENT'")
    op.execute("UPDATE orders SET payment_status = 'PAID' WHERE payment_status = 'REFUNDED'")
    op.drop_constraint("ck_orders_payment_status", "orders", type_="check")
    op.create_check_constraint("ck_orders_payment_status", "orders", "payment_status IN ('UNPAID', 'PAID')")
    op.drop_constraint("ck_orders_status", "orders", type_="check")
    op.create_check_constraint("ck_orders_status", "orders", "status IN ('PLACED', 'READY', 'PICKED_UP', 'CANCELLED', 'EXPIRED')")
    op.alter_column("orders", "status", type_=sa.String(12), existing_type=sa.String(20), existing_nullable=False, existing_server_default="PLACED")
    op.drop_index("uq_orders_razorpay_order", table_name="orders")
    for c in ("paid_at", "razorpay_refund_id", "razorpay_payment_id", "razorpay_order_id"):
        op.drop_column("orders", c)
