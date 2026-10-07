import time
import uuid
from datetime import date
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from . import admin, documents, exports, login, stock, store, store_orders
from . import repositories as repo
from . import services
from .auth import Principal, current_principal
from .config import settings
from .db import get_session
from .models import INVOICE_STATUSES, User
from .schemas import (
    AuditOut,
    BranchOut,
    CancelIn,
    EventOut,
    HealthOut,
    InvoiceCreate,
    InvoiceOut,
    InvoiceUpdate,
    MeOut,
    ProductOut,
    VersionOut,
)

def _check_production() -> None:
    """A production deployment refuses to start with an unsafe configuration."""
    if settings.environment != "production":
        return
    problems = []
    if len(settings.jwt_secret) < 32:
        problems.append("JWT_SECRET must be 32+ random characters")
    if settings.dev_login:
        problems.append("DEV_LOGIN must be off")
    if settings.storage_backend != "db":
        problems.append("STORAGE_BACKEND must be 'db' (the host's disk is wiped on every deploy)")
    if any("localhost" in o or "127.0.0.1" in o for o in settings.cors_origins):
        problems.append("CORS_ORIGINS must list only the real website address")
    if problems:
        raise RuntimeError("Unsafe production configuration: " + "; ".join(problems))


_check_production()
app = FastAPI(title="MCCIA Safety Week Proforma API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


@app.get("/health", response_model=HealthOut)
def health(response: Response, s: Session = Depends(get_session)) -> HealthOut:
    try:
        s.execute(text("select 1"))
    except SQLAlchemyError:
        response.status_code = 503
        return HealthOut(status="degraded", database="unreachable")
    return HealthOut(status="ok", database="ok")


# Read-only reference data. Admin write endpoints for events/products arrive with the
# admin phase; until then 2027 values are changed in the database.
v1 = APIRouter(prefix="/api/v1")


@v1.get("/branches", response_model=list[BranchOut])
def branches(s: Session = Depends(get_session)):
    return repo.list_branches(s)


@v1.get("/events/current", response_model=EventOut)
def current_event(s: Session = Depends(get_session)):
    event = repo.current_event(s)
    if event is None:
        raise HTTPException(404, "No active event is configured")
    return event


@v1.get("/products", response_model=list[ProductOut])
def products(s: Session = Depends(get_session)):
    event = repo.current_event(s)
    if event is None:
        raise HTTPException(404, "No active event is configured")
    return repo.list_products(s, event.id)


# ---- authenticated ----
_STATUS = {services.NotFound: 404, services.Forbidden: 403, services.Invalid: 422, services.Conflict: 409,
           services.Unavailable: 503}
SERVICE_ERRORS = tuple(_STATUS)


def _http(e: Exception) -> HTTPException:
    return HTTPException(_STATUS[type(e)], str(e))


@v1.get("/me", response_model=MeOut)
def me(p: Principal = Depends(current_principal), s: Session = Depends(get_session)):
    # The web app calls this exactly once, right after a successful sign-in, so it doubles as the login event.
    services.log_event(s, p, "auth.login", entity_type="user", entity_id=p.user_id, role=p.role)
    branch = s.get(repo.Branch, p.branch_id) if p.branch_id else None
    s.commit()
    return MeOut(id=p.user_id, name=p.name, email=p.email, role=p.role, branch=branch)


# `branch` (query) is honoured for SUPER_ADMIN only; anyone else sending it gets 403.
@v1.get("/invoices", response_model=list[InvoiceOut])
def list_invoices(
    branch: str | None = None,
    q: Annotated[str | None, Query(max_length=100, description="invoice id or company name")] = None,
    status: Annotated[str | None, Query(pattern="^(" + "|".join(INVOICE_STATUSES) + ")$")] = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    p: Principal = Depends(current_principal),
    s: Session = Depends(get_session),
):
    try:
        return services.list_invoices(s, p, branch, q=q, status=status, date_from=date_from,
                                      date_to=date_to, limit=limit)
    except SERVICE_ERRORS as e:
        raise _http(e) from None


@v1.get("/invoices/next-number")
def next_number(branch: str | None = None, p: Principal = Depends(current_principal),
                s: Session = Depends(get_session)):
    try:
        return {"invoice_number": services.peek_next_number(s, p, branch)}
    except SERVICE_ERRORS as e:
        raise _http(e) from None


@v1.get("/invoices/{invoice_id}", response_model=InvoiceOut)
def get_invoice(invoice_id: uuid.UUID, p: Principal = Depends(current_principal),
                s: Session = Depends(get_session)):
    try:
        return services.get_invoice(s, p, invoice_id)
    except SERVICE_ERRORS as e:
        raise _http(e) from None


@v1.post("/invoices", response_model=InvoiceOut, status_code=201)
def create_invoice(data: InvoiceCreate, branch: str | None = None,
                   p: Principal = Depends(current_principal), s: Session = Depends(get_session)):
    try:
        invoice = services.create_invoice(s, p, data, branch)
    except SERVICE_ERRORS as e:
        raise _http(e) from None
    s.commit()
    if invoice.status != "DRAFT":
        documents.generate_quietly(invoice.id, invoice.version, p)  # inline: serverless hosts may freeze background work
    return invoice


@v1.put("/invoices/{invoice_id}", response_model=InvoiceOut)
def update_invoice(invoice_id: uuid.UUID, data: InvoiceUpdate,
                   p: Principal = Depends(current_principal), s: Session = Depends(get_session)):
    try:
        invoice = services.update_invoice(s, p, invoice_id, data)
    except SERVICE_ERRORS as e:
        raise _http(e) from None
    s.commit()
    if invoice.status != "DRAFT":  # submitted or revised: a new version exists, so it gets its own PDF
        documents.generate_quietly(invoice.id, invoice.version, p)  # inline: serverless hosts may freeze background work
    return invoice


@v1.get("/invoices/{invoice_id}/document")
def download_pdf(invoice_id: uuid.UUID, version: int | None = Query(default=None, ge=1),
                 p: Principal = Depends(current_principal), s: Session = Depends(get_session)):
    """The PDF for the current (or a given) version. Same auth + branch scoping as the invoice itself."""
    try:
        data, name = documents.read_document(s, p, invoice_id, version)
    except SERVICE_ERRORS as e:
        raise _http(e) from None
    return Response(data, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})


