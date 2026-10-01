"""Invoice PDFs.

The PDF is NOT built by a second layout. Chromium opens the web app's /print/invoice page,
which renders the very same <InvoicePaper> component the live preview uses, from the
immutable version snapshot, and prints it. A 60-second signed token (bound to one invoice
and one version) is the only credential that page needs.
"""

import hashlib
import logging
import os
import time
import uuid
from datetime import UTC, datetime

import jwt
from playwright.sync_api import sync_playwright
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import repositories as repo
from . import services
from .auth import Principal, apply_rls
from .config import settings
from .db import SessionLocal
from .models import InvoiceDocument, InvoiceVersion
from .storage import store

log = logging.getLogger("documents")
_SECRET = settings.print_token_secret or os.urandom(32).hex()  # per process if not configured


def print_token(invoice_id: uuid.UUID, version: int) -> str:
    claims = {"inv": str(invoice_id), "v": version, "aud": "print", "exp": int(time.time()) + 60}
    return jwt.encode(claims, _SECRET, "HS256")


def check_print_token(token: str, invoice_id: uuid.UUID, version: int) -> None:
    try:
        c = jwt.decode(token, _SECRET, algorithms=["HS256"], audience="print", options={"require": ["exp"]})
    except jwt.PyJWTError:
        raise services.Forbidden("Invalid or expired print token") from None
    if c.get("inv") != str(invoice_id) or c.get("v") != version:
        raise services.Forbidden("Token is for a different invoice")


def snapshot_for_print(s: Session, invoice_id: uuid.UUID, version: int, token: str) -> dict:
    check_print_token(token, invoice_id, version)
    v = s.scalar(select(InvoiceVersion).where(InvoiceVersion.invoice_id == invoice_id,
                                              InvoiceVersion.version_number == version))
    if v is None:
        raise services.NotFound("version")
    return v.snapshot


def render_pdf(invoice_id: uuid.UUID, version: int) -> bytes:
    url = f"{settings.web_url.rstrip('/')}/print/invoice/{invoice_id}?v={version}&t={print_token(invoice_id, version)}"
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                page = browser.new_page()
                seen: list[str] = []  # what the browser saw, kept for diagnosing a failed render
                page.on("console", lambda m: seen.append(f"console.{m.type}: {m.text}") if m.type in ("error", "warning") else None)
                page.on("requestfailed", lambda r: seen.append(f"request failed: {r.url} {r.failure}"))
                page.on("response", lambda r: seen.append(f"{r.status} {r.url[:80]}") if r.status >= 400 or "/api/v1" in r.url else None)
                page.on("request", lambda r: seen.append(f"-> {r.url[:80]}") if "/api/v1" in r.url else None)
                page.goto(url, wait_until="networkidle", timeout=30_000)
                try:
                    page.wait_for_selector('[data-testid="invoice-paper"][data-ready="1"]', timeout=15_000)
                except Exception:
                    seen.append("page text: " + " / ".join(page.inner_text("body")[:300].splitlines()))
                    raise
                return page.pdf(format="A4", print_background=True, prefer_css_page_size=True)
            finally:
                browser.close()
    except Exception as e:  # browser missing, web app down, timeout...
        log.error("PDF render failed for %s v%s: %s | browser saw: %s", invoice_id, version, str(e).splitlines()[0], sorted(set(locals().get("seen") or []))[:6])
        raise services.Unavailable("PDF service is unavailable; please try again shortly") from e


def ensure_document(s: Session, p: Principal, invoice_id: uuid.UUID, version: int | None = None) -> InvoiceDocument:
    """Return the PDF record for that version, creating it (once) if needed."""
    invoice = services.get_invoice(s, p, invoice_id)  # branch scoping: 404 for anyone else's invoice
    if invoice.status == "DRAFT":
        raise services.Conflict("Submit the invoice before downloading a PDF")
    version = version or invoice.version
    if invoice.status == "CANCELLED" and version == invoice.version:
        raise services.Conflict("Cancelled invoices have no PDF (earlier versions are still available)")
    row = s.scalar(select(InvoiceVersion).where(InvoiceVersion.invoice_id == invoice.id,
                                                InvoiceVersion.version_number == version))
    if row is None:
        raise services.NotFound("version")
    # One generator at a time per (invoice, version): the background task and a fast
    # download click cannot both render it. The lock ends with this transaction.
    s.execute(select(func.pg_advisory_xact_lock(func.hashtext(f"{invoice.id}:{version}"))))
    doc = s.scalar(select(InvoiceDocument).where(InvoiceDocument.version_id == row.id))
    if doc:
        return doc

    data = render_pdf(invoice.id, version)
    key = f"invoices/{invoice.id}/v{version}.pdf"
    store().put(key, data)
    doc = InvoiceDocument(id=uuid.uuid4(), generated_at=datetime.now(UTC), invoice_id=invoice.id,
                          version_id=row.id, storage_path=key, checksum=hashlib.sha256(data).hexdigest(),
                          file_name=f"{invoice.invoice_number}_v{version}.pdf")
    repo.add(s, doc)
    if invoice.status == "SUBMITTED":
        invoice.status = "GENERATED"
    services.log_event(s, p, "invoice.pdf", entity_type="invoice", entity_id=invoice.id, branch_id=invoice.branch_id,
                       invoice_number=invoice.invoice_number, version=version, sha256=doc.checksum)
    s.commit()
    return doc


def read_document(s: Session, p: Principal, invoice_id: uuid.UUID, version: int | None) -> tuple[bytes, str]:
    doc = ensure_document(s, p, invoice_id, version)
    data = store().get(doc.storage_path)
    inv = services.get_invoice(s, p, invoice_id)
    services.log_event(s, p, "invoice.download", entity_type="invoice", entity_id=inv.id, branch_id=inv.branch_id,
                       invoice_number=inv.invoice_number, version=version or inv.version, file_name=doc.file_name)
    s.commit()
    return data, doc.file_name


def generate_quietly(invoice_id: uuid.UUID, version: int, p: Principal) -> None:
    """Background task after submit/revise. Never raises: if it fails the PDF is simply
    created on the first download instead."""
    if not settings.pdf_autogenerate:
        return
    try:
        with SessionLocal() as s:
            s.info["principal"] = p
            apply_rls(s.connection(), p)
            ensure_document(s, p, invoice_id, version)
    except Exception:
        log.exception("background PDF generation failed for %s v%s", invoice_id, version)
