"""Central-admin (SUPER_ADMIN) configuration + reporting.

Every route needs SUPER_ADMIN at the API layer; the database repeats it (RLS policies from migration
0006 allow writes to these tables only when the verified role is SUPER_ADMIN). Every change is written
to the audit log by database triggers.

Nothing here quietly reuses 2026 numbers for 2027: products start with rate_confirmed = false, an admin
must confirm/edit each rate, and the event cannot be set OPEN until that is done (see update_event).
"""

import re
import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from . import repositories as repo
from .catalogue import category_of, slugify
from . import services
from .auth import Principal, current_principal
from .db import get_session
from .login import set_password
from .models import (
    ROLES,
    AppSetting,
    Branch,
    DiscountRule,
    Event,
    EVENT_STATUSES,
    Invoice,
    Package,
    PackageItem,
    Product,
    User,
)

DEFAULT_HEADER = {
    "title": "PROFORMA INVOICE",
    "name": "Mahratta Chamber of Commerce, Industries and Agriculture",
    "address_lines": [
        "505A & B Wing, 5th floor, MCCIA Trade Tower,  Senapati Bapat Road, Pune 411 016,",
        " Maharashtra  [State Code - 27 ], Tel. 020-27013700 Email : shriramj@mcciapune.com",
    ],
    "gstin": "27AAATM5559Q1ZS",
    "pan": "AAATM5559Q",
    "for_org": "For MCCIA",
    "signatory": "Authorized Signatory",
}
COUNTED = ("SUBMITTED", "GENERATED", "EDITED")  # what counts as sales in reports


def require_super(p: Principal = Depends(current_principal)) -> Principal:
    if not p.is_super:
        raise HTTPException(403, "Central admin only")
    return p


router = APIRouter(prefix="/api/v1/admin", dependencies=[Depends(require_super)])
Sess = Annotated[Session, Depends(get_session)]
Me = Annotated[Principal, Depends(require_super)]


def bad(msg: str) -> HTTPException:
    return HTTPException(422, msg)


def commit(s: Session) -> None:
    try:
        s.commit()
    except IntegrityError as e:  # duplicate name/sku/email, failed CHECK ...
        s.rollback()
        raise bad("That conflicts with existing data (duplicate or invalid value)") from e


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


# ------------------------------------------------------------------ branches
class BranchAdminOut(Strict):
    id: uuid.UUID
    code: str
    name: str
    address: str
    phone: str
    email: str
    active: bool


class BranchEdit(Strict):
    """Code and name are locked: the five branches are fixed (PLAN 2)."""

    address: str = Field(max_length=500)
    phone: str = Field(max_length=50)
    email: str = Field(max_length=200)
    active: bool


@router.get("/branches", response_model=list[BranchAdminOut])
def list_branches(s: Sess):
    return list(s.scalars(select(Branch).order_by(Branch.name)))


@router.put("/branches/{branch_id}", response_model=BranchAdminOut)
def edit_branch(branch_id: uuid.UUID, data: BranchEdit, s: Sess):
    b = s.get(Branch, branch_id) or _404("branch")
    for k, v in data.model_dump().items():
        setattr(b, k, v)
    commit(s)
    return b


def _404(what: str):
    raise HTTPException(404, f"{what} not found")


# ------------------------------------------------------------------ users
class UserAdminOut(Strict):
    id: uuid.UUID
    name: str
    email: str
    role: str
    branch_id: uuid.UUID | None
    branch_code: str | None = None
    active: bool


class UserEdit(Strict):
    name: str = Field(min_length=1, max_length=200)
    role: Literal[ROLES]  # type: ignore[valid-type]
    branch_code: str | None = None  # required for every role except SUPER_ADMIN
    active: bool


class UserCreate(UserEdit):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


def _user_out(u: User, codes: dict) -> UserAdminOut:
    return UserAdminOut(id=u.id, name=u.name, email=u.email, role=u.role, branch_id=u.branch_id,
                        branch_code=codes.get(u.branch_id), active=u.active)


def _branch_of(s: Session, role: str, code: str | None) -> uuid.UUID | None:
    if role == "SUPER_ADMIN":
        if code:
            raise bad("The central admin belongs to no branch")
        return None
    b = repo.get_branch_by_code(s, code or "")
    if b is None:
        raise bad("Choose the user's branch")
    return b.id


