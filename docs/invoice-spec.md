# Pro Forma Invoice Specification — MCCIA National Safety Week

**Status:** Phase 0 (discovery) deliverable. Derived by direct inspection of the source workbook; nothing here is a redesign.
**Source:** `reference/Master Copy of Proforma Invoice - Safety Sale - Feb 2026.xls` (copied from `~/Downloads`, 2.7 MB, BIFF8 `.xls`).
**Inspection method:** Excel 16 COM automation (formulas, values, number formats, merges, fills, borders, fonts, row/column sizes, page setup, embedded pictures) + `xlrd` (cross-check of raw values/merges) + PDF/PNG render of sheets T-10 and T-12 for visual comparison.
**Machine-readable dump:** `reference/extracted/workbook-dump.json` (every non-empty cell of all 10 sheets: address, formula, value, displayed text, number format, merge area, font).
**Extracted assets:** `reference/extracted/T10_Picture_34.png` (MCCIA logo), `T10_Picture_2.png` (round MCCIA stamp), `T10_Picture_3.png` (signature image), `T10_sheet.pdf/.png`, `T12_sheet_discount_variant.pdf/.png`.

> The 2026 workbook is the structural/visual reference only. Dates, rates, discounts and customer data inside it are **2026 historical values** (see §9).

---

## 0. What the workbook actually is

- **There is no blank master sheet.** The workbook holds **10 sheets, each a completed 2026 customer invoice**, one per sheet: `T-10 Oriental Rubber`, `T-11 Softview`, `T-12 Scon Projects`, `T-13 Keetronics`, `T-14- Accurate Indl`, `T-15 Bhate & Raje `, `T-16 Millennium `, `T-17 Emuge`, `T-18 Shogini`, `T-19 Kraftpower`. (Names have irregular trailing spaces/dashes; T-10 is the cleanest.) All are visible, none protected, no defined names, no comments, no hidden rows/columns. (Data validation was not specifically enumerated.)
- The sheet name is `T-<invoice no.> <customer short name>` — i.e. the invoice number is the sequence `T-10 … T-19` (all 2026 invoices in this file; `T-1…T-9` are not in this file).
- **Two layout variants exist:**
  - **Variant A — standard (11 columns A–K):** T-10, T-11, T-14, T-15, T-16, T-18.
  - **Variant B — discounted (12 columns A–L):** T-12, T-13, T-17, T-19. Adds one column **"Rate after Discount"** (col F) and shifts everything after it right by one. (T-13 and T-19 have stray formatting out to col R but no data beyond L.)
- Structural reference sheet used for this spec: **T-10** (variant A), **T-12** (variant B).

---

## 1. Header layout

Sheet grid: standard variant, used range `A1:K62`. Content occupies rows 1–59. A single outer border encloses the page.

| Row | Range (merged) | Text (exact) | Font / alignment |
|---|---|---|---|
| 1 | `A1:K1` | `PROFORMA INVOICE` | Calibri 13 bold, centre, borders L/T/B |
| 2 | `A2:I2` | `Mahratta Chamber of Commerce, Industries and Agriculture` | Calibri 13 bold, left, fill white |
| 3 | `A3:I3` | `505A & B Wing, 5th floor, MCCIA Trade Tower,  Senapati Bapat Road, Pune 411 016,` (note **two spaces** before "Senapati") | Calibri 11, left |
| 4 | `A4:I4` | ` Maharashtra  [State Code - 27 ], Tel. 020-27013700 Email : shriramj@mcciapune.com` (leading space, two spaces after "Maharashtra", space before/after `27`) | Calibri 11, left |
| 5 | `A5` (unmerged, overflows) | `GSTIN - 27AAATM5559Q1ZS   PAN - AAATM5559Q` (three spaces between) | Calibri 11 bold |
| 6 | — | spacer (height 12) | — |

