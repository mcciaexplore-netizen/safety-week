"""Invoice lifecycle: draft -> update -> submit -> revise, numbering, snapshots, search, scoping."""

import re
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import pytest
from sqlalchemy import text

from app.db import engine

API = "/api/v1"


@pytest.fixture(scope="module")
def prods(client):
    return {p["name"]: p for p in client.get(f"{API}/products").json()}


def body(prods, lines, **extra):
    """lines: [(product name, qty)]"""
    return {"company_name": "Lifecycle Co", "invoice_date": "2027-02-10", "action": "draft",
            "items": [{"product_id": prods[n]["id"], "quantity": q} for n, q in lines], **extra}


def versions(invoice_id):
    with engine.connect() as c:
        return c.execute(text("select version_number, edit_reason, snapshot from invoice_versions "
                              "where invoice_id = :i order by version_number"), {"i": invoice_id}).all()


def test_draft_lifecycle_and_server_side_totals(client, people, prods):
    h = people["sbr"]["h"]
    r = client.post(f"{API}/invoices", json=body(prods, [("Badges", 10)]), headers=h)
    assert r.status_code == 201
    inv = r.json()
    assert inv["status"] == "DRAFT" and inv["version"] == 1 and inv["created_by_name"] == "sbr"
    assert re.fullmatch(r"NSW27-SBR-\d{6}", inv["invoice_number"])
    assert versions(inv["id"]) == []  # drafts are not versioned

    # update the draft: different lines, discount; same id & number; totals recomputed by the server
    upd = body(prods, [("Flags - Normal", 2), ("Badges", 100)], discount_percent="10", company_name="Renamed Co")
    r = client.put(f"{API}/invoices/{inv['id']}", json=upd, headers=h)
    assert r.status_code == 200
    u = r.json()
    assert (u["id"], u["invoice_number"], u["status"], u["version"]) == (inv["id"], inv["invoice_number"], "DRAFT", 1)
    assert u["company_name"] == "Renamed Co" and [i["particulars"] for i in u["items"]] == ["Flags - Normal", "Badges"]
    # Flags: 2 x 375 x 0.9 = 675 (+2.5%+2.5%) = 708.75 ; Badges: 100 x 4.80 x 0.9 = 432 (+9%+9%) = 509.76
    assert Decimal(u["grand_total"]) == Decimal("1219")  # 1218.51 rounded half-up
    assert Decimal(u["subtotal"]) == Decimal("1107.00") and u["amount_in_words"] == "One Thousand Two Hundred Nineteen only"
    assert float(u["items"][0]["rate_after_discount"]) == 337.5

    # submit the draft -> SUBMITTED, snapshot v1
    r = client.put(f"{API}/invoices/{inv['id']}", json={**upd, "action": "submit"}, headers=h)
    assert r.json()["status"] == "SUBMITTED" and r.json()["version"] == 1
    v = versions(inv["id"])
    assert [x[0] for x in v] == [1] and v[0][2]["grand_total"] == "1219.00"

    # revise a submitted invoice -> EDITED, version 2; v1 snapshot is untouched
    rev = {**upd, "action": "submit", "items": [{"product_id": prods["Badges"]["id"], "quantity": 1}],
           "edit_reason": "customer reduced order"}
    r = client.put(f"{API}/invoices/{inv['id']}", json=rev, headers=people["super"]["h"])  # only the central admin revises
    assert r.status_code == 200 and (r.json()["status"], r.json()["version"]) == ("EDITED", 2)
    v = versions(inv["id"])
    assert [x[0] for x in v] == [1, 2] and v[1][1] == "customer reduced order"
    assert v[0][2]["grand_total"] == "1219.00" and v[1][2]["grand_total"] == "5.00"  # 1 x 4.80 x 0.9 + 18% = 5.0976 -> 5


def test_invoice_line_snapshots_survive_catalogue_changes(client, people, prods):
    h = people["sbr"]["h"]
    inv = client.post(f"{API}/invoices", json=body(prods, [("Ball Pens", 5)], action="submit"), headers=h).json()
    before = client.get(f"{API}/invoices/{inv['id']}", headers=h).json()
    with engine.begin() as c:  # an admin changes the 2027 catalogue
        c.execute(text("update products set current_rate = 99, name = 'Ball Pens (renamed)', hsn_code = '11111111' "
                       "where name = 'Ball Pens'"))
    try:
        after = client.get(f"{API}/invoices/{inv['id']}", headers=h).json()
        assert after["items"] == before["items"] and after["grand_total"] == before["grand_total"]
        assert (before["items"][0]["particulars"], before["items"][0]["hsn_code"]) == ("Ball Pens", "96081019")
        new = client.post(f"{API}/invoices", json={**body(prods, [("Ball Pens", 5)]), "action": "draft"}, headers=h).json()
        assert Decimal(new["items"][0]["rate"]) == 99  # new invoices see the new catalogue
    finally:
        with engine.begin() as c:
            c.execute(text("update products set current_rate = 20, name = 'Ball Pens', hsn_code = '96081019' "
                           "where name = 'Ball Pens (renamed)'"))