@router.get("/users", response_model=list[UserAdminOut])
def list_users(s: Sess):
    codes = {b.id: b.code for b in s.scalars(select(Branch))}
    return [_user_out(u, codes) for u in s.scalars(select(User).order_by(User.name))]


@router.put("/users/{user_id}", response_model=UserAdminOut)
def edit_user(user_id: uuid.UUID, data: UserEdit, s: Sess, me: Me):
    u = s.get(User, user_id) or _404("user")
    lowers_self = u.id == me.user_id and (data.role != u.role or not data.active)
    if lowers_self:
        raise bad("You cannot demote or deactivate your own account")
    if u.role == "SUPER_ADMIN" and u.active and (data.role != "SUPER_ADMIN" or not data.active):
        others = s.scalar(select(func.count()).select_from(User).where(
            User.role == "SUPER_ADMIN", User.active, User.id != u.id))
        if not others:
            raise bad("There must always be at least one active central admin")
    u.name, u.role, u.active = data.name, data.role, data.active
    u.branch_id = _branch_of(s, data.role, data.branch_code)
    commit(s)
    return _user_out(u, {b.id: b.code for b in s.scalars(select(Branch))})


@router.post("/users", response_model=UserAdminOut, status_code=201)
def create_user(data: UserCreate, s: Sess):
    branch_id = _branch_of(s, data.role, data.branch_code)
    auth_id = uuid.uuid4()  # the `sub` of this user's tokens
    u = User(auth_user_id=auth_id, name=data.name, email=data.email, role=data.role, branch_id=branch_id,
             active=data.active, id=uuid.uuid4())
    s.add(u)
    commit(s)
    set_password(u.id, data.password)
    return _user_out(u, {b.id: b.code for b in s.scalars(select(Branch))})


class PasswordReset(Strict):
    password: str = Field(min_length=8, max_length=128)


@router.put("/users/{user_id}/password", status_code=204)
def reset_password(user_id: uuid.UUID, data: PasswordReset, s: Sess, me: Me):
    """Central admin sets a new password for anyone (also clears a lock after too many wrong attempts)."""
    u = s.get(User, user_id) or _404("user")
    set_password(u.id, data.password)
    services.log_event(s, me, "user.password_reset", entity_type="user", entity_id=u.id, branch_id=u.branch_id, email=u.email)
    s.commit()


# ------------------------------------------------------------------ event configuration
class EventAdminOut(Strict):
    id: uuid.UUID
    name: str
    year: int
    invoice_prefix: str
    start_date: date | None
    end_date: date | None
    status: str
    notes: str
    has_invoices: bool = False
    unconfirmed_products: int = 0


class EventEdit(Strict):
    name: str = Field(min_length=1, max_length=200)
    year: int = Field(ge=2000, le=2100)
    invoice_prefix: str = Field(pattern=r"^[A-Z0-9]{3,10}$")
    start_date: date | None = None
    end_date: date | None = None
    status: Literal[EVENT_STATUSES]  # type: ignore[valid-type]
    notes: str = Field(default="", max_length=2000)


def _event_out(s: Session, e: Event) -> EventAdminOut:
    has = bool(s.scalar(select(func.count()).select_from(Invoice).where(Invoice.event_id == e.id)))
    unconf = s.scalar(select(func.count()).select_from(Product).where(
        Product.event_id == e.id, Product.active, ~Product.rate_confirmed))
    return EventAdminOut(id=e.id, name=e.name, year=e.year, invoice_prefix=e.invoice_prefix, start_date=e.start_date,
                         end_date=e.end_date, status=e.status, notes=e.notes, has_invoices=has,
                         unconfirmed_products=unconf or 0)


@router.get("/events", response_model=list[EventAdminOut])
def list_events(s: Sess):
    return [_event_out(s, e) for e in s.scalars(select(Event).order_by(Event.year.desc()))]


@router.put("/events/{event_id}", response_model=EventAdminOut)
def update_event(event_id: uuid.UUID, data: EventEdit, s: Sess):
    e = s.get(Event, event_id) or _404("event")
    if data.start_date and data.end_date and data.end_date < data.start_date:
        raise bad("The end date is before the start date")
    out = _event_out(s, e)
    if data.invoice_prefix != e.invoice_prefix and out.has_invoices:
        raise bad("The invoice prefix cannot change once invoices exist (it is part of every invoice number)")
    if data.status == "OPEN":  # the guard that stops 2026 values from silently becoming live 2027 values
        if not (data.start_date and data.end_date):
            raise bad("Set the event dates before opening the event")
        if out.unconfirmed_products:
            raise bad(f"{out.unconfirmed_products} product rate(s) are still the 2026 reference values - "
                      "review and confirm them first (Products page)")
    for k, v in data.model_dump().items():
        setattr(e, k, v)
    commit(s)
    return _event_out(s, e)


