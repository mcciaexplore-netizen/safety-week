"""Business rules. Every invoice function takes the verified Principal and enforces the
branch rule here (layer 1); PostgreSQL row level security repeats it (layer 2).
PDF generation lands in Phase 7."""

import uuid
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import repositories as repo
from .auth import Principal
from .models import AuditLog, Invoice, InvoiceItem, InvoicePayment, InvoiceVersion
from .schemas import InvoiceCreate, InvoiceOut, InvoiceUpdate


class NotFound(Exception):
    pass


class Forbidden(Exception):
    pass


class Invalid(Exception):
    pass


class Conflict(Exception):
    pass


class Unavailable(Exception):
    pass


def allocate_invoice_number(s: Session, branch_code: str) -> str:
    """Human-readable, globally unique ID such as NSW27-TIL-000001 (PLAN 12)."""
    branch = repo.get_branch_by_code(s, branch_code)
    event = repo.current_event(s)
    if branch is None or event is None:
        raise NotFound("branch or active event")
    n = repo.allocate_sequence(s, branch.id, event.id)
    return f"{event.invoice_prefix}-{branch.code}-{n:06d}"


# ---- amounts: same arithmetic as the workbook / web app (lib/invoice/calc.ts) ----

_ONES = ("Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen "
         "Fifteen Sixteen Seventeen Eighteen Nineteen").split()
_TENS = "_ _ Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety".split()


