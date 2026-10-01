"""Version history and the audit trail."""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db import engine

API = "/api/v1"


@pytest.fixture(scope="module")
def prods(client):
    return {p["name"]: p for p in client.get(f"{API}/products").json()}


def body(prods, qty=10, **extra):
    return {"company_name": "Audit Co", "invoice_date": "2027-02-10", "action": "draft",
            "items": [{"product_id": prods["Badges"]["id"], "quantity": qty}], **extra}


def audit(entity_id):
    """Every audit row for one entity, oldest first (read as the table owner)."""
    with engine.connect() as c:
        return c.execute(text("select action, actor_name, branch_id, metadata from audit_logs "
                              "where entity_id = :i order by created_at, id"), {"i": entity_id}).mappings().all()


def actions(entity_id):
    return [r["action"] for r in audit(entity_id)]


# ---------------- versions ----------------

def test_versions_are_ordered_complete_and_immutable(client, people, prods):
    h, admin = people["til"]["h"], people["til_admin"]["h"]
    inv = client.post(f"{API}/invoices", json=body(prods, 1), headers=h).json()
    i = inv["id"]
    assert client.put(f"{API}/invoices/{i}", json=body(prods, 2, action="submit"), headers=h).status_code == 200
    for n, reason in ((3, "customer added stock"), (4, "typo in company"), (5, "discount agreed")):
        r = client.put(f"{API}/invoices/{i}", json=body(prods, n, action="submit", edit_reason=reason,
                                                       company_name=f"Audit Co {n}"), headers=h)
        assert r.status_code == 200 and r.json()["version"] == n - 1

    versions = client.get(f"{API}/invoices/{i}/versions", headers=admin).json()
    assert [v["version_number"] for v in versions] == [4, 3, 2, 1]                      # newest first, no gaps
    assert [v["edit_reason"] for v in versions] == ["discount agreed", "typo in company", "customer added stock", ""]
    assert [v["status"] for v in versions] == ["EDITED", "EDITED", "EDITED", "SUBMITTED"]
    assert {v["edited_by_name"] for v in versions} == {"til"}
    stamps = [v["created_at"] for v in versions]
    assert stamps == sorted(stamps, reverse=True)

    # the snapshots really are different points in time, and v1 was never rewritten by later edits
    v1 = client.get(f"{API}/invoices/{i}/versions/1", headers=admin).json()
    v4 = client.get(f"{API}/invoices/{i}/versions/4", headers=admin).json()
    assert (v1["company_name"], v1["items"][0]["quantity"], v1["version"]) == ("Audit Co", 2, 1)
    assert (v4["company_name"], v4["items"][0]["quantity"], v4["version"]) == ("Audit Co 5", 5, 4)
    assert client.get(f"{API}/invoices/{i}", headers=h).json()["company_name"] == "Audit Co 5"  # current = latest

    with engine.connect() as c:  # the database refuses two rows for one version
        with pytest.raises(DBAPIError):
            c.execute(text("insert into invoice_versions (invoice_id, version_number, snapshot) "
                           "values (:i, 2, '{}'::jsonb)"), {"i": i})


def test_a_reason_is_required_to_change_a_submitted_invoice(client, people, prods):
    h = people["til"]["h"]
    inv = client.post(f"{API}/invoices", json=body(prods, action="submit"), headers=h).json()
    for reason in (None, "", "  ", "no"):
        extra = {} if reason is None else {"edit_reason": reason}
        r = client.put(f"{API}/invoices/{inv['id']}", json=body(prods, 3, action="submit", **extra), headers=h)
        assert r.status_code == 422, reason
    assert client.get(f"{API}/invoices/{inv['id']}", headers=h).json()["version"] == 1   # nothing was applied
    ok = client.put(f"{API}/invoices/{inv['id']}", json=body(prods, 3, action="submit", edit_reason="fix qty"), headers=h)
    assert ok.status_code == 200 and ok.json()["version"] == 2
    # drafts need no reason
    d = client.post(f"{API}/invoices", json=body(prods), headers=h).json()
    assert client.put(f"{API}/invoices/{d['id']}", json=body(prods, 4), headers=h).status_code == 200


