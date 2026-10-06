"""The invoice PDF, drawn directly with ReportLab (pure Python: no browser, no Chromium).

It follows the same layout as the on-screen proforma and the Excel sheet (docs/invoice-spec.md): title, issuer
block with logo, customer block, 39-row table (11 columns, 12 with a discount), totals, amount in words,
payment details, "For MCCIA", the branch seal and the signatory line - all on one A4 page.

The content comes from the immutable version snapshot, so a given (invoice, version) always renders the same.
Text is limited to what the standard PDF fonts can print (Latin letters, digits, punctuation); any other
character is shown as "?" rather than breaking the file.
"""

import io
import re
from datetime import date
from decimal import Decimal
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

ASSETS = Path(__file__).parent / "assets"
BLUE = colors.HexColor("#C5D9F1")
LABELS = {
    "company": "Company Name", "address": "Address", "gstin": "GSTIN", "email": "Email ID",
    "contact": "Contact Person & Cell No", "inv_no": "Proforma Invoice No.", "inv_date": "Proforma Invoice Date",
    "words": "Amount in Words", "payment": "Payment Details", "rounded": "Rounded off Amount..",
    "total_row": "Total …",
}
PAYMENT_LABEL = {"CASH": "Cash", "UPI": "UPI", "CARD": "Card", "NET_BANKING": "Net banking", "OTHER": "Other"}

# (key, heading, Excel width, alignment) - the workbook's column widths decide the proportions
STD_COLS = [
    ("sr", "Sr.", 5.56, "C"), ("part", "Particulars", 28.67, "L"), ("hsn", "HSN Code", 9.33, "L"),
    ("rate", "Rate", 7.33, "R"), ("qty", "Qty.", 7.56, "C"), ("basic", "Basic Amount", 9.67, "R"),
    ("cgstR", "CGST Rate", 6.56, "C"), ("cgstA", "CGST AMT", 8.67, "R"), ("sgstR", "SGST Rate", 6.56, "C"),
    ("sgstA", "SGST AMT", 8.11, "R"), ("total", "Total Amount", 12.78, "R"),
]
DISC_COL = ("rad", "Rate after Discount", 8.89, "R")


def _safe(text: object) -> str:
    """Only characters the standard PDF fonts can print; escapes for the Paragraph mini-markup."""
    s = "" if text is None else str(text)
    s = "".join(ch if (ch == "\n" or 32 <= ord(ch) < 127 or ch in "…–—‘’“” " or 160 <= ord(ch) <= 255) else "?" for ch in s)
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _money(n: Decimal | float) -> str:
    n = Decimal(str(n))
    sign, n = ("-" if n < 0 else ""), abs(n)
    whole, frac = f"{n:.2f}".split(".")
    if len(whole) > 3:  # Indian digit grouping: 12,34,567.89
        head, tail = whole[:-3], whole[-3:]
        head = re.sub(r"(\d)(?=(\d\d)+$)", r"\1,", head)
        whole = f"{head},{tail}"
    return f"{sign}{whole}.{frac}"


def _dash(n: Decimal) -> str:
    return "-" if abs(Decimal(str(n))) < Decimal("0.0005") else _money(n)


def _inv_date(d: str) -> str:
    y, m, dd = map(int, d.split("-"))
    return f"{dd}/{date(y, m, dd).strftime('%b')}/{y}"


def _payment_text(snap: dict) -> str:
    pays = snap.get("payments") or []
    paid = sum((Decimal(str(p["amount"])) for p in pays), Decimal(0))
    payable = Decimal(str(snap["grand_total"]))
    parts = [f"{PAYMENT_LABEL.get(p['mode'], p['mode'])} Rs. {_money(Decimal(str(p['amount'])))}"
             f"{' (' + p['reference'] + ')' if p.get('reference') else ''}" for p in pays]
    lines = [" + ".join(parts)]
    if pays and payable - paid > 0:
        lines.append(f"Balance due Rs. {_money(payable - paid)}")
    if (snap.get("payment_details") or "").strip():
        lines.append(snap["payment_details"].strip())
    return "  |  ".join(x for x in lines if x)


def _seal(invoice_number: str) -> Path:
    m = re.match(r"^[A-Z0-9]+-([A-Z]{3})-\d+$", invoice_number or "")
    p = ASSETS / f"seal-{m.group(1)}.png" if m else None
    return p if p and p.exists() else ASSETS / "stamp.png"


