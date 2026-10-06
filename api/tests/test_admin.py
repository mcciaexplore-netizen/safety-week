"""Central admin: permissions (API + database), configuration rules, reports."""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db import engine

A = "/api/v1/admin"


@pytest.fixture(scope="module")
def su(people):
    return people["super"]["h"]


def event(client, su):
    return client.get(f"{A}/events", headers=su).json()[0]


def event_body(e, **over):
    return {"name": e["name"], "year": e["year"], "invoice_prefix": e["invoice_prefix"], "start_date": e["start_date"],
            "end_date": e["end_date"], "status": e["status"], "notes": e["notes"], **over}


# ---------------------------------------------------------------- who may use it
ENDPOINTS = ["/branches", "/users", "/events", "/products", "/discount-rules", "/packages", "/reports"]


@pytest.mark.parametrize("path", ENDPOINTS)
def test_only_the_central_admin_can_open_admin_pages(client, people, path):
    assert client.get(A + path).status_code == 401
    for who in ("til", "til_admin"):                                 # ordinary user, and a BRANCH admin
        assert client.get(A + path, headers=people[who]["h"]).status_code == 403
    assert client.get(A + path, headers=people["super"]["h"]).status_code == 200


def test_writes_are_refused_for_everyone_else_too(client, people):
    h = people["til_admin"]["h"]
    assert client.put(f"{A}/branches/{uuid.uuid4()}", json={}, headers=h).status_code == 403
    assert client.post(f"{A}/products", json={}, headers=h).status_code == 403
    assert client.put(f"{A}/settings/invoice", json={}, headers=h).status_code == 403


def test_the_database_itself_only_lets_the_central_admin_change_configuration(people):
    def as_role(conn, key, role):
        conn.execute(text("select set_config('app.user_id', :u, true), set_config('app.role', :r, true), "
                          "set_config('app.branch_id', '', true)"), {"u": str(people[key]["user_id"]), "r": role})
        conn.execute(text("set local role app_authenticated"))

    with engine.connect() as c:
        as_role(c, "til_admin", "BRANCH_ADMIN")
        assert c.execute(text("update products set current_rate = 1")).rowcount == 0          # RLS hides every row
        assert c.execute(text("update branches set phone = 'x'")).rowcount == 0
        assert c.execute(text("update users set role = 'SUPER_ADMIN' where email = 'til_admin@x.invalid'")).rowcount == 0
        with pytest.raises(DBAPIError, match="row-level security"):
            c.execute(text("insert into app_settings (key, value) values ('evil', '{}'::jsonb)"))
    with engine.connect() as c:
        as_role(c, "super", "SUPER_ADMIN")
        assert c.execute(text("update branches set phone = phone")).rowcount == 5


# ---------------------------------------------------------------- branches
def test_the_five_branches_are_fixed_but_their_details_are_editable(client, su):
    rows = client.get(f"{A}/branches", headers=su).json()
    assert {b["code"]: b["name"] for b in rows} == {"SBR": "SB Road", "TIL": "Tilak Road", "BHO": "Bhosari",
                                                    "HAD": "Hadapsar", "AHL": "Ahilyanagar"}
    b = next(x for x in rows if x["code"] == "HAD")
    ok = client.put(f"{A}/branches/{b['id']}", headers=su, json={"address": "Magarpatta, Hadapsar", "phone": "020-1",
                                                                  "email": "had@mccia.test", "active": True})
    assert ok.status_code == 200 and ok.json()["address"] == "Magarpatta, Hadapsar" and ok.json()["name"] == "Hadapsar"
    bad = client.put(f"{A}/branches/{b['id']}", headers=su, json={"address": "x", "phone": "", "email": "", "active": True,
                                                                  "name": "Sadar", "code": "SAD"})
    assert bad.status_code == 422                                     # name and code cannot be changed
    assert len(client.post if False else client.get(f"{A}/branches", headers=su).json()) == 5


