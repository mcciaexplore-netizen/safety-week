# MCCIA National Safety Week 2027 — Pro Forma Invoice System

## 0. Document Purpose

This file is the **single source of truth** for the project.

Claude must read `PLAN.md` before making implementation decisions and must treat the decisions here as the current project contract. `PROMPTS.md` contains phase-by-phase execution instructions. Claude may propose an architectural change when required, but must document the reason, impact, and migration plan before changing a locked decision.

The immediate business priority is:

> **Complete a fully navigable, visually showable UI today, especially the editable Pro Forma Invoice and its live preview.**

Backend/auth/security can be integrated after the visual workflow is stable, but the UI must be built against the final data model so it does not need to be thrown away later.

---

# 1. Project Overview

Build a web application for MCCIA's **National Safety Week 2027** safety-awareness-material sales workflow.

The application starts at a main portal and guides the user through:

1. National Safety Week 2027 entry point
2. Branch selection / branch authentication
3. Branch dashboard
4. Editable Pro Forma Invoice
5. Real-time invoice preview
6. Submit / save
7. PDF generation and download
8. Invoice history
9. Search by unique invoice ID
10. Edit/revise an existing invoice
11. Admin dashboard across all branches

The application must preserve the look, wording, structure, totals, and business fields of the supplied Excel Pro Forma Invoice as the source-of-truth reference.

The supplied workbook is:

`Master Copy of Proforma Invoice - Safety Sale - Feb 2026.xls`

Use that workbook as the **invoice layout and field reference**. It is a 2026 master/reference file; the product/event configuration for the application is targeted at 2027 and therefore must be configurable rather than hard-coded to 2026 dates.

---

# 2. Actual Branches — LOCKED

The application has exactly these five operational branches/workspaces:

1. **SB Road** — code `SBR`
2. **Tilak Road** — code `TIL`
3. **Bhosari** — code `BHO`
4. **Hadapsar** — code `HAD`
5. **Ahilyanagar** — code `AHL`

Do not use the previously discussed branch names such as Sadar or Bhusari. Those are obsolete and must not appear anywhere in the application.

Human-facing branch names and codes should come from the database/configuration layer, not be duplicated throughout UI code.

---

# 3. Core Architecture Decision

## 3.1 One codebase, five isolated branch workspaces

Use one application codebase with strict tenant/branch isolation.

Do **not** build five independent applications for the first release.

Every branch-owned record must carry a `branch_id`. Every protected backend request must resolve the authenticated user's branch and enforce authorization against that branch.

Target data isolation model:

`User -> Role + Branch -> API authorization -> Database RLS -> Branch-owned records`

A branch user can only access records for their assigned branch.

A central admin can access all five branches.

If MCCIA later requires physical database separation, the data-access layer must be designed so that this can be introduced later without rewriting the UI.

---

# 4. Recommended Technology Stack

## Frontend

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui
- React Hook Form
- Zod
- TanStack Query where remote/server state is required

## Backend

- Python
- FastAPI
- Pydantic
- SQLAlchemy or SQLModel
- PostgreSQL

## Platform services

- Supabase PostgreSQL
- Supabase Auth, or a compatible authentication layer if the deployment requires it
- Supabase Storage for generated PDFs and application assets

## PDF

- Reusable HTML/CSS invoice template
- Playwright/Chromium PDF rendering

The browser preview and generated PDF must use the same invoice template/data model so that:

`Live Preview ~= Final PDF`

The implementation must avoid maintaining two separate invoice layouts that can drift apart.

## Version control / deployment

- GitHub
- Vercel for Next.js frontend
- Render or Railway for FastAPI backend
- Supabase for database/auth/storage

The exact production host can be finalized during deployment, but local development must work independently of hosting.

---

# 5. Product Goals

## Primary goals

- Make the Pro Forma Invoice digitally editable.
- Make it visually match the existing MCCIA format.
- Show the invoice preview live while the user enters data.
- Generate a downloadable PDF.
- Persist each invoice in a database.
- Provide searchable invoice history.
- Allow controlled editing/revision.
- Give each invoice a unique, human-readable ID.
- Ensure branch-to-branch data isolation.
- Provide a central admin role.

## Secondary goals

- Product catalog and pricing should be configurable.
- Event year and event dates should be configurable.
- Branch information should be configurable.
- Discount rules should be configurable.
- Payment/notes/terms should be configurable.
- Audit history should be preserved.

---

# 6. Immediate UI Milestone — TODAY

The first successful build today is not the full production system. It is a **showable, end-to-end front-end prototype** that demonstrates the complete user journey with realistic data.

Minimum showable flow:

`Landing -> National Safety Week 2027 -> Branch Selection -> Branch Login Mock -> Branch Dashboard -> Create Pro Forma -> Editable Invoice -> Live Preview -> Submit Simulation -> History -> View/Edit`

The first milestone must work in the browser without requiring a production database.

Use local/mock data behind clean TypeScript interfaces so the real backend can be plugged in later.

### Today acceptance criteria

- No dead-end navigation.
- All five correct branch names are visible.
- Branch selection changes the active branch context.
- Login screen is visually complete even if authentication is mocked.
- Dashboard is visually complete.
- Invoice editor is fully editable.
- Invoice line items can be added/removed/updated.
- Calculated amounts update live.
- Live invoice preview updates from the same form state.
- Submit creates a realistic success state.
- History table shows saved mock invoices.
- Search by invoice ID/customer works client-side.
- Edit opens the existing invoice back into the form.
- Responsive behavior is acceptable on laptop/tablet widths.

Do not spend the first UI milestone implementing obscure backend infrastructure that blocks the visual demo.

---

# 7. Invoice Source of Truth

The supplied workbook contains the following recognizable header fields. The names must be preserved unless the actual workbook inspection proves a different exact label/placement:

- Proforma Invoice No.
- Proforma Invoice Date
- Email ID
- Particulars
- HSN Code
- Rate
- Qty.
- Basic Amount
- CGST Rate
- CGST AMT
- SGST Rate
- SGST AMT
- Total Amount
- Rounded off Amount..
- For MCCIA
- Authorized Signatory

The customer section also includes fields appearing in the source workbook:

- Company Name
- Address
- GSTIN
- Email ID
- Contact Person & Cell No
- Amount in Words
- Payment Details

The MCCIA header reference in the source workbook includes:

`Mahratta Chamber of Commerce, Industries and Agriculture`

`505A & B Wing, 5th floor, MCCIA Trade Tower, Senapati Bapat Road, Pune 411 016, Maharashtra [State Code - 27]`

`Tel. 020-27013700`

`Email: shriramj@mcciapune.com`

`GSTIN - 27AAATM5559Q1ZS`

`PAN - AAATM5559Q`

Treat these as reference/configuration values. Do not scatter them through components.

---

# 8. Product/Material Master Reference

The supplied workbook contains these invoice line-item labels. Preserve them as configured product/material records.

> **Updated 2026-09-30 (Phase 0 decision: use the highest count):** the workbook has **39 rows**, not 37. The two rows `Scrolls - Do’s & Don’ts - English Set of 2` and `Scrolls - Do’s & Don’ts - Marathi Set of 2` (HSN 39209999, 2026 rate ₹670) were missing from the list below. The authoritative 39-row list with HSN/rate/tax is `docs/invoice-spec.md` §4.3 and is implemented in `lib/mock/products.ts`.

