"""admin panel: rate confirmation, packages, settings; central-admin-only writes to configuration

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

CONFIG_TABLES = ["branches", "events", "products", "discount_rules", "packages", "package_items", "app_settings"]

AUDIT_FN = """
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ent text := CASE TG_TABLE_NAME WHEN 'users' THEN 'user' WHEN 'events' THEN 'event' WHEN 'products' THEN 'product'
                                 WHEN 'discount_rules' THEN 'discount_rule' WHEN 'packages' THEN 'package'
                                 WHEN 'package_items' THEN 'package_item' WHEN 'branches' THEN 'branch'
                                 ELSE 'setting' END;
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
    op.add_column("products", sa.Column("rate_confirmed", sa.Boolean, server_default=sa.text("false"), nullable=False))
    op.create_table(
        "packages",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("fixed_price", sa.Numeric(14, 2)),
        sa.Column("active", sa.Boolean, server_default=sa.text("true"), nullable=False),
        sa.UniqueConstraint("event_id", "name"),
    )
    op.create_table(
        "package_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("package_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("packages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.UniqueConstraint("package_id", "product_id"),
        sa.CheckConstraint("quantity > 0", name="ck_package_items_qty"),
    )
    op.create_table(
        "app_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("key", sa.String(60), nullable=False, unique=True),
        sa.Column("value", postgresql.JSONB, nullable=False),
    )

    # Configuration: anyone signed in may READ it; only the central admin may WRITE it (database-enforced).
    for t in CONFIG_TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"CREATE POLICY {t}_read ON {t} FOR SELECT TO app_authenticated USING (true)")
        op.execute(f"CREATE POLICY {t}_write ON {t} FOR ALL TO app_authenticated USING (app_is_super()) WITH CHECK (app_is_super())")
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {t} TO app_authenticated")
    op.execute("GRANT INSERT, UPDATE ON users TO app_authenticated")
    op.execute("CREATE POLICY users_write ON users FOR ALL TO app_authenticated USING (app_is_super()) WITH CHECK (app_is_super())")

    op.execute(AUDIT_FN)
    for t in ("branches", "packages", "package_items", "app_settings"):
        op.execute(f"CREATE TRIGGER audit_{t} AFTER INSERT OR UPDATE OR DELETE ON {t} FOR EACH ROW EXECUTE FUNCTION audit_row_change()")


def downgrade() -> None:
    for t in ("app_settings", "package_items", "packages", "branches"):
        op.execute(f"DROP TRIGGER audit_{t} ON {t}")
    op.execute("DROP POLICY users_write ON users")
    op.execute("REVOKE INSERT, UPDATE ON users FROM app_authenticated")
    for t in CONFIG_TABLES:
        op.execute(f"DROP POLICY {t}_write ON {t}")
        op.execute(f"DROP POLICY {t}_read ON {t}")
        op.execute(f"ALTER TABLE {t} DISABLE ROW LEVEL SECURITY")
    op.drop_table("app_settings")
    op.drop_table("package_items")
    op.drop_table("packages")
    op.drop_column("products", "rate_confirmed")