# ---------------------------------------------------------------- users
def test_user_management_and_lockout_guards(client, people, su):
    with engine.begin() as c:  # a scratch user, so other tests' audit expectations are untouched
        c.execute(text("insert into users (auth_user_id, name, email, role, branch_id) select gen_random_uuid(), 'Scratch', "
                       "'scratch@x.invalid', 'BRANCH_USER', id from branches where code = 'BHO' "
                       "on conflict (email) do nothing"))
    users = {u["email"]: u for u in client.get(f"{A}/users", headers=su).json()}
    bho = users["scratch@x.invalid"]
    r = client.put(f"{A}/users/{bho['id']}", headers=su,
                   json={"name": "Bho Renamed", "role": "BRANCH_ADMIN", "branch_code": "BHO", "active": True})
    assert r.status_code == 200 and (r.json()["role"], r.json()["branch_code"]) == ("BRANCH_ADMIN", "BHO")
    # rules: a branch user needs a branch, the central admin must have none
    for body in ({"role": "BRANCH_USER", "branch_code": None}, {"role": "SUPER_ADMIN", "branch_code": "BHO"},
                 {"role": "BRANCH_USER", "branch_code": "XXX"}):
        assert client.put(f"{A}/users/{bho['id']}", headers=su, json={"name": "n", "active": True, **body}).status_code == 422
    # cannot demote / deactivate yourself, nor remove the last central admin
    me = users["super@x.invalid"]
    assert client.put(f"{A}/users/{me['id']}", headers=su, json={"name": "s", "role": "BRANCH_USER", "branch_code": "TIL",
                                                                  "active": True}).status_code == 422
    assert client.put(f"{A}/users/{me['id']}", headers=su, json={"name": "s", "role": "SUPER_ADMIN", "branch_code": None,
                                                                  "active": False}).status_code == 422
    # the role change was audited with who did it
    rows = client.get("/api/v1/audit-logs", params={"entity_id": bho["id"], "limit": 50}, headers=su).json()
    change = next(r for r in rows if r["action"] == "user.role_change")
    assert change["actor_name"] == "super" and change["metadata"]["changes"]["role"]["new"] == "BRANCH_ADMIN"
    client.put(f"{A}/users/{bho['id']}", headers=su, json={"name": "Scratch", "role": "BRANCH_USER", "branch_code": "BHO", "active": True})


# ---------------------------------------------------------------- event, products, and the 2026 -> 2027 guard
def test_event_dates_year_and_the_open_guard(client, su, people):
    prods = client.get("/api/v1/products").json()
    client.post("/api/v1/invoices", headers=people["til"]["h"], json={  # make sure invoices exist, so the prefix is locked
        "company_name": "Prefix Lock Co", "invoice_date": "2027-02-01", "action": "draft",
        "items": [{"product_id": prods[0]["id"], "quantity": 1}]})
    e = event(client, su)
    assert e["status"] == "PLANNING" and e["start_date"] is None and e["unconfirmed_products"] == 39
    assert client.put(f"{A}/events/{e['id']}", headers=su,
                      json=event_body(e, start_date="2027-03-08", end_date="2027-03-01")).status_code == 422
    dated = event_body(e, start_date="2027-03-04", end_date="2027-03-11", notes="confirmed by MCCIA")
    ok = client.put(f"{A}/events/{e['id']}", headers=su, json=dated)
    assert ok.status_code == 200 and ok.json()["start_date"] == "2027-03-04"
    # OPEN is refused while any rate is still a 2026 reference value ...
    refused = client.put(f"{A}/events/{e['id']}", headers=su, json={**dated, "status": "OPEN"})
    assert refused.status_code == 422 and "2026" in refused.json()["detail"]
    # ... and without dates
    client.put(f"{A}/events/{e['id']}", headers=su, json=event_body(e, start_date=None, end_date=None))
    assert "dates" in client.put(f"{A}/events/{e['id']}", headers=su, json=event_body(e, status="OPEN")).json()["detail"]
    # invoices already exist (other tests) -> the prefix is locked
    assert client.put(f"{A}/events/{e['id']}", headers=su, json=event_body(e, invoice_prefix="NSW28")).status_code == 422
    assert client.put(f"{A}/events/{e['id']}", headers=su, json=event_body(e, invoice_prefix="bad")).status_code == 422


