"""The online store: catalogue with per-branch stock, e-mail-code sign-in, pick-up orders (guest and signed in),
the staff side (ready / picked up with payment / cancel), the clean-up job, and the isolation rules."""

import pytest
from sqlalchemy import text

from app import mailer
from app.config import settings
from app.db import engine

API = "/api/v1"
S = f"{API}/store"


@pytest.fixture(scope="module", autouse=True)
def store_open():
    with engine.begin() as c:
        before = c.execute(text("select status from events where invoice_prefix = 'NSW27'")).scalar()
        c.execute(text("update events set status = 'OPEN' where invoice_prefix = 'NSW27'"))
    saved = (settings.email_backend, settings.cron_secret)
    settings.email_backend, settings.cron_secret = "memory", "cron-secret-for-tests"
    yield
    settings.email_backend, settings.cron_secret = saved
    with engine.begin() as c:
        c.execute(text("delete from stock_transfers"))
        c.execute(text("delete from branch_stock"))
    with engine.begin() as c:
        c.execute(text("update events set status = :s where invoice_prefix = 'NSW27'"), {"s": before})


@pytest.fixture(scope="module")
def prods(client):
    return {p["name"]: p["id"] for p in client.get(f"{API}/products").json()}


def stock_for(client, people, prods, branch, name, qty):
    """Give a branch exactly `qty` units of a material left to sell (whatever it has already invoiced)."""
    h = people["super"]["h"]
    items = {i["name"]: i for i in client.get(f"{API}/stock", headers=h, params={"branch": branch}).json()["items"]}
    sold = items[name]["sold"] + items[name]["transferred_out"] - items[name]["transferred_in"]
    r = client.put(f"{API}/stock", headers=h, params={"branch": branch},
                   json={"items": [{"product_id": prods[name], "opening_qty": sold + qty, "low_threshold": 2}]})
    assert r.status_code == 200


def remaining(client, people, branch, name):
    items = client.get(f"{API}/stock", headers=people["super"]["h"], params={"branch": branch}).json()["items"]
    return next(i["remaining"] for i in items if i["name"] == name)


def order_body(prods, branch="TIL", lines=(("Coffee Mugs", 4),), email="shopper@example.com", **extra):
    return {"branch_code": branch, "items": [{"product_id": prods[n], "quantity": q} for n, q in lines],
            "name": "Meera Shopper", "email": email, "phone": "98 2200 1111", "payment_method": "PAY_AT_PICKUP", **extra}


def test_catalogue_shows_stock_per_branch(client, people, prods):
    stock_for(client, people, prods, "TIL", "Coffee Mugs", 10)
    stock_for(client, people, prods, "HAD", "Coffee Mugs", 0)
    cat = client.get(f"{S}/catalogue").json()
    assert cat["open"] and {b["code"] for b in cat["branches"]} == {"SBR", "TIL", "BHO", "HAD", "AHL"}
    badges = next(p for p in cat["products"] if p["name"] == "Coffee Mugs")
    assert badges["stock"]["TIL"] == 10 and badges["stock"]["HAD"] == 0
    assert badges["rate"] == "200.00" and badges["price_incl_gst"] == "236.00" and badges["gst_percent"] == "18.00"   # 200 x 1.18
    assert badges["category"] == "Gifts & Accessories" and badges["slug"] == "coffee-mugs"
    assert len(cat["products"]) == 39 and "T-Shirts" in cat["categories"]
    assert not any("password" in str(p).lower() for p in cat["products"])