- **Logo:** `Picture 34` — MCCIA wordmark image, anchored at `J3` (standard) / `K3` (variant B), size ≈ 87.6 × 25.2 pt, top offset ≈ 43.2 pt from sheet top (i.e. right side of rows 2–4, beside the address block).
- Printed render (T10_sheet.png): title row centred over the full width; org name + address left; logo top-right; GSTIN/PAN line at the bottom of the header block, a thin gap row, then the customer block.
- Header text is **identical on all 10 sheets** → it is configuration (org profile), not per-invoice data.

## 2. Customer section (rows 7–11)

Everything in this block is free text typed by the branch operator. Note that **labels and values live in the same cell** for three of the fields (the label is part of the string).

| Row | Cell / merge | Stored as | Field |
|---|---|---|---|
| 7 | `A7` | `Company Name  : <value>` (two spaces before colon) — single string, bold | **Company Name** |
| 8 | `A8:H8` (std) / `A8:I8` (var B) | `Address : <value>` — single string, bold, row height 25.5 | **Address** (single line, no separate city/pincode fields) |
| 10 | `A10` | `GSTIN ` (label, bold) | **GSTIN** label |
| 10 | `B10:C10` | value, e.g. `27AAACO1592L1Z6`, bold, left | **GSTIN** value (15-char GSTIN) |
| 10 | `D10` | `Email ID` (label, bold) | **Email ID** label |
| 10 | `E10:H10` (std) / `E10:I10` (var B) | value, centred, not bold | **Email ID** value |
| 11 | `A11:H11` (std) / `A11:I11` | `Contact Person & Cell No : <name> <mobile>` — single string, bold | **Contact Person & Cell No** (name and phone are one text field, e.g. `Pawar BT 9850899901`; T-13: `Sonali Nagarkar, 9689895659`) |

Row heights: r7 21, r8 25.5, r9 21, r10 21, r11 21, r12 12.8 (blank separator).

## 3. Invoice metadata (right block, rows 7–10)

| Cell / merge | Value | Field |
|---|---|---|
| `I7:J8` (std) / `J7:K8` (var B) | `Proforma Invoice No.` (bold, left, wrapped over two lines in print) | **Proforma Invoice No.** label |
| `K7:K8` (std) / `L7:L8` (var B) | e.g. `T-10` — text (cell number-format is an accounting format, but the value is a string), bold, left | **Proforma Invoice No.** value |
| `I9:J10` (std) / `J9:K10` (var B) | `Proforma Invoice Date` (bold, left) | **Proforma Invoice Date** label |
| `K9:K10` (std) / `L9:L10` (var B) | Excel date serial, number format `[$-409]d/mmm/yyyy;@`, bold, centred. Serial 46065 → shown **12/Feb/2026** | **Proforma Invoice Date** value |

Displayed date format is `12/Feb/2026` in Excel; the Excel PDF render shows `12/Feb/2026`.

Invoice number observed pattern: `T-10 … T-19`, **plain sequential, no year, no branch code, single MCCIA series**. The system's target ID format (`NSW27-SBR-000001`, PLAN §12) is a deliberate change; see §10 open question Q2.

## 4. Item table (rows 13–52)

### 4.1 Column order

**Variant A (standard):** A `Sr.` · B `Particulars` · C `HSN Code` · D `Rate` · E `Qty.` · F `Basic Amount` · G `CGST Rate` · H `CGST AMT` · I `SGST Rate` · J `SGST AMT` · K `Total Amount`

**Variant B (discounted):** A `Sr.` · B `Particulars` · C `HSN Code` · D `Rate` · E `Qty.` · F **`Rate after Discount`** · G `Basic Amount` · H `CGST Rate` · I `CGST AMT` · J `SGST Rate` · K `SGST AMT` · L `Total Amount`

Header label text is exact (trailing period on `Sr.` and `Qty.`; `CGST AMT` and `SGST AMT` in capitals; `CGST Rate` title case). Header row 13: height 32.3, bold, centred, wrap on, **fill `#C5D9F1` (Excel colour index 24, light blue)**, thin borders all round.

### 4.2 Column widths (Excel character units, variant A, T-10)

A 5.56 · B 28.67 · C 9.33 · D 7.33 · E 7.56 · F 9.67 · G 6.56 · H 8.67 · I 6.56 · J 8.11 · K 12.78

