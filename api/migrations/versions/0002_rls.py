"""row level security for branch isolation

The API connects with its normal login role and, per request, does
`SET LOCAL ROLE app_authenticated` plus set_config('app.user_id'|'app.role'|'app.branch_id').
Those three values are copied from the server-side `users` row - never from the client.
Policies fail closed: with no context set, no branch-owned row is visible or writable.
Owner/superuser/BYPASSRLS roles (migrations, seed, Supabase `postgres`) are unaffected.

Revision ID: 0002
Revises: 0001
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

# (table, policy predicate). Child tables inherit the parent's visibility through invoices.
BRANCH_OWNED = "app_is_super() OR branch_id = app_branch()"
VIA_INVOICE = "EXISTS (SELECT 1 FROM invoices i WHERE i.id = {t}.invoice_id)"

UP = f"""
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_authenticated') THEN
    CREATE ROLE app_authenticated NOLOGIN;
  END IF;
END $$;
GRANT app_authenticated TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO app_authenticated;

CREATE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION app_branch() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.branch_id', true), '')::uuid $$;
CREATE FUNCTION app_is_super() RETURNS boolean LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.role', true), '') = 'SUPER_ADMIN' $$;

-- reference data: read-only for the app role
GRANT SELECT ON branches, events, products, discount_rules TO app_authenticated;
-- users: a person sees only their own profile (admins see all); no writes through the API role
GRANT SELECT ON users TO app_authenticated;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_read ON users FOR SELECT TO app_authenticated
  USING (id = app_user() OR app_is_super());

GRANT SELECT, INSERT, UPDATE, DELETE ON invoices, invoice_items, invoice_versions,
  invoice_documents, invoice_sequences TO app_authenticated;
GRANT SELECT, INSERT ON audit_logs TO app_authenticated;

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoices_branch ON invoices FOR ALL TO app_authenticated
  USING ({BRANCH_OWNED}) WITH CHECK ({BRANCH_OWNED});

ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY sequences_branch ON invoice_sequences FOR ALL TO app_authenticated
  USING ({BRANCH_OWNED}) WITH CHECK ({BRANCH_OWNED});

ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY items_via_invoice ON invoice_items FOR ALL TO app_authenticated
  USING ({VIA_INVOICE.format(t="invoice_items")}) WITH CHECK ({VIA_INVOICE.format(t="invoice_items")});

ALTER TABLE invoice_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY versions_via_invoice ON invoice_versions FOR ALL TO app_authenticated
  USING ({VIA_INVOICE.format(t="invoice_versions")}) WITH CHECK ({VIA_INVOICE.format(t="invoice_versions")});

ALTER TABLE invoice_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY documents_via_invoice ON invoice_documents FOR ALL TO app_authenticated
  USING ({VIA_INVOICE.format(t="invoice_documents")}) WITH CHECK ({VIA_INVOICE.format(t="invoice_documents")});

-- audit log: append-only for the caller (actor must be themselves); only the central admin reads it
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_insert ON audit_logs FOR INSERT TO app_authenticated
  WITH CHECK (actor_user_id = app_user() AND (branch_id IS NULL OR branch_id = app_branch() OR app_is_super()));
CREATE POLICY audit_read ON audit_logs FOR SELECT TO app_authenticated USING (app_is_super());
"""

DOWN = """
DROP POLICY audit_read ON audit_logs;
DROP POLICY audit_insert ON audit_logs;
DROP POLICY documents_via_invoice ON invoice_documents;
DROP POLICY versions_via_invoice ON invoice_versions;
DROP POLICY items_via_invoice ON invoice_items;
DROP POLICY sequences_branch ON invoice_sequences;
DROP POLICY invoices_branch ON invoices;
DROP POLICY users_read ON users;
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_versions DISABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_sequences DISABLE ROW LEVEL SECURITY;
ALTER TABLE invoices DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
DROP FUNCTION app_is_super();
DROP FUNCTION app_branch();
DROP FUNCTION app_user();
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_authenticated;
REVOKE USAGE ON SCHEMA public FROM app_authenticated;
"""


def upgrade() -> None:
    op.execute(UP)


def downgrade() -> None:
    op.execute(DOWN)
