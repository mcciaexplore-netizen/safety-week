"""best-seller flag on products (shown as a tag and a filter in the online store)

Revision ID: 0013
Revises: 0012
"""

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("products", sa.Column("best_seller", sa.Boolean, nullable=False, server_default=sa.text("false")))
    # MCCIA's best sellers: Badges, Flags (normal + handy), Oath flex (Hindi + Marathi), Posters, Slogans
    op.execute("""UPDATE products SET best_seller = true
                   WHERE lower(trim(name)) IN ('badges', 'flags - normal', 'flags - handy')
                      OR lower(name) ~ '^(oath|poster|slogan)'""")


def downgrade() -> None:
    op.drop_column("products", "best_seller")
