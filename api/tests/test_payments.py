"""Mode of payment, including split and part payments."""

import pytest
from sqlalchemy import text

from app.db import engine

API = "/api/v1"
A = "/api/v1/admin"


@pytest.fixture(scope="module")
def prods(client):
    return {p["name"]: p["id"] for p in client.get(f"{API}/products").json()}


def body(prods, payments, action="submit", **extra):
    # 10 x Flags - Normal @ 375 (+2.5% +2.5%) = 3937.50 -> payable Rs 3938
    return {"company_name": "Pay Co", "invoice_date": "2027-02-10", "action": action,
            "items": [{"product_id": prods["Flags - Normal"], "quantity": 10}], "payments": payments, **extra}


def make(client, people, prods, payments, who="til", **kw):
    r = client.post(f"{API}/invoices", json=body(prods, payments, **kw), headers=people[who]["h"])
    return r


def test_no_payment_is_unpaid(client, people, prods):
    inv = make(client, people, prods, []).json()
    assert (inv["payments"], inv["payment_status"], float(inv["amount_paid"]), float(inv["grand_total"])) == ([], "UNPAID", 0.0, 3938.0)


@pytest.mark.parametrize("mode", ["CASH", "UPI", "CARD", "NET_BANKING"])
def test_single_full_payment_in_each_mode(client, people, prods, mode):
    inv = make(client, people, prods, [{"mode": mode, "amount": "3938", "reference": "REF-1"}]).json()
    assert inv["payment_status"] == "PAID" and [(p["mode"], float(p["amount"]), p["reference"]) for p in inv["payments"]] == [(mode, 3938.0, "REF-1")]


def test_split_payment_upi_and_cash(client, people, prods):
    pays = [{"mode": "UPI", "amount": "2000", "reference": "UTR 604794369987"}, {"mode": "CASH", "amount": "1938"}]
    inv = make(client, people, prods, pays).json()
    assert inv["payment_status"] == "PAID" and float(inv["amount_paid"]) == 3938.0
    assert [(p["mode"], float(p["amount"])) for p in inv["payments"]] == [("UPI", 2000.0), ("CASH", 1938.0)]   # order kept
    # a later fetch and the immutable version snapshot both carry the split
    got = client.get(f"{API}/invoices/{inv['id']}", headers=people["til"]["h"]).json()
    assert [p["mode"] for p in got["payments"]] == ["UPI", "CASH"]
    with engine.connect() as c:
        snap = c.execute(text("select snapshot from invoice_versions where invoice_id = :i and version_number = 1"), {"i": inv["id"]}).scalar()
    assert [p["mode"] for p in snap["payments"]] == ["UPI", "CASH"] and snap["payment_status"] == "PAID"


def test_part_payment_leaves_a_balance_and_can_be_completed_later(client, people, prods):
    h = people["til"]["h"]
    inv = make(client, people, prods, [{"mode": "UPI", "amount": "1000", "reference": "UTR 1"}]).json()
    assert inv["payment_status"] == "PARTIAL" and float(inv["amount_paid"]) == 1000.0
    # the customer pays the rest in cash: a revision (with its reason) records it; the old version keeps the old picture
    rest = body(prods, [{"mode": "UPI", "amount": "1000", "reference": "UTR 1"}, {"mode": "CASH", "amount": "2938"}], edit_reason="balance paid in cash")
    r = client.put(f"{API}/invoices/{inv['id']}", json=rest, headers=people["super"]["h"])  # only the central admin revises
    assert r.status_code == 200 and r.json()["payment_status"] == "PAID" and len(r.json()["payments"]) == 2
    versions = client.get(f"{API}/invoices/{inv['id']}/versions/1", headers=people["til_admin"]["h"]).json()
    assert versions["payment_status"] == "PARTIAL" and len(versions["payments"]) == 1