def test_sign_in_with_an_emailed_code(client):
    mailer.OUTBOX.clear()
    assert client.post(f"{S}/auth/request-code", json={"email": "Asha.Customer@Example.com"}).json() == {"sent": True}
    code = mailer.OUTBOX[-1].subject.rsplit(": ", 1)[1]
    assert mailer.OUTBOX[-1].to == "asha.customer@example.com" and len(code) == 6
    wrong = "000000" if code != "000000" else "111111"
    assert client.post(f"{S}/auth/verify", json={"email": "asha.customer@example.com", "code": wrong}).status_code == 401
    ok = client.post(f"{S}/auth/verify", json={"email": "asha.customer@example.com", "code": code})
    assert ok.status_code == 200
    token = ok.json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    assert client.get(f"{S}/me", headers=h).json()["email"] == "asha.customer@example.com"
    assert client.put(f"{S}/me", headers=h, json={"name": "Asha", "phone": "9822001111"}).json()["name"] == "Asha"
    assert client.post(f"{S}/auth/verify", json={"email": "asha.customer@example.com", "code": code}).status_code == 401  # used once
    # a shopper token opens nothing on the staff side
    for url in (f"{API}/me", f"{API}/stock/overview", f"{API}/admin/users", f"{API}/store-orders"):
        assert client.get(url, headers=h).status_code == 401
    # too many wrong guesses burn the code
    client.post(f"{S}/auth/request-code", json={"email": "brute@example.com"})
    c2 = mailer.OUTBOX[-1].subject.rsplit(": ", 1)[1]
    bad = "123456" if c2 != "123456" else "654321"
    for _ in range(5):
        assert client.post(f"{S}/auth/verify", json={"email": "brute@example.com", "code": bad}).status_code == 401
    assert client.post(f"{S}/auth/verify", json={"email": "brute@example.com", "code": c2}).status_code == 401


def test_place_order_reserves_stock_emails_invoice_and_tracks(client, people, prods):
    stock_for(client, people, prods, "TIL", "Coffee Mugs", 10)
    mailer.OUTBOX.clear()
    r = client.post(f"{S}/orders", json=order_body(prods))
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["status"] == "PLACED" and o["payment_method"] == "PAY_AT_PICKUP" and o["payment_status"] == "UNPAID"
    assert o["number"].startswith("NSW27-TIL-") and o["branch"]["code"] == "TIL" and o["total"] == "944.00"   # 4 x 200 + 18% GST
    assert o["items"] == [{"name": "Coffee Mugs", "quantity": 4, "rate": "200.00", "amount": "944.00"}]
    assert remaining(client, people, "TIL", "Coffee Mugs") == 6                       # stock is held at once
    mail = mailer.OUTBOX[-1]
    assert mail.to == "shopper@example.com" and o["number"] in mail.subject and "Trade Tower" not in mail.text
    assert mail.attachments and mail.attachments[0][1].startswith(b"%PDF")        # the invoice is attached
    # the order is an ordinary invoice of the pick-up branch, so the branch sees it
    inv = client.get(f"{API}/invoices", headers=people["til"]["h"]).json()
    assert any(i["invoice_number"] == o["number"] and i["status"] in ("SUBMITTED", "GENERATED") for i in inv)

    t = o["access_token"]
    assert client.get(f"{S}/orders/{o['number']}", params={"t": t}).json()["number"] == o["number"]
    assert client.get(f"{S}/orders/{o['number']}", params={"email": "SHOPPER@example.com"}).status_code == 200
    assert client.get(f"{S}/orders/{o['number']}", params={"email": "someone@else.com"}).status_code == 404
    assert client.get(f"{S}/orders/{o['number']}").status_code == 404
    pdf = client.get(f"{S}/orders/{o['number']}/invoice", params={"t": t})
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")


