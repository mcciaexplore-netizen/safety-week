"""pack size: the online store sells some materials only in packs (badges: 50 at a time)

Revision ID: 0017
Revises: 0016
"""

import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("products", sa.Column("pack_size", sa.Integer, nullable=False, server_default="1"))
    op.create_check_constraint("ck_products_pack_size", "products", "pack_size >= 1")
    # the one material sold in bundles from the start; any other is set in Admin > Products
    op.execute("UPDATE products SET pack_size = 50 WHERE lower(trim(name)) = 'badges'")


def downgrade() -> None:
    op.drop_constraint("ck_products_pack_size", "products", type_="check")
    op.drop_column("products", "pack_size")
