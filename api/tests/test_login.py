"""Our own sign-in: create a login as the central admin, sign in, lock-out, reset, change password."""

import jwt
from sqlalchemy import text

from app.config import settings
from app.db import engine

API = "/api/v1"


def test_admin_creates_login_user_signs_in_and_token_carries_no_authority(client, people):
    su = people["super"]["h"]
    body = {"email": "Asha.Login@mccia-test.com", "name": "Asha", "role": "BRANCH_USER", "branch_code": "AHL",
            "active": True, "password": "correct-horse-1"}
    r = client.post(f"{API}/admin/users", json=body, headers=su)
    assert r.status_code == 201 and r.json()["branch_code"] == "AHL"
    assert client.post(f"{API}/admin/users", json=body, headers=su).status_code == 422      # duplicate e-mail
    assert client.post(f"{API}/admin/users", json={**body, "email": "x@mccia-test.com", "password": "short"},
                       headers=su).status_code == 422                                          # password too short
    assert client.post(f"{API}/admin/users", json=body, headers=people["til_admin"]["h"]).status_code == 403

    login = client.post(f"{API}/auth/login", json={"email": "asha.login@mccia-test.com", "password": "correct-horse-1"})
    assert login.status_code == 200
    token = login.json()["access_token"]
    claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], audience="authenticated")
    assert set(claims) == {"sub", "aud", "exp"}                                                # no role / branch in the token
    me = client.get(f"{API}/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me["role"] == "BRANCH_USER" and me["branch"]["code"] == "AHL"

    # the hash is never stored in the readable users table, and the API's own database role cannot read it
    with engine.connect() as c:
        h = c.execute(text("select password_hash from user_credentials limit 1")).scalar()
        assert h.startswith("$argon2id$")
        c.execute(text("select set_config('app.role', 'SUPER_ADMIN', true)"))
        c.execute(text("set local role app_authenticated"))
        for table in ("user_credentials", "stored_files"):
            try:
                c.execute(text(f"select count(*) from {table}"))
                raise AssertionError(f"app_authenticated could read {table}")
            except AssertionError:
                raise
            except Exception:
                c.rollback()
                c.execute(text("set local role app_authenticated"))


def test_wrong_password_is_generic_then_locks_and_admin_reset_unlocks(client, people):
    su = people["super"]["h"]
    mk = {"email": "lock.me@mccia-test.com", "name": "Lock Me", "role": "BRANCH_USER", "branch_code": "TIL",
          "active": True, "password": "first-password"}
    uid = client.post(f"{API}/admin/users", json=mk, headers=su).json()["id"]
    bad = lambda: client.post(f"{API}/auth/login", json={"email": mk["email"], "password": "wrong"})
    unknown = client.post(f"{API}/auth/login", json={"email": "nobody@mccia-test.com", "password": "wrong"})
    assert unknown.status_code == 401 and unknown.json() == bad().json()                        # same message either way
    for _ in range(3):                                                                          # 4 wrong so far (one above)
        assert bad().status_code == 401
    assert client.post(f"{API}/auth/login", json={"email": mk["email"], "password": "first-password"}).status_code == 200  # resets the count
    for _ in range(5):
        bad()
    locked = client.post(f"{API}/auth/login", json={"email": mk["email"], "password": "first-password"})
    assert locked.status_code == 429                                                            # even the right password waits

    assert client.put(f"{API}/admin/users/{uid}/password", json={"password": "second-password"},
                      headers=people["til_admin"]["h"]).status_code == 403                      # central admin only
    assert client.put(f"{API}/admin/users/{uid}/password", json={"password": "second-password"}, headers=su).status_code == 204
    assert client.post(f"{API}/auth/login", json={"email": mk["email"], "password": "first-password"}).status_code == 401
    ok = client.post(f"{API}/auth/login", json={"email": mk["email"], "password": "second-password"})
    assert ok.status_code == 200
    with engine.connect() as c:
        assert c.execute(text("select count(*) from audit_logs where action = 'user.password_reset'")).scalar() >= 1


def test_inactive_user_cannot_sign_in_and_users_change_their_own_password(client, people):
    su = people["super"]["h"]
    mk = {"email": "change.me@mccia-test.com", "name": "Change Me", "role": "BRANCH_USER", "branch_code": "BHO",
          "active": True, "password": "old-password-1"}
    uid = client.post(f"{API}/admin/users", json=mk, headers=su).json()["id"]
    token = client.post(f"{API}/auth/login", json={"email": mk["email"], "password": "old-password-1"}).json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    assert client.post(f"{API}/auth/change-password", json={"current_password": "nope", "password": "new-password-1"}, headers=h).status_code == 403
    assert client.post(f"{API}/auth/change-password", json={"current_password": "old-password-1", "password": "short"}, headers=h).status_code == 422
    assert client.post(f"{API}/auth/change-password", json={"current_password": "old-password-1", "password": "new-password-1"}, headers=h).status_code == 204
    assert client.post(f"{API}/auth/login", json={"email": mk["email"], "password": "old-password-1"}).status_code == 401
    assert client.post(f"{API}/auth/login", json={"email": mk["email"], "password": "new-password-1"}).status_code == 200
    client.put(f"{API}/admin/users/{uid}", json={"name": "Change Me", "role": "BRANCH_USER", "branch_code": "BHO", "active": False}, headers=su)
    assert client.post(f"{API}/auth/login", json={"email": mk["email"], "password": "new-password-1"}).status_code == 401


def test_production_refuses_an_unsafe_configuration():
    import pytest

    from app import main

    saved = (settings.environment, settings.dev_login)
    settings.environment, settings.dev_login = "production", True
    try:
        with pytest.raises(RuntimeError, match="DEV_LOGIN must be off"):
            main._check_production()
    finally:
        settings.environment, settings.dev_login = saved


def test_pdfs_can_be_kept_in_the_database(session):
    from app.storage import DbStorage

    s = DbStorage()
    s.put("invoices/test/v1.pdf", b"%PDF-1.4 one")
    s.put("invoices/test/v1.pdf", b"%PDF-1.4 two")                                              # overwrite, not duplicate
    assert s.get("invoices/test/v1.pdf") == b"%PDF-1.4 two"
