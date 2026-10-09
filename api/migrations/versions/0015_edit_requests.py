"""edit requests: branches ask the central admin to change a submitted invoice

Revision ID: 0015
Revises: 0014
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "edit_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id"), nullable=False),
        sa.Column("requested_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("requested_by_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="OPEN"),
        sa.Column("resolved_by_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("resolved_note", sa.Text, nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('OPEN', 'DONE', 'DECLINED')", name="ck_edit_requests_status"),
    )
    op.create_index("ix_edit_requests_invoice", "edit_requests", ["invoice_id"])
    op.create_index("ix_edit_requests_status", "edit_requests", ["status", "created_at"])
    # one open request per invoice at a time
    op.create_index("uq_edit_requests_open", "edit_requests", ["invoice_id"], unique=True, postgresql_where=sa.text("status = 'OPEN'"))
    op.execute("ALTER TABLE edit_requests ENABLE ROW LEVEL SECURITY")
    # a branch sees its own requests; the central admin sees all
    op.execute("CREATE POLICY edit_requests_read ON edit_requests FOR SELECT TO app_authenticated USING (app_is_super() OR branch_id = app_branch())")
    # a branch may only ask for its own invoices, as itself
    op.execute("CREATE POLICY edit_requests_insert ON edit_requests FOR INSERT TO app_authenticated WITH CHECK (branch_id = app_branch() AND requested_by = app_user())")
    # answering (done / declined) is the central admin's alone
    op.execute("CREATE POLICY edit_requests_update ON edit_requests FOR UPDATE TO app_authenticated USING (app_is_super()) WITH CHECK (app_is_super())")
    op.execute("GRANT SELECT, INSERT, UPDATE ON edit_requests TO app_authenticated")


def downgrade() -> None:
    op.drop_table("edit_requests")
