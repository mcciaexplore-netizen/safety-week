"""Schema for PLAN.md section 15. Statuses/roles are text + CHECK (not PG enums) so
adding a value is a one-line migration. Money is NUMERIC; the workbook keeps
unrounded amounts, so line amounts carry 6 decimal places."""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

ROLES = ("SUPER_ADMIN", "BRANCH_ADMIN", "BRANCH_USER")
EVENT_STATUSES = ("PLANNING", "OPEN", "CLOSED")
PAYMENT_MODES = ("CASH", "UPI", "CARD", "NET_BANKING", "OTHER")
INVOICE_STATUSES = ("DRAFT", "SUBMITTED", "GENERATED", "EDITED", "CANCELLED")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))


def fk(target: str, *, nullable: bool = False, ondelete: str | None = None) -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), ForeignKey(target, ondelete=ondelete), nullable=nullable)


def created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


class Base(DeclarativeBase):
    pass


class Branch(Base):
    __tablename__ = "branches"
    id: Mapped[uuid.UUID] = pk()
    code: Mapped[str] = mapped_column(String(3), unique=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    address: Mapped[str] = mapped_column(Text, default="")
    phone: Mapped[str] = mapped_column(String(50), default="")
    email: Mapped[str] = mapped_column(String(200), default="")
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_at: Mapped[datetime] = created()


class User(Base):
    """App profile mapped to the auth provider's user (Supabase auth.users.id)."""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(_in("role", ROLES), name="ck_users_role"),
        # Only a central admin may be branchless.
        CheckConstraint("role = 'SUPER_ADMIN' OR branch_id IS NOT NULL", name="ck_users_branch_required"),
    )
    id: Mapped[uuid.UUID] = pk()
    auth_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320), unique=True)
    role: Mapped[str] = mapped_column(String(20))
    branch_id: Mapped[uuid.UUID | None] = fk("branches.id", nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_at: Mapped[datetime] = created()


class Event(Base):
    """Per-year campaign configuration. Admin-editable; nothing here is hard-coded in the UI."""

    __tablename__ = "events"
    __table_args__ = (
        UniqueConstraint("name", "year"),
        CheckConstraint(_in("status", EVENT_STATUSES), name="ck_events_status"),
    )
    id: Mapped[uuid.UUID] = pk()
    name: Mapped[str] = mapped_column(String(200))
    year: Mapped[int] = mapped_column(Integer)
    invoice_prefix: Mapped[str] = mapped_column(String(10), unique=True)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(10), server_default="PLANNING")
    notes: Mapped[str] = mapped_column(Text, default="")


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("event_id", "sku"),
        CheckConstraint("current_rate >= 0", name="ck_products_rate"),
    )
    id: Mapped[uuid.UUID] = pk()
    event_id: Mapped[uuid.UUID] = fk("events.id")
    sku: Mapped[str] = mapped_column(String(30))
    name: Mapped[str] = mapped_column(String(200))  # exact workbook "Particulars" text
    description: Mapped[str] = mapped_column(Text, default="")
    hsn_code: Mapped[str] = mapped_column(String(10))
    unit: Mapped[str] = mapped_column(String(20), server_default="Nos.")
    current_rate: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    cgst_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    sgst_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    sr_no: Mapped[int | None] = mapped_column(Integer)  # workbook "Sr."; blank for variant rows
    # False = still the 2026 workbook value. An admin must confirm/edit the rate for the current event.
    rate_confirmed: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    line_order: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


