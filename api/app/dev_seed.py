"""DEV ONLY: one profile per branch with the same names/e-mails the web demo shows (plus meera@ = Tilak
Road BRANCH_ADMIN and admin@ = central admin, to try the admin screens), so the
login page works unchanged against the real API (dev sign-in, no password).

    python -m app.dev_seed         (then start the API with DEV_LOGIN=true; ENVIRONMENT must not be production)

Never run this against production. Real users are created with app.admin_cli.
"""

import uuid

from sqlalchemy import select

from .db import SessionLocal
from .models import Branch, User

PEOPLE = [  # (branch code, name, e-mail) - mirrors lib/mock/seed.ts DEMO_USERS
    ("SBR", "Anjali Kulkarni", "anjali@example.invalid"),
    ("TIL", "Rajesh Patil", "rajesh@example.invalid"),
    ("BHO", "Sneha Bapat", "sneha@example.invalid"),
    ("HAD", "Mahesh Gokhale", "mahesh@example.invalid"),
    ("AHL", "Pooja Deshpande", "pooja@example.invalid"),
]

if __name__ == "__main__":
    with SessionLocal() as s:
        branches = {b.code: b for b in s.scalars(select(Branch))}
        for code, name, email in PEOPLE:
            if s.scalar(select(User).where(User.email == email)) is None:
                s.add(User(auth_user_id=uuid.uuid4(), name=name, email=email, role="BRANCH_USER",
                           branch_id=branches[code].id))
        if s.scalar(select(User).where(User.email == "meera@example.invalid")) is None:
            s.add(User(auth_user_id=uuid.uuid4(), name="Meera Admin", email="meera@example.invalid",
                       role="BRANCH_ADMIN", branch_id=branches["TIL"].id))
        if s.scalar(select(User).where(User.email == "admin@example.invalid")) is None:
            s.add(User(auth_user_id=uuid.uuid4(), name="Central Admin", email="admin@example.invalid",
                       role="SUPER_ADMIN"))
        s.commit()
    print("dev users ready")
