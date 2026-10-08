"""Paying for an online order with Razorpay: confirming the payment (two independent ways), releasing unpaid orders,
and refunds.

Flow: the order is placed as PENDING_PAYMENT (its invoice already holds the stock, for PAY_WINDOW_MIN minutes), the
shopper pays in Razorpay's window, and then BOTH of these confirm it - whichever arrives first wins, the other is a no-op:
  1. the browser posts Razorpay's signed reply (POST /orders/{number}/pay/verify), and
  2. Razorpay posts its own signed message to us (POST /webhooks/razorpay).
Marking paid is idempotent and takes a row lock, so doing it twice - or both at once - records ONE payment.
"""

import json
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import documents, mailer, razorpay, services
from .config import settings
from .db import get_session
from .models import Invoice, InvoicePayment, Order
from .store import _order_for, _system_principal, cancel_order_row, order_out

log = logging.getLogger("store.pay")
router = APIRouter(prefix="/api/v1/store")
Sess = Annotated[Session, Depends(get_session)]

PAY_WINDOW_MIN = 30  # an unpaid online order holds its stock this long


def expire_unpaid(s: Session) -> int:
    """Release online orders whose payment was never completed (their stock goes back on the shelf)."""
    cutoff = datetime.now(UTC) - timedelta(minutes=PAY_WINDOW_MIN)
    rows = list(s.scalars(select(Order).where(Order.status == "PENDING_PAYMENT", Order.created_at < cutoff)))
    for o in rows:
        try:
            cancel_order_row(s, o, "Payment was not completed in time", "EXPIRED", notify=False)
        except Exception:
            s.rollback()
            log.exception("could not release unpaid order %s", o.number)
    return len(rows)


def payment_info(o: Order) -> dict | None:
    """What the browser needs to open Razorpay's window for an order that is still waiting for payment."""
    if o.status != "PENDING_PAYMENT" or not o.razorpay_order_id:
        return None
    return {"key_id": settings.razorpay_key_id, "razorpay_order_id": o.razorpay_order_id, "amount": razorpay.paise(o.total),
            "currency": "INR", "pay_until": (o.created_at + timedelta(minutes=PAY_WINDOW_MIN)).isoformat()}


def mark_paid(s: Session, order_id: uuid.UUID, payment_id: str) -> str:
    """Records a confirmed payment. Returns "paid" (done now), "already" (done before - nothing changed) or "refunded"
    (the order had already been released, so the money was sent straight back)."""
    o = s.execute(select(Order).where(Order.id == order_id).with_for_update()).scalar_one()
    s.refresh(o)
    if o.payment_status in ("PAID", "REFUNDED"):
        return "already"
    p = _system_principal(o.branch_id)
    inv: Invoice = s.get(Invoice, o.invoice_id)

    if o.status in ("CANCELLED", "EXPIRED"):  # paid too late: the goods were released, so give the money back
        try:
            r = razorpay.refund(payment_id, razorpay.paise(o.total), {"order": o.number, "reason": "order was released before payment arrived"})
            o.razorpay_refund_id = r.get("id")
        except razorpay.RazorpayError:
            log.exception("late payment %s for %s could not be refunded automatically", payment_id, o.number)
            raise
        o.payment_status, o.razorpay_payment_id, o.paid_at, o.updated_at = "REFUNDED", payment_id, datetime.now(UTC), datetime.now(UTC)
        s.commit()
        mailer.send(mailer.Mail(
            to=o.customer_email, subject=f"Order {o.number}: payment refunded",
            text=f"Hello {o.customer_name},\n\nYour payment for order {o.number} reached us after the order had been released, so it has been refunded "
                 f"in full (it can take a few working days to show in your account). You are welcome to order again: {settings.store_url}\n\nMCCIA"))
        return "refunded"

    inv.payments.append(InvoicePayment(id=uuid.uuid4(), mode="RAZORPAY", amount=inv.grand_total, reference=payment_id, line_order=1))
    inv.version, inv.status = inv.version + 1, "EDITED"
    s.flush()
    s.refresh(inv)
    services._snapshot(s, p, inv, "Paid online (Razorpay)")
    services._audit(s, p, inv, "invoice.revise", reason="Paid online (Razorpay)", new_total=str(inv.grand_total))
    now = datetime.now(UTC)
    o.payment_status, o.razorpay_payment_id, o.paid_at, o.updated_at = "PAID", payment_id, now, now
    if o.status == "PENDING_PAYMENT":
        o.status = "PLACED"
    services._audit(s, p, inv, "order.paid", order=o.number, payment=payment_id)
    s.commit()
    _email_paid(s, o, p)
    return "paid"