1. Badges
2. Ball Pens
3. Ball Pens (Matt Finish)
4. Banners - Cloth - English - 6 x 3
5. Banners - Cloth - Hindi - 6 x 3
6. Banners - Cloth - Marathi - 6 x 3
7. Banners - Flex - English - 6x3
8. Banners - Flex - Hindi - 6x3
9. Banners - Flex - Marathi - 6x3
10. Banners - PPE Flex - 5x2
11. Caps
12. Coffee Mugs
13. Danglers - Set of 20
14. Flags - Normal
15. Flags - Handy
16. Oath English Flex
17. Oath Hindi Flex
18. Oath Marathi Flex
19. Pocket Books - Mr. Bulakh
20. Pocket Guide (Set of 25 Nos.)
21. Pocket Calendars - Set of 40
22. Posters Safety
23. Posters 5-S*
24. PPE Scrolls Safety - English
25. PPE Scrolls Safety - Marathi
26. Scrolls Security - Marathi
27. Slogans - 7.5 x 20
28. Slogans - 10 x 15
29. Slogans - 15 x 20
30. Stickers for Vehicles - Set of 30
31. T-Shirts - L
32. T Shirts - XL
33. T Shirts - XXL
34. T-Shirts - L (Premium Quality)
35. T Shirts - XL (Premium Quality)
36. T Shirts - XXL (Premium Quality)
37. Water Bottle

The supplied safety-awareness text also references material such as banners, badges, ball pens, caps, coffee mugs, danglers, flags, oaths, pocket books, pocket calendars, posters, slogans, vehicle stickers, scrolls, T-shirts, and water bottles. The workbook line items remain the invoice-system source of truth.

---

# 9. 2026 Safety Material Reference — Do Not Hard-Code as 2027 Truth

The supplied 2026 material text says National Safety Week was observed from 4–11 March 2026 and lists these indicative prices:

- Badges — Rs. 4.80 each + GST
- Ball Pens — Rs. 35 each + GST
- Cloth Banner — Rs. 390 each + GST
- Flex Banner — Rs. 450 each + GST
- PPE Banner — Rs. 430 each + GST
- Caps — Rs. 100 each + GST
- Coffee Mugs — Rs. 200 each + GST
- Danglers — Rs. 170/set + GST
- Normal Flags — Rs. 375 each + GST
- Handy Flags — Rs. 75 each + GST
- Oaths — Rs. 270 each + GST
- Pocket Book Hindi — Rs. 65 each + GST
- Pocket Guide, set of 25 — Rs. 375 + GST
- Pocket Calendars, packet of 40 — Rs. 340 + GST
- Posters — Rs. 130 each + GST
- Slogans — Rs. 90 / Rs. 80 / Rs. 70 depending on size + GST
- Vehicle stickers, packet of 30 — Rs. 150 + GST
- PPE Scroll — Rs. 370 each + GST
- Security Scroll — Rs. 370 each + GST
- Do's & Don'ts Scroll, set of 2 — Rs. 670 + GST
- T-Shirts — Rs. 450 each + GST
- Water Bottles — Rs. 400 each + GST

The supplied 2026 text also contains campaign packages/discounts including:

- Safety Starter Pack: material of Rs. 3000+ with a stated 5% early-bird discount until 15 Feb 2026.
- Safety Bulk Pack: material of Rs. 10,000+ with a stated 10% early-bird discount until 15 Feb 2026.
- Smart Safety Pack: listed as Rs. 6500 with a defined bundle and discount period.

These are **historical 2026 reference values only**. For the 2027 application, prices, event dates, discount periods, package definitions, tax rates, and product availability must be represented as configurable master data and must never be silently copied as 2027 truth.

---

# 10. Invoice UX — LOCKED BEHAVIOR

## 10.1 Layout

Use a desktop-first two-column workspace:

```text
┌──────────────────────────────────────────────────────────────┐
│ Header / Branch / User / Save status                         │
├─────────────────────────────┬────────────────────────────────┤
│ EDITABLE FORM               │ LIVE PRO FORMA PREVIEW         │
│                             │                                │
│ Customer Information        │   Exact invoice layout         │
│ Invoice Information         │   with MCCIA branding          │
│ Item selection / rows       │                                │
│ Tax / discount              │   Updates in real time         │
│ Notes / payment details     │                                │
│                             │                                │
│ [Save Draft] [Submit]       │                                │
└─────────────────────────────┴────────────────────────────────┘
```

On smaller screens, the editor and preview may stack vertically.

## 10.2 Editable fields

Every field that is variable in the source workbook must be editable unless it is explicitly a derived/calculated field.

Derived values such as Basic Amount, tax amounts and Total Amount must be calculated, not manually typed.

## 10.3 Dynamic items

Users must be able to:

- Select a product/material.
- Enter quantity.
- See rate.
- Override rate only where business rules allow it.
- Calculate the basic amount.
- Apply tax configuration.
- Remove line items.
- Add line items.
- Reorder items if the UX needs it.

## 10.4 Preview

The preview must update immediately from the same typed data.

Do not create a second, separately-maintained preview form.

---

# 11. Calculation Model

At minimum the invoice model should support:

`basicAmount = rate * quantity`

`CGST amount = taxableAmount * CGST rate / 100`

`SGST amount = taxableAmount * SGST rate / 100`

`totalAmount = basicAmount + CGST amount + SGST amount - discount/adjustment +/− rounding`

The exact discount and rounding behavior must be verified against the source workbook before production calculations are locked.

All authoritative calculations must be repeated/validated on the server before final submission.

The UI can calculate optimistically for instant feedback.

---

# 12. Unique Invoice ID

Each invoice must have:

1. Internal UUID primary key.
2. Human-readable unique invoice identifier.

Recommended format:

- `NSW27-SBR-000001`
- `NSW27-TIL-000001`
- `NSW27-BHO-000001`
- `NSW27-HAD-000001`
- `NSW27-AHL-000001`

The sequence may be branch-specific, but the complete ID must be globally unique.

The sequence must be concurrency-safe at the database layer. Never generate IDs by counting rows in the UI.

---

# 13. Invoice Lifecycle

Recommended statuses:

- `DRAFT`
- `SUBMITTED`
- `GENERATED`
- `EDITED`
- `CANCELLED`

A future-ready implementation may also support `VOID` or `ARCHIVED`.

---

# 14. Editing / Versioning

Editing an existing invoice must not destroy the audit trail.

Recommended behavior:

`Invoice`
→ `Invoice Version 1`
→ `Invoice Version 2`
→ `Invoice Version 3`

The user normally sees the current version, while the system keeps the earlier versions for audit purposes.

Every version should capture:

- edited by
- edited at
- branch
- changed data/version number
- optional reason

---

# 15. Database Model

Initial conceptual schema:

### `branches`
- id UUID
- code
- name
- address
- phone
- email
- active
- created_at

### `users`
- id UUID
- auth_user_id
- name
- email
- role
- branch_id nullable for central admin
- active
- created_at

### `events`
- id UUID
- name
- year
- start_date
- end_date
- status
- notes

### `products`
- id UUID
- event_id
- sku
- name
- description
- hsn_code
- unit
- current_rate
- tax configuration
- active

### `discount_rules`
- id UUID
- event_id
- name
- threshold
- percentage / fixed adjustment
- valid_from
- valid_until
- conditions
- active

