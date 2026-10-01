"""Data access only: SQL in, ORM objects out. No business rules here."""

import uuid
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from sqlalchemy.orm import selectinload

from .models import Branch, Event, Invoice, InvoiceSequence, Product


def list_branches(s: Session) -> list[Branch]:
    return list(s.scalars(select(Branch).where(Branch.active).order_by(Branch.name)))


def get_branch_by_code(s: Session, code: str) -> Branch | None:
    return s.scalar(select(Branch).where(Branch.code == code.upper()))


def current_event(s: Session) -> Event | None:
    """Newest event that is not closed."""
    return s.scalar(
        select(Event).where(Event.status != "CLOSED").order_by(Event.year.desc()).limit(1)
    )


def list_products(s: Session, event_id: uuid.UUID) -> list[Product]:
    return list(
        s.scalars(
            select(Product).where(Product.event_id == event_id, Product.active).order_by(Product.line_order)
        )
    )


def allocate_sequence(s: Session, branch_id: uuid.UUID, event_id: uuid.UUID) -> int:
    """Atomically hand out the next number for (branch, event).

    A single INSERT .. ON CONFLICT DO UPDATE takes a row lock, so concurrent callers
    serialise on the database and can never receive the same value. The increment
    happens inside the caller's transaction: if it rolls back, the number is not burnt.
    """
    stmt = (
        insert(InvoiceSequence)
        .values(branch_id=branch_id, event_id=event_id, next_value=2)
        .on_conflict_do_update(
            index_elements=[InvoiceSequence.branch_id, InvoiceSequence.event_id],
            set_={"next_value": InvoiceSequence.next_value + 1},
        )
        .returning(InvoiceSequence.next_value)
    )
    return s.execute(stmt).scalar_one() - 1


def add(s: Session, *rows) -> None:
    s.add_all(rows)
    s.flush()


def products_by_ids(s: Session, event_id: uuid.UUID, ids: list[uuid.UUID]) -> dict[uuid.UUID, Product]:
    rows = s.scalars(select(Product).where(Product.event_id == event_id, Product.active, Product.id.in_(ids)))
    return {p.id: p for p in rows}


def invoices_stmt(
    branch_id: uuid.UUID | None,
    *,
    q: str | None = None,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int | None = None,
):
    """branch_id=None means 'all branches' and is only ever passed for SUPER_ADMIN (see services)."""
    stmt = select(Invoice).options(selectinload(Invoice.items), selectinload(Invoice.payments)).order_by(Invoice.updated_at.desc(), Invoice.id)
    if branch_id is not None:
        stmt = stmt.where(Invoice.branch_id == branch_id)
    if q and q.strip():
        like = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        stmt = stmt.where(or_(Invoice.invoice_number.ilike(like, escape="\\"),
                              Invoice.company_name.ilike(like, escape="\\")))
    if status:
        stmt = stmt.where(Invoice.status == status)
    if date_from:
        stmt = stmt.where(Invoice.invoice_date >= date_from)
    if date_to:
        stmt = stmt.where(Invoice.invoice_date <= date_to)
    return stmt.limit(limit) if limit else stmt


def next_sequence_value(s: Session, branch_id: uuid.UUID, event_id: uuid.UUID) -> int:
    """What the next allocation WILL be (display only; never used to assign an id)."""
    return s.scalar(select(InvoiceSequence.next_value).where(
        InvoiceSequence.branch_id == branch_id, InvoiceSequence.event_id == event_id)) or 1
