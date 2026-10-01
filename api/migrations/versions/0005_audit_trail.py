"""audit trail: actor/editor names, append-only audit log, triggers for user + config changes

Row-change auditing lives in the DATABASE on purpose: whether a role or a rate is changed by the
CLI, a future admin screen or a hand-typed SQL statement, it is recorded. The trigger function is
SECURITY DEFINER so it can write audit rows regardless of who made the change.

Revision ID: 0005
Revises: 0004
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

UP = """
CREATE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.role', true), '') $$;

-- Central admin reads everything; a branch admin reads their own branch's trail only.
DROP POLICY audit_read ON audit_logs;
CREATE POLICY audit_read ON audit_logs FOR SELECT TO app_authenticated
  USING (app_is_super() OR (app_role() = 'BRANCH_ADMIN' AND branch_id = app_branch()));

-- Append-only, even for the table owner.
CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END $$;
CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE FUNCTION audit_row_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ent text := CASE TG_TABLE_NAME WHEN 'users' THEN 'user' WHEN 'events' THEN 'event'
                                 WHEN 'products' THEN 'product' ELSE 'discount_rule' END;
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
    IF meta IS NULL THEN RETURN NEW; END IF;  -- nothing actually changed
    act := ent || '.update'; row_id := NEW.id;
    IF ent = 'user' THEN
      IF jsonb_exists(meta, 'role') OR jsonb_exists(meta, 'branch_id') THEN act := 'user.role_change';
      ELSIF jsonb_exists(meta, 'active') THEN act := 'user.active_change';
      END IF;
    END IF;
    meta := jsonb_build_object('changes', meta);
  END IF;

  IF ent = 'user' THEN
    IF TG_OP = 'DELETE' THEN branch := OLD.branch_id; ELSE branch := NEW.branch_id; END IF;
  END IF;
  IF actor IS NOT NULL THEN SELECT name INTO actor_n FROM users WHERE id = actor; END IF;

  -- clock_timestamp(), not now(): several changes in one transaction must keep their real order
  INSERT INTO audit_logs (created_at, actor_user_id, actor_name, branch_id, action, entity_type, entity_id, metadata)
  VALUES (clock_timestamp(), actor, coalesce(actor_n, ''), branch, act, ent, row_id, meta);
  RETURN NULL;
END $$;

CREATE TRIGGER audit_users AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER audit_events AFTER INSERT OR UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER audit_products AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER audit_discount_rules AFTER INSERT OR UPDATE OR DELETE ON discount_rules
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
"""

DOWN = """
DROP TRIGGER audit_discount_rules ON discount_rules;
DROP TRIGGER audit_products ON products;
DROP TRIGGER audit_events ON events;
DROP TRIGGER audit_users ON users;
DROP FUNCTION audit_row_change();
DROP TRIGGER audit_logs_no_change ON audit_logs;
DROP FUNCTION audit_logs_immutable();
DROP POLICY audit_read ON audit_logs;
CREATE POLICY audit_read ON audit_logs FOR SELECT TO app_authenticated USING (app_is_super());
DROP FUNCTION app_role();
"""


def upgrade() -> None:
    op.add_column("invoice_versions", sa.Column("edited_by_name", sa.String(200), server_default="", nullable=False))
    op.add_column("audit_logs", sa.Column("actor_name", sa.String(200), server_default="", nullable=False))
    op.create_index("ix_audit_logs_created", "audit_logs", ["created_at"])
    op.create_index("ix_audit_logs_entity", "audit_logs", ["entity_type", "entity_id"])
    op.execute(UP)


def downgrade() -> None:
    op.execute(DOWN)
    op.drop_index("ix_audit_logs_entity", table_name="audit_logs")
    op.drop_index("ix_audit_logs_created", table_name="audit_logs")
    op.drop_column("audit_logs", "actor_name")
    op.drop_column("invoice_versions", "edited_by_name")
