"""Branch isolation, proven separately at the API layer and at the database (RLS) layer."""

import time
import uuid

import jwt
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db import engine
from tests.conftest import mint

API = "/api/v1"


@pytest.fixture(scope="module")
def product_id(client):
    return client.get(f"{API}/products").json()[0]["id"]  # Badges


def payload(product_id, company="Acme Ltd", qty=10, **extra):
    return {"company_name": company, "invoice_date": "2027-02-12",
            "items": [{"product_id": product_id, "quantity": qty}], "action": "submit", **extra}


@pytest.fixture(scope="module")
def invoices(client, people, product_id):
    """One invoice per branch, each created by that branch's own user (or the central admin)."""
    made = {}
    for key, code in (("sbr", "SBR"), ("til", "TIL"), ("bho", "BHO")):
        r = client.post(f"{API}/invoices", json=payload(product_id, f"{code} Customer"), headers=people[key]["h"])
        assert r.status_code == 201, r.text
        made[code] = r.json()
    r = client.post(f"{API}/invoices?branch=HAD", json=payload(product_id, "HAD Customer"), headers=people["super"]["h"])
    assert r.status_code == 201, r.text
    made["HAD"] = r.json()
    return made


# ---------------- authentication ----------------

def test_no_token_is_401(client):
    assert client.get(f"{API}/me").status_code == 401
    assert client.get(f"{API}/invoices").status_code == 401