def test_stock_is_checked_per_branch_and_cannot_be_oversold(client, people, prods):
    stock_for(client, people, prods, "TIL", "Coffee Mugs", 3)
    r = client.post(f"{S}/orders", json=order_body(prods, lines=(("Coffee Mugs", 4),)))
    assert r.status_code == 409 and r.json()["detail"]["short"] == [{"product_id": prods["Coffee Mugs"], "name": "Coffee Mugs", "available": 3}]
    assert client.post(f"{S}/orders", json=order_body(prods, branch="HAD")).status_code == 409           # that branch has none
    assert client.post(f"{S}/orders", json=order_body(prods, lines=(("Coffee Mugs", 3),), email="a@example.com")).status_code == 201
    assert client.post(f"{S}/orders", json=order_body(prods, lines=(("Coffee Mugs", 1),), email="b@example.com")).status_code == 409  # last unit gone
    assert remaining(client, people, "TIL", "Coffee Mugs") == 0
    # validation: unknown branch / payment / product, duplicate lines, silly quantities, online payment not yet open
    assert client.post(f"{S}/orders", json=order_body(prods, branch="XXX")).status_code == 422
    assert client.post(f"{S}/orders", json=order_body(prods, payment_method="ONLINE")).status_code == 409
    assert client.post(f"{S}/orders", json={**order_body(prods), "items": [{"product_id": prods["Coffee Mugs"], "quantity": 0}]}).status_code == 422
    assert client.post(f"{S}/orders", json={**order_body(prods), "items": [{"product_id": prods["Coffee Mugs"], "quantity": 1}] * 2}).status_code == 422
    assert client.post(f"{S}/orders", json={**order_body(prods), "price": "1"}).status_code == 422          # no client-side prices


def test_staff_prepare_hand_over_and_record_payment(client, people, prods):
    stock_for(client, people, prods, "TIL", "Caps", 20)
    stock_for(client, people, prods, "SBR", "Caps", 20)
    mailer.OUTBOX.clear()
    o = client.post(f"{S}/orders", json=order_body(prods, lines=(("Caps", 2),), email="pickup@example.com")).json()
    til, sbr, adm = people["til"]["h"], people["sbr"]["h"], people["super"]["h"]
    mine = client.get(f"{API}/store-orders", headers=til).json()
    row = next(x for x in mine if x["number"] == o["number"])
    assert row["customer"]["email"] == "pickup@example.com"
    assert all(x["branch"]["code"] == "TIL" for x in mine)                                                    # only their branch
    assert o["number"] not in [x["number"] for x in client.get(f"{API}/store-orders", headers=sbr).json()]    # another branch sees nothing
    assert client.post(f"{API}/store-orders/{row['id']}/ready", headers=sbr).status_code == 404
    assert client.get(f"{API}/store-orders", headers=til, params={"branch": "SBR"}).status_code == 403
    assert client.get(f"{API}/store-orders", params={"status": "OPEN"}).status_code == 401

    assert client.post(f"{API}/store-orders/{row['id']}/ready", headers=til).json()["status"] == "READY"
    assert "ready" in mailer.OUTBOX[-1].subject
    assert client.post(f"{API}/store-orders/{row['id']}/ready", headers=til).status_code == 409
    assert client.post(f"{API}/store-orders/{row['id']}/pickup", headers=til, json={}).status_code == 422   # must say how they paid
    done = client.post(f"{API}/store-orders/{row['id']}/pickup", headers=til, json={"payment_mode": "CASH"})
    assert done.status_code == 200 and (done.json()["status"], done.json()["payment_status"]) == ("PICKED_UP", "PAID")
    inv = next(i for i in client.get(f"{API}/invoices", headers=til).json() if i["invoice_number"] == o["number"])
    full = client.get(f"{API}/invoices/{inv['id']}", headers=til).json()
    assert full["version"] == 2 and full["payment_status"] == "PAID" and full["payments"][0]["mode"] == "CASH"
    assert client.post(f"{API}/store-orders/{row['id']}/pickup", headers=til, json={"payment_mode": "CASH"}).status_code == 409
    assert remaining(client, people, "TIL", "Caps") == 18                                                       # the goods left

    # cancelling: admins only; stock comes back
    o2 = client.post(f"{S}/orders", json=order_body(prods, lines=(("Caps", 5),), email="cancel@example.com")).json()
    r2 = next(x for x in client.get(f"{API}/store-orders", headers=til).json() if x["number"] == o2["number"])
    assert remaining(client, people, "TIL", "Caps") == 13
    assert client.post(f"{API}/store-orders/{r2['id']}/cancel", headers=til, json={"reason": "customer called"}).status_code == 403
    c = client.post(f"{API}/store-orders/{r2['id']}/cancel", headers=people["til_admin"]["h"], json={"reason": "customer called"})
    assert c.status_code == 200 and c.json()["status"] == "CANCELLED"
    assert remaining(client, people, "TIL", "Caps") == 18

    # the shopper can cancel their own unpaid order
    o3 = client.post(f"{S}/orders", json=order_body(prods, lines=(("Caps", 1),), email="own@example.com")).json()
    assert client.post(f"{S}/orders/{o3['number']}/cancel", params={"t": o3["access_token"]}).json()["status"] == "CANCELLED"
    assert client.post(f"{S}/orders/{o3['number']}/cancel", params={"t": o3["access_token"]}).status_code == 409
    assert remaining(client, people, "TIL", "Caps") == 18

    # central admin: online vs branch offices
    a = client.get(f"{API}/admin/store/analytics", headers=adm).json()
    til_row = next(b for b in a["branches"] if b["code"] == "TIL")
    assert til_row["online_orders"] >= 1 and a["totals"]["online_value"] > 0 and a["totals"]["online_share"] >= 0
    assert a["order_status"].get("PICKED_UP", 0) >= 1 and a["top_online_products"]
    assert client.get(f"{API}/admin/store/analytics", headers=til).status_code == 403
    # the database agrees: a branch cannot read or touch another branch's orders
    with engine.connect() as c:
        c.execute(text("select set_config('app.user_id', :u, true), set_config('app.role', 'BRANCH_USER', true), set_config('app.branch_id', "
                       "(select id::text from branches where code = 'SBR'), true)"), {"u": str(people["sbr"]["user_id"])})
        c.execute(text("set local role app_authenticated"))
        assert c.execute(text("select count(*) from orders where number like 'NSW27-TIL-%'")).scalar() == 0
        for table in ("customers", "login_codes"):
            with pytest.raises(Exception):
                c.execute(text(f"select count(*) from {table}"))
                c.rollback()