class DiscountRule(Base):
    __tablename__ = "discount_rules"
    __table_args__ = (
        CheckConstraint(
            "(percentage IS NOT NULL) <> (fixed_amount IS NOT NULL)", name="ck_discount_one_kind"
        ),
    )
    id: Mapped[uuid.UUID] = pk()
    event_id: Mapped[uuid.UUID] = fk("events.id")
    name: Mapped[str] = mapped_column(String(200))
    threshold: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    percentage: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    fixed_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    valid_from: Mapped[date | None] = mapped_column(Date)
    valid_until: Mapped[date | None] = mapped_column(Date)
    conditions: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = (
        CheckConstraint(_in("status", INVOICE_STATUSES), name="ck_invoices_status"),
        CheckConstraint("discount_percent BETWEEN 0 AND 100", name="ck_invoices_discount"),
        Index("ix_invoices_branch_updated", "branch_id", "updated_at"),
    )
    id: Mapped[uuid.UUID] = pk()
    invoice_number: Mapped[str] = mapped_column(String(40), unique=True)  # NSW27-TIL-000001
    event_id: Mapped[uuid.UUID] = fk("events.id")
    branch_id: Mapped[uuid.UUID] = fk("branches.id")
    created_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    created_by_name: Mapped[str] = mapped_column(String(200), server_default="")  # snapshot
    company_name: Mapped[str] = mapped_column(String(300))
    address: Mapped[str] = mapped_column(Text, default="")
    gstin: Mapped[str] = mapped_column(String(15), default="")
    email: Mapped[str] = mapped_column(String(320), default="")
    contact_person: Mapped[str] = mapped_column(String(200), default="")
    contact_phone: Mapped[str] = mapped_column(String(50), default="")
    invoice_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(10), server_default="DRAFT")
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), server_default="0")
    subtotal: Mapped[Decimal] = mapped_column(Numeric(16, 6), server_default="0")
    cgst_total: Mapped[Decimal] = mapped_column(Numeric(16, 6), server_default="0")
    sgst_total: Mapped[Decimal] = mapped_column(Numeric(16, 6), server_default="0")
    rounding_adjustment: Mapped[Decimal] = mapped_column(Numeric(16, 6), server_default="0")
    grand_total: Mapped[Decimal] = mapped_column(Numeric(16, 2), server_default="0")  # rounded payable
    amount_in_words: Mapped[str] = mapped_column(Text, default="")
    payment_details: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, server_default="1")
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    items: Mapped[list["InvoiceItem"]] = relationship(
        back_populates="invoice", order_by="InvoiceItem.line_order", cascade="all, delete-orphan"
    )
    payments: Mapped[list["InvoicePayment"]] = relationship(
        order_by="InvoicePayment.line_order", cascade="all, delete-orphan"
    )

    @property
    def amount_paid(self) -> Decimal:
        return sum((p.amount for p in self.payments), Decimal(0))

    @property
    def payment_status(self) -> str:
        paid = self.amount_paid
        if paid <= 0:
            return "UNPAID"
        return "PAID" if paid >= self.grand_total else "PARTIAL"


class InvoiceItem(Base):
    """Snapshot of product name/HSN/rate/tax at invoice time (catalogue changes never rewrite history)."""

    __tablename__ = "invoice_items"
    __table_args__ = (UniqueConstraint("invoice_id", "line_order"),)
    id: Mapped[uuid.UUID] = pk()
    invoice_id: Mapped[uuid.UUID] = fk("invoices.id", ondelete="CASCADE")
    product_id: Mapped[uuid.UUID | None] = fk("products.id", nullable=True)
    particulars: Mapped[str] = mapped_column(String(200))
    hsn_code: Mapped[str] = mapped_column(String(10))
    rate: Mapped[Decimal] = mapped_column(Numeric(12, 4))
    quantity: Mapped[int] = mapped_column(Integer)
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), server_default="0")
    rate_after_discount: Mapped[Decimal] = mapped_column(Numeric(16, 6))
    basic_amount: Mapped[Decimal] = mapped_column(Numeric(16, 6))
    cgst_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    cgst_amount: Mapped[Decimal] = mapped_column(Numeric(16, 6))
    sgst_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    sgst_amount: Mapped[Decimal] = mapped_column(Numeric(16, 6))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(16, 6))
    line_order: Mapped[int] = mapped_column(Integer)
    invoice: Mapped[Invoice] = relationship(back_populates="items")


class InvoiceVersion(Base):
    __tablename__ = "invoice_versions"
    __table_args__ = (UniqueConstraint("invoice_id", "version_number"),)
    id: Mapped[uuid.UUID] = pk()
    invoice_id: Mapped[uuid.UUID] = fk("invoices.id", ondelete="CASCADE")
    version_number: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSONB)
    edited_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    edited_by_name: Mapped[str] = mapped_column(String(200), server_default="")  # snapshot
    edit_reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = created()


