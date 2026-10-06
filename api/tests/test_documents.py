"""PDF generation through the real path: API -> ReportLab (app/pdf.py) -> storage, then the PDF text is read back
and compared with the invoice."""

import io
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor

import pytest
from pypdf import PdfReader
from sqlalchemy import text

from app.config import settings
from app.db import engine
from app.storage import LocalStorage
from tests.conftest import mint

API = "/api/v1"


@pytest.fixture(scope="module", autouse=True)
def render_stack():
    settings.pdf_autogenerate = True
    yield
    settings.pdf_autogenerate = False


@pytest.fixture(scope="module")
def prods(client):
    return {p["name"]: p for p in client.get(f"{API}/products").json()}


def body(prods, lines, **extra):
    return {"company_name": "Pdf Test Co", "invoice_date": "2027-02-12", "action": "submit",
            "gstin": "27AABCT1234A1Z5", "payment_details": "UTR - 123456789012",
            "items": [{"product_id": prods[n]["id"], "quantity": q} for n, q in lines], **extra}


def pdf_text(data: bytes) -> tuple[str, int]:
    r = PdfReader(io.BytesIO(data))
    # collapse whitespace: narrow table cells wrap labels such as "Rounded off Amount.." over two lines
    # NFKC: the font renders "ff"/"fl" as single ligature glyphs
    return unicodedata.normalize("NFKC", " ".join(" ".join(p.extract_text().split()) for p in r.pages)), len(r.pages)


def docs(invoice_id):
    with engine.connect() as c:
        return c.execute(text("select d.storage_path, d.file_name, d.checksum, v.version_number "
                              "from invoice_documents d join invoice_versions v on v.id = d.version_id "
                              "where d.invoice_id = :i order by v.version_number"), {"i": invoice_id}).all()


def test_submit_generates_a_pdf_that_matches_the_invoice(client, people, prods):
    h = people["til"]["h"]
    pays = [{"mode": "UPI", "amount": "100", "reference": "UTR 555"}, {"mode": "CASH", "amount": "24"}]   # a split payment
    inv = client.post(f"{API}/invoices", json=body(prods, [("Ball Pens (Matt Finish)", 3)], payments=pays), headers=h).json()
    (row,) = docs(inv["id"])  # created by the background task right after submit
    assert row.version_number == 1 and row.file_name == f"{inv['invoice_number']}_v1.pdf"
    assert re.fullmatch(rf"invoices/{inv['id']}/v1\.pdf", row.storage_path)  # built from ids only, never user text

    stored = LocalStorage(settings.storage_dir).get(row.storage_path)  # exists in (private) storage
    assert stored.startswith(b"%PDF")
    text_, pages = pdf_text(stored)
    assert pages == 1
    for expected in ("PROFORMA INVOICE", "Mahratta Chamber of Commerce, Industries and Agriculture",
                     "GSTIN - 27AAATM5559Q1ZS", "PAN - AAATM5559Q", inv["invoice_number"],
                     "Company Name", "Pdf Test Co", "27AABCT1234A1Z5", "12/Feb/2027",
                     "Ball Pens (Matt Finish)", "96081019", "35.00", "105.00", "9.45", "123.90", "124.00",
                     "One Hundred Twenty Four only", "UTR - 123456789012",
                     "UPI Rs. 100.00 (UTR 555) + Cash Rs. 24.00",
                     "Rounded off Amount..", "For MCCIA", "Authorized Signatory"):
        assert expected in text_, f"{expected!r} missing; tail: {text_[-600:]!r}"
    # generated after submit -> the invoice moved to GENERATED
    assert client.get(f"{API}/invoices/{inv['id']}", headers=h).json()["status"] == "GENERATED"


