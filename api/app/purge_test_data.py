"""Clear the test invoices (and their PDFs) before go-live.  DRY RUN BY DEFAULT: nothing is deleted unless you say so.

    python -m app.purge_test_data --before 2026-10-12                      # shows what WOULD be removed
    python -m app.purge_test_data --before 2026-10-12 --transfers --shoppers
    python -m app.purge_test_data --before 2026-10-12 --delete --confirm "DELETE TEST DATA"

`--before` is a date: only things created BEFORE that day (00:00 India time) are touched, so anything real entered
from launch day on is safe. It runs against whatever DATABASE_URL points at - the line "Database:" at the top shows which.

Removes (all in one transaction - all or nothing):
  * invoices created before the cutoff, with their lines, payments, versions, edit requests and stored PDFs
  * the online-store orders that belong to those invoices
  * optionally (--transfers) stock transfers between branches, (--shoppers) online-store shopper accounts and login codes
  * then restarts each branch's invoice numbering at 000001 - but only where NO invoice remains for that branch/event
Keeps: branches, users, products and rates, opening stock and low-stock levels, the event, discount rules, settings, and the
AUDIT LOG (it is append-only by design; the test entries in it are harmless).
Razorpay test-mode payments live in Razorpay's own test dashboard, not here.
Take a database backup (a Neon branch / restore point) BEFORE running with --delete.
"""

import argparse
import sys
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.engine import make_url

from .config import settings
from .db import engine

IST = timezone(timedelta(hours=5, minutes=30))
PHRASE = "DELETE TEST DATA"


def main() -> int:
    ap = argparse.ArgumentParser(prog="purge_test_data", description="Remove test invoices before go-live (dry run unless --delete).")
    ap.add_argument("--before", required=True, help="YYYY-MM-DD: only things created before this day (India time) are removed")
    ap.add_argument("--transfers", action="store_true", help="also remove stock transfers made before the cutoff")
    ap.add_argument("--shoppers", action="store_true", help="also remove online-store shopper accounts and login codes created before the cutoff")
    ap.add_argument("--delete", action="store_true", help="really delete (otherwise it only reports)")
    ap.add_argument("--confirm", default="", help=f'must be exactly "{PHRASE}" together with --delete')
    a = ap.parse_args()

    try:
        cutoff = datetime.combine(date.fromisoformat(a.before), datetime.min.time(), IST)
    except ValueError:
        sys.exit("--before must be a date like 2026-10-12")
    if a.delete and a.confirm != PHRASE:
        sys.exit(f'Refusing to delete: add --confirm "{PHRASE}" (or leave out --delete to only look).')

    url = make_url(settings.database_url)
    print(f"Database: {url.host}:{url.port}/{url.database}   ({'DELETE' if a.delete else 'dry run - nothing will be deleted'})")
    print(f"Cutoff:   created before {cutoff:%d %b %Y %H:%M} India time\n")

    with engine.begin() as c:
        p = {"t": cutoff}
        inv = "SELECT id FROM invoices WHERE created_at < :t"
        n = lambda sql: c.execute(text(sql), p).scalar_one()  # noqa: E731

        print("Would remove:" if not a.delete else "Removing:")
        rows = [
            ("invoices", n(f"SELECT count(*) FROM invoices WHERE created_at < :t")),
            ("  invoice lines", n(f"SELECT count(*) FROM invoice_items WHERE invoice_id IN ({inv})")),
            ("  payments", n(f"SELECT count(*) FROM invoice_payments WHERE invoice_id IN ({inv})")),
            ("  versions", n(f"SELECT count(*) FROM invoice_versions WHERE invoice_id IN ({inv})")),
            ("  PDFs (documents)", n(f"SELECT count(*) FROM invoice_documents WHERE invoice_id IN ({inv})")),
            ("  edit requests", n(f"SELECT count(*) FROM edit_requests WHERE invoice_id IN ({inv})")),
            ("online-store orders", n(f"SELECT count(*) FROM orders WHERE invoice_id IN ({inv})")),
        ]
        if a.transfers:
            rows.append(("stock transfers", n("SELECT count(*) FROM stock_transfers WHERE created_at < :t")))
        if a.shoppers:
            rows.append(("shopper accounts", n("SELECT count(*) FROM customers WHERE created_at < :t")))
            rows.append(("login codes", n("SELECT count(*) FROM login_codes WHERE created_at < :t")))
        for label, count in rows:
            print(f"  {count:>6}  {label}")
        kept = n("SELECT count(*) FROM invoices WHERE created_at >= :t")
        print(f"\nInvoices that stay (created on/after the cutoff): {kept}")
        first_last = c.execute(text("SELECT min(invoice_number), max(invoice_number) FROM invoices WHERE created_at < :t"), p).one()
        print(f"Invoice numbers affected: {first_last[0]} to {first_last[1]}")
        per_branch = c.execute(text("""
            SELECT b.code, count(*) FILTER (WHERE i.created_at < :t) AS gone, count(*) FILTER (WHERE i.created_at >= :t) AS stay
              FROM branches b LEFT JOIN invoices i ON i.branch_id = b.id GROUP BY b.code ORDER BY b.code"""), p).all()
        print("Per branch  (removed / staying): " + ", ".join(f"{code} {gone}/{stay}" for code, gone, stay in per_branch))

        if not a.delete:
            print("\nNothing was deleted. Re-run with --delete --confirm \"DELETE TEST DATA\" when you are sure (backup first).")
            return 0

        # PDFs stored in the database (production). Files on disk, if any, are not touched.
        c.execute(text(f"DELETE FROM stored_files WHERE key IN (SELECT storage_path FROM invoice_documents WHERE invoice_id IN ({inv}))"), p)
        c.execute(text(f"DELETE FROM orders WHERE invoice_id IN ({inv})"), p)
        c.execute(text("DELETE FROM invoices WHERE created_at < :t"), p)  # lines, payments, versions, documents, edit requests cascade
        if a.transfers:
            c.execute(text("DELETE FROM stock_transfers WHERE created_at < :t"), p)
        if a.shoppers:
            c.execute(text("DELETE FROM login_codes WHERE created_at < :t"), p)
            c.execute(text("DELETE FROM customers WHERE created_at < :t AND id NOT IN (SELECT customer_id FROM orders WHERE customer_id IS NOT NULL)"), p)
        # numbering restarts at 000001 only where nothing is left for that branch + event
        c.execute(text("""UPDATE invoice_sequences s SET next_value = 1
                           WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.branch_id = s.branch_id AND i.event_id = s.event_id)"""))
        print("\nDone. The transaction is committed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
