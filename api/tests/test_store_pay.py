"""Paying online with Razorpay: order -> pay -> two independent confirmations, expiry, late payment, refunds.
Razorpay's servers are replaced by a small stand-in; the signatures are computed exactly as Razorpay does."""

import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app import mailer, razorpay
from app.config import settings
from app.db import engine
from tests.test_store import API, S, order_body, remaining, stock_for

KEY, SECRET, HOOK = "rzp_test_unit", "unit-test-key-secret", "unit-test-webhook-secret"
POSTER = "Posters 5-S"  # rate 130 + 18% GST: 2 of them = 306.80 -> Rs 307.00 = 30700 paise


class FakeRazorpay:
    def __init__(self):
        self.orders, self.payments, self.refunds = {}, {}, []

    def create_order(self, amount_paise, receipt, notes=None):
        oid = f"order_T{len(self.orders):04d}"
        self.orders[oid] = {"amount": amount_paise, "receipt": receipt}
        return {"id": oid, "amount": amount_paise}

    def pay(self, oid, status="captured", amount=None):
        pid = f"pay_T{len(self.payments):04d}"
        self.payments[pid] = {"id": pid, "order_id": oid, "status": status, "amount": amount or self.orders[oid]["amount"]}
        return pid

    def fetch_payment(self, pid):
        return self.payments[pid]

    def capture(self, pid, amount):
        self.payments[pid]["status"] = "captured"
        return self.payments[pid]

    def refund(self, pid, amount, notes=None):
        self.refunds.append((pid, amount))
        return {"id": f"rfnd_{len(self.refunds)}"}


@pytest.fixture(scope="module")
def rz():
    fake = FakeRazorpay()
    saved = (settings.razorpay_key_id, settings.razorpay_key_secret, settings.razorpay_webhook_secret, settings.email_backend)
    settings.razorpay_key_id, settings.razorpay_key_secret, settings.razorpay_webhook_secret, settings.email_backend = KEY, SECRET, HOOK, "memory"
    mp = pytest.MonkeyPatch()
    for name in ("create_order", "fetch_payment", "capture", "refund"):
        mp.setattr(razorpay, name, getattr(fake, name))
    with engine.begin() as c:
        before = c.execute(text("select status from events where invoice_prefix = 'NSW27'")).scalar()
        c.execute(text("update events set status = 'OPEN' where invoice_prefix = 'NSW27'"))
    yield fake
    mp.undo()
    settings.razorpay_key_id, settings.razorpay_key_secret, settings.razorpay_webhook_secret, settings.email_backend = saved
    with engine.begin() as c:
        c.execute(text("update events set status = :s where invoice_prefix = 'NSW27'"), {"s": before})
        c.execute(text("delete from stock_transfers"))
        c.execute(text("delete from branch_stock"))


@pytest.fixture(scope="module")
def prods(client):
    return {p["name"]: p["id"] for p in client.get(f"{API}/products").json()}


