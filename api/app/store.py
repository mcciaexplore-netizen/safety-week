"""The public online store (no staff login): catalogue with per-branch stock, e-mail-code sign-in for shoppers,
and pick-up orders.

How an order works: the shopper picks a branch to collect from; the order becomes an ordinary SUBMITTED invoice of THAT
branch (so its stock goes down at once, branch dashboards/PDF/Excel need no changes) plus an `orders` row with the
customer, status and payment method. Payment is "pay at pick-up" (online payment is switched on later). Branch staff
then pack it (READY) and hand it over (PICKED_UP, recording the payment) - see store_orders.py.

Everything here runs on the owner database connection (there is no staff identity), so every query is explicit and
nothing numeric from the browser is trusted: prices, GST, totals and stock are recomputed on the server.
Shopper tokens carry audience "customer" and can never open a staff endpoint (staff tokens use "authenticated").
"""

import hashlib
import hmac
import logging
import secrets
import time
import uuid
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Literal

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from . import documents, mailer, services
from . import repositories as repo
from .auth import Principal
from .config import settings
from .db import get_session
from .models import Branch, Customer, Invoice, LoginCode, Order, Product
from .schemas import InvoiceCreate, InvoiceItemIn
from .stock import levels

log = logging.getLogger("store")
router = APIRouter(prefix="/api/v1/store")
Sess = Annotated[Session, Depends(get_session)]

MAX_OPEN_ORDERS = 5  # per e-mail address, uncollected
MAX_QTY = 500
CODE_TTL_MIN = 10
CODE_TRIES = 5
CODES_PER_HOUR = 5
ONLINE_PAYMENTS = False  # flipped on when the Razorpay step is built


# ---------------------------------------------------------------- helpers
def _now() -> datetime:
    return datetime.now(UTC)


def _today_ist():
    return (_now() + timedelta(hours=5, minutes=30)).date()


def _clean(name: str) -> str:
    return " ".join(name.split())


def _event_open(s: Session):
    e = repo.current_event(s)
    if e is None or e.status != "OPEN":
        raise HTTPException(409, "The store is closed at the moment")
    return e


def _branch(s: Session, code: str) -> Branch:
    b = repo.get_branch_by_code(s, code)
    if b is None or not b.active:
        raise HTTPException(422, "Choose one of our branches for pick-up")
    return b


def _price_incl_gst(p: Product) -> Decimal:
    return (p.current_rate * (1 + (p.cgst_rate + p.sgst_rate) / 100)).quantize(Decimal("0.01"), ROUND_HALF_UP)


def _branch_out(b: Branch) -> dict:
    return {"code": b.code, "name": b.name, "address": b.address, "phone": b.phone}


def _system_principal(branch_id: uuid.UUID | None, *, admin: bool = False) -> Principal:
    """The identity used for system actions (placing an order, expiring one). Never exposed to anyone."""
    return Principal(user_id=None, role="SUPER_ADMIN" if admin else "BRANCH_USER",  # type: ignore[arg-type]
                     branch_id=None if admin else branch_id, name="Online Store", email="")


# ---------------------------------------------------------------- shopper tokens
def _hash_code(email: str, code: str) -> str:
    return hashlib.sha256(f"{code}:{email}:{settings.jwt_secret}".encode()).hexdigest()


def customer_token(c: Customer) -> str:
    return jwt.encode({"sub": str(c.id), "aud": "customer", "exp": int(time.time()) + 30 * 86400}, settings.jwt_secret, "HS256")


def order_token(number: str) -> str:
    """Lets a guest open their own order page from the e-mail link (no account needed)."""
    return jwt.encode({"n": number, "aud": "order", "exp": int(time.time()) + 180 * 86400}, settings.jwt_secret, "HS256")


def _customer_from(s: Session, authorization: str | None) -> Customer | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    try:
        c = jwt.decode(authorization[7:], settings.jwt_secret, algorithms=["HS256"], audience="customer",
                       options={"require": ["exp", "sub"]})
        return s.get(Customer, uuid.UUID(c["sub"]))
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(401, "Please sign in again") from None


def _need_customer(s: Session, authorization: str | None) -> Customer:
    c = _customer_from(s, authorization)
    if c is None:
        raise HTTPException(401, "Please sign in")
    return c


