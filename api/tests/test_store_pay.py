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
        self.orders, self.payments, self.refunds, self.qrs, self.qr_paid = {}, {}, [], {}, {}

    def create_order(self, amount_paise, receipt, notes=None):
        oid = f"order_T{len(self.orders):04d}"
        self.orders[oid] = {"amount": amount_paise, "receipt": receipt}
        return {"id": oid, "amount": amount_paise}

    def pay(self, oid, status="captured", amount=None):
        pid = f"pay_T{len(self.payments):04d}"
        self.payments[pid] = {"id": pid, "order_id": oid, "status": status, "amount": amount or self.orders[oid]["amount"]}
        return pid

    def fetch_payment(self, pid):
        if pid not in self.payments:
            raise razorpay.RazorpayError("The id provided does not exist")
        return self.payments[pid]

    def create_qr(self, amount_paise, name, description, notes=None, close_by=None):
        qid = f"qr_T{len(self.qrs):04d}"
        self.qrs[qid] = {"id": qid, "image_url": f"https://rzp.io/{qid}", "payment_amount": amount_paise, "status": "active", "notes": notes or {}, "close_by": close_by}
        self.qr_paid[qid] = []
        return self.qrs[qid]

    def fetch_qr(self, qid):
        return self.qrs[qid]

    def qr_payments(self, qid):
        return self.qr_paid[qid]

    def scan_and_pay(self, qid, amount=None):
        pid = f"pay_Q{len(self.payments):04d}"
        pay = {"id": pid, "order_id": None, "status": "captured", "amount": amount or self.qrs[qid]["payment_amount"]}
        self.payments[pid] = pay
        self.qr_paid[qid].append(pay)
        return pid

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
    for name in ("create_order", "fetch_payment", "capture", "refund", "create_qr", "fetch_qr", "qr_payments"):
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


# ---------------------------------------------------------------- counter payments (staff: cash or Razorpay UPI)
def staff_invoice(client, people, prods, who, qty, **extra):
    return client.post(f"{API}/invoices", headers=people[who]["h"], json={
        "company_name": "Counter Co", "invoice_date": "2027-03-03", "action": "submit",
        "items": [{"product_id": prods["Slogans - 10 x 15"], "quantity": qty}], **extra})


def test_counter_qr_is_created_for_the_exact_amount_and_reports_paid(client, people, prods, rz):
    h = people["til"]["h"]
    assert client.get(f"{API}/payments/config", headers=h).json()["razorpay"] is True
    r = client.post(f"{API}/payments/razorpay-qr", headers=h, json={"amount": "94.40", "note": "Counter Co"})
    assert r.status_code == 200
    qr = r.json()
    assert qr["amount"] == "94.40" and qr["image_url"].startswith("https://rzp.io/") and rz.qrs[qr["id"]]["payment_amount"] == 9440
    assert rz.qrs[qr["id"]]["notes"]["branch"] == "TIL"
    assert client.get(f"{API}/payments/razorpay-qr/{qr['id']}", headers=h).json() == {"status": "waiting"}
    pid = rz.scan_and_pay(qr["id"])
    got = client.get(f"{API}/payments/razorpay-qr/{qr['id']}", headers=h).json()
    assert got == {"status": "paid", "payment_id": pid, "amount": "94.40"}
    # another branch cannot look at this QR; the central admin can; nobody unauthenticated
    assert client.get(f"{API}/payments/razorpay-qr/{qr['id']}", headers=people["sbr"]["h"]).status_code == 404
    assert client.get(f"{API}/payments/razorpay-qr/{qr['id']}", headers=people["super"]["h"]).status_code == 200
    assert client.get(f"{API}/payments/razorpay-qr/{qr['id']}").status_code == 401
    assert client.post(f"{API}/payments/razorpay-qr", headers=h, json={"amount": "0"}).status_code == 422
    assert client.post(f"{API}/payments/razorpay-qr", headers=h, json={"amount": "5000000"}).status_code == 422
    assert client.get(f"{API}/payments/razorpay-qr/not-a-qr", headers=h).status_code == 404
    assert client.get(f"{API}/payments/razorpay-qr/{rz.create_qr(100, 'x', 'y')['id']}", headers=h).status_code == 404   # a QR with no branch note is nobody's