Variant B (T-12): A 5.56 · B 26.89 · C 9.33 · D 7.33 · E 7.56 · F 8.89 · G 9.67 · H 6.56 · I 8.67 · J 6.56 · K 8.11 · L 12.78

Rows 14–52 are each 21 pt high. Data rows: Calibri 11, thin borders on all cells.

### 4.3 Row order — 39 rows (rows 14–52), all pre-populated

Every sheet contains the same 39 pre-listed rows (the operator only types **Qty.** in column E; the rest is prefilled). Sr. numbers run 1–35; **four rows carry a blank Sr.** (sub-variants of the row above): row 16 and rows 49–51.

| Sr. | Row | Particulars (exact) | HSN | Rate | CGST = SGST |
|---|---|---|---|---|---|
| 1 | 14 | Badges | 49090090 | 4.80 | 9% |
| 2 | 15 | Ball Pens | 96081019 | 20.00 | 9% |
| — | 16 | Ball Pens (Matt Finish) | 96081019 | 35.00 | 9% |
| 3 | 17 | Banners - Cloth - English - 6 x 3 | 59119090 | 390.00 | 2.5% |
| 4 | 18 | Banners - Cloth - Hindi - 6 x 3 | 59119090 | 390.00 | 2.5% |
| 5 | 19 | Banners - Cloth - Marathi - 6 x 3 | 59119090 | 390.00 | 2.5% |
| 6 | 20 | Banners - Flex - English -  6x3 (two spaces before 6x3) | 39209999 | 450.00 | 9% |
| 7 | 21 | Banners - Flex - Hindi -  6x3 | 39209999 | 450.00 | 9% |
| 8 | 22 | Banners - Flex - Marathi -  6x3 | 39209999 | 450.00 | 9% |
| 9 | 23 | Banners - PPE Flex - 5x2 | 39209999 | 430.00 | 9% |
| 10 | 24 | Caps | 61091000 | 100.00 | 2.5% |
| 11 | 25 | Coffee Mugs | 69120010 | 200.00 | 9% |
| 12 | 26 | Danglers - Set of 20 | 49119920 | 170.00 | 9% |
| 13 | 27 | Flags - Normal | 61091000 | 375.00 | 2.5% |
| 14 | 28 | Flags - Handy | 61091000 | 75.00 | 2.5% |
| 15 | 29 | Oath English  Flex | 39209999 | 270.00 | 9% |
| 16 | 30 | Oath Hindi  Flex | 39209999 | 270.00 | 9% |
| 17 | 31 | Oath Marathi  Flex | 39209999 | 270.00 | 9% |
| 18 | 32 | Pocket Books - Mr. Bulakh | 49090090 | 65.00 | 9% |
| 19 | 33 | Pocket Guide (Set of 25 Nos.) | 49090090 | 375.00 | 9% |
| 20 | 34 | Pocket Calendars - Set of 40 | 49100090 | 340.00 | 9% |
| 21 | 35 | Posters Safety | 49119920 | 130.00 | 9% |
| 22 | 36 | Posters 5-S | 49119920 | 130.00 | 9% |
| 23 | 37 | Scrolls - Do's & Don’ts - English Set of 2 | 39209999 | 670.00 | 9% |
| 24 | 38 | Scrolls - Do's & Don’ts - Marathi Set of 2 | 39209999 | 670.00 | 9% |
| 25 | 39 | PPE Scrolls Safety - English | 39209999 | 370.00 | 9% |
| 26 | 40 | PPE Scrolls Safety - Marathi | 39209999 | 370.00 | 9% |
| 27 | 41 | Scrolls Security - Marathi | 39209999 | 370.00 | 9% |
| 28 | 42 | Slogans - 7.5 x 20 | 49119920 | 70.00 | 9% |
| 29 | 43 | Slogans - 10 x 15 | 49119920 | 80.00 | 9% |
| 30 | 44 | Slogans - 15 x 20 | 49119920 | 90.00 | 9% |
| 31 | 45 | Stickers for Vehicles - Set of 30 | 49119920 | 150.00 | 9% |
| 32 | 46 | T-Shirts - L | 61091000 | 340.00 | 2.5% |
| 33 | 47 | T Shirts - XL | 61091000 | 340.00 | 2.5% |
| 34 | 48 | T Shirts - XXL | 61091000 | 340.00 | 2.5% |
| — | 49 | T-Shirts - L (Premium Quality) | 61091000 | 450.00 | 2.5% |
| — | 50 | T Shirts - XL (Premium Quality) | 61091000 | 450.00 | 2.5% |
| — | 51 | T Shirts - XXL (Premium Quality) | 61091000 | 450.00 | 2.5% |
| 35 | 52 | Water Bottle | 96170090 | 400.00 | 9% |

