"""Simple stock per branch.

An admin sets the OPENING stock (and a "low at" level) per material. Remaining stock is never stored:
it is opening stock minus everything invoiced by that branch for the current event (submitted, PDF-generated
or edited invoices; not drafts or cancelled ones), computed on every read. So edits, cancellations and
revisions can never leave the numbers out of step.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from . import repositories as repo
from .admin import COUNTED
from .auth import Principal, current_principal
from .db import get_session
from .models import BranchStock, Product

router = APIRouter(prefix="/api/v1/stock")
Sess = Annotated[Session, Depends(get_session)]
Me = Annotated[Principal, Depends(current_principal)]


class StockItem(BaseModel):
    product_id: uuid.UUID
    name: str
    line_order: int
    opening_qty: int | None
    low_threshold: int | None
    sold: int
    remaining: int | None
    status: str  # OK | LOW | OUT | UNSET


class StockOut(BaseModel):
    branch_code: str
    branch_name: str
    items: list[StockItem]


class StockRowIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: uuid.UUID
    opening_qty: int = Field(ge=0, le=10_000_000)
    low_threshold: int = Field(ge=0, le=10_000_000)


class StockIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[StockRowIn] = Field(max_length=200)


def _branch(s: Session, p: Principal, code: str | None):
    if p.is_super:
        b = repo.get_branch_by_code(s, code or "")
        if b is None:
            raise HTTPException(422, "Choose a branch (branch=CODE)")
        return b
    if code is not None:
        raise HTTPException(403, "Your branch is fixed by your account")
    return s.get(repo.Branch, p.branch_id)


def levels(s: Session, branch, event) -> list[StockItem]:
    rows = s.execute(text("""
        SELECT pr.id, pr.name, pr.line_order, bs.opening_qty, bs.low_threshold,
               coalesce((SELECT sum(ii.quantity) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
                          WHERE i.branch_id = :b AND i.event_id = :e AND i.status = ANY(:counted)
                            AND ii.product_id = pr.id), 0) AS sold
          FROM products pr LEFT JOIN branch_stock bs ON bs.product_id = pr.id AND bs.branch_id = :b
         WHERE pr.event_id = :e AND pr.active ORDER BY pr.line_order"""),
        {"b": branch.id, "e": event.id, "counted": list(COUNTED)}).mappings().all()
    out = []
    for r in rows:
        opening, low, sold = r["opening_qty"], r["low_threshold"], int(r["sold"])
        remaining = None if opening is None else opening - sold
        status = "UNSET" if remaining is None else "OUT" if remaining <= 0 else "LOW" if remaining <= (low or 0) else "OK"
        out.append(StockItem(product_id=r["id"], name=" ".join(r["name"].split()), line_order=r["line_order"],
                             opening_qty=opening, low_threshold=low, sold=sold, remaining=remaining, status=status))
    return out


def _event(s: Session):
    event = repo.current_event(s)
    if event is None:
        raise HTTPException(404, "No active event is configured")
    return event


@router.get("", response_model=StockOut)
def stock(s: Sess, p: Me, branch: str | None = None):
    b, e = _branch(s, p, branch), _event(s)
    return StockOut(branch_code=b.code, branch_name=b.name, items=levels(s, b, e))


@router.get("/low")
def low_stock(s: Sess, p: Me, branch: str | None = None, limit: Annotated[int, Query(ge=1, le=50)] = 8):
    """For the dashboard: the materials that are low or out, emptiest first."""
    b, e = _branch(s, p, branch), _event(s)
    items = levels(s, b, e)
    low = sorted((i for i in items if i.status in ("LOW", "OUT")), key=lambda i: (i.remaining or 0, i.line_order))
    return {"configured": sum(i.status != "UNSET" for i in items), "total": len(items), "items": low[:limit],
            "low_count": len(low)}


@router.put("", response_model=StockOut)
def save_stock(data: StockIn, s: Sess, p: Me, branch: str | None = None):
    """Set opening stock / low level. Central admin: any branch. Branch admin: their own branch only."""
    if not p.is_admin:
        raise HTTPException(403, "Only an admin can change stock")
    b, e = _branch(s, p, branch), _event(s)
    ids = {r.product_id for r in data.items}
    known = set(s.scalars(select(Product.id).where(Product.event_id == e.id, Product.id.in_(ids))))
    if known != ids:
        raise HTTPException(422, "Every material must belong to the current event")
    for r in data.items:
        s.execute(insert(BranchStock).values(id=uuid.uuid4(), branch_id=b.id, product_id=r.product_id,
                                             opening_qty=r.opening_qty, low_threshold=r.low_threshold)
                  .on_conflict_do_update(index_elements=[BranchStock.branch_id, BranchStock.product_id],
                                         set_={"opening_qty": r.opening_qty, "low_threshold": r.low_threshold}))
    s.commit()
    return StockOut(branch_code=b.code, branch_name=b.name, items=levels(s, b, e))
