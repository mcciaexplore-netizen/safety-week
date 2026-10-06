"""Invoice PDFs.

Drawn directly from the immutable version snapshot by app/pdf.py (ReportLab, pure Python - no browser), so the
same (invoice, version) always gives the same document. Each version's PDF is stored once (see storage.py) with a
checksum, and every creation and download is written to the audit log.
"""

import hashlib
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import admin
from . import repositories as repo
from . import services
from .auth import Principal, apply_rls
from .config import settings
from .db import SessionLocal
from .models import InvoiceDocument, InvoiceVersion, Product
from .pdf import render_invoice_pdf
from .storage import store

log = logging.getLogger("documents")


def render_pdf(s: Session, invoice, version_row: InvoiceVersion) -> bytes:
    products = [
        {"id": p.id, "name": p.name, "hsn_code": p.hsn_code, "current_rate": p.current_rate, "cgst_rate": p.cgst_rate,
         "sr_no": p.sr_no}
        for p in s.scalars(select(Product).where(Product.event_id == invoice.event_id, Product.active).order_by(Product.line_order))
    ]
    snap = {**version_row.snapshot, "id": str(invoice.id)}
    # product ids in the snapshot are strings; the catalogue rows hold UUIDs
    for p in products:
        p["id"] = str(p["id"])
    try:
        return render_invoice_pdf(snap, products, admin.read_header(s))
    except Exception as e:
        log.exception("PDF render failed for %s v%s", invoice.id, version_row.version_number)
        raise services.Unavailable("The PDF could not be created; please try again shortly") from e


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

    data = render_pdf(s, invoice, row)
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