(The `’` above is a curly apostrophe; the `.xls` stores it as a Windows-1252 byte that some readers render as `�`.)

Cell-level facts:
- **Sr.** (A): numeric, format `0.0` (so it prints `1.0`, `2.0` … — observed in the render), centred.
- **HSN** (C): stored as **number** (not text), format General, left-aligned, 8 digits.
- **Rate** (D): number, format `_(* #,##0.00_)…` (accounting, 2 decimals).
- **Qty.** (E): **empty by default**; when typed, format `_(* #,##0_)…` (integer accounting), centred. Only truly manual numeric input in the grid.
- **CGST Rate / SGST Rate**: number `0.09` or `0.025`, format `0.0%` → prints `9.0%` / `2.5%`, centred. Typed constant per row, **not** a formula; CGST always equals SGST.
- Two text cells (`B49`, `B52` etc.) use `@` text format and slightly different font sizes (12) — inconsistency in source, not a design intent.

### 4.4 Tax rate grouping (by HSN, as it appears in the workbook)

| HSN | Items | CGST + SGST |
|---|---|---|
| 49090090 | Badges, Pocket Books, Pocket Guide | 9% + 9% |
| 96081019 | Ball Pens (both) | 9% + 9% |
| 59119090 | Cloth banners (3) | 2.5% + 2.5% |
| 39209999 | Flex banners, PPE banner, Oaths, all Scrolls | 9% + 9% |
| 61091000 | Caps, Flags (both), all T-shirts (6) | 2.5% + 2.5% |
| 69120010 | Coffee Mugs | 9% + 9% |
| 49119920 | Danglers, Posters, Slogans, Vehicle stickers | 9% + 9% |
| 49100090 | Pocket Calendars | 9% + 9% |
| 96170090 | Water Bottle | 9% + 9% |

## 5. Calculation rules (formulas, verbatim)

### 5.1 Line item — variant A (row *n*, 14 ≤ n ≤ 52)

| Cell | Formula | Meaning |
|---|---|---|
| `F{n}` Basic Amount | `=D{n}*E{n}` | rate × qty |
| `H{n}` CGST AMT | `=G{n}*F{n}` | CGST rate × basic |
| `J{n}` SGST AMT | `=F{n}*I{n}` | basic × SGST rate |
| `K{n}` Total Amount | `=J{n}+H{n}+F{n}` | basic + CGST + SGST |

No per-line rounding. Empty qty ⇒ zeros, displayed as `-` by the accounting format.

### 5.2 Line item — variant B (discounted), row *n*

| Cell | Formula |
|---|---|
| `F{n}` Rate after Discount | `=D{n}-D{n}*5%` (T-12, T-17) — or `=D{n}-D{n}*6.23%` / `=D14-D14*6.23%+0.25` (T-13, T-19) |
| `G{n}` Basic Amount | `=E{n}*F{n}` |
| `I{n}` CGST AMT | `=H{n}*G{n}` |
| `K{n}` SGST AMT | `=G{n}*J{n}` |
| `L{n}` Total Amount | `=K{n}+I{n}+G{n}` |

### 5.3 Discount logic (variant B only) — **rate-level, before tax, percentage**