# ------------------------------------------------------------------ products
class ProductAdminOut(Strict):
    id: uuid.UUID
    sku: str
    name: str
    description: str
    hsn_code: str
    unit: str
    current_rate: Decimal
    cgst_rate: Decimal
    sgst_rate: Decimal
    sr_no: int | None
    line_order: int
    active: bool
    rate_confirmed: bool
    slug: str | None = None
    category: str = ""
    image_url: str = ""
    online_enabled: bool = True


class ProductIn(Strict):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=1000)
    hsn_code: str = Field(pattern=r"^\d{4,8}$")
    unit: str = Field(default="Nos.", max_length=20)
    current_rate: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    cgst_rate: Decimal = Field(ge=0, le=14)
    sgst_rate: Decimal = Field(ge=0, le=14)
    sr_no: int | None = Field(default=None, ge=1)
    line_order: int = Field(ge=1)
    active: bool = True
    confirm_rate: bool = False  # "I have checked this rate for the current event"
    category: str = Field(default="", max_length=60)
    image_url: str = Field(default="", max_length=500, pattern=r"^$|^https://\S+$")
    online_enabled: bool = True  # shown in the online store


class ConfirmIn(Strict):
    ids: list[uuid.UUID] | None = None  # None = every active unconfirmed product


def _event_for(s: Session, event_id: uuid.UUID | None) -> Event:
    e = s.get(Event, event_id) if event_id else repo.current_event(s)
    return e or _404("event")


@router.get("/products", response_model=list[ProductAdminOut])
def list_products(s: Sess, event_id: uuid.UUID | None = None):
    e = _event_for(s, event_id)
    return list(s.scalars(select(Product).where(Product.event_id == e.id).order_by(Product.line_order)))


@router.post("/products", response_model=ProductAdminOut, status_code=201)
def create_product(data: ProductIn, s: Sess, event_id: uuid.UUID | None = None):
    e = _event_for(s, event_id)
    fields = data.model_dump(exclude={"confirm_rate"})
    fields["category"] = fields["category"] or category_of(data.name)
    p = Product(id=uuid.uuid4(), event_id=e.id, sku=f"{e.invoice_prefix}-{uuid.uuid4().hex[:6].upper()}",
                slug=f"{slugify(data.name)}-{uuid.uuid4().hex[:4]}", rate_confirmed=True, **fields)  # a product an admin just typed in is deliberate
    s.add(p)
    commit(s)
    return p


@router.put("/products/{product_id}", response_model=ProductAdminOut)
def edit_product(product_id: uuid.UUID, data: ProductIn, s: Sess):
    p = s.get(Product, product_id) or _404("product")
    rate_changed = data.current_rate != p.current_rate
    for k, v in data.model_dump(exclude={"confirm_rate"}).items():
        setattr(p, k, v)
    if rate_changed or data.confirm_rate:
        p.rate_confirmed = True
    commit(s)
    return p


@router.post("/products/confirm")
def confirm_rates(data: ConfirmIn, s: Sess):
    stmt = select(Product).where(Product.active, ~Product.rate_confirmed)
    if data.ids is not None:
        stmt = stmt.where(Product.id.in_(data.ids))
    else:
        stmt = stmt.where(Product.event_id == _event_for(s, None).id)
    rows = list(s.scalars(stmt))
    for p in rows:
        p.rate_confirmed = True
    commit(s)
    return {"confirmed": len(rows)}


# ------------------------------------------------------------------ discount rules
class DiscountIn(Strict):
    name: str = Field(min_length=1, max_length=200)
    threshold: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    percentage: Decimal | None = Field(default=None, gt=0, le=100, max_digits=5, decimal_places=2)
    fixed_amount: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2)
    valid_from: date | None = None
    valid_until: date | None = None
    conditions: dict = {}
    active: bool = True

    @field_validator("valid_until")
    @classmethod
    def _order(cls, v, info):
        if v and info.data.get("valid_from") and v < info.data["valid_from"]:
            raise ValueError("valid_until is before valid_from")
        return v