### `invoices`
- id UUID
- invoice_number
- event_id
- branch_id
- created_by
- customer information
- invoice date
- status
- subtotal
- discount
- cgst_total
- sgst_total
- rounding_adjustment
- grand_total
- amount_in_words
- created_at
- updated_at

### `invoice_items`
- id UUID
- invoice_id
- product_id
- particulars snapshot
- hsn snapshot
- rate
- quantity
- basic_amount
- cgst_rate
- cgst_amount
- sgst_rate
- sgst_amount
- total_amount
- line_order

Store invoice-time snapshots of product name/rate/HSN/tax labels where needed so historical invoices do not change when the catalog changes later.

### `invoice_versions`
- id UUID
- invoice_id
- version_number
- snapshot_json / normalized version record
- edited_by
- edit_reason
- created_at

### `invoice_documents`
- id UUID
- invoice_id
- version_id
- storage_path
- file_name
- generated_at
- checksum if implemented

### `invoice_sequences`
- branch_id
- event/year
- next_value

### `audit_logs`
- id UUID
- actor_user_id
- branch_id nullable
- action
- entity_type
- entity_id
- metadata JSON
- created_at

---

# 16. Authentication / Authorization

Roles:

- `SUPER_ADMIN`
- `BRANCH_ADMIN`
- `BRANCH_USER`

Rules:

### Branch user

Can:

- login
- view own branch dashboard
- create invoices for own branch
- edit permitted own-branch invoices
- download permitted own-branch PDFs
- search own-branch history

Cannot:

- view another branch
- edit another branch
- alter user roles
- alter global event configuration unless permission is explicitly granted

### Branch admin

Can do everything a branch user can do plus branch-level user/configuration operations allowed by the system.

### Super admin

Can:

- access all five branches
- manage users
- manage branches
- manage event configuration
- manage products/pricing
- view all invoices
- view reports
- view audit logs

Security must not rely only on hidden buttons or route checks in React. The API/database must enforce authorization.

---

# 17. Main Pages / Routes

Recommended route structure:

- `/`
- `/national-safety-week-2027`
- `/login`
- `/select-branch` if required before auth
- `/dashboard`
- `/invoices`
- `/invoices/new`
- `/invoices/[id]`
- `/invoices/[id]/edit`
- `/admin`
- `/admin/branches`
- `/admin/users`
- `/admin/products`
- `/admin/events`
- `/admin/reports`
- `/admin/audit-logs`

Do not let route names become coupled to individual branch names. Branch context must come from authenticated state.

---

# 18. Folder Architecture

Suggested monorepo/project structure:

```text
project-root/
├── PLAN.md
├── PROMPTS.md
├── reference/
│   ├── Master Copy of Proforma Invoice - Safety Sale - Feb 2026.xls
│   ├── safety-week-reference-notes.txt
│   └── ui-reference-images/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   ├── lib/
│   │   ├── types/
│   │   └── styles/
│   └── api/
│       ├── app/
│       ├── api/
│       ├── models/
│       ├── schemas/
│       ├── services/
│       ├── repositories/
│       └── tests/
├── packages/
│   └── shared-types/
└── docs/
```

If Claude chooses a simpler single-repository layout during the initial UI phase, keep the same logical separation between web, server, shared types and reference assets.

---

# 19. UI Design Direction

The interface should feel like a professional internal MCCIA business system rather than a generic AI dashboard.

Use:

- clean white/light surfaces
- strong typography
- restrained institutional branding
- clear section separators
- obvious form labels
- compact enterprise tables
- accessible contrast
- print-oriented invoice preview

Avoid:

- excessive gradients
- excessive animations
- glassmorphism-heavy UI
- giant decorative illustrations
- dashboard widgets that do not support the workflow

The invoice itself is the primary visual artifact and should receive most attention.

---

# 20. History UX

Columns:

- Invoice ID
- Invoice Date
- Customer / Company
- Branch
- Total Amount
- Status
- Created By
- Updated At
- Actions

Actions:

- View
- Edit
- Download PDF

Filters:

- branch (admin only)
- date range
- status
- invoice ID
- customer/company

Search must be useful even with partial invoice IDs.

---

# 21. Admin Reporting

Initial admin overview should support:

- invoice count by branch
- invoice count by date range
- total value by branch
- recent invoices
- product/material usage summary
- downloadable/reportable results later

Do not build a complicated analytics system for MVP.

---

# 22. Security Requirements

Mandatory:

- environment variables for secrets
- no secrets in frontend source
- API authorization on every protected resource
- database row-level security where supported
- branch_id derived from authenticated identity, not trusted from arbitrary client input
- server-side recalculation before final submission
- input validation with Zod/Pydantic
- parameterized DB operations through ORM/data-access layer
- safe file naming for PDFs
- controlled signed URLs for private documents if documents are private
- audit logging for create/edit/delete/permission changes

---

# 23. Testing Strategy

## Frontend

Use Playwright for critical workflows.

Minimum end-to-end scenarios:

1. Login.
2. Select branch.
3. Open new invoice.
4. Enter customer information.
5. Add item.
6. Change quantity/rate.
7. Verify calculations.
8. Verify preview updates.
9. Submit.
10. Verify history.
11. Edit.
12. Download PDF.

## Backend

Use pytest for:

- invoice creation
- calculations
- authorization
- branch isolation
- unique ID generation
- versioning
- PDF generation integration

## Security tests

Explicitly test:

- SB Road user trying to read Tilak data.
- Tilak user trying to read Bhosari data.
- branch user attempting to modify branch_id in a request.
- direct API request to another branch's invoice.
- ID guessing/enumeration.

All must be rejected.

---

# 24. Phase Plan

## PHASE 0 — Source Inspection & Final Specification

Goal:

Understand the actual workbook and lock the exact field structure, formulas, print layout, wording and assets.

Tasks:

- Inspect the supplied `.xls` in the development environment.
- Identify sheets and relevant invoice sheet(s).
- Identify merged cells/layout.
- Identify exact field positions.
- Identify formulas and discount/rounding logic.
- Identify HSN/tax values.
- Identify logos/stamps/signature assets embedded in the workbook if relevant.
- Produce a clean invoice schema.

Deliverable:

`docs/invoice-spec.md`

---

## PHASE 1 — UI FOUNDATION

Goal:

Produce the first showable UI.

Tasks:

- Next.js setup.
- Tailwind/shadcn setup.
- Layout and navigation.
- Landing page.
- National Safety Week 2027 entry page.
- Branch selection page.
- Mock login page.
- Branch dashboard.

Acceptance:

A stakeholder can click through the complete shell without dead ends.

---

## PHASE 2 — INVOICE UI / TODAY'S CRITICAL MILESTONE

Goal:

Make the editable Pro Forma Invoice visually convincing.

Tasks:

- Invoice form.
- Exact fields from source workbook.
- Customer section.
- Invoice metadata.
- Item table.
- Product selection.
- Quantity/rate fields.
- Calculation fields.
- Discount/rounding placeholders based on source.
- Live preview.
- MCCIA header/footer.
- Signature/authorization area.

Acceptance:

A user can fill the entire invoice and see the finished invoice update live.

---

## PHASE 3 — HISTORY / EDIT / DEMO SUBMISSION

Goal:

Complete a showable front-end workflow.

Tasks:

- Mock save.
- Mock generated invoice ID.
- History table.
- Search.
- View.
- Edit.
- Demo success state.
- Mock download button.

Acceptance:

The complete browser demo works from entry to invoice history.

---

## PHASE 4 — BACKEND FOUNDATION

