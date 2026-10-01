"""simple stock: opening stock per branch and product (remaining = opening - invoiced, computed on read)

Revision ID: 0008
Revises: 0007
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

AUDIT_FN = """
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ent text := CASE TG_TABLE_NAME WHEN 'users' THEN 'user' WHEN 'events' THEN 'event' WHEN 'products' THEN 'product'
                                 WHEN 'discount_rules' THEN 'discount_rule' WHEN 'packages' THEN 'package'
                                 WHEN 'package_items' THEN 'package_item' WHEN 'branches' THEN 'branch'
                                 WHEN 'branch_stock' THEN 'stock' ELSE 'setting' END;
  act text;
  meta jsonb;
  row_id uuid;
  branch uuid := NULL;
  actor uuid := app_user();
  actor_n text := '';
BEGIN
  IF TG_OP = 'INSERT' THEN
    act := ent || '.create'; meta := jsonb_build_object('new', to_jsonb(NEW)); row_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    act := ent || '.delete'; meta := jsonb_build_object('old', to_jsonb(OLD)); row_id := OLD.id;
  ELSE
    SELECT jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value)) INTO meta
      FROM jsonb_each(to_jsonb(NEW)) n JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
     WHERE n.value IS DISTINCT FROM o.value;
    IF meta IS NULL THEN RETURN NEW; END IF;
    act := ent || '.update'; row_id := NEW.id;
    IF ent = 'user' THEN
      IF jsonb_exists(meta, 'role') OR jsonb_exists(meta, 'branch_id') THEN act := 'user.role_change';
      ELSIF jsonb_exists(meta, 'active') THEN act := 'user.active_change';
      END IF;
    ELSIF ent = 'product' AND jsonb_exists(meta, 'current_rate') THEN act := 'product.rate_change';
    END IF;
    meta := jsonb_build_object('changes', meta);
  END IF;

  IF ent = 'user' THEN
    IF TG_OP = 'DELETE' THEN branch := OLD.branch_id; ELSE branch := NEW.branch_id; END IF;
  ELSIF ent = 'stock' THEN
    IF TG_OP = 'DELETE' THEN branch := OLD.branch_id; ELSE branch := NEW.branch_id; END IF;
  ELSIF ent = 'branch' THEN
    branch := row_id;
  END IF;
  IF actor IS NOT NULL THEN SELECT name INTO actor_n FROM users WHERE id = actor; END IF;

  INSERT INTO audit_logs (created_at, actor_user_id, actor_name, branch_id, action, entity_type, entity_id, metadata)
  VALUES (clock_timestamp(), actor, coalesce(actor_n, ''), branch, act, ent, row_id, meta);
  RETURN NULL;
END $$;
"""


def upgrade() -> None:
    op.create_table(
        "branch_stock",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("branches.id"), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("opening_qty", sa.Integer, nullable=False),
        sa.Column("low_threshold", sa.Integer, nullable=False, server_default="10"),
        sa.UniqueConstraint("branch_id", "product_id"),
        sa.CheckConstraint("opening_qty >= 0 AND low_threshold >= 0", name="ck_branch_stock_nonneg"),
    )
    op.execute("ALTER TABLE branch_stock ENABLE ROW LEVEL SECURITY")
    # a branch sees its own stock; the central admin sees all
    op.execute("CREATE POLICY stock_read ON branch_stock FOR SELECT TO app_authenticated USING (app_is_super() OR branch_id = app_branch())")
    # only the central admin, or the admin OF THAT BRANCH, may change it
    op.execute(
        "CREATE POLICY stock_write ON branch_stock FOR ALL TO app_authenticated "
        "USING (app_is_super() OR (app_role() = 'BRANCH_ADMIN' AND branch_id = app_branch())) "
        "WITH CHECK (app_is_super() OR (app_role() = 'BRANCH_ADMIN' AND branch_id = app_branch()))"
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON branch_stock TO app_authenticated")
    op.execute(AUDIT_FN)
    op.execute("CREATE TRIGGER audit_branch_stock AFTER INSERT OR UPDATE OR DELETE ON branch_stock FOR EACH ROW EXECUTE FUNCTION audit_row_change()")


def downgrade() -> None:
    op.drop_table("branch_stock")  # also drops its trigger and policies
