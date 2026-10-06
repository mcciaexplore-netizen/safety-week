"""Create (or reset) an MCCIA login from the command line - use it to create the FIRST central admin.

    python -m app.admin_cli create-user --email boss@mccia.org --name "Boss" --role SUPER_ADMIN --password "..."
    python -m app.admin_cli create-user --email a@mccia.org --name "Asha" --role BRANCH_USER --branch TIL --password "..."
    python -m app.admin_cli set-password --email a@mccia.org --password "..."

Afterwards the central admin can add and reset everyone else from the Users page. The role and branch stored
here are what the API and row level security trust - nothing the browser sends can change them.
"""

import argparse
import sys
import uuid

from sqlalchemy import func, select

from .db import SessionLocal
from .login import set_password
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
    c.add_argument("--password", required=True)
    r = sub.add_parser("set-password")
    r.add_argument("--email", required=True)
    r.add_argument("--password", required=True)
    a = ap.parse_args()

    if len(a.password) < 8:
        sys.exit("The password must be at least 8 characters")

    with SessionLocal() as s:
        if a.cmd == "set-password":
            user = s.scalar(select(User).where(func.lower(User.email) == a.email.lower()))
            if user is None:
                sys.exit(f"No user {a.email}")
            if user.auth_user_id is None:
                user.auth_user_id = user.id
                s.commit()
            set_password(user.id, a.password)
            print(f"password set for {a.email}")
            return 0

        if (a.role == "SUPER_ADMIN") == bool(a.branch):
            sys.exit("SUPER_ADMIN takes no --branch; every other role requires one")
        branch = get_branch_by_code(s, a.branch) if a.branch else None
        if a.branch and branch is None:
            sys.exit(f"Unknown branch {a.branch}")
        user = User(id=uuid.uuid4(), auth_user_id=uuid.uuid4(), name=a.name, email=a.email, role=a.role,
                    branch_id=branch.id if branch else None)
        s.add(user)
        s.commit()
        set_password(user.id, a.password)
    print(f"created {a.role} {a.email} branch={a.branch or '-'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
