"""Requests to change a submitted invoice.

Only the CENTRAL ADMIN can change an invoice once it is submitted (services.update_invoice). A branch user or branch
admin who needs a change sends an edit request here: the invoice and a reason. The central admin sees the open
requests, changes the invoice (which answers its open request automatically) or declines it with a note.
Nothing is deleted; every step is in the audit log.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import repositories as repo
from . import services
from .auth import Principal, current_principal
from .db import get_session
from .models import Branch, EditRequest, Invoice

router = APIRouter(prefix="/api/v1")
Sess = Annotated[Session, Depends(get_session)]
Me = Annotated[Principal, Depends(current_principal)]


class RequestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=3, max_length=1000)


class DeclineIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str = Field(min_length=3, max_length=1000)


class RequestOut(BaseModel):
    id: uuid.UUID
    invoice_id: uuid.UUID
    invoice_number: str
    company_name: str
    invoice_status: str
    branch_code: str
    branch_name: str
    requested_by_name: str
    reason: str
    status: Literal["OPEN", "DONE", "DECLINED"]
    resolved_by_name: str
    resolved_note: str
    created_at: datetime
    resolved_at: datetime | None


def _out(r: EditRequest, inv: Invoice, b: Branch) -> RequestOut:
    return RequestOut(id=r.id, invoice_id=r.invoice_id, invoice_number=inv.invoice_number, company_name=inv.company_name,
                      invoice_status=inv.status, branch_code=b.code, branch_name=b.name, requested_by_name=r.requested_by_name,
                      reason=r.reason, status=r.status, resolved_by_name=r.resolved_by_name, resolved_note=r.resolved_note,  # type: ignore[arg-type]
                      created_at=r.created_at, resolved_at=r.resolved_at)


def _http(e: Exception) -> HTTPException:
    return HTTPException({services.NotFound: 404, services.Forbidden: 403, services.Invalid: 422, services.Conflict: 409}[type(e)], str(e))


def close_open_requests(s: Session, p: Principal, invoice: Invoice) -> None:
    """Called when the central admin has changed the invoice: its open request is answered."""
    now = datetime.now(UTC)
    for r in s.scalars(select(EditRequest).where(EditRequest.invoice_id == invoice.id, EditRequest.status == "OPEN")):
        r.status, r.resolved_by_name, r.resolved_at = "DONE", p.name, now
        services.log_event(s, p, "edit_request.done", entity_type="edit_request", entity_id=r.id, branch_id=invoice.branch_id,
                           invoice_number=invoice.invoice_number)


@router.post("/invoices/{invoice_id}/edit-requests", response_model=RequestOut, status_code=201)
def create_request(invoice_id: uuid.UUID, body: RequestIn, p: Me, s: Sess):
    try:
        if p.is_super:
            raise services.Forbidden("The central admin can edit the invoice directly")
        invoice = services.get_invoice(s, p, invoice_id)  # someone else's invoice is "not found"
        if invoice.status == "DRAFT":
            raise services.Invalid("A draft can be edited directly - no request is needed")
        if invoice.status == "CANCELLED":
            raise services.Conflict("A cancelled invoice cannot be edited")
        r = EditRequest(invoice_id=invoice.id, branch_id=invoice.branch_id, requested_by=p.user_id,
                        requested_by_name=p.name, reason=body.reason.strip())
        try:
            repo.add(s, r)  # flushes: the database allows one open request per invoice
        except IntegrityError:
            s.rollback()
            raise services.Conflict("An edit request for this invoice is already waiting for the central admin") from None
        s.refresh(r)
        services.log_event(s, p, "edit_request.create", entity_type="edit_request", entity_id=r.id, branch_id=invoice.branch_id,
                           invoice_number=invoice.invoice_number, reason=r.reason)
        out = _out(r, invoice, s.get(Branch, invoice.branch_id))
    except (services.NotFound, services.Forbidden, services.Invalid, services.Conflict) as e:
        raise _http(e) from None
    s.commit()
    return out


@router.get("/edit-requests", response_model=list[RequestOut])
def list_requests(p: Me, s: Sess, status: Annotated[Literal["OPEN", "DONE", "DECLINED"] | None, Query()] = None,
                  invoice_id: uuid.UUID | None = None):
    """Central admin: every branch. Everyone else: their own branch."""
    stmt = (select(EditRequest, Invoice, Branch).join(Invoice, Invoice.id == EditRequest.invoice_id)
            .join(Branch, Branch.id == EditRequest.branch_id).order_by(EditRequest.created_at.desc()).limit(300))
    if not p.is_super:
        stmt = stmt.where(EditRequest.branch_id == p.branch_id)
    if status:
        stmt = stmt.where(EditRequest.status == status)
    if invoice_id:
        stmt = stmt.where(EditRequest.invoice_id == invoice_id)
    return [_out(r, i, b) for r, i, b in s.execute(stmt)]


@router.post("/edit-requests/{request_id}/decline", response_model=RequestOut)
def decline_request(request_id: uuid.UUID, body: DeclineIn, p: Me, s: Sess):
    if not p.is_super:
        raise HTTPException(403, "Only the central admin can answer an edit request")
    r = s.get(EditRequest, request_id)
    if r is None:
        raise HTTPException(404, "Request not found")
    if r.status != "OPEN":
        raise HTTPException(409, "This request has already been answered")
    r.status, r.resolved_by_name, r.resolved_note, r.resolved_at = "DECLINED", p.name, body.note.strip(), datetime.now(UTC)
    invoice = s.get(Invoice, r.invoice_id)
    services.log_event(s, p, "edit_request.decline", entity_type="edit_request", entity_id=r.id, branch_id=r.branch_id,
                       invoice_number=invoice.invoice_number, note=r.resolved_note)
    s.flush()
    out = _out(r, invoice, s.get(Branch, r.branch_id))
    s.commit()
    return out
