"""Simple stock per branch.

An admin sets the OPENING stock (and a "low at" level) per material. Remaining stock is never stored:
it is opening stock + stock received from other branches - stock sent to them - everything invoiced by that
branch for the current event (submitted, PDF-generated or edited invoices; not drafts or cancelled ones),
computed on every read. So edits, cancellations and revisions can never leave the numbers out of step.

Only the central admin can move stock between branches (POST /stock/transfers, append-only) and see all
branches side by side (GET /stock/overview).
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from . import repositories as repo
from . import services
from .admin import COUNTED
from .auth import Principal, current_principal
from .db import get_session
from .models import Branch, BranchStock, Product, StockTransfer

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
    transferred_in: int = 0
    transferred_out: int = 0
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
                            AND ii.product_id = pr.id), 0) AS sold,
               coalesce((SELECT sum(t.quantity) FROM stock_transfers t WHERE t.event_id = :e AND t.product_id = pr.id
                          AND t.to_branch_id = :b), 0) AS t_in,
               coalesce((SELECT sum(t.quantity) FROM stock_transfers t WHERE t.event_id = :e AND t.product_id = pr.id
                          AND t.from_branch_id = :b), 0) AS t_out
          FROM products pr LEFT JOIN branch_stock bs ON bs.product_id = pr.id AND bs.branch_id = :b
         WHERE pr.event_id = :e AND pr.active ORDER BY pr.line_order"""),
        {"b": branch.id, "e": event.id, "counted": list(COUNTED)}).mappings().all()
    out = []
    for r in rows:
        opening, low, sold = r["opening_qty"], r["low_threshold"], int(r["sold"])
        t_in, t_out = int(r["t_in"]), int(r["t_out"])
        remaining = None if opening is None else opening + t_in - t_out - sold
        status = "UNSET" if remaining is None else "OUT" if remaining <= 0 else "LOW" if remaining <= (low or 0) else "OK"
        out.append(StockItem(product_id=r["id"], name=" ".join(r["name"].split()), line_order=r["line_order"],
                             opening_qty=opening, low_threshold=low, sold=sold,
                             transferred_in=t_in, transferred_out=t_out, remaining=remaining, status=status))
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


# ---------------------------------------------------------------- central admin: all branches + transfers
def _super_only(p: Principal) -> None:
    if not p.is_super:
        raise HTTPException(403, "Only the central admin can see all branches or move stock")


class BranchLevel(BaseModel):
    opening_qty: int | None
    low_threshold: int | None
    sold: int
    transferred_in: int
    transferred_out: int
    remaining: int | None
    status: str


class OverviewItem(BaseModel):
    product_id: uuid.UUID
    name: str
    total_remaining: int
    branches: dict[str, BranchLevel]  # by branch code


class OverviewOut(BaseModel):
    branches: list[dict[str, str]]  # [{code, name}] in display order
    items: list[OverviewItem]


class TransferIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: uuid.UUID
    from_branch: str = Field(min_length=1, max_length=3)
    to_branch: str = Field(min_length=1, max_length=3)
    quantity: int = Field(gt=0, le=10_000_000)
    note: str = Field(default="", max_length=300)


class TransferOut(BaseModel):
    id: uuid.UUID
    created_at: str
    product_id: uuid.UUID
    product: str
    from_branch: str
    to_branch: str
    quantity: int
    note: str
    by: str


def _name(raw: str) -> str:
    return " ".join(raw.split())


@router.get("/overview", response_model=OverviewOut)
def overview(s: Sess, p: Me):
    """Every active branch's stock for every material, side by side (central admin only)."""
    _super_only(p)
    e = _event(s)
    branches = list(s.scalars(select(Branch).where(Branch.active).order_by(Branch.name)))
    per = {b.code: {i.product_id: i for i in levels(s, b, e)} for b in branches}
    first = next(iter(per.values()), {})
    items = []
    for pid, base in sorted(first.items(), key=lambda kv: kv[1].line_order):
        cells = {code: BranchLevel(**{k: getattr(lv[pid], k) for k in BranchLevel.model_fields}) for code, lv in per.items()}
        items.append(OverviewItem(product_id=pid, name=base.name, branches=cells,
                                  total_remaining=sum(c.remaining or 0 for c in cells.values())))
    return OverviewOut(branches=[{"code": b.code, "name": b.name} for b in branches], items=items)


def _transfer_out(t: StockTransfer, names: dict, product: str) -> TransferOut:
    return TransferOut(id=t.id, created_at=t.created_at.isoformat(), product_id=t.product_id, product=product,
                       from_branch=names[t.from_branch_id], to_branch=names[t.to_branch_id], quantity=t.quantity,
                       note=t.note, by=t.created_by_name)


@router.get("/transfers", response_model=list[TransferOut])
def transfers(s: Sess, p: Me, limit: Annotated[int, Query(ge=1, le=200)] = 30):
    _super_only(p)
    e = _event(s)
    names = {b.id: b.name for b in s.scalars(select(Branch))}
    rows = s.execute(select(StockTransfer, Product.name).join(Product, Product.id == StockTransfer.product_id)
                     .where(StockTransfer.event_id == e.id).order_by(StockTransfer.created_at.desc()).limit(limit)).all()
    return [_transfer_out(t, names, _name(n)) for t, n in rows]


@router.post("/transfers", response_model=TransferOut, status_code=201)
def transfer(data: TransferIn, s: Sess, p: Me):
    """Move stock of one material between two branches. The sending branch must have that much remaining."""
    _super_only(p)
    e = _event(s)
    src, dst = repo.get_branch_by_code(s, data.from_branch), repo.get_branch_by_code(s, data.to_branch)
    if src is None or dst is None:
        raise HTTPException(422, "Unknown branch")
    if src.id == dst.id:
        raise HTTPException(422, "Choose two different branches")
    product = s.scalar(select(Product).where(Product.id == data.product_id, Product.event_id == e.id))
    if product is None:
        raise HTTPException(422, "That material does not belong to the current event")
    name = _name(product.name)
    # lock the sender's stock row so two simultaneous transfers cannot both spend the same units
    locked = s.scalar(select(BranchStock.id).where(BranchStock.branch_id == src.id, BranchStock.product_id == product.id).with_for_update())
    if locked is None:
        raise HTTPException(422, f"{src.name} has no stock set for {name}")
    have = next(i.remaining for i in levels(s, src, e) if i.product_id == product.id)
    if data.quantity > have:
        raise HTTPException(422, f"{src.name} has only {have} left of {name}")
    # a branch that never had this material gets a zero opening row so received units count as its stock
    s.execute(insert(BranchStock).values(id=uuid.uuid4(), branch_id=dst.id, product_id=product.id, opening_qty=0, low_threshold=10)
              .on_conflict_do_nothing(index_elements=[BranchStock.branch_id, BranchStock.product_id]))
    t = StockTransfer(id=uuid.uuid4(), event_id=e.id, product_id=product.id, from_branch_id=src.id, to_branch_id=dst.id,
                      quantity=data.quantity, note=data.note.strip(), created_by=p.user_id, created_by_name=p.name,
                      created_at=datetime.now(UTC))
    s.add(t)
    s.flush()
    services.log_event(s, p, "stock.transfer", entity_type="stock", entity_id=t.id, branch_id=src.id, product=name,
                       quantity=data.quantity, from_branch=src.code, to_branch=dst.code, note=t.note)
    s.commit()
    return _transfer_out(t, {src.id: src.name, dst.id: dst.name}, name)
