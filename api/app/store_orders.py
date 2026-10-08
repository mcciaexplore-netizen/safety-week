"""Staff side of the online store: the branch (or the central admin) prepares and hands over pick-up orders,
and the central admin compares online sales with the branch offices.

Runs as the signed-in staff member under row level security: a branch sees only the orders to be collected from it,
the central admin sees all of them.
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from . import mailer, razorpay, services
from . import repositories as repo
from .admin import COUNTED
from .auth import Principal, current_principal
from .config import settings
from .db import get_session
from .models import Branch, Invoice, InvoicePayment, Order
from .store import cancel_order_row, order_out

router = APIRouter(prefix="/api/v1/store-orders")
Sess = Annotated[Session, Depends(get_session)]
Me = Annotated[Principal, Depends(current_principal)]


def _order(s: Session, p: Principal, order_id: uuid.UUID) -> Order:
    o = s.get(Order, order_id)  # row level security already hides other branches' orders
    if o is None:
        raise HTTPException(404, "Order not found")
    return o


def _row(s: Session, o: Order) -> dict:
    d = order_out(s, o)
    d["id"] = str(o.id)
    d["razorpay_payment_id"] = o.razorpay_payment_id
    return d


@router.get("")
def list_orders(s: Sess, p: Me, status: Annotated[str | None, Query(pattern="^(PENDING_PAYMENT|PLACED|READY|PICKED_UP|CANCELLED|EXPIRED|OPEN)$")] = None,
                branch: str | None = None, limit: Annotated[int, Query(ge=1, le=500)] = 200):
    stmt = select(Order).order_by(Order.created_at.desc()).limit(limit)
    if status == "OPEN":
        stmt = stmt.where(Order.status.in_(("PLACED", "READY")))
    elif status:
        stmt = stmt.where(Order.status == status)
    if branch:
        if not p.is_super:
            raise HTTPException(403, "Your branch is fixed by your account")
        b = repo.get_branch_by_code(s, branch)
        if b is None:
            raise HTTPException(422, "Unknown branch")
        stmt = stmt.where(Order.branch_id == b.id)
    return [_row(s, o) for o in s.scalars(stmt)]


@router.post("/{order_id}/ready")
def mark_ready(order_id: uuid.UUID, s: Sess, p: Me):
    o = _order(s, p, order_id)
    if o.status != "PLACED":
        raise HTTPException(409, "Only a new order can be marked ready")
    o.status, o.ready_at, o.updated_at = "READY", datetime.now(UTC), datetime.now(UTC)
    inv = services.get_invoice(s, p, o.invoice_id)
    services._audit(s, p, inv, "order.ready", order=o.number)
    s.commit()
    branch = s.get(Branch, o.branch_id)
    mailer.send(mailer.Mail(
        to=o.customer_email, subject=f"Order {o.number} is ready for pick-up",
        text=(f"Hello {o.customer_name},\n\nYour order {o.number} is packed and ready at {branch.name}.\n{branch.address}\n"
              f"{('Phone: ' + branch.phone) if branch.phone else ''}\n\n"
              f"{'Please bring the amount of Rs. ' + str(o.total) + ' - you can pay at the counter.' if o.payment_status == 'UNPAID' else 'It is already paid.'}\n"
              f"Please collect within {settings.pickup_hold_days} days of ordering - uncollected orders are released.\n\nMCCIA")))
    return _row(s, o)


class PickupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    payment_mode: Literal["CASH", "RAZORPAY", "UPI", "CARD", "NET_BANKING", "OTHER"] | None = None
    reference: str = Field(default="", max_length=200)


@router.post("/{order_id}/pickup")
def mark_picked_up(order_id: uuid.UUID, body: PickupIn, s: Sess, p: Me):
    """The customer collected the goods. If they had not paid yet, the payment taken at the counter is recorded on the
    invoice (a new version: 'Paid at pick-up')."""
    o = _order(s, p, order_id)
    if o.status not in ("PLACED", "READY"):
        raise HTTPException(409, "This order is not waiting for pick-up")
    inv: Invoice = services.get_invoice(s, p, o.invoice_id)
    if o.payment_status == "UNPAID":
        if body.payment_mode is None:
            raise HTTPException(422, "Say how the customer paid")
        if body.payment_mode == "OTHER" and not body.reference.strip():
            raise HTTPException(422, "Say how it was paid")
        if body.payment_mode == "RAZORPAY":
            from .counter_pay import verify_reference

            try:
                verify_reference(s, body.reference, inv.grand_total, inv.id)
            except services.Invalid as ex:
                raise HTTPException(422, str(ex)) from None
        inv.payments.append(InvoicePayment(id=uuid.uuid4(), mode=body.payment_mode, amount=inv.grand_total,
                                           reference=body.reference.strip(), line_order=1))
        inv.version, inv.status = inv.version + 1, "EDITED"
        s.flush()
        s.refresh(inv)
        services._snapshot(s, p, inv, "Paid at pick-up")
        services._audit(s, p, inv, "invoice.revise", reason="Paid at pick-up", new_total=str(inv.grand_total))
        o.payment_status = "PAID"
    now = datetime.now(UTC)
    o.status, o.picked_up_at, o.updated_at = "PICKED_UP", now, now
    services._audit(s, p, inv, "order.pickup", order=o.number)
    s.commit()
    return _row(s, o)


class CancelIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=3, max_length=300)


@router.post("/{order_id}/cancel")
def cancel(order_id: uuid.UUID, body: CancelIn, s: Sess, p: Me):
    """Cancels an order (stock returns). If the customer already paid online, the full amount is refunded through Razorpay first."""
    if not p.is_admin:
        raise HTTPException(403, "Only an admin can cancel an order")
    o = _order(s, p, order_id)
    if o.status not in ("PENDING_PAYMENT", "PLACED", "READY"):
        raise HTTPException(409, "This order can no longer be cancelled")
    refund_id = None
    if o.payment_status == "PAID" and o.razorpay_payment_id:
        try:
            refund_id = razorpay.refund(o.razorpay_payment_id, razorpay.paise(o.total), {"order": o.number, "reason": body.reason.strip()}).get("id")
        except razorpay.RazorpayError as e:
            raise HTTPException(502, f"The refund could not be sent through Razorpay ({e}). The order has NOT been cancelled.") from None
    try:
        cancel_order_row(s, o, body.reason.strip(), "CANCELLED", p)
    except services.Conflict as ex:
        raise HTTPException(409, str(ex)) from None
    if refund_id:
        o.payment_status, o.razorpay_refund_id = "REFUNDED", refund_id
        s.commit()
        mailer.send(mailer.Mail(to=o.customer_email, subject=f"Order {o.number}: refund on its way",
                                text=f"Hello {o.customer_name},\n\nWe have refunded Rs. {o.total} for order {o.number}. It usually shows in your account within 5-7 working days.\n\nMCCIA"))
    return _row(s, o)


# ---------------------------------------------------------------- central admin: online vs branch offices
analytics_router = APIRouter(prefix="/api/v1/admin/store")


@analytics_router.get("/analytics")
def analytics(s: Sess, p: Me):
    if not p.is_super:
        raise HTTPException(403, "Central admin only")
    e = repo.current_event(s)
    if e is None:
        raise HTTPException(404, "No active event is configured")
    args = {"e": e.id, "counted": list(COUNTED)}
    by_branch = s.execute(text("""
        SELECT b.code, b.name,
               count(i.id) FILTER (WHERE o.id IS NULL) AS office_invoices,
               coalesce(sum(i.grand_total) FILTER (WHERE o.id IS NULL), 0) AS office_value,
               count(i.id) FILTER (WHERE o.id IS NOT NULL) AS online_orders,
               coalesce(sum(i.grand_total) FILTER (WHERE o.id IS NOT NULL), 0) AS online_value
          FROM branches b
          LEFT JOIN invoices i ON i.branch_id = b.id AND i.event_id = :e AND i.status = ANY(:counted)
            AND NOT EXISTS (SELECT 1 FROM orders po WHERE po.invoice_id = i.id AND po.status = 'PENDING_PAYMENT')
          LEFT JOIN orders o ON o.invoice_id = i.id
         GROUP BY b.id ORDER BY b.name"""), args).mappings().all()
    units = s.execute(text("""
        SELECT (o.id IS NOT NULL) AS online, coalesce(sum(ii.quantity), 0) AS units
          FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id LEFT JOIN orders o ON o.invoice_id = i.id
         WHERE i.event_id = :e AND i.status = ANY(:counted) AND (o.id IS NULL OR o.status <> 'PENDING_PAYMENT') GROUP BY 1"""), args).mappings().all()
    daily = s.execute(text("""
        SELECT i.invoice_date AS day, (o.id IS NOT NULL) AS online, sum(i.grand_total) AS value, count(*) AS n
          FROM invoices i LEFT JOIN orders o ON o.invoice_id = i.id
         WHERE i.event_id = :e AND i.status = ANY(:counted) AND i.invoice_date >= current_date - 29 AND (o.id IS NULL OR o.status <> 'PENDING_PAYMENT')
         GROUP BY 1, 2 ORDER BY 1"""), args).mappings().all()
    top = s.execute(text("""
        SELECT ii.particulars AS name, sum(ii.quantity) AS units, sum(ii.total_amount) AS value
          FROM orders o JOIN invoices i ON i.id = o.invoice_id AND i.status = ANY(:counted)
          JOIN invoice_items ii ON ii.invoice_id = i.id WHERE o.event_id = :e AND o.status <> 'PENDING_PAYMENT'
         GROUP BY ii.particulars ORDER BY value DESC LIMIT 8"""), args).mappings().all()
    status = s.execute(text("SELECT status, count(*) AS n FROM orders WHERE event_id = :e GROUP BY status"), args).mappings().all()
    pay = s.execute(text("SELECT payment_status, count(*) AS n FROM orders WHERE event_id = :e AND status = 'PICKED_UP' GROUP BY 1"), args).mappings().all()
    num = lambda x: float(x) if isinstance(x, Decimal) else x  # noqa: E731
    rows = [{k: num(v) for k, v in r.items()} for r in by_branch]
    online_value = sum(r["online_value"] for r in rows)
    office_value = sum(r["office_value"] for r in rows)
    return {
        "branches": rows,
        "totals": {"online_orders": sum(r["online_orders"] for r in rows), "online_value": online_value,
                   "office_invoices": sum(r["office_invoices"] for r in rows), "office_value": office_value,
                   "online_share": round(100 * online_value / (online_value + office_value), 1) if (online_value + office_value) else 0,
                   "online_units": num(next((u["units"] for u in units if u["online"]), 0)),
                   "office_units": num(next((u["units"] for u in units if not u["online"]), 0))},
        "daily": [{"day": r["day"].isoformat(), "online": r["online"], "value": num(r["value"]), "n": r["n"]} for r in daily],
        "top_online_products": [{k: num(v) for k, v in r.items()} for r in top],
        "order_status": {r["status"]: r["n"] for r in status},
        "picked_up_payments": {r["payment_status"]: r["n"] for r in pay},
    }
