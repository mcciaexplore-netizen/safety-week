"""online store: shop fields on products, customers, e-mail sign-in codes, pick-up orders

Online orders are ordinary invoices at the chosen pick-up branch (so stock, branch dashboards, PDFs and Excel
all work unchanged); `orders` adds the customer, the pick-up status and the payment method on top.
customers / login_codes are owner-only (no grants, RLS on); orders are visible to the branch that must hand
the goods over, and to the central admin.

Revision ID: 0011
Revises: 0010
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

CATEGORY_SQL = """
UPDATE products SET category = CASE
  WHEN lower(name) ~ '^t[ -]?shirt' THEN 'T-Shirts'
  WHEN lower(name) ~ '^banner' THEN 'Banners'
  WHEN lower(name) ~ '^flag' THEN 'Flags'
  WHEN lower(name) ~ '^(poster|slogan)' THEN 'Posters & Slogans'
  WHEN lower(name) ~ '^(scroll|ppe scroll|oath)' THEN 'Scrolls & Oath'
  WHEN lower(name) ~ '^pocket' THEN 'Books & Calendars'
  WHEN lower(name) ~ '^(badge|ball pen|cap|coffee|water|dangler|sticker)' THEN 'Gifts & Accessories'
  ELSE 'Safety Materials' END,
  slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
"""


def upgrade() -> None:
    op.add_column("products", sa.Column("slug", sa.String(120), nullable=True))
    op.add_column("products", sa.Column("category", sa.String(60), nullable=False, server_default=""))
    op.add_column("products", sa.Column("image_url", sa.String(500), nullable=False, server_default=""))
    op.add_column("products", sa.Column("online_enabled", sa.Boolean, nullable=False, server_default=sa.text("true")))
    op.execute(CATEGORY_SQL)
    op.create_index("uq_products_event_slug", "products", ["event_id", "slug"], unique=True)

    op.create_table(
        "customers",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False, server_default=""),
        sa.Column("phone", sa.String(50), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "login_codes",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_login_codes_email", "login_codes", ["email", "created_at"])

    op.create_table(
        "orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("number", sa.String(40), nullable=False, unique=True),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("invoices.id"), nullable=False, unique=True),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id"), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("customers.id"), nullable=True),
        sa.Column("customer_name", sa.String(200), nullable=False),
        sa.Column("customer_email", sa.String(320), nullable=False),
        sa.Column("customer_phone", sa.String(50), nullable=False, server_default=""),
        sa.Column("status", sa.String(12), nullable=False, server_default="PLACED"),
        sa.Column("payment_method", sa.String(16), nullable=False),
        sa.Column("payment_status", sa.String(8), nullable=False, server_default="UNPAID"),
        sa.Column("note", sa.Text, nullable=False, server_default=""),
        sa.Column("total", sa.Numeric(16, 2), nullable=False),
        sa.Column("item_count", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("picked_up_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('PLACED', 'READY', 'PICKED_UP', 'CANCELLED', 'EXPIRED')", name="ck_orders_status"),
        sa.CheckConstraint("payment_method IN ('PAY_AT_PICKUP', 'ONLINE')", name="ck_orders_payment_method"),
        sa.CheckConstraint("payment_status IN ('UNPAID', 'PAID')", name="ck_orders_payment_status"),
    )
    op.create_index("ix_orders_branch_created", "orders", ["branch_id", "created_at"])
    op.create_index("ix_orders_email", "orders", ["customer_email"])

    for t in ("customers", "login_codes", "orders"):
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
    # the branch that must hand the goods over sees (and updates) its orders; the central admin sees all.
    # Customers and sign-in codes are never readable by the staff API role.
    op.execute("CREATE POLICY orders_branch ON orders FOR ALL TO app_authenticated "
               "USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch())")
    op.execute("GRANT SELECT, UPDATE ON orders TO app_authenticated")


def downgrade() -> None:
    op.drop_table("orders")
    op.drop_table("login_codes")
    op.drop_table("customers")
    op.drop_index("uq_products_event_slug", table_name="products")
    for c in ("online_enabled", "image_url", "category", "slug"):
        op.drop_column("products", c)