def test_confirming_rates_then_opening_the_event(client, su):
    e = event(client, su)
    products = client.get(f"{A}/products", headers=su).json()
    assert len(products) == 39 and not any(p["rate_confirmed"] for p in products)      # nothing is silently "2027"
    badges = products[0]
    body = {k: badges[k] for k in ("name", "description", "hsn_code", "unit", "current_rate", "cgst_rate", "sgst_rate",
                                   "sr_no", "line_order", "active")}
    same = client.put(f"{A}/products/{badges['id']}", headers=su, json=body)                # untouched rate: still unconfirmed
    assert same.json()["rate_confirmed"] is False
    new = client.put(f"{A}/products/{badges['id']}", headers=su, json={**body, "current_rate": "5.20"})
    assert new.json()["rate_confirmed"] is True and new.json()["current_rate"] == "5.20"   # editing a rate confirms it
    explicit = client.put(f"{A}/products/{products[1]['id']}", headers=su,
                          json={**body, "name": products[1]["name"], "hsn_code": products[1]["hsn_code"],
                                "current_rate": products[1]["current_rate"], "line_order": products[1]["line_order"],
                                "confirm_rate": True})
    assert explicit.json()["rate_confirmed"] is True
    assert client.get(f"{A}/events", headers=su).json()[0]["unconfirmed_products"] == 37

    n = client.post(f"{A}/products/confirm", json={}, headers=su).json()["confirmed"]
    assert n == 37 and client.get(f"{A}/events", headers=su).json()[0]["unconfirmed_products"] == 0
    dated = event_body(e, start_date="2027-03-04", end_date="2027-03-11")
    assert client.put(f"{A}/events/{e['id']}", headers=su, json={**dated, "status": "OPEN"}).status_code == 200
    # put it back so the other tests still see a planning event with the 2026 catalogue
    client.put(f"{A}/events/{e['id']}", headers=su, json=event_body(e))
    with engine.begin() as c:
        c.execute(text("update products set rate_confirmed = false"))
        c.execute(text("update products set current_rate = 4.80 where name = 'Badges'"))


def test_product_validation_and_new_products(client, su):
    base = {"name": "Safety Vest", "hsn_code": "62113300", "unit": "Nos.", "current_rate": "250.00", "cgst_rate": "2.5",
            "sgst_rate": "2.5", "line_order": 40}
    ok = client.post(f"{A}/products", json=base, headers=su)
    assert ok.status_code == 201 and ok.json()["rate_confirmed"] is True and ok.json()["sku"].startswith("NSW27-")
    for bad in ({"hsn_code": "12"}, {"hsn_code": "ABCD1234"}, {"current_rate": "-1"}, {"cgst_rate": "50"}, {"name": ""},
                {"name": "Badges"}):                                                          # duplicate name is allowed? see below
        r = client.post(f"{A}/products", json={**base, **bad}, headers=su)
        if bad == {"name": "Badges"}:
            assert r.status_code == 201                                                       # names are not unique in the workbook
        else:
            assert r.status_code == 422, bad
    with engine.begin() as c:                                                                 # tidy up: products are never deleted via the API
        c.execute(text("delete from products where name in ('Safety Vest', 'Badges') and line_order = 40"))


# ---------------------------------------------------------------- discount rules and packages
def test_discount_rules(client, su):
    r = client.post(f"{A}/discount-rules", headers=su,
                    json={"name": "Early bird", "threshold": "3000", "percentage": "5", "valid_from": "2027-01-01",
                          "valid_until": "2027-02-15"})
    assert r.status_code == 201
    rid = r.json()["id"]
    assert client.post(f"{A}/discount-rules", headers=su, json={"name": "x", "percentage": "5", "fixed_amount": "10"}).status_code == 422
    assert client.post(f"{A}/discount-rules", headers=su, json={"name": "x"}).status_code == 422
    assert client.post(f"{A}/discount-rules", headers=su, json={"name": "x", "percentage": "150"}).status_code == 422
    assert client.post(f"{A}/discount-rules", headers=su, json={"name": "x", "percentage": "5", "valid_from": "2027-03-01",
                                                                "valid_until": "2027-01-01"}).status_code == 422
    edit = client.put(f"{A}/discount-rules/{rid}", headers=su, json={"name": "Early bird", "fixed_amount": "100", "active": False})
    assert edit.status_code == 200 and float(edit.json()["fixed_amount"]) == 100.0 and edit.json()["percentage"] is None
    assert [d["id"] for d in client.get(f"{A}/discount-rules", headers=su).json()] == [rid]
    assert client.delete(f"{A}/discount-rules/{rid}", headers=su).status_code == 204
    assert client.get(f"{A}/discount-rules", headers=su).json() == []