def test_version_history_is_for_admins_of_that_branch(client, people, prods):
    inv = client.post(f"{API}/invoices", json=body(prods, action="submit"), headers=people["til"]["h"]).json()
    url = f"{API}/invoices/{inv['id']}/versions"
    assert client.get(url, headers=people["til"]["h"]).status_code == 403     # ordinary user
    assert client.get(url, headers=people["til_admin"]["h"]).status_code == 200
    assert client.get(url, headers=people["super"]["h"]).status_code == 200
    assert client.get(url).status_code == 401
    assert client.get(url + "/9", headers=people["til_admin"]["h"]).status_code == 404
    # an admin of ANOTHER branch cannot see it (the SBR user is not an admin; use the central-only path)
    with engine.begin() as c:
        c.execute(text("update users set role='BRANCH_ADMIN' where email='sbr@x.invalid'"))
    try:
        assert client.get(url, headers=people["sbr"]["h"]).status_code == 404
    finally:
        with engine.begin() as c:
            c.execute(text("update users set role='BRANCH_USER' where email='sbr@x.invalid'"))


# ---------------- cancellation ----------------

def test_cancel_keeps_the_record_and_records_why(client, people, prods):
    h, admin = people["til"]["h"], people["til_admin"]["h"]
    inv = client.post(f"{API}/invoices", json=body(prods, action="submit"), headers=h).json()
    url = f"{API}/invoices/{inv['id']}/cancel"
    assert client.post(url, json={"reason": "duplicate order"}, headers=h).status_code == 403          # users cannot
    assert client.post(url, json={"reason": "duplicate order"}, headers=people["sbr"]["h"]).status_code == 403
    assert client.post(url, json={"reason": "x"}, headers=admin).status_code == 422                     # reason needed
    assert client.post(url, json={"reason": "duplicate order", "status": "OK"}, headers=admin).status_code == 422
    r = client.post(url, json={"reason": "duplicate order"}, headers=admin)
    assert r.status_code == 200 and (r.json()["status"], r.json()["version"]) == ("CANCELLED", 2)

    versions = client.get(f"{API}/invoices/{inv['id']}/versions", headers=admin).json()
    assert [(v["version_number"], v["status"], v["edit_reason"]) for v in versions] == [
        (2, "CANCELLED", "duplicate order"), (1, "SUBMITTED", "")]
    assert client.put(f"{API}/invoices/{inv['id']}", json=body(prods, 5, action="submit", edit_reason="undo"),
                      headers=h).status_code == 409                                                     # read-only now
    assert client.post(url, json={"reason": "again please"}, headers=admin).status_code == 409
    assert client.get(f"{API}/invoices/{inv['id']}", headers=h).status_code == 200                      # still on record
    assert actions(inv["id"]) == ["invoice.submit", "invoice.cancel"]


# ---------------- audit rows ----------------

def test_invoice_lifecycle_writes_audit_rows(client, people, prods):
    h, admin = people["til"]["h"], people["til_admin"]["h"]
    inv = client.post(f"{API}/invoices", json=body(prods, 1), headers=h).json()
    i = inv["id"]
    client.put(f"{API}/invoices/{i}", json=body(prods, 2), headers=h)                                    # draft save
    client.put(f"{API}/invoices/{i}", json=body(prods, 3, action="submit"), headers=h)                   # submit
    client.put(f"{API}/invoices/{i}", json=body(prods, 4, action="submit", edit_reason="qty"), headers=h)  # revise
    client.post(f"{API}/invoices/{i}/cancel", json={"reason": "customer withdrew"}, headers=admin)      # cancel
    rows = audit(i)
    assert [r["action"] for r in rows] == ["invoice.create", "invoice.update", "invoice.submit",
                                           "invoice.revise", "invoice.cancel"]
    assert rows[0]["actor_name"] == "til" and rows[-1]["actor_name"] == "til_admin"
    revise = rows[3]["metadata"]
    assert (revise["reason"], revise["version"], revise["invoice_number"]) == ("qty", 2, inv["invoice_number"])
    assert float(revise["previous_total"]) == 17.0 and float(revise["new_total"]) == 23.0               # 3 vs 4 badges
    assert rows[4]["metadata"]["reason"] == "customer withdrew"
    assert all(str(r["branch_id"]) == inv["branch_id"] for r in rows)


def test_login_is_audited(client, people):
    before = len(audit(people["sbr"]["user_id"]))
    assert client.get(f"{API}/me", headers=people["sbr"]["h"]).status_code == 200
    rows = audit(people["sbr"]["user_id"])
    assert len(rows) == before + 1 and rows[-1]["action"] == "auth.login" and rows[-1]["actor_name"] == "sbr"