def _email_paid(s: Session, o: Order, p) -> None:
    attachments = []
    try:
        data, name = documents.read_document(s, p, o.invoice_id, None)
        attachments = [(name, data, "application/pdf")]
    except Exception:
        log.exception("could not attach the invoice to the payment e-mail for %s", o.number)
    from .models import Branch  # local: avoids a wider import at module load

    b = s.get(Branch, o.branch_id)
    mailer.send(mailer.Mail(
        to=o.customer_email, subject=f"Payment received - order {o.number}",
        text=(f"Hello {o.customer_name},\n\nThank you - we have received your payment of Rs. {o.total} for order {o.number}.\n\n"
              f"Pick-up branch: {b.name}\n{b.address}\n{('Phone: ' + b.phone) if b.phone else ''}\n\n"
              f"There is nothing more to pay. We will e-mail you when your order is packed and ready; just show your invoice (attached) at the branch.\n\n"
              f"Track your order: {settings.store_url}/order/{o.number}\n\nMCCIA"),
        attachments=attachments))


def _confirm_with_razorpay(o: Order, payment_id: str) -> None:
    """Never trust a payment id alone: ask Razorpay what it really is (right order, right amount, captured)."""
    try:
        pay = razorpay.fetch_payment(payment_id)
        if pay.get("status") == "authorized":  # accounts that do not auto-capture
            pay = razorpay.capture(payment_id, razorpay.paise(o.total))
    except razorpay.RazorpayError as e:
        raise HTTPException(502, "We could not confirm the payment with Razorpay just now. If money was taken it will be matched shortly.") from e
    if pay.get("order_id") != o.razorpay_order_id or int(pay.get("amount", -1)) != razorpay.paise(o.total) or pay.get("status") != "captured":
        raise HTTPException(400, "This payment does not match the order")


class VerifyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    razorpay_order_id: str = Field(min_length=5, max_length=40)
    razorpay_payment_id: str = Field(min_length=5, max_length=40)
    razorpay_signature: str = Field(min_length=10, max_length=200)


@router.post("/orders/{number}/pay/verify")
def verify_payment(number: str, body: VerifyIn, s: Sess, authorization: Annotated[str | None, Header()] = None,
                   t: Annotated[str | None, Query(max_length=1000)] = None, email: Annotated[str | None, Query(max_length=320)] = None):
    """1 of 2 confirmations: the browser hands over what Razorpay signed after the shopper paid."""
    o = _order_for(s, number, authorization, t, email)
    if not o.razorpay_order_id or body.razorpay_order_id != o.razorpay_order_id:
        raise HTTPException(400, "This payment does not belong to this order")
    if not razorpay.verify_signature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature):
        raise HTTPException(400, "The payment could not be verified")
    if o.payment_status != "PAID":
        _confirm_with_razorpay(o, body.razorpay_payment_id)
        try:
            mark_paid(s, o.id, body.razorpay_payment_id)
        except razorpay.RazorpayError as e:
            raise HTTPException(502, "Your payment arrived after the order was released and we could not refund it automatically - please contact MCCIA.") from e
    s.refresh(o)
    return order_out(s, o)


@router.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request, s: Sess, x_razorpay_signature: Annotated[str | None, Header()] = None):
    """2 of 2 confirmations: Razorpay tells us itself, signed with the webhook secret (covers a shopper who closes the tab after paying)."""
    raw = await request.body()
    if not razorpay.verify_webhook(raw, x_razorpay_signature or ""):
        raise HTTPException(400, "Bad signature")
    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "Bad body") from None
    kind = event.get("event", "")
    if kind in ("payment.captured", "order.paid"):
        pay = (event.get("payload", {}).get("payment") or {}).get("entity") or {}
        order_id, payment_id = pay.get("order_id"), pay.get("id")
        o = s.scalar(select(Order).where(Order.razorpay_order_id == order_id)) if order_id else None
        if o is not None and payment_id and pay.get("status") == "captured" and int(pay.get("amount", -1)) == razorpay.paise(o.total):
            try:
                mark_paid(s, o.id, payment_id)
            except Exception:
                s.rollback()
                log.exception("webhook could not record payment %s for %s", payment_id, o.number)
                raise HTTPException(500, "Could not record the payment") from None  # Razorpay will retry
    return {"ok": True}
