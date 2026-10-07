"""Idempotent reference-data seed: `python -m app.seed`.

Branches are locked by PLAN 2 (exactly five). The event and product rows are the
2026 workbook values used as a STARTING catalogue - an admin edits them for 2027;
they are data, not code.
"""

import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .db import SessionLocal
from .admin import DEFAULT_HEADER
from .catalogue import category_of, slugify
from .models import AppSetting, Branch, Event, Product

BRANCHES = [
    ("SBR", "SB Road", "MCCIA Trade Tower, Senapati Bapat Road, Pune"),
    ("TIL", "Tilak Road", "Tilak Road, Pune"),
    ("BHO", "Bhosari", "Bhosari, Pune"),
    ("HAD", "Hadapsar", "Hadapsar, Pune"),
    ("AHL", "Ahilyanagar", "Ahilyanagar, Maharashtra"),
]

PRODUCTS = json.loads((Path(__file__).parent / "seed_data" / "products.json").read_text("utf-8"))


def seed(s: Session) -> None:
    for code, name, address in BRANCHES:
        s.execute(
            insert(Branch)
            .values(code=code, name=name, address=address, email=f"{name.lower().replace(' ', '')}@example.invalid")
            .on_conflict_do_update(index_elements=[Branch.code], set_={"name": name})
        )

    s.execute(
        insert(Event)
        .values(name="National Safety Week", year=2027, invoice_prefix="NSW27", status="PLANNING",
                notes="Dates to be confirmed by MCCIA.")
        .on_conflict_do_nothing(index_elements=[Event.invoice_prefix])
    )
    event = s.scalars(select(Event).where(Event.invoice_prefix == "NSW27")).one()

    for p in PRODUCTS:
        s.execute(
            insert(Product)
            .values(
                event_id=event.id, sku=f"NSW-{p['line_order']:03d}", name=p["name"], hsn_code=p["hsn_code"],
                current_rate=p["rate"], cgst_rate=p["gst_half_rate"], sgst_rate=p["gst_half_rate"],
                sr_no=p["sr_no"], line_order=p["line_order"], slug=slugify(p["name"]), category=category_of(p["name"]),
            )
            # Re-seeding never overwrites an admin's edits to rates or names.
            .on_conflict_do_nothing(index_elements=[Product.event_id, Product.sku])
        )
    s.execute(insert(AppSetting).values(key="invoice_header", value=DEFAULT_HEADER)
              .on_conflict_do_nothing(index_elements=[AppSetting.key]))
    s.commit()


if __name__ == "__main__":
    with SessionLocal() as session:
        seed(session)
    print("seeded")
