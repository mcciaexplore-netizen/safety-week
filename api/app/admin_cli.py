"""Create an MCCIA user: a Supabase Auth login plus the matching profile row.

    python -m app.admin_cli create-user --email a@mccia.org --name "Asha" --role BRANCH_USER --branch TIL --password "..."
    python -m app.admin_cli create-user --email boss@mccia.org --name "Boss" --role SUPER_ADMIN --password "..."

If you already created the login in the Supabase dashboard, add `--auth-id <its UUID>` and
no password: only the profile row (role + branch) is created. The role and branch stored here
are what the API and row level security trust - nothing the browser sends can change them.
"""

import argparse
import sys
import uuid

import httpx

from .config import settings
from .db import SessionLocal
from .models import ROLES, User
from .repositories import get_branch_by_code


def main() -> int:
    ap = argparse.ArgumentParser(prog="admin_cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create-user")
    c.add_argument("--email", required=True)
    c.add_argument("--name", required=True)
    c.add_argument("--role", required=True, choices=ROLES)
    c.add_argument("--branch", help="SBR | TIL | BHO | HAD | AHL (not for SUPER_ADMIN)")
    c.add_argument("--password")
    c.add_argument("--auth-id", type=uuid.UUID)
    a = ap.parse_args()

    if (a.role == "SUPER_ADMIN") == bool(a.branch):
        sys.exit("SUPER_ADMIN takes no --branch; every other role requires one")

    with SessionLocal() as s:
        branch = get_branch_by_code(s, a.branch) if a.branch else None
        if a.branch and branch is None:
            sys.exit(f"Unknown branch {a.branch}")

        auth_id = a.auth_id
        if auth_id is None:
            if not (a.password and settings.supabase_url and settings.supabase_service_key):
                sys.exit("Need --password plus SUPABASE_URL and SUPABASE_SERVICE_KEY (or pass --auth-id)")
            r = httpx.post(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users",
                headers={"apikey": settings.supabase_service_key,
                         "Authorization": f"Bearer {settings.supabase_service_key}"},
                json={"email": a.email, "password": a.password, "email_confirm": True},
                timeout=20,
            )
            if r.status_code >= 300:
                sys.exit(f"Supabase refused: {r.status_code} {r.text}")
            auth_id = uuid.UUID(r.json()["id"])

        s.add(User(auth_user_id=auth_id, name=a.name, email=a.email, role=a.role,
                   branch_id=branch.id if branch else None))
        s.commit()
    print(f"created {a.role} {a.email} branch={a.branch or '-'} auth_id={auth_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