# ---------------------------------------------------------------- catalogue
@router.get("/catalogue")
def catalogue(s: Sess):
    """Everything the shop front needs in one call: products, categories, branches and the stock at each branch."""
    e = repo.current_event(s)
    branches = list(s.scalars(select(Branch).where(Branch.active).order_by(Branch.name)))
    if e is None:
        return {"open": False, "branches": [_branch_out(b) for b in branches], "categories": [], "products": []}
    prods = list(s.scalars(select(Product).where(Product.event_id == e.id, Product.active, Product.online_enabled)
                           .order_by(Product.line_order)))
    stock = {b.code: {i.product_id: i.remaining for i in levels(s, b, e)} for b in branches}
    out = []
    for p in prods:
        out.append({
            "id": str(p.id), "slug": p.slug or str(p.id), "name": _clean(p.name), "category": p.category or "Safety Materials",
            "image_url": p.image_url, "best_seller": p.best_seller, "unit": p.unit, "hsn_code": p.hsn_code,
            "rate": str(p.current_rate), "gst_percent": str(p.cgst_rate + p.sgst_rate), "price_incl_gst": str(_price_incl_gst(p)),
            # None (stock not set up) counts as 0 for shoppers
            "stock": {code: max(0, min(999, st.get(p.id) or 0)) for code, st in stock.items()},
        })
    cats = sorted({p["category"] for p in out})
    return {"open": e.status == "OPEN", "event": e.name, "year": e.year, "branches": [_branch_out(b) for b in branches],
            "categories": cats, "products": out, "pickup_hold_days": settings.pickup_hold_days,
            "online_payments": ONLINE_PAYMENTS}


# ---------------------------------------------------------------- sign-in by e-mail code
class EmailIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr


class VerifyIn(EmailIn):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class ProfileIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    phone: str = Field(default="", max_length=50, pattern=r"^$|^[0-9+ \-]{8,20}$")


def _customer_out(c: Customer) -> dict:
    return {"id": str(c.id), "email": c.email, "name": c.name, "phone": c.phone}


@router.post("/auth/request-code")
def request_code(body: EmailIn, s: Sess):
    email = body.email.lower()
    recent = s.scalar(select(func.count()).select_from(LoginCode).where(
        LoginCode.email == email, LoginCode.created_at > _now() - timedelta(hours=1)))
    if (recent or 0) >= CODES_PER_HOUR:
        raise HTTPException(429, "Too many codes requested. Please try again in an hour.")
    code = f"{secrets.randbelow(1_000_000):06d}"
    s.add(LoginCode(id=uuid.uuid4(), email=email, code_hash=_hash_code(email, code),
                    expires_at=_now() + timedelta(minutes=CODE_TTL_MIN)))
    s.commit()
    mailer.send(mailer.Mail(
        to=email, subject=f"Your MCCIA Store sign-in code: {code}",
        text=f"Your sign-in code is {code}.\n\nIt works for {CODE_TTL_MIN} minutes. If you did not ask for it, ignore this e-mail."))
    return {"sent": True}  # the same answer whether or not the address has an account


@router.post("/auth/verify")
def verify_code(body: VerifyIn, s: Sess):
    email = body.email.lower()
    row = s.scalars(select(LoginCode).where(LoginCode.email == email, LoginCode.expires_at > _now())
                    .order_by(LoginCode.created_at.desc())).first()
    if row is None or row.attempts >= CODE_TRIES:
        raise HTTPException(401, "That code is not valid. Ask for a new one.")
    if not hmac.compare_digest(row.code_hash, _hash_code(email, body.code)):
        row.attempts += 1
        s.commit()
        raise HTTPException(401, "That code is not valid. Ask for a new one.")
    s.execute(delete(LoginCode).where(LoginCode.email == email))
    c = s.scalar(select(Customer).where(Customer.email == email))
    if c is None:
        c = Customer(id=uuid.uuid4(), email=email)
        s.add(c)
    s.commit()
    return {"token": customer_token(c), "customer": _customer_out(c)}


@router.get("/me")
def me(s: Sess, authorization: Annotated[str | None, Header()] = None):
    return _customer_out(_need_customer(s, authorization))


@router.put("/me")
def update_me(body: ProfileIn, s: Sess, authorization: Annotated[str | None, Header()] = None):
    c = _need_customer(s, authorization)
    c.name, c.phone = body.name.strip(), body.phone.strip()
    s.commit()
    return _customer_out(c)


# ---------------------------------------------------------------- orders
class OrderLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: uuid.UUID
    quantity: int = Field(ge=1, le=MAX_QTY)


class OrderIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    branch_code: str = Field(min_length=3, max_length=3)
    items: list[OrderLine] = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    phone: str = Field(pattern=r"^[0-9+ \-]{8,20}$")
    payment_method: Literal["PAY_AT_PICKUP", "ONLINE"] = "PAY_AT_PICKUP"
    note: str = Field(default="", max_length=300)