def test_ids_are_uuid_and_number_is_concurrency_safe(client, people, prods):
    h = people["bho"]["h"]

    def make(_):
        r = client.post(f"{API}/invoices", json=body(prods, [("Badges", 1)]), headers=h)
        assert r.status_code == 201, r.text
        return r.json()

    with ThreadPoolExecutor(8) as pool:
        made = list(pool.map(make, range(24)))
    numbers = [m["invoice_number"] for m in made]
    assert len(set(numbers)) == 24 and len({m["id"] for m in made}) == 24
    seqs = sorted(int(n.rsplit("-", 1)[1]) for n in numbers)
    assert seqs == list(range(seqs[0], seqs[0] + 24))  # no gaps, no duplicates
    assert all(re.fullmatch(r"NSW27-BHO-\d{6}", n) for n in numbers)
    assert re.fullmatch(r"[0-9a-f-]{36}", made[0]["id"])


def test_numbering_ignores_row_counts_and_is_per_branch(client, people, prods):
    """Deleting rows must not make numbers repeat (a COUNT(*)-based scheme would)."""
    h = people["til"]["h"]
    first = client.post(f"{API}/invoices", json=body(prods, [("Badges", 1)]), headers=h).json()
    with engine.begin() as c:
        c.execute(text("delete from invoice_items where invoice_id = :i"), {"i": first["id"]})
        c.execute(text("delete from invoices where id = :i"), {"i": first["id"]})
    peek = client.get(f"{API}/invoices/next-number", headers=h).json()["invoice_number"]
    second = client.post(f"{API}/invoices", json=body(prods, [("Badges", 1)]), headers=h).json()
    n1, n2 = (int(x["invoice_number"][-6:]) for x in (first, second))
    assert n2 == n1 + 1 and second["invoice_number"] == peek
    other = client.post(f"{API}/invoices", json=body(prods, [("Badges", 1)]), headers=people["sbr"]["h"]).json()
    assert other["invoice_number"].startswith("NSW27-SBR-")


def test_validation_and_permissions(client, people, prods):
    h = people["sbr"]["h"]
    assert client.post(f"{API}/invoices", json={**body(prods, []), "action": "submit"}, headers=h).status_code == 422
    assert client.post(f"{API}/invoices", json={**body(prods, [("Badges", 0)]), "action": "submit"}, headers=h).status_code == 422
    dup = body(prods, [("Badges", 1), ("Badges", 2)])
    assert client.post(f"{API}/invoices", json=dup, headers=h).status_code == 422
    unknown = body(prods, [("Badges", 1)])
    unknown["items"][0]["product_id"] = "00000000-0000-0000-0000-000000000000"
    assert client.post(f"{API}/invoices", json=unknown, headers=h).status_code == 422
    assert client.post(f"{API}/invoices", json=body(prods, [("Badges", -1)]), headers=h).status_code == 422
    # sending the catalogue rate is fine for everyone; a different rate needs an admin
    same = body(prods, [("Badges", 1)])
    same["items"][0]["rate"] = prods["Badges"]["current_rate"]
    assert client.post(f"{API}/invoices", json=same, headers=h).status_code == 201
    same["items"][0]["rate"] = "1.00"
    assert client.post(f"{API}/invoices", json=same, headers=h).status_code == 403


def test_cannot_touch_another_branch_or_a_cancelled_invoice(client, people, prods):
    mine = client.post(f"{API}/invoices", json=body(prods, [("Badges", 1)]), headers=people["sbr"]["h"]).json()
    put = lambda who: client.put(f"{API}/invoices/{mine['id']}", json=body(prods, [("Badges", 2)]), headers=people[who]["h"])
    assert put("til").status_code == 404  # another branch: not even visible
    assert put("bho").status_code == 404
    assert put("sbr").status_code == 200
    with engine.begin() as c:
        c.execute(text("update invoices set status = 'CANCELLED' where id = :i"), {"i": mine["id"]})
    assert put("sbr").status_code == 409


def test_history_search_filters_and_scoping(client, people, prods):
    h = people["til_admin"]["h"]
    a = client.post(f"{API}/invoices", json=body(prods, [("Badges", 1)], company_name="Zeta_Works 100%", invoice_date="2027-03-01"), headers=h).json()
    b = client.post(f"{API}/invoices", json=body(prods, [("Badges", 1)], company_name="Alpha Traders", invoice_date="2027-01-05", action="submit"), headers=h).json()

    def ids(**params):
        r = client.get(f"{API}/invoices", params=params, headers=h)
        assert r.status_code == 200, r.text
        return {i["id"] for i in r.json()}

    assert a["id"] in ids(q="zeta") and b["id"] not in ids(q="zeta")                    # company, case-insensitive
    assert ids(q=b["invoice_number"][-6:]) >= {b["id"]}                                   # partial invoice id
    assert ids(q="Zeta_Works 100%") == {a["id"]}                                          # % and _ are literal
    assert ids(q="%") == {a["id"]}                                                        # only the invoice that contains a literal %
    assert b["id"] in ids(status="SUBMITTED") and a["id"] not in ids(status="SUBMITTED")
    assert ids(date_from="2027-02-01", date_to="2027-03-31") >= {a["id"]} and b["id"] not in ids(date_from="2027-02-01")
    assert b["id"] in ids(date_to="2027-01-31") and a["id"] not in ids(date_to="2027-01-31")
    assert len(client.get(f"{API}/invoices", params={"limit": 2}, headers=h).json()) == 2
    assert client.get(f"{API}/invoices", params={"status": "BOGUS"}, headers=h).status_code == 422
    # scoping holds with every filter on: the SBR user never sees Tilak rows, whatever they search
    theirs = client.get(f"{API}/invoices", params={"q": "Zeta"}, headers=people["sbr"]["h"]).json()
    assert theirs == []


def test_dev_token_endpoint_is_off_by_default(client):
    assert client.post(f"{API}/dev/token", json={"email": "sbr@x.invalid"}).status_code == 404
