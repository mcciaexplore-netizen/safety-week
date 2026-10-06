"""stock transfers: the central admin moves stock of a material from one branch to another
(remaining = opening + received - sent - invoiced, still computed on read)

Revision ID: 0009
Revises: 0008
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stock_transfers",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("from_branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id"), nullable=False),
        sa.Column("to_branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id"), nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("note", sa.String(300), nullable=False, server_default=""),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_by_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_stock_transfers_qty"),
        sa.CheckConstraint("from_branch_id <> to_branch_id", name="ck_stock_transfers_branches"),
    )
    op.create_index("ix_stock_transfers_event_product", "stock_transfers", ["event_id", "product_id"])
    op.execute("ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY")
    # a branch can see transfers that touch it (its own remaining stock depends on them); the central admin sees all
    op.execute(
        "CREATE POLICY transfers_read ON stock_transfers FOR SELECT TO app_authenticated "
        "USING (app_is_super() OR from_branch_id = app_branch() OR to_branch_id = app_branch())"
    )
    # only the central admin may move stock, and a transfer can never be edited or deleted (cancel = transfer back)
    op.execute("CREATE POLICY transfers_insert ON stock_transfers FOR INSERT TO app_authenticated WITH CHECK (app_is_super())")
    op.execute("GRANT SELECT, INSERT ON stock_transfers TO app_authenticated")


def downgrade() -> None:
    op.drop_table("stock_transfers")