def test_edit_creates_a_new_document_and_keeps_the_old_one(client, people, prods):
    h = people["til"]["h"]
    inv = client.post(f"{API}/invoices", json=body(prods, [("Badges", 10)]), headers=h).json()
    revised = body(prods, [("Badges", 100)], company_name="Renamed Pdf Co", edit_reason="qty")
    r = client.put(f"{API}/invoices/{inv['id']}", json=revised, headers=h)
    assert r.status_code == 200 and (r.json()["status"], r.json()["version"]) == ("EDITED", 2)

    v1, v2 = docs(inv["id"])
    assert (v1.version_number, v2.version_number) == (1, 2) and v1.checksum != v2.checksum
    new = client.get(f"{API}/invoices/{inv['id']}/document", headers=h)                 # current = v2
    old = client.get(f"{API}/invoices/{inv['id']}/document?version=1", headers=h)      # history stays downloadable
    assert new.status_code == old.status_code == 200
    t2, t1 = pdf_text(new.content)[0], pdf_text(old.content)[0]
    assert "Renamed Pdf Co" in t2 and "Pdf Test Co" not in t2 and "480.00" in t2 and "566.40" in t2     # 100 x 4.80 (+18%)
    assert "Pdf Test Co" in t1 and "Renamed" not in t1 and "48.00" in t1 and "56.64" in t1
    assert client.get(f"{API}/invoices/{inv['id']}", headers=h).json()["status"] == "EDITED"


def test_secure_download(client, people, prods):
    inv = client.post(f"{API}/invoices", json=body(prods, [("Badges", 1)]), headers=people["sbr"]["h"]).json()
    url = f"{API}/invoices/{inv['id']}/document"
    ok = client.get(url, headers=people["sbr"]["h"])
    assert ok.status_code == 200 and ok.headers["content-type"] == "application/pdf"
    assert ok.headers["content-disposition"] == f'attachment; filename="{inv["invoice_number"]}_v1.pdf"'
    assert ok.headers["cache-control"] == "no-store"
    assert client.get(url).status_code == 401                                             # no login
    assert client.get(url, headers=people["til"]["h"]).status_code == 404                 # another branch
    assert client.get(url, headers=people["super"]["h"]).status_code == 200               # central admin
    assert client.get(url + "?version=9", headers=people["sbr"]["h"]).status_code == 404
    draft = client.post(f"{API}/invoices", json=body(prods, [("Badges", 1)], action="draft"), headers=people["sbr"]["h"]).json()
    assert client.get(f"{API}/invoices/{draft['id']}/document", headers=people["sbr"]["h"]).status_code == 409


def test_pdf_is_created_on_first_download_when_background_generation_is_off(client, people, prods):
    settings.pdf_autogenerate = False
    try:
        h = people["had"]["h"] if "had" in people else people["sbr"]["h"]
        inv = client.post(f"{API}/invoices", json=body(prods, [("Badges", 2)]), headers=h).json()
        assert docs(inv["id"]) == []
        with ThreadPoolExecutor(3) as pool:  # simultaneous clicks must still yield exactly one document
            codes = list(pool.map(lambda _: client.get(f"{API}/invoices/{inv['id']}/document", headers=h).status_code, range(3)))
        assert codes == [200, 200, 200] and len(docs(inv["id"])) == 1
    finally:
        settings.pdf_autogenerate = True


def test_storage_refuses_path_traversal():
    with pytest.raises(ValueError):
        LocalStorage(settings.storage_dir).put("../escape.pdf", b"x")


def test_downloads_are_audited_and_cancelled_invoices_have_no_new_pdf(client, people, prods):
    h, admin = people["til"]["h"], people["til_admin"]["h"]
    inv = client.post(f"{API}/invoices", json=body(prods, [("Badges", 5)]), headers=h).json()
    assert client.get(f"{API}/invoices/{inv['id']}/document", headers=h).status_code == 200
    assert client.get(f"{API}/invoices/{inv['id']}/document?version=1", headers=admin).status_code == 200
    with engine.connect() as c:
        rows = c.execute(text("select actor_name, metadata from audit_logs where entity_id = :i and action = 'invoice.download' "
                              "order by created_at"), {"i": inv["id"]}).all()
    assert [r[0] for r in rows] == ["til", "til_admin"]
    assert rows[0][1]["file_name"] == f"{inv['invoice_number']}_v1.pdf" and rows[0][1]["version"] == 1

    assert client.post(f"{API}/invoices/{inv['id']}/cancel", json={"reason": "wrong customer"}, headers=admin).status_code == 200
    assert client.get(f"{API}/invoices/{inv['id']}/document", headers=h).status_code == 409           # v2 = cancelled: no PDF
    assert client.get(f"{API}/invoices/{inv['id']}/document?version=1", headers=h).status_code == 200  # history stays available
