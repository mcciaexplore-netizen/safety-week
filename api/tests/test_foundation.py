from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app import services
from app.db import SessionLocal
from app.models import Branch, Event, Product, User
from app.seed import seed

ROOT = Path(__file__).resolve().parents[1]
FIVE = {"SBR": "SB Road", "TIL": "Tilak Road", "BHO": "Bhosari", "HAD": "Hadapsar", "AHL": "Ahilyanagar"}


def test_health(client):
    assert client.get("/health").json() == {"status": "ok", "database": "ok"}


def test_exactly_the_five_locked_branches(client, session):
    api = {b["code"]: b["name"] for b in client.get("/api/v1/branches").json()}
    assert api == FIVE
    assert session.scalar(text("select count(*) from branches")) == 5  # nothing obsolete seeded


def test_event_and_products_come_from_the_database(client):
    event = client.get("/api/v1/events/current").json()
    assert (event["year"], event["invoice_prefix"], event["start_date"]) == (2027, "NSW27", None)
    products = client.get("/api/v1/products").json()
    assert len(products) == 39  # the workbook's 39 rows, incl. both Do's & Don'ts scrolls
    assert [p["line_order"] for p in products] == list(range(1, 40))
    assert products[0]["name"] == "Badges" and products[-1]["name"] == "Water Bottle"
    assert sum("Do's & Don’ts" in p["name"] for p in products) == 2
    assert {p["cgst_rate"] for p in products} == {"9.00", "2.50"}


def test_seed_is_idempotent_and_keeps_admin_edits(session):
    product = session.scalars(select(Product).where(Product.sku == "NSW-001")).one()
    product.current_rate = 5.25  # an admin sets the 2027 rate
    session.commit()
    seed(session)
    session.refresh(product)
    assert float(product.current_rate) == 5.25
    assert session.scalar(text("select count(*) from products")) == 39
    assert session.scalar(text("select count(*) from branches")) == 5
    product.current_rate = 4.80
    session.commit()


def test_migrations_match_models():
    command.check(Config(str(ROOT / "alembic.ini")))  # raises if a model change lacks a migration


def test_invoice_numbers_are_sequential_per_branch(session):
    a = services.allocate_invoice_number(session, "TIL")
    b = services.allocate_invoice_number(session, "TIL")
    c = services.allocate_invoice_number(session, "HAD")
    session.commit()
    seq = lambda n: int(n.rsplit("-", 1)[1])  # noqa: E731 - other test modules also consume numbers
    assert a.startswith("NSW27-TIL-") and b.startswith("NSW27-TIL-") and c.startswith("NSW27-HAD-")
    assert seq(b) == seq(a) + 1 and len(a.rsplit("-", 1)[1]) == 6


def test_invoice_numbers_are_unique_under_concurrency():
    def grab(_):
        with SessionLocal() as s:
            n = services.allocate_invoice_number(s, "AHL")
            s.commit()
            return n

    with ThreadPoolExecutor(10) as pool:
        numbers = list(pool.map(grab, range(30)))
    assert len(set(numbers)) == 30


def test_database_rejects_bad_data(session):
    branch = session.scalars(select(Branch).where(Branch.code == "SBR")).one()
    event = session.scalars(select(Event)).one()
    for bad in (
        User(name="x", email="a@x.invalid", role="BRANCH_USER"),  # branch user without a branch
        User(name="x", email="b@x.invalid", role="ROOT", branch_id=branch.id),  # unknown role
    ):
        session.add(bad)
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()
    session.add(User(name="Central", email="c@x.invalid", role="SUPER_ADMIN"))  # branchless admin is fine
    session.flush()
    with pytest.raises(IntegrityError):  # invoice status is constrained
        session.execute(
            text(
                "insert into invoices (invoice_number,event_id,branch_id,company_name,invoice_date,status) "
                "values ('X-1',:e,:b,'Co',current_date,'BOGUS')"
            ),
            {"e": event.id, "b": branch.id},
        )
    session.rollback()
