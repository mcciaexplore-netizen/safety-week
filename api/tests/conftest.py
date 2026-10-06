"""Tests run against a throwaway REAL PostgreSQL (pgserver), built only by
`alembic upgrade head` + the seed - so the migrations themselves are what is tested."""

import os
import tempfile
from pathlib import Path

import pgserver
import pytest
from alembic import command
from alembic.config import Config

_dir = tempfile.mkdtemp(prefix="nsw_pg_")
_server = pgserver.get_server(_dir, cleanup_mode="delete")
# Must be set before app modules are imported (the engine is created at import time).
os.environ["DATABASE_URL"] = _server.get_uri().replace("postgresql://", "postgresql+psycopg://", 1)

SECRET = "test-secret-test-secret-test-secret-32b"
os.environ["JWT_SECRET"] = SECRET
os.environ["DEV_LOGIN"] = "false"  # tests must not inherit a developer .env
os.environ["PDF_AUTOGENERATE"] = "false"  # only tests/test_documents.py turns this on (needs the web app)
os.environ["CORS_ORIGINS"] = '["http://127.0.0.1:3300"]'
os.environ["STORAGE_DIR"] = tempfile.mkdtemp(prefix="nsw_pdf_")

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session", autouse=True)
def database():
    command.upgrade(Config(str(ROOT / "alembic.ini")), "head")
    from app.db import SessionLocal
    from app.seed import seed

    with SessionLocal() as s:
        seed(s)
    yield


@pytest.fixture()
def session():
    from app.db import SessionLocal

    with SessionLocal() as s:
        yield s
        s.rollback()


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


# ---- identities: real profile rows + tokens minted exactly the way the API signs them at sign-in ----
import time  # noqa: E402
import uuid  # noqa: E402

import jwt  # noqa: E402


def mint(sub, *, secret=SECRET, exp_in=3600, aud="authenticated", alg="HS256"):
    return jwt.encode({"sub": str(sub), "aud": aud, "exp": int(time.time()) + exp_in}, secret, alg)


@pytest.fixture(scope="session")
def people(database):
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import Branch, User

    specs = {  # key: (role, branch code, active)
        "sbr": ("BRANCH_USER", "SBR", True),
        "til": ("BRANCH_USER", "TIL", True),
        "bho": ("BRANCH_USER", "BHO", True),
        "til_admin": ("BRANCH_ADMIN", "TIL", True),
        "super": ("SUPER_ADMIN", None, True),
        "inactive": ("BRANCH_USER", "SBR", False),
    }
    out = {}
    with SessionLocal() as s:
        branches = {b.code: b for b in s.scalars(select(Branch))}
        for key, (role, code, active) in specs.items():
            auth_id = uuid.uuid4()
            u = User(auth_user_id=auth_id, name=key, email=f"{key}@x.invalid", role=role, active=active,
                     branch_id=branches[code].id if code else None)
            s.add(u)
            s.flush()
            out[key] = {"user_id": u.id, "h": {"Authorization": f"Bearer {mint(auth_id)}"}}
        s.commit()
    return out
