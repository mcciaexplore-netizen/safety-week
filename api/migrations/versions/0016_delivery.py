"""delivery: product weights and courier delivery on online orders

Revision ID: 0016
Revises: 0015
"""

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None

NEW_STATUSES = "'PENDING_PAYMENT', 'PLACED', 'READY', 'SHIPPED', 'DELIVERED', 'PICKED_UP', 'CANCELLED', 'EXPIRED'"
OLD_STATUSES = "'PENDING_PAYMENT', 'PLACED', 'READY', 'PICKED_UP', 'CANCELLED', 'EXPIRED'"


def upgrade() -> None:
    op.add_column("products", sa.Column("weight_grams", sa.Integer, nullable=False, server_default="0"))
    op.create_check_constraint("ck_products_weight", "products", "weight_grams >= 0")
    for name, col in (
        ("fulfilment", sa.Column("fulfilment", sa.String(8), nullable=False, server_default="PICKUP")),
        ("ship_address", sa.Column("ship_address", sa.Text, nullable=False, server_default="")),
        ("ship_city", sa.Column("ship_city", sa.String(100), nullable=False, server_default="")),
        ("ship_state", sa.Column("ship_state", sa.String(100), nullable=False, server_default="")),
        ("ship_pincode", sa.Column("ship_pincode", sa.String(10), nullable=False, server_default="")),
        ("weight_grams", sa.Column("weight_grams", sa.Integer, nullable=False, server_default="0")),
        ("shipping_charge", sa.Column("shipping_charge", sa.Numeric(12, 2), nullable=False, server_default="0")),
        ("courier", sa.Column("courier", sa.String(30), nullable=False, server_default="")),
        ("tracking_no", sa.Column("tracking_no", sa.String(60), nullable=False, server_default="")),
        ("tracking_url", sa.Column("tracking_url", sa.String(500), nullable=False, server_default="")),
        ("shipped_at", sa.Column("shipped_at", sa.DateTime(timezone=True), nullable=True)),
        ("delivered_at", sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True)),
    ):
        op.add_column("orders", col)
    op.create_check_constraint("ck_orders_fulfilment", "orders", "fulfilment IN ('PICKUP', 'DELIVERY')")
    # a home delivery is never pay-at-pick-up: the money must arrive before anything is sent
    op.create_check_constraint("ck_orders_delivery_paid_online", "orders", "fulfilment = 'PICKUP' OR payment_method = 'ONLINE'")
    op.drop_constraint("ck_orders_status", "orders", type_="check")
    op.create_check_constraint("ck_orders_status", "orders", f"status IN ({NEW_STATUSES})")


def downgrade() -> None:
    op.drop_constraint("ck_orders_status", "orders", type_="check")
    op.create_check_constraint("ck_orders_status", "orders", f"status IN ({OLD_STATUSES})")
    op.drop_constraint("ck_orders_delivery_paid_online", "orders", type_="check")
    op.drop_constraint("ck_orders_fulfilment", "orders", type_="check")
    for c in ("delivered_at", "shipped_at", "tracking_url", "tracking_no", "courier", "shipping_charge", "weight_grams",
              "ship_pincode", "ship_state", "ship_city", "ship_address", "fulfilment"):
        op.drop_column("orders", c)
    op.drop_constraint("ck_products_weight", "products", type_="check")
    op.drop_column("products", "weight_grams")