Goal:

Connect the UI to real persisted data.

Tasks:

- PostgreSQL/Supabase setup.
- migrations.
- schema.
- repositories/services.
- event/product tables.
- invoice tables.
- versioning.

---

## PHASE 5 — AUTHENTICATION & BRANCH ISOLATION

Goal:

Replace mocked auth and enforce real tenant security.

Tasks:

- Supabase Auth.
- Roles.
- Branch claims/context.
- RLS.
- FastAPI authorization.
- User management.

---

## PHASE 6 — REAL INVOICE CRUD

Goal:

Persist real invoice drafts/submissions.

Tasks:

- create
- save draft
- update
- submit
- fetch
- list/search
- versioning

---

## PHASE 7 — PDF GENERATION

Goal:

Produce the final PDF matching the approved invoice preview.

Tasks:

- reusable HTML/CSS invoice template
- Playwright PDF generation
- storage
- download
- version-linked PDFs

---

## PHASE 8 — ADMIN PANEL

Goal:

Complete central administration.

Tasks:

- branches
- users
- products
- prices
- event configuration
- discount rules
- reports
- audit logs

---

## PHASE 9 — HARDENING & TESTING

Goal:

Production-grade behavior.

Tasks:

- unit tests
- API tests
- Playwright tests
- branch-isolation tests
- PDF tests
- validation
- error states
- empty states
- concurrency checks
- accessibility pass

---

## PHASE 10 — DEPLOYMENT / UAT

Goal:

Deploy and validate with actual MCCIA users.

Tasks:

- production environment
- domain
- database backup strategy
- monitoring
- logs
- production smoke tests
- five-branch UAT
- fixes
- handover

---

# 25. Definition of Done

A phase is not done merely because code exists.

A phase is done when:

1. The intended user flow works.
2. The UI is visually usable.
3. No known blocking errors remain.
4. Relevant tests pass.
5. Existing functionality is not broken.
6. Documentation/status is updated.
7. The next phase can start without ambiguous requirements.

---

# 26. Claude Operating Rules

1. Read `PLAN.md` before coding.
2. Read the relevant prompt in `PROMPTS.md` before executing a phase.
3. Inspect the current repository before changing it.
4. Reuse working code before rewriting it.
5. Do not silently change architecture decisions.
6. Do not remove security controls to make a demo work.
7. Keep mock services behind interfaces so they can be replaced by real APIs.
8. Do not hard-code 2026 values as 2027 business truth.
9. Do not use obsolete branch names.
10. Do not create five separate copies of the application.
11. Do not trust `branch_id` sent by the browser.
12. Keep calculation logic testable and centralized.
13. Keep preview and PDF based on the same invoice template/data model.
14. Before finishing each prompt, run the most relevant checks.
15. Update the project status/change log in `PLAN.md` after significant milestones.

---

# 27. Current Status

### Overall

`PLANNING + UI-FIRST BUILD START`

### Source references received

- MCCIA 7-step application process image.
- MCCIA National Safety Week 2026 informational text.
- `Master Copy of Proforma Invoice - Safety Sale - Feb 2026.xls`.

### Locked branches

- SB Road
- Tilak Road
- Bhosari
- Hadapsar
- Ahilyanagar

### Current priority

**Get the editable Pro Forma Invoice UI and live preview visually working first.**

### Phase status

- **PHASE 0 — Source Inspection: DONE (2026-09-30).** Deliverable: `docs/invoice-spec.md`. Open questions Q1–Q18 in that file need MCCIA confirmation before calculation rules are locked (notably discount policy Q3/Q4, rounding at .50 Q5, invoice-number display Q2).
- **PHASE 1 — UI Foundation: DONE (2026-09-30).** Next.js 16 + TypeScript + Tailwind 4 + shadcn/ui (base-nova). All 9 routes render; typecheck, lint, production build and 3 Playwright e2e tests pass. Mock services sit behind interfaces in `lib/services/types.ts`.
- **PHASE 2 — Editable Pro Forma UI: DONE (2026-09-30, fast-forwarded per project owner).** Two-panel workspace on `/invoices/new` and `/invoices/[id]/edit`: editable form (left) + live A4 paper preview (right) driven by one typed `InvoiceDraft`. Read-only paper view on `/invoices/[id]`. Save Draft / Submit / Save revision / Reset (with confirmation) / Print preview. Typecheck, lint, build and 6 Playwright tests pass.
- **PHASE 3 — History / Edit / Demo submission: DONE (2026-09-30).** Full demo flow works end to end. 7 Playwright tests, typecheck, lint and production build pass.
- **PHASE 4 — Backend foundation: DONE (2026-09-30).** FastAPI + SQLAlchemy 2 + Alembic in `api/`; 11 tables migrated on real PostgreSQL; 8 pytest tests pass. The web app is NOT yet wired to the API (still mock services); Download still uses the browser print dialog.
- **PHASE 5 — Real authentication + branch isolation: DONE in code (2026-09-30); NOT yet live** — needs a Supabase project (steps in `docs/setup-supabase.md`). 30 backend tests + 7 web e2e tests + typecheck/lint/build pass.
- **PHASE 6 — Real invoice CRUD + unique ID: DONE (2026-09-30).** The web UI now runs against the real FastAPI/PostgreSQL backend when `NEXT_PUBLIC_API_URL` is set. 38 API/DB tests, 7 mock-mode e2e tests and 1 real-backend e2e test pass; typecheck/lint/build clean.
- **PHASE 7 — Exact preview + PDF generation: DONE (2026-09-30).** One template (`InvoicePaper`) feeds the live preview, the read-only view, print, and the stored PDF. 44 API/DB/PDF tests, 7 mock-mode + 1 real-stack browser tests pass; typecheck/lint/build clean.
- **Versioning + audit trail (Prompt 08): DONE (2026-09-30).** 55 API/DB/PDF tests, 7 demo-mode browser tests and the real-stack browser journey pass; typecheck/lint/build clean.
- **Admin panel (Prompt 09): DONE (2026-09-30).** Central-admin pages: Overview, Branches, Users, Invoices, Products, Event configuration (+ invoice header/footer), Discounts and packages, Reports, Audit logs. 74 API/DB/PDF tests, 7 demo-mode browser tests, and real-stack browser journeys for the branch flow and the admin flow pass; typecheck/lint/build clean.
- Remaining PLAN phases: hardening, deployment/UAT (owner: Supabase + hosting steps in docs/setup-supabase.md).

### Next action

Owner: create the Supabase project and users (`docs/setup-supabase.md`) - deferred to the end by the project owner. Next build phase: hardening. Execute the next prompt (Phase 3 polish / Phase 4 backend as directed by the project owner). Open questions in `docs/invoice-spec.md` §10 (esp. Q3 discount policy, Q5 rounding, Q7 page count) should be answered by MCCIA in parallel.

---

# 28. Change Log

## 2026-09-29

- Project scope defined for National Safety Week 2027.
- Corrected branches to SB Road, Tilak Road, Bhosari, Hadapsar, Ahilyanagar.
- Adopted one-codebase branch-isolation architecture.
- Locked UI-first milestone.
- Added invoice field/product reference extracted from the supplied 2026 workbook.
- Added configurable 2027 event/product/pricing model.
- Added admin, authentication, PDF, history, versioning and audit requirements.

## 2026-09-30 — Phase 0 (discovery)