@v1.post("/invoices/{invoice_id}/cancel", response_model=InvoiceOut)
def cancel_invoice(invoice_id: uuid.UUID, data: CancelIn, p: Principal = Depends(current_principal),
                   s: Session = Depends(get_session)):
    try:
        invoice = services.cancel_invoice(s, p, invoice_id, data.reason)
    except SERVICE_ERRORS as e:
        raise _http(e) from None
    s.commit()
    return invoice


@v1.get("/invoices/{invoice_id}/versions", response_model=list[VersionOut])
def invoice_versions(invoice_id: uuid.UUID, p: Principal = Depends(current_principal),
                     s: Session = Depends(get_session)):
    try:
        rows = services.list_versions(s, p, invoice_id)
    except SERVICE_ERRORS as e:
        raise _http(e) from None
    return [VersionOut(version_number=v.version_number, created_at=v.created_at, edited_by_name=v.edited_by_name,
                       edit_reason=v.edit_reason, status=v.snapshot["status"], grand_total=v.snapshot["grand_total"])
            for v in rows]


@v1.get("/invoices/{invoice_id}/versions/{number}", response_model=InvoiceOut)
def invoice_version(invoice_id: uuid.UUID, number: int, p: Principal = Depends(current_principal),
                    s: Session = Depends(get_session)):
    """The invoice exactly as it was at that version (from the immutable snapshot)."""
    try:
        return services.get_version(s, p, invoice_id, number).snapshot
    except SERVICE_ERRORS as e:
        raise _http(e) from None


@v1.get("/audit-logs", response_model=list[AuditOut])
def audit_logs(action: Annotated[str | None, Query(max_length=60, description="prefix, e.g. invoice. or user.")] = None,
               entity_type: Annotated[str | None, Query(max_length=60)] = None, entity_id: uuid.UUID | None = None,
               limit: Annotated[int, Query(ge=1, le=500)] = 100, p: Principal = Depends(current_principal),
               s: Session = Depends(get_session)):
    try:
        return services.list_audit(s, p, action=action, entity_type=entity_type, entity_id=entity_id, limit=limit)
    except SERVICE_ERRORS as e:
        raise _http(e) from None


# ---- DEV ONLY sign-in (no password while building) ----
# Registered only when DEV_LOGIN=true and ENVIRONMENT is not "production" (production also refuses to start with it on).
if settings.dev_login and settings.environment != "production":

    class DevLogin(BaseModel):
        email: str

    @v1.post("/dev/token")
    def dev_token(body: DevLogin, s: Session = Depends(get_session)):
        user = s.scalar(select(User).where(User.email == body.email, User.active))
        if user is None or user.auth_user_id is None or not settings.jwt_secret:
            raise HTTPException(404, "No such dev user")
        claims = {"sub": str(user.auth_user_id), "aud": "authenticated", "exp": int(time.time()) + 8 * 3600}
        return {"access_token": jwt.encode(claims, settings.jwt_secret, "HS256")}


@v1.get("/settings/invoice")
def invoice_header(s: Session = Depends(get_session)):
    """Header/footer text of the invoice. Not secret (it is printed on every invoice); the print page needs it without a login."""
    return admin.read_header(s)


app.include_router(v1)
app.include_router(admin.router)
app.include_router(stock.router)
app.include_router(login.router)
app.include_router(store.router)
app.include_router(store_orders.router)
app.include_router(store_orders.analytics_router)
app.include_router(exports.router)