@pytest.mark.parametrize("token", [
    mint(uuid.uuid4(), secret="a-completely-different-signing-secret-xx"),  # forged signature
    mint(uuid.uuid4(), exp_in=-10),                                         # expired
    mint(uuid.uuid4(), aud="anon"),                                         # wrong audience
    jwt.encode({"sub": str(uuid.uuid4()), "aud": "authenticated", "exp": int(time.time()) + 99}, None, "none"),
    "not.a.jwt",
])
def test_bad_tokens_are_401(client, token):
    assert client.get(f"{API}/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_valid_token_without_profile_or_inactive_is_403(client, people):
    assert client.get(f"{API}/me", headers={"Authorization": f"Bearer {mint(uuid.uuid4())}"}).status_code == 403
    assert client.get(f"{API}/me", headers=people["inactive"]["h"]).status_code == 403


def test_me_reports_server_side_branch(client, people):
    me = client.get(f"{API}/me", headers=people["til"]["h"]).json()
    assert (me["role"], me["branch"]["code"], me["branch"]["name"]) == ("BRANCH_USER", "TIL", "Tilak Road")
    assert client.get(f"{API}/me", headers=people["super"]["h"]).json()["branch"] is None


# ---------------- API layer isolation ----------------

def test_sb_road_user_cannot_read_tilak_invoices(client, people, invoices):
    mine = client.get(f"{API}/invoices", headers=people["sbr"]["h"]).json()
    assert mine and {i["invoice_number"][:9] for i in mine} == {"NSW27-SBR"}
    # 404, not 403: an outsider cannot even confirm the invoice exists
    assert client.get(f"{API}/invoices/{invoices['TIL']['id']}", headers=people["sbr"]["h"]).status_code == 404


def test_tilak_user_cannot_read_bhosari_invoices(client, people, invoices):
    assert client.get(f"{API}/invoices/{invoices['BHO']['id']}", headers=people["til"]["h"]).status_code == 404
    listed = client.get(f"{API}/invoices", headers=people["til"]["h"]).json()
    assert listed and all("-BHO-" not in i["invoice_number"] for i in listed)


def test_branch_admin_is_also_limited_to_their_branch(client, people, invoices):
    got = client.get(f"{API}/invoices", headers=people["til_admin"]["h"]).json()
    assert got and all("-TIL-" in i["invoice_number"] for i in got)
    assert client.get(f"{API}/invoices/{invoices['SBR']['id']}", headers=people["til_admin"]["h"]).status_code == 404


def test_branch_cannot_be_chosen_through_the_request(client, people, product_id):
    h = people["til"]["h"]
    branches = {b["code"]: b["id"] for b in client.get(f"{API}/branches").json()}
    # 1. in the body: rejected outright (unknown keys are forbidden)
    for key in ("branch_id", "branch", "branch_code"):
        r = client.post(f"{API}/invoices", json=payload(product_id, **{key: branches["SBR"]}), headers=h)
        assert r.status_code == 422, key
    # 2. in the query string: 403 for anyone but the central admin
    assert client.post(f"{API}/invoices?branch=SBR", json=payload(product_id), headers=h).status_code == 403
    assert client.get(f"{API}/invoices?branch=SBR", headers=h).status_code == 403
    # 3. a normal create lands in the caller's own branch
    r = client.post(f"{API}/invoices", json=payload(product_id), headers=h)
    assert r.status_code == 201
    assert r.json()["branch_id"] == branches["TIL"] and "-TIL-" in r.json()["invoice_number"]


def test_role_status_and_totals_cannot_be_injected(client, people, product_id):
    for key, val in (("role", "SUPER_ADMIN"), ("created_by", str(uuid.uuid4())), ("status", "GENERATED"),
                     ("grand_total", "1")):
        r = client.post(f"{API}/invoices", json=payload(product_id, **{key: val}), headers=people["til"]["h"])
        assert r.status_code == 422, key


def test_only_admins_may_override_rates(client, people, product_id):
    body = payload(product_id)
    body["items"][0]["rate"] = "1.00"
    assert client.post(f"{API}/invoices", json=body, headers=people["til"]["h"]).status_code == 403
    assert client.post(f"{API}/invoices", json=body, headers=people["til_admin"]["h"]).status_code == 201


def test_server_recalculates_totals(invoices):
    inv = invoices["SBR"]  # 10 x Badges @ 4.80, 9% + 9%  ->  48 + 4.32 + 4.32 = 56.64  ->  57
    assert (float(inv["subtotal"]), float(inv["grand_total"]), inv["amount_in_words"]) == (48.0, 57.0, "Fifty Seven only")


def test_super_admin_reads_every_branch(client, people, invoices):
    everything = client.get(f"{API}/invoices", headers=people["super"]["h"]).json()
    assert {i["invoice_number"].split("-")[1] for i in everything} >= {"SBR", "TIL", "BHO", "HAD"}
    only_had = client.get(f"{API}/invoices?branch=HAD", headers=people["super"]["h"]).json()
    assert only_had and {i["invoice_number"].split("-")[1] for i in only_had} == {"HAD"}
    for code in ("SBR", "TIL", "BHO", "HAD"):
        assert client.get(f"{API}/invoices/{invoices[code]['id']}", headers=people["super"]["h"]).status_code == 200


def test_super_admin_must_name_a_branch_to_create(client, people, product_id):
    assert client.post(f"{API}/invoices", json=payload(product_id), headers=people["super"]["h"]).status_code == 422


# ---------------- database (RLS) layer: no API involved ----------------

def as_app_user(conn, people, key, role, branch_id):
    conn.execute(text("select set_config('app.user_id', :u, true), set_config('app.role', :r, true), "
                      "set_config('app.branch_id', :b, true)"),
                 {"u": str(people[key]["user_id"]), "r": role, "b": str(branch_id or "")})
    conn.execute(text("set local role app_authenticated"))


@pytest.fixture()
def branch_ids():
    with engine.connect() as c:
        return {code: str(i) for code, i in c.execute(text("select code, id from branches"))}


def test_rls_limits_rows_even_for_a_query_with_no_where_clause(people, invoices, branch_ids):
    with engine.connect() as conn:
        as_app_user(conn, people, "til", "BRANCH_USER", branch_ids["TIL"])
        assert {n.split("-")[1] for (n,) in conn.execute(text("select invoice_number from invoices"))} == {"TIL"}
        owners = conn.execute(text(
            "select distinct b.code from invoice_items i join invoices v on v.id = i.invoice_id "
            "join branches b on b.id = v.branch_id"))
        assert {c for (c,) in owners} == {"TIL"}
        # items are protected on their own too, not just through the join
        assert conn.execute(text("select count(*) from invoice_items")).scalar() == conn.execute(text(
            "select count(*) from invoice_items i join invoices v on v.id = i.invoice_id")).scalar()


def test_rls_blocks_writing_into_or_editing_another_branch(people, invoices, branch_ids):
    with engine.connect() as conn:
        as_app_user(conn, people, "til", "BRANCH_USER", branch_ids["TIL"])
        assert conn.execute(text("update invoices set company_name='hacked' where invoice_number like 'NSW27-SBR-%'")).rowcount == 0
        assert conn.execute(text("delete from invoices where invoice_number like 'NSW27-BHO-%'")).rowcount == 0
        with pytest.raises(DBAPIError, match="row-level security"):
            conn.execute(text("insert into invoices (invoice_number,event_id,branch_id,company_name,invoice_date) "
                              "select 'FORGED-1', event_id, :sbr, 'x', current_date from invoices limit 1"),
                         {"sbr": branch_ids["SBR"]})


def test_rls_fails_closed_without_identity(invoices):
    with engine.connect() as conn:
        conn.execute(text("set local role app_authenticated"))  # a role, but no verified identity
        assert conn.execute(text("select count(*) from invoices")).scalar() == 0
        assert conn.execute(text("select count(*) from invoice_sequences")).scalar() == 0


def test_rls_super_admin_sees_all_and_others_cannot_read_audit_log(people, invoices, branch_ids):
    with engine.connect() as conn:
        as_app_user(conn, people, "super", "SUPER_ADMIN", None)
        assert {n.split("-")[1] for (n,) in conn.execute(text("select invoice_number from invoices"))} >= {"SBR", "TIL", "BHO", "HAD"}
        assert conn.execute(text("select count(*) from audit_logs")).scalar() >= 4
    with engine.connect() as conn:
        as_app_user(conn, people, "til_admin", "BRANCH_ADMIN", branch_ids["TIL"])
        seen = {b for (b,) in conn.execute(text("select branch_id from audit_logs"))}
        assert seen == {uuid.UUID(branch_ids["TIL"])}  # a branch admin sees their own branch's trail only
        assert conn.execute(text("select count(*) from users")).scalar() == 1  # only their own profile
    with engine.connect() as conn:
        as_app_user(conn, people, "til", "BRANCH_USER", branch_ids["TIL"])
        assert conn.execute(text("select count(*) from audit_logs")).scalar() == 0  # ordinary users see none


def test_rls_context_survives_a_commit_inside_a_request(client, people, invoices):
    # create_invoice commits; the response then lazily reads items in a NEW transaction.
    # The after_begin hook must re-apply the role, otherwise that read would run unrestricted.
    r = client.get(f"{API}/invoices/{invoices['TIL']['id']}", headers=people["til"]["h"])
    assert r.status_code == 200 and len(r.json()["items"]) == 1