- Discount is applied to the **unit rate**: `Rate after Discount = Rate − Rate × d%`. The discount is therefore inherently *pre-tax* (GST is computed on the discounted basic amount). There is no discount amount line, no discount row in the totals.
- The **discount percentage is hard-coded inside each formula** (`5%`, `6.23%`). It is *not* read from a cell. A cell above the column, `F12` (T-12 has `0.05`, filled yellow `#FFFF00`, red font, format shows `5%`), is a **visual label only** — no formula references it.
- `Rate after Discount` is **not rounded** (e.g. 4.75096, 32.8195). Downstream amounts are unrounded; only the display is 2-dp.
- T-13/T-19 (identical content) use `6.23%` on all discounted rows, and the *Badges* row uses `-D14*6.23%+0.25` — a manual per-row nudge of +0.25, so the effective badge rate is 4.75096 (not a clean percentage). This is a manual override by the operator, not a rule.
- T-13/T-19: rows where nothing was ordered contain the *non-discounted* form `=E{n}*D{n}` (e.g. `G15`, `G27`) and an empty `F{n}` — formulas are **not uniform across rows in the same sheet**.
- Variant B sheets that were checked: T-12 (5% flat), T-17 (5% flat), T-13 & T-19 (6.23%). The other six sheets are variant A with no discount.

### 5.4 Totals row (row 53)

| Variant A | Variant B |
|---|---|
| `E53 =SUM(E14:E52)` (total qty) | `E53 =SUM(E14:E52)` |
| `F53 =SUM(F14:F52)` (basic) | `G53 =SUM(G14:G52)` |
| `H53 =SUM(H14:H52)` (CGST) | `I53 =SUM(I14:I52)` |
| `J53 =SUM(J14:J52)` (SGST) | `K53 =SUM(K14:K52)` |
| `K53 =SUM(K14:K52)` (grand total, unrounded) | `L53 =SUM(L14:L52)` |

Data anomaly: in **T-13 and T-19** several totals sum `10:52` rather than `14:52` (`E53`, `I53`, `K53`, `L53`) while `G53` sums `14:52`. Rows 10–13 contain only text headers/labels in those columns so the result is unaffected, but it shows the totals formulas are hand-edited. **Do not carry that pattern forward.**

Total row label: `Total …` (ellipsis glyph; raw `.xls` read shows `Total �`) in unmerged `B53`, bold, centred, fill `#C5D9F1` like the header. Row 53 has no merged cells (see §6 for the merge list).

### 5.5 Rounding

- Row 54: label `Rounded off Amount..` (two trailing dots) and the value.
- **The rounded value is a hard-typed constant, not a formula** (`K54` = `1313` with `HasFormula = False`; `L54` in variant B likewise). The typed value equals the grand total rounded to the nearest rupee in every one of the 10 sheets:

| Sheet | Grand total (unrounded) | Rounded typed | Consistent with ROUND(x,0)? |
|---|---|---|---|
| T-10 | 1,312.60 | 1,313 | yes |
| T-11 | 283.20 | 283 | yes |
| T-12 | 5,610.9375 | 5,611 | yes |
| T-13 | 7,669.78583 | 7,670 | yes |
| T-14 | 9,968.80 | 9,969 | yes |
| T-15 | 4,331.25 | 4,331 | yes |
| T-16 | 393.75 | 394 | yes |
| T-17 | 5,612.3625 | 5,612 | yes |
| T-18 | 2,494.60 | 2,495 | yes |
| T-19 | 7,669.78583 | 7,670 | yes |

- Inference (not stated in workbook): nearest-rupee rounding. **No `.50` boundary case exists in the file**, so half-up vs half-even is *unverified* (Q5). The rounding adjustment amount itself is never displayed, only the rounded grand total.
- Rounding applies **only to the final grand total**; individual lines and subtotals are not rounded (display-only 2-dp).

### 5.6 Summary of the tax model

- Intra-state GST: CGST rate + SGST rate, each on the (post-discount) basic amount, rates differ per HSN (2.5% or 9% each). No IGST column exists anywhere.
- No TCS/TDS, freight, packing or other charges.
- No separate "Discount" total row or "Subtotal" row.

## 6. Totals section and merges (rows 53–56)

