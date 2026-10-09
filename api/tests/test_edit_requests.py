"""Only the central admin changes a submitted invoice; everyone else sends an edit request."""

import pytest

API = "/api/v1"


@pytest.fixture(scope="module")
def prods(client):
    return {p["name"]: p for p in client.get(f"{API}/products").json()}


def body(prods, qty=1, **extra):
    return {"company_name": "Request Co", "invoice_date": "2027-02-10", "action": "submit",
            "items": [{"product_id": prods["Badges"]["id"], "quantity": qty}], **extra}


def submitted(client, prods, h):
    r = client.post(f"{API}/invoices", json=body(prods), headers=h)
    assert r.status_code == 201
    return r.json()


def test_branch_users_and_admins_cannot_change_a_submitted_invoice(client, people, prods):
    inv = submitted(client, prods, people["til"]["h"])
    for who in ("til", "til_admin"):
        r = client.put(f"{API}/invoices/{inv['id']}", json=body(prods, 2, edit_reason="please"), headers=people[who]["h"])
        assert r.status_code == 403 and "Request edit" in r.json()["detail"], who
    assert client.get(f"{API}/invoices/{inv['id']}", headers=people["til"]["h"]).json()["version"] == 1
    ok = client.put(f"{API}/invoices/{inv['id']}", json=body(prods, 2, edit_reason="central change"), headers=people["super"]["h"])
    assert ok.status_code == 200 and ok.json()["version"] == 2


def test_a_draft_can_still_be_edited_by_its_branch(client, people, prods):
    h = people["til"]["h"]
    d = client.post(f"{API}/invoices", json=body(prods, action="draft"), headers=h).json()
    assert client.put(f"{API}/invoices/{d['id']}", json=body(prods, 3, action="draft"), headers=h).status_code == 200
    assert client.post(f"{API}/invoices/{d['id']}/edit-requests", json={"reason": "not needed"}, headers=h).status_code == 422  # drafts need no request


def test_request_flow_and_isolation(client, people, prods):
    h, adm, sup = people["til"]["h"], people["til_admin"]["h"], people["super"]["h"]
    inv = submitted(client, prods, h)
    url = f"{API}/invoices/{inv['id']}/edit-requests"
    assert client.post(url, json={"reason": "x"}, headers=h).status_code == 422                        # reason needed
    assert client.post(url, json={"reason": "customer changed qty", "status": "DONE"}, headers=h).status_code == 422
    assert client.post(url, json={"reason": "customer changed qty"}, headers=people["sbr"]["h"]).status_code == 404  # other branch
    assert client.post(url, json={"reason": "customer changed qty"}, headers=sup).status_code == 403   # the central admin just edits
    assert client.post(url, json={"reason": "customer changed qty"}).status_code == 401
    r = client.post(url, json={"reason": "customer changed qty"}, headers=h)
    assert r.status_code == 201
    req = r.json()
    assert (req["status"], req["invoice_number"], req["branch_code"], req["requested_by_name"]) == ("OPEN", inv["invoice_number"], "TIL", "til")
    assert client.post(url, json={"reason": "second try"}, headers=adm).status_code == 409           # one open request per invoice

    mine = client.get(f"{API}/edit-requests", params={"invoice_id": inv["id"]}, headers=adm).json()
    assert [x["id"] for x in mine] == [req["id"]]                                                     # the branch sees its own
    assert client.get(f"{API}/edit-requests", params={"invoice_id": inv["id"]}, headers=people["sbr"]["h"]).json() == []
    assert req["id"] in [x["id"] for x in client.get(f"{API}/edit-requests", params={"status": "OPEN"}, headers=sup).json()]

    # only the central admin answers
    d = f"{API}/edit-requests/{req['id']}/decline"
    assert client.post(d, json={"note": "no need"}, headers=adm).status_code == 403
    assert client.post(d, json={"note": "x"}, headers=sup).status_code == 422
    done = client.post(d, json={"note": "Invoice is correct as issued"}, headers=sup)
    assert done.status_code == 200 and done.json()["status"] == "DECLINED" and done.json()["resolved_by_name"] == "super"
    assert client.post(d, json={"note": "again please"}, headers=sup).status_code == 409
    # declined -> the branch can ask again
    assert client.post(url, json={"reason": "now with proof"}, headers=h).status_code == 201


def test_the_central_admin_changing_the_invoice_answers_the_request(client, people, prods):
    h, sup = people["til"]["h"], people["super"]["h"]
    inv = submitted(client, prods, h)
    assert client.post(f"{API}/invoices/{inv['id']}/edit-requests", json={"reason": "wrong quantity"}, headers=h).status_code == 201
    assert client.put(f"{API}/invoices/{inv['id']}", json=body(prods, 5, edit_reason="wrong quantity"), headers=sup).status_code == 200
    got = client.get(f"{API}/edit-requests", params={"invoice_id": inv["id"]}, headers=h).json()
    assert [(x["status"], x["resolved_by_name"]) for x in got] == [("DONE", "super")]


def test_edit_requests_are_audited(client, people, prods):
    h, sup = people["til"]["h"], people["super"]["h"]
    inv = submitted(client, prods, h)
    client.post(f"{API}/invoices/{inv['id']}/edit-requests", json={"reason": "audit me"}, headers=h)
    rows = client.get(f"{API}/audit-logs", params={"action": "edit_request."}, headers=sup).json()
    assert any(r["action"] == "edit_request.create" and r["metadata"]["invoice_number"] == inv["invoice_number"] for r in rows)


def test_purge_script_only_looks_unless_confirmed(client, people, prods, capsys, monkeypatch):
    """The test-data clean-up is a dry run by default and refuses to delete without the exact confirmation phrase."""
    from sqlalchemy import text

    from app import purge_test_data
    from app.db import engine

    submitted(client, prods, people["til"]["h"])
    count = lambda: engine.connect().execute(text("select count(*) from invoices")).scalar()  # noqa: E731
    before = count()
    monkeypatch.setattr("sys.argv", ["purge", "--before", "2099-01-01"])
    assert purge_test_data.main() == 0
    out = capsys.readouterr().out
    assert "dry run" in out and "Nothing was deleted" in out and count() == before
    monkeypatch.setattr("sys.argv", ["purge", "--before", "2099-01-01", "--delete"])        # no confirmation phrase
    with pytest.raises(SystemExit):
        purge_test_data.main()
    monkeypatch.setattr("sys.argv", ["purge", "--before", "not-a-date"])
    with pytest.raises(SystemExit):
        purge_test_data.main()
    assert count() == before