class DiscountOut(DiscountIn):
    id: uuid.UUID


def _discount_check(d: DiscountIn) -> None:
    if (d.percentage is None) == (d.fixed_amount is None):
        raise bad("Set either a percentage or a fixed amount (not both)")


@router.get("/discount-rules", response_model=list[DiscountOut])
def list_discounts(s: Sess, event_id: uuid.UUID | None = None):
    e = _event_for(s, event_id)
    return list(s.scalars(select(DiscountRule).where(DiscountRule.event_id == e.id).order_by(DiscountRule.name)))


@router.post("/discount-rules", response_model=DiscountOut, status_code=201)
def create_discount(data: DiscountIn, s: Sess):
    _discount_check(data)
    r = DiscountRule(id=uuid.uuid4(), event_id=_event_for(s, None).id, **data.model_dump())
    s.add(r)
    commit(s)
    return r


@router.put("/discount-rules/{rule_id}", response_model=DiscountOut)
def edit_discount(rule_id: uuid.UUID, data: DiscountIn, s: Sess):
    _discount_check(data)
    r = s.get(DiscountRule, rule_id) or _404("discount rule")
    for k, v in data.model_dump().items():
        setattr(r, k, v)
    commit(s)
    return r


@router.delete("/discount-rules/{rule_id}", status_code=204)
def delete_discount(rule_id: uuid.UUID, s: Sess):
    s.delete(s.get(DiscountRule, rule_id) or _404("discount rule"))
    commit(s)


# ------------------------------------------------------------------ packages / bundles
class PackageItemIn(Strict):
    product_id: uuid.UUID
    quantity: int = Field(ge=1, le=100000)


class PackageIn(Strict):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=1000)
    fixed_price: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    active: bool = True
    items: list[PackageItemIn] = Field(min_length=1)


class PackageItemOut(Strict):
    product_id: uuid.UUID
    quantity: int
    product_name: str = ""


class PackageOut(Strict):
    id: uuid.UUID
    name: str
    description: str
    fixed_price: Decimal | None
    active: bool
    items: list[PackageItemOut]


def _package_out(s: Session, pkg: Package) -> PackageOut:
    names = {p.id: p.name for p in s.scalars(select(Product).where(
        Product.id.in_([i.product_id for i in pkg.items])))}
    return PackageOut(id=pkg.id, name=pkg.name, description=pkg.description, fixed_price=pkg.fixed_price,
                      active=pkg.active, items=[PackageItemOut(product_id=i.product_id, quantity=i.quantity,
                                                               product_name=names.get(i.product_id, ""))
                                                for i in pkg.items])


def _package_items(s: Session, event: Event, data: PackageIn) -> list[PackageItem]:
    ids = [i.product_id for i in data.items]
    if len(set(ids)) != len(ids):
        raise bad("A product can appear only once in a package")
    known = set(s.scalars(select(Product.id).where(Product.event_id == event.id, Product.id.in_(ids))))
    if known != set(ids):
        raise bad("Every product must belong to the current event")
    return [PackageItem(id=uuid.uuid4(), product_id=i.product_id, quantity=i.quantity) for i in data.items]


@router.get("/packages", response_model=list[PackageOut])
def list_packages(s: Sess):
    e = _event_for(s, None)
    rows = s.scalars(select(Package).options(selectinload(Package.items)).where(Package.event_id == e.id)
                     .order_by(Package.name))
    return [_package_out(s, p) for p in rows]


@router.post("/packages", response_model=PackageOut, status_code=201)
def create_package(data: PackageIn, s: Sess):
    e = _event_for(s, None)
    pkg = Package(id=uuid.uuid4(), event_id=e.id, name=data.name, description=data.description,
                  fixed_price=data.fixed_price, active=data.active, items=_package_items(s, e, data))
    s.add(pkg)
    commit(s)
    return _package_out(s, pkg)


@router.put("/packages/{package_id}", response_model=PackageOut)
def edit_package(package_id: uuid.UUID, data: PackageIn, s: Sess):
    pkg = s.scalars(select(Package).options(selectinload(Package.items)).where(Package.id == package_id)).first() \
        or _404("package")
    items = _package_items(s, s.get(Event, pkg.event_id), data)
    pkg.name, pkg.description, pkg.fixed_price, pkg.active = data.name, data.description, data.fixed_price, data.active
    pkg.items.clear()
    s.flush()
    pkg.items = items
    commit(s)
    return _package_out(s, pkg)