def order_out(s: Session, o: Order, *, token: bool = False) -> dict:
    inv = s.get(Invoice, o.invoice_id)
    branch = s.get(Branch, o.branch_id)
    out = {
        "number": o.number, "status": o.status, "payment_method": o.payment_method, "payment_status": o.payment_status,
        "branch": _branch_out(branch), "total": str(o.total), "item_count": o.item_count, "note": o.note,
        "customer": {"name": o.customer_name, "email": o.customer_email, "phone": o.customer_phone},
        "created_at": o.created_at.isoformat(), "ready_at": o.ready_at.isoformat() if o.ready_at else None,
        "picked_up_at": o.picked_up_at.isoformat() if o.picked_up_at else None,
        "hold_until": (o.created_at + timedelta(days=settings.pickup_hold_days)).isoformat(),
        "items": [{"name": _clean(i.particulars), "quantity": i.quantity, "rate": f"{i.rate:.2f}", "amount": f"{i.total_amount:.2f}"}
                  for i in inv.items],
    }
    if token:
        out["access_token"] = order_token(o.number)
    return out


def _notify_placed(s: Session, o: Order, p: Principal) -> None:
    attachments = []
    try:
        data, name = documents.read_document(s, p, o.invoice_id, None)
        attachments = [(name, data, "application/pdf")]
    except Exception:
        log.exception("could not attach the invoice to the order e-mail for %s", o.number)
    branch = s.get(Branch, o.branch_id)
    pay = ("You will pay at the branch when you collect your order." if o.payment_method == "PAY_AT_PICKUP"
           else "Your payment has been received.")
    mailer.send(mailer.Mail(
        to=o.customer_email, subject=f"Order {o.number} received - collect from {branch.name}",
        text=(f"Hello {o.customer_name},\n\nThank you for your order {o.number}.\n\n"
              f"Pick-up branch: {branch.name}\n{branch.address}\n{('Phone: ' + branch.phone) if branch.phone else ''}\n\n"
              f"Total: Rs. {o.total}\n{pay}\n\n"
              f"We will e-mail you when it is packed and ready. Please keep it for {settings.pickup_hold_days} days at most - "
              f"uncollected orders are released.\nYour invoice is attached.\n\nTrack your order: "
              f"{settings.store_url}/order/{o.number}?t={order_token(o.number)}\n\nMCCIA"),
        attachments=attachments))


@router.post("/orders", status_code=201)
def place_order(body: OrderIn, s: Sess, authorization: Annotated[str | None, Header()] = None):
    if body.payment_method == "ONLINE" and not ONLINE_PAYMENTS:
        raise HTTPException(409, "Online payment is not available yet - please choose pay at pick-up")
    e = _event_open(s)
    branch = _branch(s, body.branch_code.upper())
    customer = _customer_from(s, authorization)
    email = (customer.email if customer else body.email).lower()
    open_orders = s.scalar(select(func.count()).select_from(Order).where(
        Order.customer_email == email, Order.status.in_(("PLACED", "READY"))))
    if (open_orders or 0) >= MAX_OPEN_ORDERS:
        raise HTTPException(429, "You already have several orders waiting for pick-up. Please collect them first.")
    ids = [i.product_id for i in body.items]
    if len(set(ids)) != len(ids):
        raise HTTPException(422, "Each product can appear only once")
    products = repo.products_by_ids(s, e.id, ids)
    for pid in ids:
        pr = products.get(pid)
        if pr is None or not pr.active or not pr.online_enabled:
            raise HTTPException(422, "One of the products is no longer available")

    # one buyer at a time per branch, so the last unit cannot be sold twice
    s.execute(select(func.pg_advisory_xact_lock(func.hashtext(f"store:{branch.id}"))))
    have = {i.product_id: i.remaining for i in levels(s, branch, e)}
    short = [{"product_id": str(l.product_id), "name": _clean(products[l.product_id].name), "available": max(0, have.get(l.product_id) or 0)}
             for l in body.items if (have.get(l.product_id) or 0) < l.quantity]
    if short:
        raise HTTPException(409, {"message": f"Not enough stock at {branch.name}", "short": short})

    p = _system_principal(branch.id)
    data = InvoiceCreate(
        company_name=body.name.strip(), address=f"Pick-up at {branch.name}", email=email, contact_person=body.name.strip(),
        contact_phone=body.phone.strip(), invoice_date=_today_ist(), discount_percent=Decimal(0),
        items=[InvoiceItemIn(product_id=l.product_id, quantity=l.quantity) for l in body.items], payments=[],
        payment_details="ONLINE ORDER - Pay at pick-up" + (f" | Note: {body.note.strip()}" if body.note.strip() else ""),
        action="submit")
    try:
        invoice = services.create_invoice(s, p, data, None)
    except services.Invalid as ex:
        s.rollback()
        raise HTTPException(422, str(ex)) from None
    order = Order(id=uuid.uuid4(), number=invoice.invoice_number, invoice_id=invoice.id, branch_id=branch.id, event_id=e.id,
                  customer_id=customer.id if customer else None, customer_name=body.name.strip(), customer_email=email,
                  customer_phone=body.phone.strip(), status="PLACED", payment_method=body.payment_method,
                  payment_status="UNPAID", note=body.note.strip(), total=invoice.grand_total,
                  item_count=sum(i.quantity for i in invoice.items))
    s.add(order)
    s.commit()
    try:
        _notify_placed(s, order, p)
    except Exception:
        log.exception("order e-mail failed for %s", order.number)
    return order_out(s, order, token=True)