- Copied source files from Downloads into `reference/` (workbook, brochure PDF/JPGs). Extracted assets and a full cell dump into `reference/extracted/`.
- Inspected workbook via Excel COM + xlrd. Workbook has **10 filled 2026 invoice sheets (T-10…T-19), no blank master**; two layouts: standard (A–K) and discounted (A–L, extra `Rate after Discount` column).
- Confirmed formulas: basic = rate×qty; CGST/SGST = rate×basic; total = basic+CGST+SGST; column SUMs. Discount is a pre-tax percentage applied to the unit rate, hard-coded in formulas (5%, 6.23%). Rounded-off amount is a **hard-typed** nearest-rupee value, not a formula. Amount in words and payment details are free text.
- Findings that differ from PLAN: §8 product list is missing 2 workbook rows (`Scrolls - Do's & Don't's - English/Marathi Set of 2`, ₹670); PLAN §11 lacks the pre-tax rate-discount mechanism; workbook rates differ from brochure for Ball Pens and T-shirts. No PLAN decisions were changed; branches untouched.
- Created `docs/invoice-spec.md`.

## 2026-09-30 — Phase 1 (application shell)

- Scaffolded Next.js 16.3 (App Router) + Tailwind 4 + shadcn/ui at the repo root (single-repo layout allowed by PLAN §18; `apps/web` split deferred).
- Routes: `/`, `/national-safety-week-2027`, `/select-branch`, `/login`, `/dashboard`, `/invoices`, `/invoices/new`, `/invoices/[id]`, `/invoices/[id]/edit`.
- Service boundary: `lib/services/types.ts` (Auth, Branch, Catalog, Invoice, Dashboard). Mock implementation `lib/services/mock.ts` (localStorage, seeded, branch-scoped from the session — no service takes a branch id). Swap point: `lib/services/index.ts`.
- Domain types mirror PLAN §15; calculation logic centralised in `lib/invoice/calc.ts` (workbook formulas; half-up rounding is an assumption, spec Q5).
- Product master = 39 workbook rows (PLAN §8 corrected). Rates are 2026 workbook values flagged as reference only. Branches: exactly the five locked branches.
- Playwright e2e in `e2e/shell.spec.ts` (`npm run test:e2e` against a running server, default port 3100).

## 2026-09-30 — Phase 2 (editable Pro Forma UI)

- Plan change from project owner: process fast-forwarded; UI built now, backend/auth deferred.
- One state object: `InvoiceDraft` (`lib/invoice/model.ts`). `computeView(draft)` derives lines, totals and words; both the form summary and `InvoicePaper` render from it. No separate preview state.
- `components/invoice/invoice-paper.tsx`: single HTML table mirroring the workbook merge structure and column widths; automatically switches to the 12-column "Rate after Discount" layout (with yellow % marker) when a discount > 0. Optional "show all catalogue rows" mode reproduces the Excel's 39-row print. MCCIA header, labels, logo, stamp and signature come from `lib/config/app-config.ts`.
- Behaviour implemented from the spec: rate x qty; CGST/SGST = rate x basic; total = basic + CGST + SGST; pre-tax percentage discount on rate; grand total rounded to nearest rupee (half-up ASSUMED, Q5); amount in words in workbook style (auto, with manual override); payment details free text.
- Save flow: `services.invoices.save({draft, action})` re-validates (Zod, `lib/invoice/validation.ts`) and recalculates on the mock "server"; branch comes from the session only. Draft -> DRAFT, Submit -> SUBMITTED, saving a non-draft -> EDITED with version+1. Cancelled invoices are read-only.
- Deviation from PLAN §4: React Hook Form is not used; a single typed state object + Zod was simpler for guaranteeing one source of truth. Revisit when the form grows.
- Invoice number is system-assigned (read-only field, provisional until first save); spec Q2 still open.
- Tests: `e2e/editor.spec.ts` covers company name, date, add material, quantity, totals, live preview, discount column, full-catalogue mode, remove line, save draft, reopen, reset confirmation, submit, revision, validation, cross-branch refusal, mobile tabs.

## 2026-09-30 — Phase 3 (history, edit, demo submission)

- Applied `.agents/rules/ponytail.md` (Full): reused what Phase 1-2 already delivered. The `InvoiceService` interface + mock in `lib/services` is the invoice repository; only the mock touches localStorage.
- Added: invoice-date range filter (native date inputs) alongside the existing search (ID/company) and status filter.
- Download (history row, detail page, submit-success dialog) now works: opens the invoice with `?print=1` and calls `window.print()`; choose "Save as PDF". Removed the "coming soon" dialog component. A server-side PDF (Playwright/Chromium) remains Phase 7.
- Already in place and covered by tests: submit validates, assigns `NSW27-<BRANCH>-nnnnnn`, saves, shows success; history lists ID/date/company/total/status/created-by/actions; Edit reopens the saved invoice in the editor with a populated preview.

## 2026-09-30 — Phase 4 (database foundation)

