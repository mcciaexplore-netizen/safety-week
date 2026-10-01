"""Pydantic request/response models (the API contract).

Deliberately absent from the create request: branch_id, invoice_number, created_by
and every amount. The server derives the branch from the authenticated identity
(PLAN 26.11), allocates the number, and recalculates all totals itself (PLAN 11).
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    database: Literal["ok", "unreachable"]


class BranchOut(Out):
    id: uuid.UUID
    code: str
    name: str
    address: str
    phone: str
    email: str


class MeOut(Out):
    """Who the SERVER says you are. The browser must use this, not its own idea of branch/role."""

    id: uuid.UUID
    name: str
    email: str
    role: str
    branch: BranchOut | None


class EventOut(Out):
    id: uuid.UUID
    name: str
    year: int
    invoice_prefix: str
    start_date: date | None
    end_date: date | None
    status: str


class ProductOut(Out):
    id: uuid.UUID
    sku: str
    name: str
    hsn_code: str
    unit: str
    current_rate: Decimal
    cgst_rate: Decimal
    sgst_rate: Decimal
    sr_no: int | None
    line_order: int


class InvoiceItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: uuid.UUID
    quantity: int = Field(ge=0)
    # Optional rate override; the service decides whether the caller's role may use it.
    rate: Decimal | None = Field(default=None, ge=0)


class PaymentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["CASH", "UPI", "CARD", "NET_BANKING", "OTHER"]
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    reference: str = Field(default="", max_length=200)  # UTR / card slip / cheque no. / what "other" means


class InvoiceCreate(BaseModel):
    # Unknown keys (e.g. branch_id, role, status) are rejected, never silently honoured.
    model_config = ConfigDict(extra="forbid")

    company_name: str = Field(min_length=1, max_length=300)
    address: str = ""
    gstin: str = Field(default="", pattern=r"^$|^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
    email: EmailStr | Literal[""] = ""
    contact_person: str = ""
    contact_phone: str = ""
    invoice_date: date
    discount_percent: Decimal = Field(default=Decimal(0), ge=0, le=100)
    items: list[InvoiceItemIn] = []
    amount_in_words: str | None = None  # None = generate
    payment_details: str = ""  # free-text notes, printed after the structured payments
    payments: list[PaymentIn] = Field(default_factory=list, max_length=6)
    action: Literal["draft", "submit"] = "draft"


class InvoiceUpdate(InvoiceCreate):
    edit_reason: str = Field(default="", max_length=500)  # stored with the version when a submitted invoice is revised


class InvoiceItemOut(Out):
    id: uuid.UUID
    product_id: uuid.UUID | None
    particulars: str
    hsn_code: str
    rate: Decimal
    quantity: int
    discount_percent: Decimal
    rate_after_discount: Decimal
    basic_amount: Decimal
    cgst_rate: Decimal
    cgst_amount: Decimal
    sgst_rate: Decimal
    sgst_amount: Decimal
    total_amount: Decimal
    line_order: int


class PaymentOut(Out):
    mode: str
    amount: Decimal
    reference: str


class InvoiceOut(Out):
    id: uuid.UUID
    invoice_number: str
    branch_id: uuid.UUID
    event_id: uuid.UUID
    status: str
    created_by_name: str
    company_name: str
    address: str
    gstin: str
    email: str
    contact_person: str
    contact_phone: str
    invoice_date: date
    discount_percent: Decimal
    subtotal: Decimal
    cgst_total: Decimal
    sgst_total: Decimal
    rounding_adjustment: Decimal
    grand_total: Decimal
    amount_in_words: str
    payment_details: str
    payments: list[PaymentOut] = []
    amount_paid: Decimal = Decimal(0)
    payment_status: str = "UNPAID"
    version: int
    created_at: datetime
    updated_at: datetime
    items: list[InvoiceItemOut]


class CancelIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=3, max_length=500)


class VersionOut(BaseModel):
    """One row of an invoice's history. The full record is at /invoices/{id}/versions/{n}."""

    version_number: int
    created_at: datetime
    edited_by_name: str
    edit_reason: str
    status: str
    grand_total: Decimal


class AuditOut(Out):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    created_at: datetime
    actor_name: str
    branch_id: uuid.UUID | None
    action: str
    entity_type: str
    entity_id: uuid.UUID | None
    metadata: dict = Field(validation_alias="metadata_")