def test_packages(client, su):
    p = {x["name"]: x["id"] for x in client.get(f"{A}/products", headers=su).json()}
    body = {"name": "Starter Pack", "description": "3 items", "fixed_price": "3000",
            "items": [{"product_id": p["Badges"], "quantity": 100}, {"product_id": p["Caps"], "quantity": 20}]}
    r = client.post(f"{A}/packages", json=body, headers=su)
    assert r.status_code == 201 and [i["product_name"] for i in r.json()["items"]] == ["Badges", "Caps"]
    pid = r.json()["id"]
    dup = {**body, "name": "Dup", "items": [body["items"][0], body["items"][0]]}
    assert client.post(f"{A}/packages", json=dup, headers=su).status_code == 422
    assert client.post(f"{A}/packages", json={**body, "name": "Ghost", "items": [{"product_id": str(uuid.uuid4()), "quantity": 1}]},
                       headers=su).status_code == 422
    assert client.post(f"{A}/packages", json={**body, "name": "Empty", "items": []}, headers=su).status_code == 422
    upd = client.put(f"{A}/packages/{pid}", headers=su, json={**body, "items": [{"product_id": p["Caps"], "quantity": 5}]})
    assert [(i["product_name"], i["quantity"]) for i in upd.json()["items"]] == [("Caps", 5)]
    assert client.delete(f"{A}/packages/{pid}", headers=su).status_code == 204
    assert client.get(f"{A}/packages", headers=su).json() == []


# ---------------------------------------------------------------- invoice header / footer
def test_invoice_header_is_configurable_and_public_to_read(client, su):
    default = client.get("/api/v1/settings/invoice").json()                     # the print page reads it without a login
    assert default["name"].startswith("Mahratta Chamber") and default["for_org"] == "For MCCIA"
    new = {**default, "for_org": "For MCCIA Pune", "address_lines": ["Line one", "Line two"]}
    assert client.put(f"{A}/settings/invoice", json=new, headers=su).status_code == 200
    assert client.get("/api/v1/settings/invoice").json()["for_org"] == "For MCCIA Pune"
    assert client.put(f"{A}/settings/invoice", json={**new, "gstin": "BAD"}, headers=su).status_code == 422
    assert client.put(f"{A}/settings/invoice", json={**new, "extra": 1}, headers=su).status_code == 422
    client.put(f"{A}/settings/invoice", json=default, headers=su)


# ---------------------------------------------------------------- reports
def test_reports(client, people, su):
    prods = {p["name"]: p["id"] for p in client.get("/api/v1/products").json()}
    make = lambda who, qty, day, status: client.post("/api/v1/invoices", headers=people[who]["h"], json={
        "company_name": "Rep Co", "invoice_date": day, "action": status,
        "items": [{"product_id": prods["Danglers - Set of 20"], "quantity": qty}]}).json()
    before = client.get(f"{A}/reports", headers=su, params={"date_from": "2031-01-01", "date_to": "2031-12-31"}).json()
    assert before["totals"] == {"invoices": 0, "value": 0}
    make("sbr", 10, "2031-05-10", "submit")          # 10 x 170 = 1700 + 18% = 2006
    make("til", 1, "2031-05-20", "submit")           # 170 + 18% = 200.6 -> 201
    make("til", 5, "2031-06-01", "draft")            # drafts never count
    rep = client.get(f"{A}/reports", headers=su, params={"date_from": "2031-01-01", "date_to": "2031-12-31"}).json()
    by = {b["code"]: b for b in rep["by_branch"]}
    assert len(rep["by_branch"]) == 5 and (by["SBR"]["invoices"], float(by["SBR"]["value"])) == (1, 2006.0)
    assert (by["TIL"]["invoices"], float(by["TIL"]["value"])) == (1, 201.0) and by["BHO"]["invoices"] == 0
    assert rep["totals"]["invoices"] == 2 and float(rep["totals"]["value"]) == 2207.0
    assert [(p["name"], p["quantity"]) for p in rep["by_product"]] == [("Danglers - Set of 20", 11)]
    assert [m["month"] for m in rep["by_month"]] == ["2031-05"]
    assert {s["status"]: s["invoices"] for s in rep["by_status"]} == {"SUBMITTED": 2, "DRAFT": 1}