Merged ranges on T-10 (xlrd merge list converted to A1, cross-checked with Excel `MergeArea`), 21 in total:

- Header: `A1:K1`, `A2:I2`, `A3:I3`, `A4:I4`, `J2:K5` (blank block behind the logo picture, which is anchored at `J3`)
- Customer / metadata: `A8:H8`, `B10:C10`, `E10:H10`, `A11:H11`, `I11:K11` (blank), `I7:J8`, `K7:K8`, `I9:J10`, `K9:K10`
- Totals / footer: `A54:G54` (blank), `H54:J54` (`Rounded off Amount..`), `A55:H56` (Amount in Words), `I55:K55` (`For MCCIA`), `I56:K58` (stamp + signature area), `A57:H59` (Payment Details), `I59:K59` (`Authorized Signatory`)

All 10 sheets report 21 merges; variant B is shifted one column right.

| Row | Element | Content |
|---|---|---|
| 53 | Totals row | `Total …` in B; total qty (E); basic (F); CGST amt (H); SGST amt (J); grand total (K). Bold, fill `#C5D9F1`, thin borders. Rates columns G and I are empty. |
| 54 | Rounded off | `H54:J54` = `Rounded off Amount..` (bold, centred); `K54` = rounded grand total (bold, white fill, accounting 2-dp) |
| 55–56 | Amount in Words | `A55:H56` = `Amount in Words : <words> ` — label and value in **one string**, left, top-aligned, wrap |
| 57–59 | Payment Details | `A57:H59` = `Payment Details : <text>` — one string, Calibri **12**, wrapped, top-aligned, **fill yellow `#FFFF00`** (Excel colour index 6) |

Amount in words: **hand-typed**, not a formula; not standardised: `one Thousand Three Hundred Thirteen only ` (lower-case "one"), `Two Hundred Eighty Three only ` (no "Rupees"), `Four Thousand Three Hundred Thirty One ony ` (typo), `Three Hundred Ninty Four only` (typo), `Five Thousand Six Hundred Eleven only ` (no space after colon). Convention observed: Title-Case words, **no "Rupees" prefix, no paise, ending in "only"**, based on the *rounded* total.

Payment details are free text: bank ref types (`UTR - …`, `UPI - …`, `Paid thur QR code -UTR - …`) followed by payer name. Recorded after payment; so the proforma is issued *with* payment reference filled in (or the field is completed on receipt).

## 7. Footer / signatory area (rows 55–59, right side)

| Element | Location | Detail |
|---|---|---|
| `For MCCIA` | `I55:K55` (std) / `J55:L55` (var B) | bold, centred |
| Stamp image | `Picture 2` anchored `I56` (std) / `J56` (var B) | round blue MCCIA stamp: "MAHRATTA CHAMBER OF COMMERCE, INDUSTRIES AND AGRICULTURE · PUNE · MAHARASHTRA (INDIA)"; ≈ 85.8 × 57.0 pt |
| Signature image | `Picture 3` anchored `J56` / `K56` | "Authorised Signatory / P V SASIDHARAN / EXECUTIVE" with hand signature; ≈ 62.4 × 50.4 pt |
| `Authorized Signatory` | `I59:K59` (std) / `J59:L59` (var B) | bold, centred |

Both images overlap the blank merged block `I56:K58`, stamp to the left, signature to the right, stacked horizontally between `For MCCIA` and `Authorized Signatory`.

The **signatory printed inside the signature image is a named person ("P V Sasidharan, Executive")**. This name is baked into the image, not present as text in any cell (Q6).

No terms & conditions, no bank details, no "computer generated" note, no page number/footer text exist in the workbook (print header/footer strings are empty).

## 8. Page setup / print