- `api/` (single-repo layout): `app/{config,db,models,schemas,repositories,services,seed,main,devdb}.py`, Alembic migration `0001_initial_schema`, `tests/`.
- Tables: branches, users (profile mapped to `auth_user_id`), events, products, discount_rules, invoices, invoice_items (snapshots), invoice_versions (JSONB snapshot), invoice_documents, invoice_sequences, audit_logs. Statuses/roles are text + CHECK; a branch user cannot exist without a branch (CHECK); money is NUMERIC (6 dp on line amounts to keep the workbook's unrounded arithmetic).
- Seed (`python -m app.seed`, idempotent): exactly the five branches SBR/TIL/BHO/HAD/AHL, event `National Safety Week 2027` (`NSW27`, dates NULL), and the 39 workbook products as a starting catalogue. Re-seeding never overwrites admin edits. Event and products live only in the database, so 2027 values are changed by editing rows, not code.
- Endpoints: `GET /health`, `GET /api/v1/branches`, `/api/v1/events/current`, `/api/v1/products` (read-only). No write/admin endpoints yet on purpose: they need authentication (Phase 5), so shipping them open would be a security hole.
- Invoice numbers: `services.allocate_invoice_number` -> `NSW27-TIL-000001` via one `INSERT .. ON CONFLICT DO UPDATE .. RETURNING` (row-locked, transactional; verified unique across 30 concurrent allocations).
- Schemas: Pydantic request/response models incl. `InvoiceCreate` (no branch_id, number or amounts accepted from the client) and `InvoiceOut`.
- Local dev DB: `python -m app.devdb` (pip `pgserver`, real PostgreSQL, no Docker). Tests build a throwaway Postgres from `alembic upgrade head` + seed and include `alembic check` (models == migrations). Production: Supabase via `DATABASE_URL`.
- Fixed frontend catalogue text to workbook-exact `Do's & Don’ts` (straight then curly apostrophe).
- Not done (by design, later phases): RLS policies, auth, invoice CRUD/versioning logic, PDF storage.

## 2026-09-30 — Phase 5 (authentication + branch isolation)

- Auth = Supabase Auth JWTs. API (`api/app/auth.py`) verifies signature/expiry/audience (HS256 secret or JWKS for asymmetric keys; algorithm list fixed server-side, `none` rejected), then loads the caller's row in `users` by `sub`. No profile or `active=false` -> 403. Role and branch come ONLY from that row.
- Layer 1 (API): every invoice service function takes the verified `Principal`; non-super users are filtered to `principal.branch_id`; a `branch` query param is honoured for SUPER_ADMIN only (403 otherwise); `InvoiceCreate` forbids unknown keys, so `branch_id`/`role`/`status`/totals in a body give 422. Other branches' invoices answer 404 (no id probing). Rate override is admin-only.
- Layer 2 (database): migration `0002_rls` — role `app_authenticated`, RLS on invoices, invoice_items, invoice_versions, invoice_documents, invoice_sequences, audit_logs, users. Per request the API does `SET LOCAL ROLE app_authenticated` + `set_config('app.user_id'|'app.role'|'app.branch_id')` from the verified profile; an `after_begin` hook re-applies it after any commit. Policies fail closed (no identity => zero rows). Audit log: append-only for callers, readable by SUPER_ADMIN only.
- New endpoints: `GET /api/v1/me`, `GET/POST /api/v1/invoices`, `GET /api/v1/invoices/{id}` (create includes server-side calculation, numbering and an audit entry; edit/versioning is Phase 6).
- Web: `lib/services/real-auth.ts` signs in via Supabase REST (no SDK), calls `/me`, and uses the SERVER's branch; picking the wrong branch at login is refused. Active only when `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` are all set; otherwise demo mode is unchanged. Invoices in the web app are still mock until Phase 6.
- `python -m app.admin_cli create-user ...` creates the Supabase login + profile row.
- Tests (`api/tests/test_security.py`): bad/forged/expired/`none`/wrong-audience tokens, missing or inactive profile, SBR cannot read TIL, TIL cannot read BHO, branch cannot be set via body/query, role/status/totals injection rejected, super admin reads all, and — with no API involved — RLS limiting SELECT/UPDATE/DELETE/INSERT and failing closed.
- Known limits / for later: access tokens are not refreshed (user re-signs in after ~1h); rate limiting/brute-force protection is Supabase's; RLS was verified on local PostgreSQL 16-style engine, and must be smoke-tested once on the real Supabase project (checklist in docs/setup-supabase.md section 6); `users` has no admin write path yet (CLI only).

## 2026-09-30 — Phase 6 (real invoice CRUD, unique IDs)

- API: `POST /invoices` (draft or submit), `PUT /invoices/{id}` (save draft / submit / revise), `GET /invoices` with `q` (invoice id or company, case-insensitive, `%`/`_` literal), `status`, `date_from`, `date_to`, `limit`; `GET /invoices/{id}`; `GET /invoices/next-number` (display only).
- Lifecycle: DRAFT -> (save)* -> SUBMITTED (snapshot v1). Any later save of a submitted/edited/generated invoice = revision: status EDITED, `version` + 1, new immutable snapshot in `invoice_versions` with editor + reason; earlier snapshots are never touched. CANCELLED -> 409. Drafts carry no versions. Every change writes an audit log row.
- Server-side calculation: the browser sends only user-entered values (customer, date, discount %, product + qty, optional rate). Rates, HSN, tax rates and names come from the catalogue rows and are snapshotted into `invoice_items` (a later catalogue change never alters an existing invoice; verified). Totals, rounding and amount-in-words are computed in `services._calculate`; no client total is accepted (unknown keys -> 422). Rate override needs an admin role (equal-to-catalogue rate is fine); duplicate/unknown products and empty submits -> 422. Responses and snapshots are re-read from the database (`refresh`), so they show exactly what is stored.
- IDs: UUID primary keys + `NSW27-<BRANCH>-nnnnnn` from `invoice_sequences` via one atomic `INSERT .. ON CONFLICT DO UPDATE .. RETURNING` (never `COUNT(*)`). Verified: 24 parallel creates -> 24 distinct gap-free numbers; numbers do not repeat after rows are deleted; independent per branch.
- Migration `0003`: `invoices.created_by_name` (snapshot; other branches' user profiles are unreadable under RLS) + index (branch_id, updated_at).
- Web: `lib/services/api.ts` (catalog, invoices, dashboard over the API; shared `summarize.ts`), selected by `NEXT_PUBLIC_API_URL`. Sign-in in API mode uses Supabase when its vars are set, otherwise the dev-only `POST /api/v1/dev/token` (exists only if `DEV_LOGIN=true` AND `SUPABASE_URL` is empty). `python -m app.dev_seed` creates the five demo users + a central admin. The rate field is read-only for branch users. Branches remain the locked five constants in the UI.
- How to run locally on the real backend (no Supabase): `python -m app.devdb` (start Postgres; copy the printed URL into `api/.env` with `DEV_LOGIN=true`, `SUPABASE_JWT_SECRET=<any 32+ char string>`, `CORS_ORIGINS=["http://localhost:3200"]`), `alembic upgrade head`, `python -m app.seed`, `python -m app.dev_seed`, `uvicorn app.main:app --port 8000`, then `NEXT_PUBLIC_API_URL=http://localhost:8000 npx next dev -p 3200`. Real-backend e2e: `API_E2E=1 BASE_URL=http://localhost:3200 npx playwright test api`. Stop Postgres cleanly with `pg_ctl -D .pgdata stop -m fast` (a forced kill leaves the data dir needing recovery).
- Tests now isolate from a developer's `.env` (conftest pins `DEV_LOGIN=false`).
- Known gaps: list returns up to 500 invoices (no paging UI); dashboard aggregates are computed client-side from that list; concurrent edits of the same draft are last-write-wins (no optimistic-lock version check); Download is still the browser print dialog (Phase 7); access tokens are not refreshed.

## 2026-09-30 — Phase 7 (preview == PDF)

- Single rendering path: the API launches Chromium (Playwright) and opens `WEB_URL/print/invoice/{id}?v={version}&t={token}`. That bare Next page renders the same `<InvoicePaper>` component the editor preview uses, from the immutable `invoice_versions.snapshot`, then `page.pdf()` prints it (A4, print CSS already in `globals.css`). There is no separate PDF layout. Verified visually against the workbook and by text extraction.
- Print access: `GET /api/v1/print/{id}?v=&t=` is guarded only by a 60-second HS256 token bound to that invoice + version (`PRINT_TOKEN_SECRET`; random per process if unset - set it when running more than one API instance). A login token is not accepted there; wrong invoice/version/expired -> 403.
- When: after submit and after every revision (FastAPI background task) each version gets its own `invoice_documents` row (unique per version, migration 0004). SUBMITTED -> GENERATED when the first PDF exists; a revision stays EDITED and gets a new PDF while the old version's PDF stays downloadable (`?version=N`). If background generation fails, the PDF is created on first download; an advisory lock makes concurrent clicks produce exactly one document.
- Storage: `app/storage.py` - private Supabase Storage bucket `invoice-pdfs` when SUPABASE_URL + SUPABASE_SERVICE_KEY are set, otherwise a local directory (`api/storage/`, git-ignored). Keys are `invoices/{invoice_uuid}/v{n}.pdf` (ids only; traversal refused).
- Download: `GET /api/v1/invoices/{id}/document[?version=N]` streams `application/pdf` as an attachment with `Cache-Control: no-store`, after the normal auth + branch scoping (other branch -> 404, no login -> 401, draft -> 409, no public URLs). Web: one `DownloadButton` (history rows, invoice page, submit dialog); in demo mode it opens the print dialog instead.
- Renderer diagnostics: a failed render logs what the browser saw (console errors, failed requests, page text).
- Config/dev notes: `next.config.ts` `allowedDevOrigins: ["127.0.0.1"]` (dev only; needed because the renderer opens 127.0.0.1); ESLint/tsc now exclude `api/`. `WEB_URL` must be the public address of the web app that the API host can reach.
- Tests: `api/tests/test_documents.py` boots the real API + `next dev` and checks: PDF exists in storage, is one page and contains the invoice's fields (header, company, GSTIN, number, date, line, HSN, amounts, rounded total, words, payment, signatory), revision creates a v2 document with new data while v1 keeps the old data, secure download rules, print-token rules, on-demand creation + concurrency, path traversal. Real-stack browser test (`API_E2E=1`) downloads PDFs from the submit dialog and from history.
- Known gaps: PDF fonts fall back to the server's Calibri substitute (Carlito is metric-compatible - install `fonts-crosextra-carlito` on Linux hosts for the closest match); Chromium adds ~1-3 s per PDF and must exist on the API host (`playwright install --with-deps chromium`); no explicit cancel/void flow yet.

## 2026-09-30 — Prompt 08 (versioning + audit trail)

- Versions: every submit, revision and cancellation writes an immutable `invoice_versions` row (number, editor id + name, time, reason, full JSON snapshot; unique per invoice+number). Revising a submitted/generated invoice = status EDITED, version + 1, earlier versions untouched. A reason (3+ chars) is REQUIRED for revisions: enforced by the API (422) and by the form (shared validation); drafts need none. Verified ordering (newest first, no gaps) and that v1 is never rewritten.
- Cancellation: `POST /invoices/{id}/cancel` (branch admin of that branch or central admin; reason required). The invoice stays on record, becomes read-only (edits -> 409), gets its own version with the reason; its current version has no PDF (earlier versions' PDFs stay downloadable).
- Admin read access: `GET /invoices/{id}/versions` and `/versions/{n}` (admins, branch-scoped) and `GET /audit-logs` (central admin: all; branch admin: own branch only - enforced in the API AND by RLS policy; ordinary users: 403 / zero rows). Web: version-history panel on the invoice page (view any old version as the paper, download its PDF, cancel) and `/admin/audit-logs` (sidebar link for admins in API mode).
- Audit events recorded: `auth.login` (once per sign-in, via `/me`), `invoice.create|update|submit|revise|cancel|pdf|download`, and - by DATABASE TRIGGERS, so they cannot be skipped whichever tool makes the change - `user.create|role_change|active_change|update|delete`, `product.*`, `event.*`, `discount_rule.*` with old/new values and the acting user when one is known (console changes are recorded with no actor). The audit table is append-only (a trigger rejects UPDATE/DELETE, even for the owner); triggers stamp rows with `clock_timestamp()` so several changes in one transaction keep their order.
- Migration `0005` adds `invoice_versions.edited_by_name`, `audit_logs.actor_name`, indexes, the trigger functions and the branch-admin read policy. Names are snapshotted because ordinary users cannot read other profiles under RLS.
- Dev: `python -m app.dev_seed` also creates `meera@example.invalid` (Tilak branch admin) and `admin@example.invalid` (central admin); sign in with the email typed into the login form.
- Test infrastructure notes: `next dev` allows one server per build directory and rewrites `tsconfig.json`, so the API test-suite uses `NEXT_DIST_DIR=.next-test` and restores `tsconfig.json` itself; build/start for checks use `NEXT_DIST_DIR=.next-build`. Never run `taskkill /im node.exe` - it also kills your own dev server.
- Known gaps: no screens yet for changing users/roles/prices (changes are still made via CLI/SQL, and are audited automatically); login attempts that FAIL are recorded by Supabase, not here; audit rows for users deleted later keep their actor id (deactivate instead of deleting).

## 2026-09-30 — Prompt 09 (admin panel)

- Access: everything under `/api/v1/admin/*` needs SUPER_ADMIN (403 otherwise) AND the database enforces it: migration `0006` turns on RLS for branches, events, products, discount_rules, packages, package_items, app_settings (read: any signed-in user; write: central admin only) and lets only the central admin write `users`. The central admin signs in via "Central admin sign-in" on the branch page (`/login?branch=ADMIN`); their session has no branch (a stand-in "All branches" label in the UI only) and they land on `/admin`. Branch users and branch admins are refused (`Central admin only`); the audit-log page stays open to branch admins for their own branch.
- **2026 values never silently become 2027:** every product carries `rate_confirmed` (false for the seeded workbook values, shown as a "2026 reference" badge with a warning banner). A rate becomes confirmed only when an admin edits it, ticks "I have checked this rate", or uses "Confirm all pending". The event cannot be set to OPEN until dates are set and no active product is unconfirmed (422 with the count). The event prefix (part of every invoice number) is locked once invoices exist. Event year/name/dates/status/notes are editable.
- Screens: Branches (address/phone/e-mail/active only - code and name are locked to the five real branches); Users (add - creates the Supabase login when the service key is configured, dev-only otherwise -, change role/branch/active; guards: cannot demote/deactivate yourself, cannot remove the last active central admin); Invoices (all branches, branch/status/search filters, view, PDF download); Products (add/edit name, HSN, unit, rate, CGST/SGST, order, active; deactivate rather than delete so invoice history stays intact); Discount rules and Packages/bundles (CRUD; **definitions only - invoices do not apply them automatically yet**); Event configuration + invoice header/footer text (title, organisation name, address lines, GSTIN, PAN, "For ..." and signatory label; served publicly at `GET /api/v1/settings/invoice` because the print page needs it; used by the shared `InvoicePaper`, so the preview, print and new PDFs follow it; issued PDFs do not change); Reports (per branch, month, material, status; date range; CSV download); Audit logs (existing).
- Audit: all of the above writes are recorded by the database triggers (extended to branches, packages, package items and settings; rate edits are labelled `product.rate_change`), with the acting central admin's name.
- Notes / gaps: the stamp and signature images are still files in `public/brand` (not admin-uploadable); the branch dropdown on the Users/Invoices screens lists the five fixed branches as constants; creating a whole new event year (with a catalogue copy) is not built - edit the existing event's year/dates for now; discounts/packages are stored but not yet applied by the invoice form or server.
- Tests: `api/tests/test_admin.py` (permissions at API and DB level, branch lock, user guards, event/OPEN guard and rate confirmation, product validation, discount rules, packages, header, reports); `e2e/admin.spec.ts` drives every admin page against the real stack.

## 2026-09-30 — New Pro Forma redesign (order-sheet entry)

- Owner request: fast entry for many invoices. `/invoices/new` and `/invoices/[id]/edit` now have the customer / invoice / summary-and-footer sections on the left (unchanged) and, on the right, the real invoice sheet with **all 39 items pre-filled**. The user clicks a **Qty.** cell and types; that row's basic amount, CGST, SGST and total (and the invoice totals, rounding, words) fill in immediately. Tab moves to the next row's Qty. cell. Clearing a Qty. removes the material. The old "Materials" cards were removed.
- Unbought items deliberately stay on the invoice (shown with "-") so customers keep seeing the full range: this applies to the editable sheet, the saved-invoice page, the admin version viewer AND the PDF (the print page now loads the catalogue too). Removed the old "show all catalogue rows" toggle (it is always on).
- The read-only preview appears only after **Save Draft** or **Submit** ("Saved invoice preview"; an **Edit quantities** button returns to the sheet). Opening a saved invoice starts on the sheet. Admins can also edit the Rate cell of a row that has a quantity; branch users cannot (the server enforces this).
- Print/PDF: the full sheet is scaled (print CSS `zoom: 0.88`) so all 39 rows fit one A4 page; verified visually and by the test that asserts a one-page PDF.
- Note: unbought rows on an old PDF show the catalogue rate at the time the PDF was made (the invoice itself only stores the items that were bought). On small laptop screens the sheet is scaled down to fit; it is comfortable at about 1600px width and above.
- Tests updated/added: `e2e/editor.spec.ts` (typing into Qty. cells, totals, discount column, preview only after saving, reset, submit, revision reason, Tab-through entry, mobile tabs, history), `api.spec.ts` (real stack), PDF tests. Results: 74 API/DB/PDF tests, 7 demo-mode browser tests, 2 real-stack journeys; typecheck/lint/build clean.
- Prompt 10 is on hold until the owner sends it.

## 2026-09-30 — New Pro Forma layout: top to bottom

- Owner request (layout only, no logic change): `/invoices/new` and `/invoices/[id]/edit` are now ONE column in this order: Customer information, Invoice information, the editable invoice sheet (full width, scaled up to 1.35x so it is big and readable), then Summary and footer. The side-by-side split and the phone "Details/Invoice" tabs are gone (a single column works on every screen size). `InvoiceForm` takes `part="details" | "summary"`; `PaperFrame` takes `maxScale` and centres the sheet by measured offset.
- Tests: new layout-order test (customer < invoice info < sheet < summary; sheet wider than 900px at 1600px), phone test rewritten; PDF one-page test unchanged and passing.

## 2026-09-30 — Mode of payment, including split payments

- Owner request: record how the customer paid (Cash, UPI, Card, Net banking, Other), and support a customer paying part in one mode and the rest in another.
- Data: new table `invoice_payments` (migration `0007`; mode CHECK, amount > 0, reference, order; RLS follows the invoice, so branch isolation applies). API: `payments` list on create/update (max 6 rows), returned on every invoice with derived `amount_paid` and `payment_status` (UNPAID / PARTIAL / PAID). Payments are part of each version snapshot and are replaced (not appended) when a draft is saved again.
- Rules (server AND form): one row = normal case; several rows = split payment; the total may be LESS than the payable amount (part payment, balance due) but never MORE (422); "Other" must say what it is; amounts have at most 2 decimals. No payment = unpaid; submitting does not require payment.
- Form (Summary and footer): "Mode of payment" dropdown - choosing a mode takes the FULL payable amount automatically and keeps following it if quantities change; optional reference (UTR / card slip / receipt no.). "Split payment" opens rows of mode + amount + reference, with "Fill balance" per row, "Add payment mode", "Back to a single payment", and a live "Paid X of Y - balance Z" line (red if over). Status pill: Not paid yet / Part payment - balance due / Paid in full. The free-text "Payment Details" box stays for extra notes.
- Invoice / PDF: the yellow Payment Details box prints e.g. "UPI Rs. 500.00 (UTR 111) + Cash Rs. 701.00" and, for a part payment, "| Balance due Rs. ...", followed by any notes ("Rs." is used instead of the rupee sign so every PDF font shows it).
- History has a Payment column (Paid / Part paid / Unpaid). Admin reports gained "Received by mode of payment" (cash reconciliation) and "Outstanding (not fully paid)"; both are in the CSV. Demo data was refreshed (storage key v2): mostly UPI, some split UPI + cash, some part-paid.
- Tests: `api/tests/test_payments.py` (all modes, split, part payment completed later via a revision with the old version kept, draft replacement, 10 refusal cases, branch isolation incl. the database policy, report totals); `e2e/payments.spec.ts` (single mode follows the total, split with fill-balance, over-payment refused, part payment saved and reopened, "Other" needs a description); PDF test now prints a split payment; real-stack journey saves and reloads a UPI payment. Results: 95 API/DB/PDF tests, 11 demo-mode browser tests, 2 real-stack journeys.
- Not built (say if wanted): recording a later payment WITHOUT revising the invoice (today it is a revision with a reason), cheque as its own mode (use Other), payment dates, receipts.

## 2026-10-01 — Day-export to Excel, stock card, branch seals, collapsible sidebar

- **Excel of the day's invoices** (`GET /api/v1/exports/daily-invoices?date=YYYY-MM-DD&branch=`; `api/app/exports.py`, openpyxl). One workbook: a Summary tab, then one tab per invoice laid out like the MCCIA sheet (all 39 catalogue rows, blue header/total/rounded-off rows, payment text, footer). Tab name = branch code + invoice sequence + company, e.g. `TIL-000007 Sahyadri Precision` (31-character Excel limit, forbidden characters removed, duplicates numbered). Only issued invoices for that invoice date are included (drafts and cancelled are not). Branch admin: own branch (button on Invoices). Central admin: `ALL` branches combined (tabs grouped by branch; Summary shows a subtotal per branch and a grand total) or each of the five branches separately (buttons on Admin > Invoices). Branch users: 403. Each download is audited (`report.export`).
- **Stock instead of "Recent invoices"** on the dashboard: card "Low stock materials" (emptiest first, Low / Out badges; link to Stock). No stock existed, so a simple model was added (migration `0008`, `branch_stock`): an admin enters OPENING stock and a "low at or below" level per material and branch (page `/stock`: branch admin = own branch, central admin = any branch via a dropdown, other users read-only/none; RLS enforces it). Remaining stock is never stored - it is opening stock minus everything invoiced (submitted/generated/edited), so revisions and cancellations give stock back automatically and drafts do not count. Until stock is entered the card says so. Stock edits are audited. Selling more than the stock is NOT blocked (not requested).
- **Bottom of the invoice:** the "Rounded off Amount.." row is now the same blue as the header/Total row. The round seal is per branch and fixed: chosen from the branch code in the invoice number from `public/brand/seals/{SBR,TIL,BHO,HAD,AHL}.png` (currently copies of the old stamp - OWNER: overwrite these five files; see the README there). Applies to the editor sheet, saved view, admin version viewer and every PDF; no UI can change it. The existing signature image stays next to the seal.
- **Sidebar:** collapsible (toggle in the top bar, remembered); collapses automatically on `/invoices/new` and `/invoices/[id]/edit`; the toggle opens it for that visit only; collapsed it is an icon rail with tooltips and accessible names.
- Tests: `api/tests/test_export_stock.py` (tab names/contents/colours, branch scoping, combined vs separate, permissions, audit; stock arithmetic with revisions/cancellations/drafts, permissions, isolation incl. DB policy), `e2e/layout.spec.ts`, `e2e/ops.spec.ts` (real stack). Results: 101 API/DB/PDF tests, 15 demo-mode browser tests, 4 real-stack journeys; typecheck/lint/build clean.
- Not built / assumptions: the "image of bottom of invoice" mentioned in the request was not attached, so the blue change was applied to the Rounded-off row (the Total row was already blue) - tell me if another area was meant; seal images are not embedded in the Excel tabs; "today" uses the browser's local date and the invoice date field.

## 2026-10-01 — One-command local backend

- `api\start-dev.bat` (or `.venv\Scripts\python start_dev.py`) starts the local PostgreSQL, rewrites `DATABASE_URL` in `api/.env` (its port changes on every start), applies migrations, seeds branches/products/dev users and runs the API on :8000. Fixes the "taking forever / CORS error" symptom, which was simply the API running without its database (the browser reports a hung API as a CORS error). After a forced stop the database may need a minute of crash recovery on the next start.