class InvoiceDocument(Base):
    __tablename__ = "invoice_documents"
    __table_args__ = (UniqueConstraint("version_id"),)  # one PDF per invoice version
    id: Mapped[uuid.UUID] = pk()
    invoice_id: Mapped[uuid.UUID] = fk("invoices.id", ondelete="CASCADE")
    version_id: Mapped[uuid.UUID | None] = fk("invoice_versions.id", nullable=True)
    storage_path: Mapped[str] = mapped_column(Text)
    file_name: Mapped[str] = mapped_column(String(255))
    checksum: Mapped[str | None] = mapped_column(String(64))
    generated_at: Mapped[datetime] = created()


class InvoiceSequence(Base):
    """One counter per (branch, event); allocated atomically in repositories.next_invoice_number."""

    __tablename__ = "invoice_sequences"
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), primary_key=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), primary_key=True)
    next_value: Mapped[int] = mapped_column(Integer, server_default="1")


class AuditLog(Base):
    """Append-only (database trigger). Written by services and by triggers on users/config tables."""

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_created", "created_at"),
        Index("ix_audit_logs_entity", "entity_type", "entity_id"),
    )
    id: Mapped[uuid.UUID] = pk()
    actor_user_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    actor_name: Mapped[str] = mapped_column(String(200), server_default="")  # snapshot
    branch_id: Mapped[uuid.UUID | None] = fk("branches.id", nullable=True)
    action: Mapped[str] = mapped_column(String(60))
    entity_type: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = created()


class Package(Base):
    """A bundle definition (e.g. a starter pack). Definition only for now: invoices do not apply packages yet."""

    __tablename__ = "packages"
    __table_args__ = (UniqueConstraint("event_id", "name"),)
    id: Mapped[uuid.UUID] = pk()
    event_id: Mapped[uuid.UUID] = fk("events.id")
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    fixed_price: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    items: Mapped[list["PackageItem"]] = relationship(cascade="all, delete-orphan", order_by="PackageItem.id")


class PackageItem(Base):
    __tablename__ = "package_items"
    __table_args__ = (
        UniqueConstraint("package_id", "product_id"),
        CheckConstraint("quantity > 0", name="ck_package_items_qty"),
    )
    id: Mapped[uuid.UUID] = pk()
    package_id: Mapped[uuid.UUID] = fk("packages.id", ondelete="CASCADE")
    product_id: Mapped[uuid.UUID] = fk("products.id")
    quantity: Mapped[int] = mapped_column(Integer)


class AppSetting(Base):
    """Small admin-editable settings, e.g. key 'invoice_header'."""

    __tablename__ = "app_settings"
    id: Mapped[uuid.UUID] = pk()
    key: Mapped[str] = mapped_column(String(60), unique=True)
    value: Mapped[dict] = mapped_column(JSONB)


class InvoicePayment(Base):
    """One leg of the payment. A split payment is simply several rows (e.g. UPI 500 + Cash 324)."""

    __tablename__ = "invoice_payments"
    __table_args__ = (
        CheckConstraint(_in("mode", PAYMENT_MODES), name="ck_invoice_payments_mode"),
        CheckConstraint("amount > 0", name="ck_invoice_payments_amount"),
        Index("ix_invoice_payments_invoice", "invoice_id"),
    )
    id: Mapped[uuid.UUID] = pk()
    invoice_id: Mapped[uuid.UUID] = fk("invoices.id", ondelete="CASCADE")
    mode: Mapped[str] = mapped_column(String(12))
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    reference: Mapped[str] = mapped_column(String(200), server_default="")  # UTR, card slip, cheque / DD no ...
    line_order: Mapped[int] = mapped_column(Integer)


class BranchStock(Base):
    """Opening stock per branch and material. Remaining stock is computed from invoices (see stock.py)."""

    __tablename__ = "branch_stock"
    __table_args__ = (
        UniqueConstraint("branch_id", "product_id"),
        CheckConstraint("opening_qty >= 0 AND low_threshold >= 0", name="ck_branch_stock_nonneg"),
    )
    id: Mapped[uuid.UUID] = pk()
    branch_id: Mapped[uuid.UUID] = fk("branches.id")
    product_id: Mapped[uuid.UUID] = fk("products.id")
    opening_qty: Mapped[int] = mapped_column(Integer)
    low_threshold: Mapped[int] = mapped_column(Integer, server_default="10")