@router.delete("/packages/{package_id}", status_code=204)
def delete_package(package_id: uuid.UUID, s: Sess):
    s.delete(s.get(Package, package_id) or _404("package"))
    commit(s)


# ------------------------------------------------------------------ invoice header / footer
class HeaderIn(Strict):
    title: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=200)
    address_lines: list[Annotated[str, Field(max_length=200)]] = Field(min_length=1, max_length=4)
    gstin: str = Field(pattern=r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
    pan: str = Field(pattern=r"^[A-Z]{5}\d{4}[A-Z]$")
    for_org: str = Field(min_length=1, max_length=60)
    signatory: str = Field(min_length=1, max_length=60)


def read_header(s: Session) -> dict:
    row = s.scalar(select(AppSetting).where(AppSetting.key == "invoice_header"))
    return {**DEFAULT_HEADER, **(row.value if row else {})}


@router.put("/settings/invoice", response_model=HeaderIn)
def save_header(data: HeaderIn, s: Sess):
    row = s.scalar(select(AppSetting).where(AppSetting.key == "invoice_header"))
    if row is None:
        s.add(AppSetting(id=uuid.uuid4(), key="invoice_header", value=data.model_dump()))
    else:
        row.value = data.model_dump()
    commit(s)
    return data


# ------------------------------------------------------------------ reports
@router.get("/reports")
def reports(s: Sess, date_from: date | None = None, date_to: date | None = None,
            event_id: uuid.UUID | None = None):
    """Sales figures across all branches (submitted, PDF-generated and edited invoices; not drafts or cancelled)."""
    e = _event_for(s, event_id)
    args = {"e": e.id, "f": date_from, "t": date_to, "counted": list(COUNTED)}
    where = ("i.event_id = :e AND i.status = ANY(:counted) AND (CAST(:f AS date) IS NULL OR i.invoice_date >= :f) "
             "AND (CAST(:t AS date) IS NULL OR i.invoice_date <= :t)")

    def rows(sql: str):
        return [dict(r) for r in s.execute(text(sql), args).mappings()]

    branches = rows(f"""SELECT b.code, b.name, count(i.id) AS invoices, coalesce(sum(i.grand_total), 0) AS value
                        FROM branches b LEFT JOIN invoices i ON i.branch_id = b.id AND {where}
                        GROUP BY b.id ORDER BY b.name""")
    products = rows(f"""SELECT ii.particulars AS name, sum(ii.quantity) AS quantity, sum(ii.basic_amount) AS value
                        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE {where}
                        GROUP BY ii.particulars ORDER BY sum(ii.basic_amount) DESC LIMIT 50""")
    months = rows(f"""SELECT to_char(date_trunc('month', i.invoice_date), 'YYYY-MM') AS month, count(*) AS invoices,
                             sum(i.grand_total) AS value FROM invoices i WHERE {where} GROUP BY 1 ORDER BY 1""")
    modes = rows(f"""SELECT p.mode, count(*) AS payments, sum(p.amount) AS value FROM invoice_payments p
                     JOIN invoices i ON i.id = p.invoice_id WHERE {where} GROUP BY p.mode ORDER BY sum(p.amount) DESC""")
    outstanding = rows(f"""SELECT count(*) AS invoices, coalesce(sum(i.grand_total - coalesce(pp.paid, 0)), 0) AS value
                           FROM invoices i LEFT JOIN (SELECT invoice_id, sum(amount) AS paid FROM invoice_payments
                           GROUP BY invoice_id) pp ON pp.invoice_id = i.id
                           WHERE {where} AND i.grand_total - coalesce(pp.paid, 0) > 0""")[0]
    statuses = rows("""SELECT status, count(*) AS invoices, coalesce(sum(grand_total), 0) AS value FROM invoices i
                       WHERE i.event_id = :e AND (CAST(:f AS date) IS NULL OR i.invoice_date >= :f)
                       AND (CAST(:t AS date) IS NULL OR i.invoice_date <= :t) GROUP BY status ORDER BY status""")
    return {
        "event": {"id": e.id, "name": e.name, "year": e.year},
        "totals": {"invoices": sum(b["invoices"] for b in branches), "value": sum(b["value"] for b in branches)},
        "by_branch": branches, "by_product": products, "by_month": months, "by_status": statuses,
        "by_payment_mode": modes, "outstanding": outstanding,
    }