| Setting | Value (T-10 style sheets) | Variant B |
|---|---|---|
| Orientation | Portrait | Portrait |
| Paper size | code 9 = A4 (rendered as Letter 612×792 by Excel's default printer in export — printer-dependent) | same |
| Zoom | 70% fixed | 65% fixed |
| Fit to pages | `FitToPagesWide=1, FitToPagesTall=1` is set but **ignored** because `Zoom` is numeric | same |
| Margins (pt) | left/right 50.4 (0.70"), top/bottom 54.0 (0.75") | same |
| Print area | not defined (whole used range) | not defined |
| Manual page break | 1 horizontal break (1 sheet has 0) — the invoice **spills to 2 pages** in PDF export (items 1–51 on page 1, water bottle + totals + footer on page 2) | same |
| Header/footer | empty | empty |
| Print titles | none | none |
| Gridlines | shown on screen; print uses cell borders | |

Consequence: the Excel invoice is effectively a **two-page printout**; the digital PDF should aim to fit sensibly on A4 (Q7), since the Excel behaviour is an artefact of zoom/paper defaults, not a design requirement.

Visual vocabulary (to be reproduced, not redesigned): Calibri throughout (11 pt body, 13 pt title/org name, 12 pt payment details); thin black borders on every table cell and around blocks; header/total fill `#C5D9F1`; payment-details fill `#FFFF00`; discount % marker cell in red bold on yellow; black text; logo top-right; outer page border.

---

## 9. Historical (2026) values vs. structural fields to carry into 2027

### 9.1 2026 historical / configuration values — must be configurable, never hard-coded as 2027 truth

- All customer data, invoice numbers `T-10…T-19`, invoice dates (12–17 Feb 2026 serials 46065–46070), payment references, amounts.
- All **rates** (Badges 4.80, Ball Pens 20, Matt 35, banners 390/450/430, caps 100, mugs 200, danglers 170, flags 375/75, oaths 270, pocket book 65, guide 375, calendars 340, posters 130, scrolls 670/370, slogans 70/80/90, stickers 150, T-shirts 340 / 450 premium, water bottle 400).
- **Discount percentages** (5%, 6.23%, +0.25 tweak) and the concept of when they apply (early-bird / negotiated) — brochure text says 5% (₹3000+) and 10% (₹10,000+) early-bird to 15 Feb 2026; workbook shows 5% and 6.23% actual usage. Both are 2026.
- **GST rates and HSN codes** — must be re-verified for 2027 (rates can change; some HSN assignments look questionable, see Q8).
- Product **list membership** (39 rows) — a starting catalogue only.
- Organisation profile text (address, phone, e-mail, GSTIN, PAN, signatory image, stamp image) — same on all sheets, so structurally constant, but store as configuration (a person may change: `shriramj@mcciapune.com`, signatory name).
- Branch: **the workbook has no branch concept** — there is one MCCIA header; branch context is new in 2027 (PLAN §2).

### 9.2 Structural fields that carry into 2027 (labels exact)

| Group | Fields (exact label) |
|---|---|
| Title | `PROFORMA INVOICE` |
| Org block | org name, address (2 lines), state code 27, tel, email, `GSTIN`, `PAN`, logo |
| Customer | `Company Name`, `Address`, `GSTIN`, `Email ID`, `Contact Person & Cell No` |
| Metadata | `Proforma Invoice No.`, `Proforma Invoice Date` |
| Item columns | `Sr.`, `Particulars`, `HSN Code`, `Rate`, `Qty.`, [`Rate after Discount` — conditional], `Basic Amount`, `CGST Rate`, `CGST AMT`, `SGST Rate`, `SGST AMT`, `Total Amount` |
| Totals | `Total …` row (qty, basic, CGST, SGST, total), `Rounded off Amount..` |
| Words / payment | `Amount in Words`, `Payment Details` |
| Footer | `For MCCIA`, stamp, signature, `Authorized Signatory` |
| Formulas | basic = rate×qty; CGST/SGST = rate×basic each; line total = basic+CGST+SGST; column sums; final = nearest-rupee rounding of grand total |

## 10. Open questions where inspection is inconclusive

| # | Question | What was found | Needed from |
|---|---|---|---|
| Q1 | Is there a *blank master* template? | File is named "Master Copy" but contains only 10 filled invoices. Blank structure is inferred from T-10. | MCCIA to confirm; also whether `T-1…T-9` exist elsewhere |
| Q2 | Invoice number format | 2026: `T-<n>`, single series, no year/branch. PLAN §12 target: `NSW27-SBR-000001`. Should the visible "Proforma Invoice No." on the printed invoice be the new ID? | MCCIA |
| Q3 | Discount policy for 2027 | 2026 practice = per-invoice % applied to rate (before tax), hard-coded in formulas; % varied (5%, 6.23%) and once nudged by +0.25. How are % chosen (brochure early-bird 5% ≥₹3000 / 10% ≥₹10,000 vs custom)? Is a custom % allowed? Should discounted rate be rounded to 2dp before multiplying? Should the "Rate after Discount" column appear only when a discount exists (as in 2026 variant B)? | MCCIA |
| Q4 | Discount base for the ₹3000/₹10,000 thresholds | Not in workbook (only in brochure). Threshold on pre-discount basic or on invoice total incl. GST? | MCCIA |
| Q5 | Rounding rule at .50 | All 10 samples round to nearest ₹; no exact .50. Half-up assumed? Is the rounding adjustment (e.g. +0.40) to be shown as its own value? (2026 shows only the rounded figure.) | MCCIA |
| Q6 | Signatory | Image says "P V Sasidharan, Executive". Which signatory/stamp images are valid for 2027; is a per-branch signatory needed for the 5 branches? | MCCIA |
| Q7 | Print target | Excel prints on two A4 pages at 70% zoom. Should PDF be 1 page or 2? | MCCIA |
| Q8 | HSN / tax correctness | Caps and *Flags* share `61091000` (a T-shirt HSN) at 2.5%; Flex banners/oaths/scrolls all `39209999`. These may be intentional or copy-through. Not to be silently "fixed". | MCCIA/CA |
| Q9 | Rate mismatches vs. brochure (PLAN §9) | Workbook: Ball Pens 20 (brochure 35), T-shirts 340 (brochure 450; workbook Premium = 450). Workbook lists "Ball Pens" and "Ball Pens (Matt Finish)" separately; PLAN lists them both. | MCCIA |
| Q10 | PLAN §8 product list is **missing 2 rows** | Workbook has 39 rows; PLAN lists 37 — missing `Scrolls - Do's & Don’ts - English Set of 2` and `… Marathi Set of 2` (₹670, HSN 39209999). PLAN also renumbers items and lists "Posters 5-S*" (workbook: `Posters 5-S`). Decision needed to add them. | Project lead |
| Q11 | Is `Sr.` numbering fixed? | 4 rows have blank Sr. (variants). Should the digital invoice renumber consecutively for the *lines actually ordered*? Workbook prints all 39 rows including zero-qty ones. | MCCIA |
| Q12 | Print only ordered lines? | Excel prints all 39 lines with `-` for zero. UX for the digital PDF unspecified. | MCCIA |
| Q13 | Amount-in-words style | Manual, inconsistent casing, typos, no "Rupees". Standardise (e.g. "Rupees … Only")? Basis = rounded total in all samples. | MCCIA |
| Q14 | Payment Details semantics | Free text incl. UTR + payer name, yellow-highlighted. Structured (mode, ref no., payer, date, amount) or keep free text? | MCCIA |
| Q15 | Customer address structure | Single line, no city/state/PIN; no place-of-supply logic (all intra-state 27). What if customer is out-of-state (IGST)? No IGST evidence in workbook. | MCCIA |
| Q16 | Yellow `5%` marker `F12` | Visual only in the file (formula hard-codes 5%). Intended as the discount-percentage input? | MCCIA |
| Q17 | Rendering fidelity | Printed values shown in this spec came from Excel; the LibreOffice-free PDF export used Letter paper by default; exact physical page size on the user's printer was not observed. | Verify with a real print / user's printer |
| Q18 | Stamp | Round stamp is a raster image. Reuse the extracted PNG (low-res: ~140×100 px) or request originals? | MCCIA |

Not inspected / limits: no hidden sheets or defined names were found; macros/VBA and external links were not specifically enumerated (Excel opened the file with no prompts); images were extracted at screen resolution by Excel (low resolution). Print appearance was verified only via Excel PDF export.