def render_invoice_pdf(snap: dict, products: list[dict], header: dict) -> bytes:
    """snap = InvoiceOut JSON of one version; products = the event's catalogue rows in order
    (dicts: id, name, hsn_code, current_rate, cgst_rate, sr_no); header = the issuer text (admin.read_header)."""
    disc = Decimal(str(snap["discount_percent"]))
    has_disc = disc > 0
    cols = [*STD_COLS[:5], DISC_COL, *STD_COLS[5:]] if has_disc else list(STD_COLS)
    n = len(cols)
    L, H = n - 3, n - 2
    page_w, page_h = A4
    margin_x, margin_y = 24, 18
    usable_w = page_w - 2 * margin_x
    total_w = sum(c[2] for c in cols)
    widths = [usable_w * c[2] / total_w for c in cols]
    ci = {c[0]: i for i, c in enumerate(cols)}

    base = ParagraphStyle("b", fontName="Helvetica", fontSize=7, leading=8.2)
    bold = ParagraphStyle("bb", parent=base, fontName="Helvetica-Bold")
    al = {"L": TA_LEFT, "C": TA_CENTER, "R": TA_RIGHT}

    def P(text, *, b=False, size=7, align="L", color=None):
        st = ParagraphStyle("x", parent=bold if b else base, fontSize=size, leading=size * 1.18, alignment=al[align],
                            textColor=color or colors.black)
        return Paragraph(_safe(text).replace("\n", "<br/>"), st)

    items = {i["product_id"]: i for i in snap["items"] if i.get("product_id")}
    listed = {p["id"] for p in products}
    rows: list[list] = []

    def put(row: list, key: str, text: str, **kw):
        row[ci[key]] = P(text, align=dict((c[0], c[3]) for c in cols)[key], **kw)

    def line_row(sr, particulars, hsn, rate, qty, rad, basic, cr, ca, sr_, sa, total):
        r = [""] * n
        vals = {"sr": f"{sr}" if sr else "", "part": particulars, "hsn": hsn, "rate": _money(rate),
                "qty": str(qty) if qty else "", "rad": _money(rad), "basic": _dash(basic), "cgstR": f"{Decimal(str(cr)):.1f}%",
                "cgstA": _dash(ca), "sgstR": f"{Decimal(str(sr_)):.1f}%", "sgstA": _dash(sa), "total": _dash(total)}
        for k, v in vals.items():
            if k in ci:
                put(r, k, v, size=6.6 if k == "part" else 7)
        return r

    num = 0
    for p in products:
        num += 1
        it = items.get(p["id"])
        if it:
            rows.append(line_row(num, it["particulars"], it["hsn_code"], Decimal(str(it["rate"])), it["quantity"],
                                 Decimal(str(it["rate_after_discount"])), Decimal(str(it["basic_amount"])), it["cgst_rate"],
                                 it["cgst_amount"], it["sgst_rate"], it["sgst_amount"], Decimal(str(it["total_amount"]))))
        else:
            rate = Decimal(str(p["current_rate"]))
            rad = rate - rate * disc / 100
            rows.append(line_row(num, " ".join(p["name"].split()), p["hsn_code"], rate, 0, rad, 0, p["cgst_rate"], 0,
                                 p["cgst_rate"], 0, 0))
    for it in snap["items"]:  # a line whose product is no longer listed must never disappear
        if not it.get("product_id") or it["product_id"] not in listed:
            num += 1
            rows.append(line_row(num, it["particulars"], it["hsn_code"], Decimal(str(it["rate"])), it["quantity"],
                                 Decimal(str(it["rate_after_discount"])), Decimal(str(it["basic_amount"])), it["cgst_rate"],
                                 it["cgst_amount"], it["sgst_rate"], it["sgst_amount"], Decimal(str(it["total_amount"]))))

    grand = Decimal(str(snap["grand_total"]))  # the rounded payable amount
    rounding = Decimal(str(snap["rounding_adjustment"]))
    total_qty = sum(i["quantity"] for i in snap["items"])
    words = snap["amount_in_words"] if snap["items"] else ""

    # ---- the grid: every row has n cells; spans merge them
    data: list[list] = []
    spans: list[tuple] = []
    heights: list[float] = []
    style: list[tuple] = []

    def add(cells: dict[int, object], h: float) -> int:
        row = [""] * n
        for c, v in cells.items():
            row[c] = v
        data.append(row)
        heights.append(h)
        return len(data) - 1

    def span(c0, r0, c1, r1):
        if (c0, r0) != (c1, r1):
            spans.append(("SPAN", (c0, r0), (c1, r1)))

    r_title = add({0: P(header["title"], b=True, size=11, align="C")}, 20)
    span(0, r_title, n - 1, r_title)
    style.append(("BOX", (0, r_title), (-1, r_title), 0.7, colors.black))
    logo = Image(str(ASSETS / "logo.png"), width=62, height=21)
    r_name = add({0: P(header["name"], b=True, size=10), H: logo}, 17)
    r_a1 = add({0: P(header["address_lines"][0], size=7.4)}, 13)
    r_a2 = add({0: P(header["address_lines"][1], size=7.4)}, 13)
    r_tax = add({0: P(f"GSTIN - {header['gstin']}   PAN - {header['pan']}", b=True, size=7.6)}, 15)
    for r in (r_name, r_a1, r_a2, r_tax):
        span(0, r, H - 1, r)
    span(H, r_name, n - 1, r_tax)
    style += [("BOX", (0, r_name), (-1, r_tax), 0.7, colors.black), ("ALIGN", (H, r_name), (n - 1, r_tax), "CENTER"),
              ("VALIGN", (H, r_name), (n - 1, r_tax), "MIDDLE")]
    r_sp1 = add({}, 5)
    span(0, r_sp1, n - 1, r_sp1)
    style.append(("LINEBEFORE", (0, r_sp1), (0, r_sp1), 0.7, colors.black))
    style.append(("LINEAFTER", (n - 1, r_sp1), (n - 1, r_sp1), 0.7, colors.black))

    c0 = add({0: P(f"{LABELS['company']}  : {snap['company_name']}", b=True),
              L: P(LABELS["inv_no"], b=True), n - 1: P(snap["invoice_number"], b=True, size=6, align="C")}, 17)
    c1 = add({0: P(f"{LABELS['address']} : {snap['address']}", b=True)}, 21)
    c2 = add({L: P(LABELS["inv_date"], b=True), n - 1: P(_inv_date(snap["invoice_date"]), b=True, align="C")}, 9)
    c3 = add({0: P(LABELS["gstin"], b=True), 1: P(snap["gstin"], b=True), 3: P(LABELS["email"], b=True),
              4: P(snap["email"], align="C")}, 17)
    contact = " ".join(x for x in (snap["contact_person"], snap["contact_phone"]) if x)
    c4 = add({0: P(f"{LABELS['contact']} : {contact}", b=True)}, 17)
    span(0, c0, L - 1, c0); span(L, c0, L + 1, c1); span(n - 1, c0, n - 1, c1)
    span(0, c1, L - 1, c1)
    span(0, c2, L - 1, c2); span(L, c2, L + 1, c3); span(n - 1, c2, n - 1, c3)
    span(1, c3, 2, c3); span(4, c3, L - 1, c3)
    span(0, c4, L - 1, c4); span(L, c4, n - 1, c4)
    style += [("GRID", (0, c0), (-1, c4), 0.7, colors.black), ("VALIGN", (0, c0), (-1, c4), "MIDDLE")]

    r_sp2 = add({}, 8)
    if has_disc:
        data[r_sp2][ci["rad"]] = P(f"{disc.normalize():f}%", b=True, align="C", color=colors.red)
        style.append(("BACKGROUND", (ci["rad"], r_sp2), (ci["rad"], r_sp2), colors.yellow))
        span(0, r_sp2, ci["rad"] - 1, r_sp2)
        span(ci["rad"] + 1, r_sp2, n - 1, r_sp2)
    else:
        span(0, r_sp2, n - 1, r_sp2)
    style.append(("LINEBEFORE", (0, r_sp2), (0, r_sp2), 0.7, colors.black))
    style.append(("LINEAFTER", (n - 1, r_sp2), (n - 1, r_sp2), 0.7, colors.black))

    r_head = add({i: P(c[1], b=True, size=6.8, align="C") for i, c in enumerate(cols)}, 24)
    style += [("BACKGROUND", (0, r_head), (-1, r_head), BLUE), ("GRID", (0, r_head), (-1, r_head), 0.7, colors.black),
              ("VALIGN", (0, r_head), (-1, r_head), "MIDDLE")]

    # item rows get whatever height is left on the page (at most 12pt)
    footer_h = 17 + 16 + 14 + 20 + 20 + 16 + 17
    used = sum(heights) + footer_h
    row_h = max(8.5, min(12, (page_h - 2 * margin_y - used - 6) / max(1, len(rows))))
    first_item = len(data)
    for r in rows:
        add(dict(enumerate(r)), row_h)
    last_item = len(data) - 1
    style += [("GRID", (0, first_item), (-1, last_item), 0.5, colors.black), ("VALIGN", (0, first_item), (-1, last_item), "MIDDLE")]

    tot = {i: "" for i in range(n)}
    tot[ci["part"]] = P(LABELS["total_row"], b=True, align="C")
    tot[ci["qty"]] = P(_money(total_qty), b=True, align="R")
    tot[ci["basic"]] = P(_money(Decimal(str(snap["subtotal"]))), b=True, align="R")
    tot[ci["cgstA"]] = P(_money(Decimal(str(snap["cgst_total"]))), b=True, align="R")
    tot[ci["sgstA"]] = P(_money(Decimal(str(snap["sgst_total"]))), b=True, align="R")
    tot[ci["total"]] = P(_money(grand - rounding), b=True, align="R")
    r_tot = add(tot, 17)
    r_rnd = add({n - 4: P(LABELS["rounded"], b=True, align="C"), n - 1: P(_dash(grand), b=True, align="R")}, 17)
    span(n - 4, r_rnd, n - 2, r_rnd)
    style += [("GRID", (0, r_tot), (-1, r_rnd), 0.7, colors.black), ("BACKGROUND", (0, r_tot), (-1, r_tot), BLUE),
              ("BACKGROUND", (n - 4, r_rnd), (-1, r_rnd), BLUE), ("VALIGN", (0, r_tot), (-1, r_rnd), "MIDDLE")]
    span(0, r_rnd, n - 5, r_rnd)

    # footer: words | For MCCIA / seal / signatory on the right; payment details under the words
    seal = Image(str(_seal(snap["invoice_number"])), width=46, height=46)
    pay_style = ParagraphStyle("p", parent=base, fontSize=7.6, leading=9, backColor=None)
    f1 = add({0: P(f"{LABELS['words']} : {words}", size=7.4), L: P(header["for_org"], b=True, align="C")}, 16)
    f2 = add({L: seal}, 14)
    f3 = add({0: Paragraph(_safe(f"{LABELS['payment']} : {_payment_text(snap)}"), pay_style)}, 20)
    f4 = add({}, 20)
    f5 = add({L: P(header["signatory"], b=True, align="C")}, 16)
    span(0, f1, L - 1, f2); span(L, f1, n - 1, f1)
    span(L, f2, n - 1, f4)
    span(0, f3, L - 1, f5); span(L, f5, n - 1, f5)
    style += [("GRID", (0, f1), (-1, f5), 0.7, colors.black), ("BACKGROUND", (0, f3), (L - 1, f5), BLUE),
              ("VALIGN", (0, f1), (L - 1, f1), "TOP"), ("VALIGN", (0, f3), (L - 1, f3), "TOP"),
              ("ALIGN", (L, f2), (-1, f4), "CENTER"), ("VALIGN", (L, f2), (-1, f4), "MIDDLE"),
              ("VALIGN", (L, f1), (-1, f1), "MIDDLE"), ("VALIGN", (L, f5), (-1, f5), "MIDDLE"),
              ("LEFTPADDING", (0, 0), (-1, -1), 2.5), ("RIGHTPADDING", (0, 0), (-1, -1), 2.5),
              ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]

    table = Table(data, colWidths=widths, rowHeights=heights, repeatRows=0)
    table.setStyle(TableStyle([*style, *spans]))
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=margin_x, rightMargin=margin_x, topMargin=margin_y,
                            bottomMargin=margin_y, title=f"Proforma Invoice {snap['invoice_number']}",
                            author="MCCIA", creator="MCCIA Safety Week Proforma")
    doc.build([table])
    return buf.getvalue()
