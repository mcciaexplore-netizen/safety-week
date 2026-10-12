"""Create Safety Week cash receipts in Payment Desk's existing receipt series.

This module intentionally uses a second, server-only database connection. It
does not add a new counter: allocation uses Payment Desk's serial_counters row
and writes cash_receipts + audit_log in the same transaction.
"""

import json
import uuid
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from .config import settings

IST = ZoneInfo("Asia/Kolkata")
BRANCHES = {
    "SBR": "SB Road Office",
    "TIL": "Tilak Road Office",
    "BHO": "Bhosari Office",
    "HAD": "Hadapsar Office",
    "AHL": "Ahilyanagar Office",
}
BRANCH_CODES = {name: code for code, name in BRANCHES.items()}


class PaymentDeskNotConfigured(Exception):
    pass


class PaymentDeskAccessDenied(Exception):
    pass


@lru_cache(maxsize=1)
def _engine() -> Engine:
    url = settings.payment_desk_database_url.strip()
    if not url:
        raise PaymentDeskNotConfigured
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url.removeprefix("postgres://")
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_recycle=300,
        pool_size=1,
        max_overflow=0,
        connect_args={"prepare_threshold": None},
    )


def _number(branch: str, receipt_date: date, sequence: int) -> tuple[str, str]:
    code = BRANCH_CODES[branch]
    start_year = receipt_date.year if receipt_date.month >= 4 else receipt_date.year - 1
    financial_year = f"{start_year}-{(start_year + 1) % 100:02d}"
    return f"CR/{code}/{financial_year}/{sequence:04d}", financial_year


def _receipt(row) -> dict:
    return {
        "id": str(row["id"]),
        "serial_no": row["serial_no"],
        "receipt_date": row["receipt_date"].isoformat(),
        "branch": row["branch"],
        "party_name": row["party_name"],
        "gstin": row["gstin"] or "",
        "items": row["items"],
        "total": str(row["total"]),
        "issued_by": row["submitted_by_name"],
        "official": True,
    }


def _authorized_issuer(connection, email: str, branch: str):
    issuer = connection.execute(
        text("""select id, full_name, email from admin_users
                where lower(email) = lower(:email) and is_active = true limit 1"""),
        {"email": email.strip()},
    ).mappings().first()
    if not issuer:
        raise PaymentDeskAccessDenied
    grant = connection.execute(
        text("""select 1 from admin_user_roles
                where admin_user_id = :user_id
                  and role in ('BRANCH', 'CASH_RECEIPT')
                  and scope_value = :branch
                limit 1"""),
        {"user_id": issuer["id"], "branch": branch},
    ).first()
    if not grant:
        raise PaymentDeskAccessDenied
    return issuer


def _find_receipt(connection, source_invoice_id: uuid.UUID):
    return connection.execute(
        text("""select r.id, r.serial_no, r.receipt_date, r.branch, r.party_name,
                       r.gstin, r.items, r.total, r.submitted_by_name
                from audit_log a
                join cash_receipts r on r.id = a.cash_receipt_id
                where a.action = 'CASH_RECEIPT_SUBMITTED'
                  and a.details->>'sourceSystem' = 'SAFETY_WEEK'
                  and a.details->>'sourceInvoiceId' = :invoice_id
                order by a.created_at desc limit 1"""),
        {"invoice_id": str(source_invoice_id)},
    ).mappings().first()


def get_receipt(source_invoice_id: uuid.UUID, email: str, branch_code: str) -> dict | None:
    branch = BRANCHES.get(branch_code)
    if not branch:
        raise PaymentDeskAccessDenied
    with _engine().connect() as connection:
        _authorized_issuer(connection, email, branch)
        row = _find_receipt(connection, source_invoice_id)
        return _receipt(row) if row else None


def create_receipt(*, source_invoice_id: uuid.UUID, invoice_number: str, party_name: str,
                   gstin: str, amount: Decimal, email: str, branch_code: str,
                   ip_address: str | None = None) -> dict:
    branch = BRANCHES.get(branch_code)
    if not branch:
        raise PaymentDeskAccessDenied
    total = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if total <= 0:
        raise ValueError("Cash amount must be greater than zero")

    with _engine().begin() as connection:
        # Serialize retries for this source invoice, then return any receipt
        # already saved. This prevents a repeated submit from consuming a new
        # official number or creating a duplicate receipt.
        connection.execute(
            text("select pg_advisory_xact_lock(hashtext(:lock_key))"),
            {"lock_key": f"safety-week-cash-receipt:{source_invoice_id}"},
        )
        issuer = _authorized_issuer(connection, email, branch)
        existing = _find_receipt(connection, source_invoice_id)
        if existing:
            return _receipt(existing)

        receipt_date = datetime.now(IST).date()
        _, financial_year = _number(branch, receipt_date, 1)
        series = f"CASH_RECEIPT:{branch}"
        connection.execute(
            text("""insert into serial_counters (financial_year, series, last_number)
                    values (:financial_year, :series, 0)
                    on conflict (financial_year, series) do nothing"""),
            {"financial_year": financial_year, "series": series},
        )
        counter = connection.execute(
            text("""select last_number from serial_counters
                    where financial_year = :financial_year and series = :series
                    for update"""),
            {"financial_year": financial_year, "series": series},
        ).mappings().one()
        sequence = int(counter["last_number"]) + 1
        serial_no, _ = _number(branch, receipt_date, sequence)
        connection.execute(
            text("""update serial_counters set last_number = :next_number
                    where financial_year = :financial_year and series = :series"""),
            {"next_number": sequence, "financial_year": financial_year, "series": series},
        )

        total_text = f"{total:.2f}"
        items = [{
            "particulars": f"Cash received for Safety Week invoice {invoice_number}",
            "copies": 1,
            "price": total_text,
            "amount": total_text,
        }]
        saved = connection.execute(
            text("""insert into cash_receipts
                    (serial_no, financial_year, branch, receipt_date, party_name, gstin,
                     items, total, issued_by_user_id, submitted_by_name, submitted_by_email)
                    values (:serial_no, :financial_year, :branch, :receipt_date, :party_name,
                            :gstin, cast(:items as jsonb), :total, :issuer_id, :issuer_name, :issuer_email)
                    returning id, serial_no, receipt_date, branch, party_name, gstin,
                              items, total, submitted_by_name"""),
            {
                "serial_no": serial_no,
                "financial_year": financial_year,
                "branch": branch,
                "receipt_date": receipt_date,
                "party_name": party_name.strip(),
                "gstin": gstin.strip() or None,
                "items": json.dumps(items),
                "total": total_text,
                "issuer_id": issuer["id"],
                "issuer_name": issuer["full_name"],
                "issuer_email": issuer["email"],
            },
        ).mappings().one()
        details = json.dumps({
            "serialNo": serial_no,
            "branch": branch,
            "total": total_text,
            "sourceSystem": "SAFETY_WEEK",
            "sourceInvoiceId": str(source_invoice_id),
            "sourceInvoiceNumber": invoice_number,
        })
        connection.execute(
            text("""insert into audit_log (cash_receipt_id, action, actor, ip_address, details)
                    values (:receipt_id, 'CASH_RECEIPT_SUBMITTED', :actor, :ip, cast(:details as jsonb))"""),
            {"receipt_id": saved["id"], "actor": issuer["full_name"],
             "ip": ip_address, "details": details},
        )
        return _receipt(saved)