def test_updating_a_draft_replaces_the_payments(client, people, prods):
    h = people["til"]["h"]
    d = make(client, people, prods, [{"mode": "CASH", "amount": "500"}], action="draft").json()
    r = client.put(f"{API}/invoices/{d['id']}", json=body(prods, [{"mode": "CARD", "amount": "700", "reference": "slip 9"}], action="draft"), headers=h)
    assert [(p["mode"], float(p["amount"])) for p in r.json()["payments"]] == [("CARD", 700.0)]        # replaced, not added to
    r = client.put(f"{API}/invoices/{d['id']}", json=body(prods, [], action="draft"), headers=h)
    assert r.json()["payments"] == [] and r.json()["payment_status"] == "UNPAID"


@pytest.mark.parametrize("pays, why", [
    ([{"mode": "CASH", "amount": "3938.01"}], "more than the total"),
    ([{"mode": "UPI", "amount": "2000"}, {"mode": "CASH", "amount": "2000"}], "split adds up to more than the total"),
    ([{"mode": "OTHER", "amount": "100"}], "'Other' needs a description"),
    ([{"mode": "OTHER", "amount": "100", "reference": "   "}], "blank description"),
    ([{"mode": "BITCOIN", "amount": "100"}], "unknown mode"),
    ([{"mode": "CASH", "amount": "0"}], "zero amount"),
    ([{"mode": "CASH", "amount": "-5"}], "negative amount"),
    ([{"mode": "CASH", "amount": "10.005"}], "more than two decimals"),
    ([{"mode": "CASH", "amount": "10", "note": "x"}], "unknown field"),
    ([{"mode": "CASH", "amount": "1"}] * 7, "too many rows"),
])
def test_bad_payments_are_refused(client, people, prods, pays, why):
    assert make(client, people, prods, pays).status_code == 422, why


def test_other_mode_with_a_description_is_fine(client, people, prods):
    inv = make(client, people, prods, [{"mode": "OTHER", "amount": "3938", "reference": "Demand draft 552211"}])
    assert inv.status_code == 201 and inv.json()["payments"][0]["reference"] == "Demand draft 552211"


def test_payments_follow_branch_isolation(client, people, prods):
    inv = make(client, people, prods, [{"mode": "UPI", "amount": "100", "reference": "secret-utr"}]).json()
    assert client.get(f"{API}/invoices/{inv['id']}", headers=people["sbr"]["h"]).status_code == 404
    with engine.connect() as c:     # and the database hides the rows from another branch, whatever the API does
        branch = c.execute(text("select id from branches where code = 'SBR'")).scalar()
        user = people["sbr"]["user_id"]
        c.execute(text("select set_config('app.user_id', :u, true), set_config('app.role', 'BRANCH_USER', true), "
                       "set_config('app.branch_id', :b, true)"), {"u": str(user), "b": str(branch)})
        c.execute(text("set local role app_authenticated"))
        assert c.execute(text("select count(*) from invoice_payments where reference = 'secret-utr'")).scalar() == 0


def test_reports_group_payments_by_mode_and_show_outstanding(client, people, prods):
    su = people["super"]["h"]
    q = {"date_from": "2033-01-01", "date_to": "2033-12-31"}
    mk = lambda pays: client.post(f"{API}/invoices", headers=people["sbr"]["h"], json=body(prods, pays, invoice_date="2033-03-03"))
    mk([{"mode": "UPI", "amount": "2000"}, {"mode": "CASH", "amount": "1938"}])     # fully paid
    mk([{"mode": "CASH", "amount": "1000"}])                                          # 2938 outstanding
    mk([])                                                                            # 3938 outstanding
    rep = client.get(f"{A}/reports", params=q, headers=su).json()
    by = {m["mode"]: (m["payments"], float(m["value"])) for m in rep["by_payment_mode"]}
    assert by == {"CASH": (2, 2938.0), "UPI": (1, 2000.0)}
    assert rep["outstanding"]["invoices"] == 2 and float(rep["outstanding"]["value"]) == 6876.0
