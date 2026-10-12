"""Taking a payment at the branch counter through Razorpay.

Staff choose "Razorpay UPI" (the only alternative to cash). The screen asks the server for a Razorpay order for the exact
amount and opens Razorpay's own payment window (the same one the online store uses: the customer pays by UPI / card there).
The server then checks Razorpay's signature and asks Razorpay itself whether the money arrived. The invoice can then only record that
payment if Razorpay itself says the money arrived (right amount, captured) and the payment has not been used before -
staff cannot type a made-up reference.
"""

import re
import time
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import razorpay, services
from .config import settings
from .auth import Principal, current_principal
from .db import SessionLocal, get_session
from .models import Invoice, InvoicePayment

router = APIRouter(prefix="/api/v1/payments")
Sess = Annotated[Session, Depends(get_session)]
Me = Annotated[Principal, Depends(current_principal)]
QR_MINUTES = 30


def verify_reference(s: Session, reference: str, amount: Decimal, exclude_invoice=None) -> None:
    """Raises services.Invalid unless `reference` is a real, captured Razorpay payment of exactly `amount` that no other invoice uses.
    Does nothing when Razorpay is not set up on this server (development, tests)."""
    if not razorpay.enabled():
        return
    ref = (reference or "").strip()
    if not re.fullmatch(r"pay_\w{5,}", ref):
        raise services.Invalid("Razorpay payment: show the customer the Razorpay QR and wait for 'Paid' before submitting")
    try:
        pay = razorpay.fetch_payment(ref)
    except razorpay.RazorpayError:
        raise services.Invalid("That Razorpay payment could not be found. Please collect it with the Razorpay QR.") from None
    if pay.get("status") != "captured":
        raise services.Invalid("That Razorpay payment has not been completed")
    if int(pay.get("amount", -1)) != razorpay.paise(amount):
        raise services.Invalid(f"That Razorpay payment is Rs. {Decimal(pay.get('amount', 0)) / 100:.2f}, but this payment is Rs. {amount:.2f}")
    # a draft that merely mentions the payment does not use it up; a submitted (or later cancelled) invoice does
    stmt = (select(func.count()).select_from(InvoicePayment).join(Invoice, Invoice.id == InvoicePayment.invoice_id)
            .where(InvoicePayment.reference == ref, Invoice.status != "DRAFT"))
    if exclude_invoice is not None:
        stmt = stmt.where(InvoicePayment.invoice_id != exclude_invoice)
    with SessionLocal() as everyone:  # a branch's own session cannot see other branches' invoices, but a payment can only be used once overall
        used = everyone.scalar(stmt)
    if used:
        raise services.Invalid("That Razorpay payment is already recorded on another invoice")


@router.get("/config")
def config(p: Me):
    # test keys make QR codes that no UPI app can pay (Razorpay only lets live-mode QR codes be scanned): the screen warns about it
    return {"razorpay": razorpay.enabled(), "test_mode": razorpay.enabled() and settings.razorpay_key_id.startswith("rzp_test_")}


class QrIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount: Decimal = Field(gt=0, le=1_000_000, max_digits=10, decimal_places=2)
    note: str = Field(default="", max_length=100)


def _branch_code(s: Session, p: Principal) -> str:
    from . import repositories as repo

    return "ALL" if p.is_super else s.get(repo.Branch, p.branch_id).code


class CounterOrderIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount: Decimal = Field(gt=0, le=1_000_000, max_digits=10, decimal_places=2)
    note: str = Field(default="", max_length=100)


@router.post("/counter-order")
def create_counter_order(body: CounterOrderIn, s: Sess, p: Me):
    """A Razorpay order for exactly this amount; the screen opens Razorpay's payment window with it."""
    if not razorpay.enabled():
        raise HTTPException(409, "Razorpay is not set up on this server")
    code = _branch_code(s, p)
    try:
        order = razorpay.create_order(razorpay.paise(body.amount), f"CTR-{code}-{int(time.time())}",
                                      {"branch": code, "by": p.name[:40], "kind": "counter", "note": body.note.strip()[:100]})
    except razorpay.RazorpayError as e:
        raise HTTPException(502, f"Razorpay could not start the payment ({e})") from None
    return {"order_id": order["id"], "key_id": settings.razorpay_key_id, "amount": razorpay.paise(body.amount), "currency": "INR"}


class CounterVerifyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    razorpay_order_id: str = Field(min_length=5, max_length=40)
    razorpay_payment_id: str = Field(min_length=5, max_length=40)
    razorpay_signature: str = Field(min_length=10, max_length=200)


@router.post("/counter-order/verify")
def verify_counter_order(body: CounterVerifyIn, s: Sess, p: Me):
    """After the customer pays in Razorpay's window: check its signature, then ask Razorpay whether this exact order was paid."""
    if not razorpay.verify_signature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature):
        raise HTTPException(400, "The payment could not be verified")
    try:
        order = razorpay.fetch_order(body.razorpay_order_id)
        notes = order.get("notes") or {}
        if notes.get("kind") != "counter" or (not p.is_super and notes.get("branch") != _branch_code(s, p)):
            raise HTTPException(404, "Payment not found")
        pay = razorpay.fetch_payment(body.razorpay_payment_id)
        if pay.get("status") == "authorized":  # accounts that do not auto-capture
            pay = razorpay.capture(body.razorpay_payment_id, int(order["amount"]))
    except razorpay.RazorpayError as e:
        raise HTTPException(502, f"Could not confirm the payment with Razorpay ({e})") from None
    if pay.get("order_id") != body.razorpay_order_id or int(pay.get("amount", -1)) != int(order["amount"]) or pay.get("status") != "captured":
        raise HTTPException(400, "This payment does not match the order")
    return {"status": "paid", "payment_id": pay["id"], "amount": f"{Decimal(pay['amount']) / 100:.2f}"}


@router.post("/razorpay-qr")
def create_qr(body: QrIn, s: Sess, p: Me):
    if not razorpay.enabled():
        raise HTTPException(409, "Razorpay is not set up on this server")
    code = _branch_code(s, p)
    try:
        qr = razorpay.create_qr(razorpay.paise(body.amount), f"MCCIA {code}", body.note.strip() or "Counter payment",
                                {"branch": code, "by": p.name[:40], "kind": "counter"}, int(time.time()) + QR_MINUTES * 60)
    except razorpay.RazorpayError as e:
        raise HTTPException(502, f"Razorpay could not create the QR ({e})") from None
    return {"id": qr["id"], "image_url": qr.get("image_url"), "amount": f"{body.amount:.2f}", "expires_at": datetime.fromtimestamp(qr.get("close_by", 0), UTC).isoformat() if qr.get("close_by") else None}


@router.get("/razorpay-qr/{qr_id}")
def qr_status(qr_id: str, s: Sess, p: Me):
    """waiting / paid (with the Razorpay payment id) / closed. A QR is only visible to the branch that made it (and the central admin)."""
    if not re.fullmatch(r"qr_\w{5,}", qr_id):
        raise HTTPException(404, "QR not found")
    try:
        qr = razorpay.fetch_qr(qr_id)
        mine = (qr.get("notes") or {}).get("branch")
        if not p.is_super and mine != _branch_code(s, p):
            raise HTTPException(404, "QR not found")
        paid = [x for x in razorpay.qr_payments(qr_id) if x.get("status") == "captured" and int(x.get("amount", -1)) == int(qr.get("payment_amount", -2))]
    except razorpay.RazorpayError as e:
        raise HTTPException(502, f"Could not ask Razorpay ({e})") from None
    if paid:
        return {"status": "paid", "payment_id": paid[0]["id"], "amount": f"{Decimal(paid[0]['amount']) / 100:.2f}"}
    return {"status": "closed" if qr.get("status") == "closed" else "waiting"}