def test_a_razorpay_payment_on_an_invoice_must_be_real(client, people, prods, rz):
    h = people["til"]["h"]
    # Slogans - 10 x 15: rate 80 + 18% = 94.40 -> Rs 94.00 payable
    qr = client.post(f"{API}/payments/razorpay-qr", headers=h, json={"amount": "94.00"}).json()
    pid = rz.scan_and_pay(qr["id"])
    pay = lambda ref, amt="94.00": [{"mode": "RAZORPAY", "amount": amt, "reference": ref}]
    assert staff_invoice(client, people, prods, "til", 1, payments=pay("")).status_code == 422                 # no payment id: not accepted
    assert staff_invoice(client, people, prods, "til", 1, payments=pay("made-up")).status_code == 422
    assert staff_invoice(client, people, prods, "til", 1, payments=pay("pay_DoesNotExist")).status_code == 422   # Razorpay has never heard of it
    rz.payments["pay_Short1"] = {"id": "pay_Short1", "order_id": None, "status": "captured", "amount": 5000}
    assert staff_invoice(client, people, prods, "til", 1, payments=pay("pay_Short1")).status_code == 422       # Rs 50 was paid, not Rs 94
    rz.payments["pay_Fail1"] = {"id": "pay_Fail1", "order_id": None, "status": "failed", "amount": 9400}
    assert staff_invoice(client, people, prods, "til", 1, payments=pay("pay_Fail1")).status_code == 422        # not completed
    assert staff_invoice(client, people, prods, "til", 1, payments=pay(pid), action="draft").status_code == 201  # a draft is only a note
    ok = staff_invoice(client, people, prods, "til", 1, payments=pay(pid))
    assert ok.status_code == 201 and ok.json()["payments"][0]["reference"] == pid and ok.json()["payment_status"] == "PAID"
    again = staff_invoice(client, people, prods, "sbr", 1, payments=pay(pid))                                    # the same money cannot pay two invoices
    assert again.status_code == 422 and "already recorded" in again.json()["detail"]
    # revising the invoice keeps its own payment without asking Razorpay again for a new one
    inv = ok.json()
    rev = client.put(f"{API}/invoices/{inv['id']}", headers=people["super"]["h"], json={"company_name": "Counter Co", "invoice_date": "2027-03-03", "action": "submit", "edit_reason": "name",
                                                                      "items": [{"product_id": prods["Slogans - 10 x 15"], "quantity": 1}], "payments": pay(pid)})
    assert rev.status_code == 200
    # cash is never checked with Razorpay
    cash = staff_invoice(client, people, prods, "til", 1, payments=[{"mode": "CASH", "amount": "94.00", "reference": ""}])
    assert cash.status_code == 201


def test_branch_handover_with_razorpay_needs_the_real_payment(client, people, prods, rz):
    stock_for(client, people, prods, "TIL", POSTER, 10)
    o = client.post(f"{S}/orders", json=order_body(prods, lines=((POSTER, 1),), email="counter@example.com")).json()          # pay at pick-up
    row = next(x for x in client.get(f"{API}/store-orders", headers=people["til"]["h"]).json() if x["number"] == o["number"])
    url = f"{API}/store-orders/{row['id']}/pickup"
    assert client.post(url, headers=people["til"]["h"], json={"payment_mode": "RAZORPAY"}).status_code == 422
    assert client.post(url, headers=people["til"]["h"], json={"payment_mode": "RAZORPAY", "reference": "pay_Nope123"}).status_code == 422
    qr = client.post(f"{API}/payments/razorpay-qr", headers=people["til"]["h"], json={"amount": o["total"]}).json()
    pid = rz.scan_and_pay(qr["id"])
    done = client.post(url, headers=people["til"]["h"], json={"payment_mode": "RAZORPAY", "reference": pid})
    assert done.status_code == 200 and (done.json()["status"], done.json()["payment_status"]) == ("PICKED_UP", "PAID")