def _order_for(s: Session, number: str, authorization: str | None, t: str | None, email: str | None) -> Order:
    o = s.scalar(select(Order).where(Order.number == number))
    ok = False
    if o is not None:
        c = _customer_from(s, authorization)
        if c is not None and o.customer_email == c.email:
            ok = True
        elif t:
            try:
                ok = jwt.decode(t, settings.jwt_secret, algorithms=["HS256"], audience="order")["n"] == number
            except jwt.PyJWTError:
                ok = False
        elif email:
            ok = hmac.compare_digest(email.lower().encode(), o.customer_email.encode())
    if not ok:
        raise HTTPException(404, "We could not find that order")  # the same answer for "no such order" and "not yours"
    return o


@router.get("/orders/{number}")
def get_order(number: str, s: Sess, authorization: Annotated[str | None, Header()] = None,
              t: Annotated[str | None, Query(max_length=1000)] = None, email: Annotated[str | None, Query(max_length=320)] = None):
    return order_out(s, _order_for(s, number, authorization, t, email))


@router.get("/orders/{number}/invoice")
def order_invoice(number: str, s: Sess, authorization: Annotated[str | None, Header()] = None,
                  t: Annotated[str | None, Query(max_length=1000)] = None, email: Annotated[str | None, Query(max_length=320)] = None):
    o = _order_for(s, number, authorization, t, email)
    p = _system_principal(o.branch_id)
    try:
        data, name = documents.read_document(s, p, o.invoice_id, None)
    except (services.NotFound, services.Conflict, services.Unavailable) as ex:
        raise HTTPException(409, str(ex)) from None
    return Response(data, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})


@router.post("/orders/{number}/cancel")
def cancel_order(number: str, s: Sess, authorization: Annotated[str | None, Header()] = None,
                 t: Annotated[str | None, Query(max_length=1000)] = None, email: Annotated[str | None, Query(max_length=320)] = None):
    """The shopper changes their mind before collecting (and before paying)."""
    o = _order_for(s, number, authorization, t, email)
    if o.status not in ("PLACED", "READY") or o.payment_status == "PAID":
        raise HTTPException(409, "This order can no longer be cancelled here. Please contact the branch.")
    cancel_order_row(s, o, "Cancelled by the customer", "CANCELLED")
    return order_out(s, o)


def cancel_order_row(s: Session, o: Order, reason: str, status: str, principal: Principal | None = None) -> None:
    """Cancels the invoice (stock returns), marks the order and tells the shopper. Used by shoppers, staff and the clean-up job."""
    p = principal or _system_principal(None, admin=True)
    services.cancel_invoice(s, p, o.invoice_id, reason)
    o.status, o.cancelled_at, o.updated_at = status, _now(), _now()
    s.commit()
    mailer.send(mailer.Mail(
        to=o.customer_email, subject=f"Order {o.number} {'cancelled' if status == 'CANCELLED' else 'released'}",
        text=f"Hello {o.customer_name},\n\nYour order {o.number} has been {'cancelled' if status == 'CANCELLED' else 'released'} ({reason}).\n"
             f"You are welcome to order again any time: {settings.store_url}\n\nMCCIA"))


@router.get("/my-orders")
def my_orders(s: Sess, authorization: Annotated[str | None, Header()] = None):
    c = _need_customer(s, authorization)
    rows = s.scalars(select(Order).where(Order.customer_email == c.email).order_by(Order.created_at.desc()).limit(50))
    return [order_out(s, o) for o in rows]


# ---------------------------------------------------------------- scheduled clean-up
@router.get("/jobs/expire")
def expire_uncollected(s: Sess, authorization: Annotated[str | None, Header()] = None):
    """Called by the host's scheduler (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`)."""
    if not settings.cron_secret or not hmac.compare_digest((authorization or "").encode(), f"Bearer {settings.cron_secret}".encode()):
        raise HTTPException(401, "Not allowed")
    cutoff = _now() - timedelta(days=settings.pickup_hold_days)
    rows = list(s.scalars(select(Order).where(Order.status.in_(("PLACED", "READY")), Order.payment_status == "UNPAID",
                                             Order.created_at < cutoff)))
    for o in rows:
        cancel_order_row(s, o, f"Not collected within {settings.pickup_hold_days} days", "EXPIRED")
    return {"released": len(rows)}