def _below_1000(n: int) -> str:
    words = []
    if n >= 100:
        words.append(f"{_ONES[n // 100]} Hundred")
        n %= 100
    if n >= 20:
        words.append(_TENS[n // 10])
        n %= 10
    if n:
        words.append(_ONES[n])
    return " ".join(words)


def amount_in_words(amount: int) -> str:
    """Indian numbering, workbook style: no 'Rupees', ends with 'only'."""
    if amount == 0:
        return "Zero only"
    parts = []
    for size, name in ((10_000_000, "Crore"), (100_000, "Lakh"), (1000, "Thousand")):
        q, amount = divmod(amount, size)
        if q:
            parts.append(f"{_below_1000(q)} {name}")
    if amount:
        parts.append(_below_1000(amount))
    return " ".join(parts) + " only"


def _branch_for(s: Session, p: Principal, branch_code: str | None):
    if p.is_super:
        branch = repo.get_branch_by_code(s, branch_code or "")
        if branch is None:
            raise Invalid("A central admin must say which branch (branch=CODE)")
        return branch
    if branch_code is not None:
        raise Forbidden("Your branch is fixed by your account")
    return s.get(repo.Branch, p.branch_id)


def _calculate(s: Session, p: Principal, data: InvoiceCreate, event) -> tuple[list[InvoiceItem], dict]:
    """The ONLY place amounts are computed. Nothing numeric from the browser is trusted:
    rates and tax come from the catalogue rows and are snapshotted onto the invoice lines."""
    if data.action == "submit" and not any(i.quantity > 0 for i in data.items):
        raise Invalid("Add at least one material with a quantity")
    if len({i.product_id for i in data.items}) != len(data.items):
        raise Invalid("A material can appear only once")
    products = repo.products_by_ids(s, event.id, [i.product_id for i in data.items])
    hundred = Decimal(100)
    items: list[InvoiceItem] = []
    for n, line in enumerate(data.items, 1):
        prod = products.get(line.product_id)
        if prod is None:
            raise Invalid(f"Unknown product {line.product_id}")
        if line.rate is not None and line.rate != prod.current_rate and not p.is_admin:
            raise Forbidden("Only an admin may override a rate")
        rate = line.rate if line.rate is not None else prod.current_rate
        after = rate - rate * data.discount_percent / hundred
        basic = line.quantity * after
        cgst, sgst = basic * prod.cgst_rate / hundred, basic * prod.sgst_rate / hundred
        items.append(InvoiceItem(
            product_id=prod.id, particulars=prod.name, hsn_code=prod.hsn_code, rate=rate,
            quantity=line.quantity, discount_percent=data.discount_percent, rate_after_discount=after,
            basic_amount=basic, cgst_rate=prod.cgst_rate, cgst_amount=cgst, sgst_rate=prod.sgst_rate,
            sgst_amount=sgst, total_amount=basic + cgst + sgst, line_order=n,
        ))
    grand = sum((i.total_amount for i in items), Decimal(0))
    rounded = grand.quantize(Decimal(1), rounding=ROUND_HALF_UP)
    totals = dict(
        subtotal=sum((i.basic_amount for i in items), Decimal(0)),
        cgst_total=sum((i.cgst_amount for i in items), Decimal(0)),
        sgst_total=sum((i.sgst_amount for i in items), Decimal(0)),
        rounding_adjustment=rounded - grand, grand_total=rounded,
        amount_in_words=data.amount_in_words or amount_in_words(int(rounded)),
    )
    return items, totals


def _build_payments(data: InvoiceCreate, payable: Decimal) -> list[InvoicePayment]:
    """Zero payments = unpaid. Several = a split payment. They may add up to less than the total
    (part payment, balance due) but never to more."""
    if sum((p.amount for p in data.payments), Decimal(0)) > payable:
        raise Invalid("The payments add up to more than the invoice total")
    for p in data.payments:
        if p.mode == "OTHER" and not p.reference.strip():
            raise Invalid("Say what the 'Other' payment mode is (put it in the reference)")
    return [InvoicePayment(mode=p.mode, amount=p.amount, reference=p.reference.strip(), line_order=n)
            for n, p in enumerate(data.payments, 1)]


def _fields(data: InvoiceCreate) -> dict:
    return dict(company_name=data.company_name, address=data.address, gstin=data.gstin, email=data.email,
                contact_person=data.contact_person, contact_phone=data.contact_phone,
                invoice_date=data.invoice_date, discount_percent=data.discount_percent,
                payment_details=data.payment_details)


def log_event(s: Session, p: Principal, action: str, *, entity_type: str, entity_id: uuid.UUID | None = None,
              branch_id: uuid.UUID | None = None, **metadata) -> None:
    """Append one audit row. id/created_at are set here so the INSERT needs no RETURNING: reading
    audit rows back is restricted (admins only), and RETURNING would be blocked by RLS."""
    repo.add(s, AuditLog(id=uuid.uuid4(), created_at=datetime.now(UTC), actor_user_id=p.user_id,
                         actor_name=p.name, branch_id=branch_id if branch_id is not None else p.branch_id,
                         action=action, entity_type=entity_type, entity_id=entity_id, metadata_=metadata))


def _audit(s: Session, p: Principal, invoice: Invoice, action: str, **extra) -> None:
    log_event(s, p, action, entity_type="invoice", entity_id=invoice.id, branch_id=invoice.branch_id,
              invoice_number=invoice.invoice_number, status=invoice.status, version=invoice.version, **extra)


def _snapshot(s: Session, p: Principal, invoice: Invoice, reason: str = "") -> None:
    """Immutable copy of the invoice as of this version (PLAN 14)."""
    repo.add(s, InvoiceVersion(
        id=uuid.uuid4(), created_at=datetime.now(UTC), invoice_id=invoice.id, version_number=invoice.version,
        snapshot=InvoiceOut.model_validate(invoice).model_dump(mode="json"),
        edited_by=p.user_id, edited_by_name=p.name, edit_reason=reason))


def _check_stock(s: Session, branch, event, items: list[InvoiceItem], mine: dict | None = None) -> None:
    """A submitted invoice cannot take more of a material than the branch has left. `mine` = what this invoice already
    holds (a revision may keep its own quantities). Materials with no stock set up are not limited."""
    from sqlalchemy import func

    from .stock import levels  # local import: stock.py imports this module

    s.execute(select(func.pg_advisory_xact_lock(func.hashtext(f"store:{branch.id}"))))  # one seller at a time per branch
    have = {i.product_id: i.remaining for i in levels(s, branch, event)}
    for it in items:
        left = have.get(it.product_id)
        if left is None:
            continue
        allowed = left + (mine or {}).get(it.product_id, 0)
        if it.quantity > allowed:
            raise Invalid(f"Only {max(allowed, 0)} of {' '.join(it.particulars.split())} in stock at {branch.name}")


def _verify_razorpay(s: Session, payments: list[InvoicePayment], invoice_id=None, already: set[str] | None = None) -> None:
    """Every Razorpay payment on a submitted invoice must be a real, matching, unused Razorpay payment (see counter_pay)."""
    from .counter_pay import verify_reference  # local import: counter_pay imports this module

    for pay in payments:
        if pay.mode == "RAZORPAY" and pay.reference not in (already or set()):
            verify_reference(s, pay.reference, pay.amount, invoice_id)


def create_invoice(s: Session, p: Principal, data: InvoiceCreate, branch_code: str | None = None) -> Invoice:
    branch = _branch_for(s, p, branch_code)  # branch comes from the account, never the payload
    event = repo.current_event(s)
    if event is None:
        raise Invalid("No active event is configured")
    items, totals = _calculate(s, p, data, event)
    if data.action == "submit":
        _check_stock(s, branch, event, items)
    new_payments = _build_payments(data, totals["grand_total"])
    if data.action == "submit":
        _verify_razorpay(s, new_payments)
    invoice = Invoice(
        invoice_number=allocate_invoice_number(s, branch.code), event_id=event.id, branch_id=branch.id,
        created_by=p.user_id, created_by_name=p.name, status="SUBMITTED" if data.action == "submit" else "DRAFT",
        items=items, payments=new_payments, **_fields(data), **totals)
    repo.add(s, invoice)
    s.refresh(invoice)  # from here on, values are exactly what the database stored
    if invoice.status == "SUBMITTED":
        _snapshot(s, p, invoice)
    _audit(s, p, invoice, "invoice.submit" if invoice.status == "SUBMITTED" else "invoice.create")
    return invoice


def update_invoice(s: Session, p: Principal, invoice_id: uuid.UUID, data: InvoiceUpdate) -> Invoice:
    """Draft: save (or submit). Submitted/edited/generated: a revision -> EDITED, version + 1."""
    invoice = get_invoice(s, p, invoice_id)  # 404 for anything outside the caller's branch
    if invoice.status == "CANCELLED":
        raise Conflict("Cancelled invoices cannot be edited")
    event = s.get(repo.Event, invoice.event_id)
    items, totals = _calculate(s, p, data, event)

    was_draft = invoice.status == "DRAFT"
    if not (was_draft and data.action != "submit"):  # a submitted invoice or a revision: stock must cover it
        _check_stock(s, s.get(repo.Branch, invoice.branch_id), event, items,
                     None if was_draft else {i.product_id: i.quantity for i in invoice.items})
    reason = data.edit_reason.strip()
    if not was_draft and len(reason) < 3:
        raise Invalid("Give a reason for changing a submitted invoice")
    previous_total = invoice.grand_total
    for key, value in {**_fields(data), **totals}.items():
        setattr(invoice, key, value)
    new_payments = _build_payments(data, totals["grand_total"])
    if not (was_draft and data.action != "submit"):  # submitted / revised: the Razorpay payments must be real
        _verify_razorpay(s, new_payments, invoice.id, {x.reference for x in invoice.payments if x.mode == "RAZORPAY"})
    invoice.items.clear()
    invoice.payments.clear()
    s.flush()  # delete the old lines first: (invoice_id, line_order) is unique
    invoice.items = items
    invoice.payments = new_payments

    if was_draft:
        invoice.status = "SUBMITTED" if data.action == "submit" else "DRAFT"
        action = "invoice.submit" if data.action == "submit" else "invoice.update"
    else:
        invoice.status, invoice.version = "EDITED", invoice.version + 1
        action = "invoice.revise"
    s.flush()
    s.refresh(invoice)
    if invoice.status != "DRAFT":
        _snapshot(s, p, invoice, "" if was_draft else reason)
    _audit(s, p, invoice, action, previous_total=str(previous_total), new_total=str(invoice.grand_total),
           **({} if was_draft else {"reason": reason}))
    return invoice


def cancel_invoice(s: Session, p: Principal, invoice_id: uuid.UUID, reason: str) -> Invoice:
    """Admins only. The invoice stays on record (nothing is deleted); the cancellation is a new
    version with its reason, and the invoice becomes read-only."""
    if not p.is_admin:
        raise Forbidden("Only an admin can cancel an invoice")
    invoice = get_invoice(s, p, invoice_id)
    if invoice.status == "CANCELLED":
        raise Conflict("Already cancelled")
    if len(reason.strip()) < 3:
        raise Invalid("Give a reason for the cancellation")
    if invoice.status != "DRAFT":
        invoice.version += 1
    invoice.status = "CANCELLED"
    s.flush()
    s.refresh(invoice)
    _snapshot(s, p, invoice, reason.strip())
    _audit(s, p, invoice, "invoice.cancel", reason=reason.strip())
    return invoice


def list_versions(s: Session, p: Principal, invoice_id: uuid.UUID) -> list[InvoiceVersion]:
    if not p.is_admin:
        raise Forbidden("Version history is available to admins")
    invoice = get_invoice(s, p, invoice_id)  # branch scoping first
    return list(s.scalars(select(InvoiceVersion).where(InvoiceVersion.invoice_id == invoice.id)
                          .order_by(InvoiceVersion.version_number.desc())))


def get_version(s: Session, p: Principal, invoice_id: uuid.UUID, number: int) -> InvoiceVersion:
    for v in list_versions(s, p, invoice_id):
        if v.version_number == number:
            return v
    raise NotFound("version")


def list_audit(s: Session, p: Principal, *, action: str | None = None, entity_type: str | None = None,
               entity_id: uuid.UUID | None = None, limit: int = 100) -> list[AuditLog]:
    """Central admin: everything. Branch admin: their own branch's trail. Both layers enforce it."""
    if not p.is_admin:
        raise Forbidden("The audit log is available to admins")
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
    if not p.is_super:
        stmt = stmt.where(AuditLog.branch_id == p.branch_id)
    if action:
        stmt = stmt.where(AuditLog.action.like(action.replace("%", "").replace("_", "\\_") + "%", escape="\\"))
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    return list(s.scalars(stmt))


def list_invoices(s: Session, p: Principal, branch_code: str | None = None, *, q: str | None = None,
                  status: str | None = None, date_from: date | None = None, date_to: date | None = None,
                  limit: int = 200) -> list[Invoice]:
    if p.is_super:
        branch = repo.get_branch_by_code(s, branch_code) if branch_code else None
        if branch_code and branch is None:
            raise NotFound("branch")
        branch_id = branch.id if branch else None
    else:
        if branch_code is not None:
            raise Forbidden("Your branch is fixed by your account")
        branch_id = p.branch_id
    stmt = repo.invoices_stmt(branch_id, q=q, status=status, date_from=date_from, date_to=date_to, limit=limit)
    return list(s.scalars(stmt))


def get_invoice(s: Session, p: Principal, invoice_id: uuid.UUID) -> Invoice:
    """Someone else's invoice is reported as 'not found', so ids cannot be probed."""
    stmt = repo.invoices_stmt(None if p.is_super else p.branch_id).where(Invoice.id == invoice_id)
    invoice = s.scalars(stmt).first()
    if invoice is None:
        raise NotFound("invoice")
    return invoice


def peek_next_number(s: Session, p: Principal, branch_code: str | None = None) -> str:
    """Display only ('your next invoice will be ...'); the real number is allocated on save."""
    branch = _branch_for(s, p, branch_code)
    event = repo.current_event(s)
    if event is None:
        raise Invalid("No active event is configured")
    n = repo.next_sequence_value(s, branch.id, event.id)
    return f"{event.invoice_prefix}-{branch.code}-{n:06d}"