def test_uncollected_orders_are_released_by_the_scheduled_job(client, people, prods):
    stock_for(client, people, prods, "BHO", "Caps", 5)
    o = client.post(f"{S}/orders", json=order_body(prods, branch="BHO", lines=(("Caps", 5),), email="late@example.com")).json()
    assert remaining(client, people, "BHO", "Caps") == 0
    assert client.get(f"{S}/jobs/expire").status_code == 401
    assert client.get(f"{S}/jobs/expire", headers={"Authorization": "Bearer wrong"}).status_code == 401
    held = settings.pickup_hold_days
    settings.pickup_hold_days = 0
    try:
        r = client.get(f"{S}/jobs/expire", headers={"Authorization": "Bearer cron-secret-for-tests"})
    finally:
        settings.pickup_hold_days = held
    assert r.status_code == 200 and r.json()["released"] >= 1
    assert client.get(f"{S}/orders/{o['number']}", params={"t": o["access_token"]}).json()["status"] == "EXPIRED"
    assert remaining(client, people, "BHO", "Caps") == 5


def test_order_limits_per_email(client, people, prods):
    stock_for(client, people, prods, "AHL", "Flags - Handy", 50)
    for _ in range(5):
        assert client.post(f"{S}/orders", json=order_body(prods, branch="AHL", lines=(("Flags - Handy", 1),), email="many@example.com")).status_code == 201
    assert client.post(f"{S}/orders", json=order_body(prods, branch="AHL", lines=(("Flags - Handy", 1),), email="many@example.com")).status_code == 429


def test_store_is_closed_until_the_event_is_open(client, people, prods):
    with engine.begin() as c:
        c.execute(text("update events set status = 'PLANNING' where invoice_prefix = 'NSW27'"))
    try:
        assert client.get(f"{S}/catalogue").json()["open"] is False
        assert client.post(f"{S}/orders", json=order_body(prods)).status_code == 409
    finally:
        with engine.begin() as c:
            c.execute(text("update events set status = 'OPEN' where invoice_prefix = 'NSW27'"))