def sig(order_id, payment_id):
    return hmac.new(SECRET.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()


def hook(client, event, order_id, payment_id, amount, status="captured", bad=False):
    body = json.dumps({"event": event, "payload": {"payment": {"entity": {"id": payment_id, "order_id": order_id, "amount": amount, "status": status}}}}).encode()
    good = hmac.new(HOOK.encode(), body, hashlib.sha256).hexdigest()
    return client.post(f"{S}/webhooks/razorpay", content=body, headers={"X-Razorpay-Signature": "0" * 64 if bad else good, "Content-Type": "application/json"})


def place(client, prods, qty=2, email="payer@example.com", branch="TIL"):
    r = client.post(f"{S}/orders", json=order_body(prods, branch=branch, lines=((POSTER, qty),), email=email, payment_method="ONLINE"))
    assert r.status_code == 201, r.text
    return r.json()


def test_online_order_is_held_unpaid_then_paid_by_the_browser_reply(client, people, prods, rz):
    stock_for(client, people, prods, "TIL", POSTER, 10)
    mailer.OUTBOX.clear()
    o = place(client, prods)
    assert (o["status"], o["payment_method"], o["payment_status"]) == ("PENDING_PAYMENT", "ONLINE", "UNPAID")
    assert o["payment"]["key_id"] == KEY and o["payment"]["amount"] == 30700 and o["payment"]["currency"] == "INR"
    assert remaining(client, people, "TIL", POSTER) == 8                                                    # the stock is held while they pay
    assert not mailer.OUTBOX                                                                                 # nothing is e-mailed until it is paid
    # the branch does not see it as work to do yet
    assert o["number"] not in [x["number"] for x in client.get(f"{API}/store-orders", headers=people["til"]["h"], params={"status": "OPEN"}).json()]
    assert o["number"] in [x["number"] for x in client.get(f"{API}/store-orders", headers=people["til"]["h"], params={"status": "PENDING_PAYMENT"}).json()]

    rid, t = o["payment"]["razorpay_order_id"], o["access_token"]
    pid = rz.pay(rid)
    verify = lambda **kw: client.post(f"{S}/orders/{o['number']}/pay/verify", params={"t": t},
                                      json={"razorpay_order_id": rid, "razorpay_payment_id": pid, "razorpay_signature": sig(rid, pid), **kw})
    assert verify(razorpay_signature="f" * 64).status_code == 400                                           # forged signature
    assert verify(razorpay_order_id="order_other_one").status_code == 400                                   # a different order
    assert client.post(f"{S}/orders/{o['number']}/pay/verify", json={"razorpay_order_id": rid, "razorpay_payment_id": pid, "razorpay_signature": sig(rid, pid)}).status_code == 404   # no access
    ok = verify()
    assert ok.status_code == 200 and (ok.json()["status"], ok.json()["payment_status"]) == ("PLACED", "PAID")
    assert verify().status_code == 200                                                                      # doing it again changes nothing
    mail = mailer.OUTBOX[-1]
    assert "Payment received" in mail.subject and mail.attachments and mail.attachments[0][1].startswith(b"%PDF")
    assert len([m for m in mailer.OUTBOX if "Payment received" in m.subject]) == 1

    inv = next(i for i in client.get(f"{API}/invoices", headers=people["til"]["h"]).json() if i["invoice_number"] == o["number"])
    full = client.get(f"{API}/invoices/{inv['id']}", headers=people["til"]["h"]).json()
    assert full["version"] == 2 and full["payment_status"] == "PAID" and [(p["mode"], p["reference"]) for p in full["payments"]] == [("RAZORPAY", pid)]
    assert o["number"] in [x["number"] for x in client.get(f"{API}/store-orders", headers=people["til"]["h"], params={"status": "OPEN"}).json()]   # now it is work to do


def test_webhook_confirms_when_the_shopper_closes_the_tab(client, people, prods, rz):
    stock_for(client, people, prods, "TIL", POSTER, 10)
    o = place(client, prods, email="closed.tab@example.com")
    rid = o["payment"]["razorpay_order_id"]
    pid = rz.pay(rid)
    amount = o["payment"]["amount"]
    assert hook(client, "payment.captured", rid, pid, amount, bad=True).status_code == 400                   # not from Razorpay
    assert hook(client, "payment.captured", rid, pid, amount + 100).status_code == 200                        # wrong amount: ignored
    assert client.get(f"{S}/orders/{o['number']}", params={"t": o["access_token"]}).json()["payment_status"] == "UNPAID"
    assert hook(client, "payment.captured", rid, pid, amount).status_code == 200
    assert hook(client, "order.paid", rid, pid, amount).status_code == 200                                    # Razorpay often sends several events
    got = client.get(f"{S}/orders/{o['number']}", params={"t": o["access_token"]}).json()
    assert (got["status"], got["payment_status"]) == ("PLACED", "PAID") and got["payment"] is None
    with engine.connect() as c:
        assert c.execute(text("select count(*) from invoice_payments p join invoices i on i.id = p.invoice_id where i.invoice_number = :n"), {"n": o["number"]}).scalar() == 1
    # the browser reply arriving after the webhook is a harmless repeat
    r = client.post(f"{S}/orders/{o['number']}/pay/verify", params={"t": o["access_token"]}, json={"razorpay_order_id": rid, "razorpay_payment_id": pid, "razorpay_signature": sig(rid, pid)})
    assert r.status_code == 200 and r.json()["payment_status"] == "PAID"


def test_unpaid_orders_are_released_and_a_late_payment_is_refunded(client, people, prods, rz):
    stock_for(client, people, prods, "TIL", POSTER, 10)
    o = place(client, prods, qty=3, email="slow@example.com")
    assert remaining(client, people, "TIL", POSTER) == 7
    with engine.begin() as c:
        c.execute(text("update orders set created_at = :t where number = :n"), {"t": datetime.now(UTC) - timedelta(minutes=45), "n": o["number"]})
    got = client.get(f"{S}/orders/{o['number']}", params={"t": o["access_token"]}).json()                   # any store request releases it
    assert got["status"] == "EXPIRED" and remaining(client, people, "TIL", POSTER) == 10
    # the money arrives anyway: it goes straight back
    rid = o["payment"]["razorpay_order_id"]
    pid = rz.pay(rid)
    assert hook(client, "payment.captured", rid, pid, o["payment"]["amount"]).status_code == 200
    assert (pid, o["payment"]["amount"]) in rz.refunds
    after = client.get(f"{S}/orders/{o['number']}", params={"t": o["access_token"]}).json()
    assert (after["status"], after["payment_status"]) == ("EXPIRED", "REFUNDED")
    assert remaining(client, people, "TIL", POSTER) == 10


def test_cancelling_a_paid_online_order_refunds_it(client, people, prods, rz):
    stock_for(client, people, prods, "TIL", POSTER, 10)
    o = place(client, prods, qty=4, email="refund@example.com")
    rid = o["payment"]["razorpay_order_id"]
    pid = rz.pay(rid)
    assert hook(client, "payment.captured", rid, pid, o["payment"]["amount"]).status_code == 200
    assert remaining(client, people, "TIL", POSTER) == 6
    row = next(x for x in client.get(f"{API}/store-orders", headers=people["til"]["h"]).json() if x["number"] == o["number"])
    assert row["razorpay_payment_id"] == pid
    assert client.post(f"{S}/orders/{o['number']}/cancel", params={"t": o["access_token"]}).status_code == 409   # the shopper cannot cancel a paid order
    assert client.post(f"{API}/store-orders/{row['id']}/cancel", headers=people["til"]["h"], json={"reason": "customer asked"}).status_code == 403
    done = client.post(f"{API}/store-orders/{row['id']}/cancel", headers=people["til_admin"]["h"], json={"reason": "customer asked"})
    assert done.status_code == 200 and (done.json()["status"], done.json()["payment_status"]) == ("CANCELLED", "REFUNDED")
    assert (pid, o["payment"]["amount"]) in rz.refunds
    assert remaining(client, people, "TIL", POSTER) == 10
    assert any("refund" in m.subject.lower() for m in mailer.OUTBOX)


def test_online_payment_needs_keys_and_pay_at_pickup_still_works(client, people, prods, rz):
    stock_for(client, people, prods, "TIL", POSTER, 10)
    assert client.get(f"{S}/catalogue").json()["online_payments"] is True
    settings.razorpay_key_id = ""
    try:
        assert client.get(f"{S}/catalogue").json()["online_payments"] is False
        assert client.post(f"{S}/orders", json=order_body(prods, lines=((POSTER, 1),), payment_method="ONLINE")).status_code == 409
    finally:
        settings.razorpay_key_id = KEY
    cash = client.post(f"{S}/orders", json=order_body(prods, lines=((POSTER, 1),), email="cash@example.com"))
    assert cash.status_code == 201 and cash.json()["status"] == "PLACED" and cash.json()["payment"] is None


def test_unpaid_online_orders_are_not_counted_as_sales(client, people, prods, rz):
    stock_for(client, people, prods, "TIL", POSTER, 10)
    before = client.get(f"{API}/admin/store/analytics", headers=people["super"]["h"]).json()["totals"]
    o = place(client, prods, email="unpaid@example.com")
    mid = client.get(f"{API}/admin/store/analytics", headers=people["super"]["h"]).json()["totals"]
    assert mid["online_orders"] == before["online_orders"] and mid["office_value"] == before["office_value"]
    rid = o["payment"]["razorpay_order_id"]
    assert hook(client, "payment.captured", rid, rz.pay(rid), o["payment"]["amount"]).status_code == 200
    after = client.get(f"{API}/admin/store/analytics", headers=people["super"]["h"]).json()["totals"]
    assert after["online_orders"] == before["online_orders"] + 1