def test_user_and_role_changes_are_audited_whoever_makes_them(people):
    uid = people["bho"]["user_id"]
    with engine.begin() as c:
        # simulate the API acting as the central admin (any path that sets the actor is attributed)
        c.execute(text("select set_config('app.user_id', :u, true)"), {"u": str(people["super"]["user_id"])})
        c.execute(text("update users set role='BRANCH_ADMIN' where id=:i"), {"i": uid})
        c.execute(text("update users set active=false where id=:i"), {"i": uid})
        c.execute(text("update users set name = name where id=:i"), {"i": uid})       # no real change -> no row
    with engine.begin() as c:                                                          # ...and via a bare SQL console
        c.execute(text("update users set role='BRANCH_USER', active=true where id=:i"), {"i": uid})
    rows = [r for r in audit(uid) if r["action"].startswith("user.")]
    assert [r["action"] for r in rows] == ["user.create", "user.role_change", "user.active_change", "user.role_change"]
    assert rows[1]["metadata"]["changes"]["role"] == {"old": "BRANCH_USER", "new": "BRANCH_ADMIN"}
    assert (rows[1]["actor_name"], rows[3]["actor_name"]) == ("super", "")            # console change: no actor known
    assert rows[2]["metadata"]["changes"]["active"] == {"old": True, "new": False}


def test_configuration_changes_are_audited(prods):
    pid = prods["Coffee Mugs"]["id"]
    with engine.begin() as c:
        c.execute(text("update products set current_rate = 210 where id = :i"), {"i": pid})
        c.execute(text("update events set notes = 'dates confirmed' where invoice_prefix = 'NSW27'"))
        c.execute(text("insert into discount_rules (event_id, name, threshold, percentage) "
                       "select id, 'Early bird', 3000, 5 from events limit 1"))
    try:
        rows = audit(pid)
        change = rows[-1]["metadata"]["changes"]["current_rate"]
        assert rows[-1]["action"] == "product.rate_change" and (float(change["old"]), float(change["new"])) == (200.0, 210.0)
        with engine.connect() as c:
            got = {r[0] for r in c.execute(text("select action from audit_logs where entity_type in ('event','discount_rule')"))}
        assert {"event.update", "discount_rule.create"} <= got
    finally:
        with engine.begin() as c:
            c.execute(text("update products set current_rate = 200 where id = :i"), {"i": pid})
            c.execute(text("update events set notes = 'Dates to be confirmed by MCCIA.' where invoice_prefix = 'NSW27'"))
            c.execute(text("delete from discount_rules where name = 'Early bird'"))


def test_audit_log_is_append_only(people):
    with engine.connect() as c:
        for stmt in ("update audit_logs set action = 'x'", "delete from audit_logs"):
            with pytest.raises(DBAPIError, match="append-only"):
                c.execute(text(stmt))
            c.rollback()


# ---------------- reading the trail ----------------

def test_audit_endpoint_access(client, people, prods):
    inv = client.post(f"{API}/invoices", json=body(prods, action="submit"), headers=people["til"]["h"]).json()
    client.post(f"{API}/invoices", json=body(prods, action="submit"), headers=people["sbr"]["h"])
    url = f"{API}/audit-logs"
    assert client.get(url).status_code == 401
    assert client.get(url, headers=people["til"]["h"]).status_code == 403                  # ordinary user
    mine = client.get(url, params={"limit": 500}, headers=people["til_admin"]["h"]).json()
    assert mine and {r["branch_id"] for r in mine} == {inv["branch_id"]}                   # own branch only
    everyone = client.get(url, params={"limit": 500}, headers=people["super"]["h"]).json()
    assert len({r["branch_id"] for r in everyone}) > 1 and any(r["branch_id"] is None for r in everyone)
    assert any(r["action"] == "product.rate_change" for r in everyone)                          # config trail: central only
    assert not any(r["entity_type"] == "product" for r in mine)

    one = client.get(url, params={"entity_id": inv["id"]}, headers=people["til_admin"]["h"]).json()
    assert [r["action"] for r in one] == ["invoice.submit"] and one[0]["metadata"]["invoice_number"] == inv["invoice_number"]
    prefix = client.get(url, params={"action": "invoice.", "limit": 500}, headers=people["super"]["h"]).json()
    assert prefix and all(r["action"].startswith("invoice.") for r in prefix)
    assert prefix == sorted(prefix, key=lambda r: r["created_at"], reverse=True)           # newest first
    assert client.get(url, params={"limit": 0}, headers=people["super"]["h"]).status_code == 422
    assert client.get(url, params={"entity_id": str(uuid.uuid4())}, headers=people["super"]["h"]).json() == []
