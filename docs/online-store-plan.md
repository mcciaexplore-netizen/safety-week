# MCCIA Online Store — Plan

Status: **PLAN — nothing built yet.** Decisions marked **(confirm)** need the owner's yes before the phase that depends on them.

## 1. What we are building

A public, consumer-facing web shop for MCCIA's safety merchandise (the 39 materials: badges, caps, T-shirts, banners, flags, posters, water bottles …), at its **own web address**, separate from the staff system.

A visitor can: browse and search products → open a product page → add to cart → pay online (UPI / cards / net banking) → receive an order confirmation and a **GST tax invoice by e-mail straight away** → track the order until it is delivered.

Behind it, the shop is **a sixth sales channel of the same system**: it has its own stock, its own invoice series, its own analytics, and the **central admin runs it** (no branch staff). Sales can then be compared directly: five branch offices vs. online.

### Not in version 1
Marketplace features (other sellers), reviews, coupons/wishlists, WhatsApp/SMS notifications, courier-API automation, international shipping, mobile app, multi-language (Marathi/Hindi) storefront. Each is listed in section 14 as a later step.

## 2. Architecture decision (the important one)

```
 shop.<domain>  (NEW  Next.js app, folder store/, Vercel project "nsw-store")      <- public customers
        |  HTTPS, public API  /api/v1/store/*  +  customer sign-in
        v
 api.<domain>   (EXISTING FastAPI, Vercel project "nsw-api")  ---- one Neon database ----
        ^
        |  staff API /api/v1/*  (unchanged, staff sign-in)
 app.<domain>   (EXISTING staff web app, Vercel project "nsw-web")                <- central admin + branches
```

* **Same API and same database, new public front door.** Stock, invoices, audit and analytics already live there; a second backend would mean copying data and breaking "one number for sales". The store gets its **own router** (`/api/v1/store/…`) with a **separate, minimal database role** — it can only see what the shop needs.
* **New website, new address.** The storefront is a separate Next.js app in `store/` (own Vercel project, own domain, own design for consumers; it reuses the brand tokens but not the admin shell). The staff app keeps its address and is never exposed to shoppers.
* **Online = a branch row.** One new row in `branches` with code **`ONL`** (name "Online Store") and a new column `kind` (`BRANCH` | `ONLINE`). Everything that already works per branch — stock, invoice numbers (`NSW27-ONL-000001`), reports, audit, Excel exports — works for it with small changes. The code that assumes "exactly five branches" (hard-coded lists in the UI, "All 5 branches" labels, the Excel "ALL" export) is updated to read the branch list from the API.
* **No staff accounts for ONL.** Nobody signs in "as the online store". Only the central admin manages it, from a new **Online store** section in the staff app.

## 3. Decisions (recommended defaults — confirm)

| # | Topic | Recommendation | Why |
|---|---|---|---|
| D1 | Payment gateway | **Razorpay** (UPI, cards, net banking, wallets); test mode first | Standard in India, hosted page = no card data on our servers, good refunds API. Needs a business KYC account with MCCIA's PAN/GSTIN/bank. |
| D2 | Prices shown | **GST-inclusive** price to shoppers; same rate as the branch price list unless an admin sets an *online price* | Consumers expect the final price; B2B sheet rates are before GST. |
| D3 | Invoice type | **GST Tax Invoice** (not "Proforma"), B2C. Out-of-Maharashtra buyers get **IGST**, in-state get CGST+SGST. Needs the buyer's state. | Legally a paid sale needs a tax invoice. Our current invoices only have CGST/SGST. **MCCIA's accountant must confirm** place-of-supply and shipping-charge GST treatment. |
| D4 | Where we deliver | **All India**, flat shipping fee with free shipping above a threshold (both editable by admin); pincode serviceability check is a later step | Simple to start; courier chosen per order. |
| D5 | Shipping fulfilment | **v1 manual**: admin packs, books any courier, enters courier + tracking number, customer gets the tracking link. **v2** integrate an aggregator (Shiprocket/Delhivery). | Avoids a third-party contract before we know volume. |
| D6 | Customer accounts | **Guest checkout + passwordless sign-in** (6-digit code sent by e-mail). Orders are tied to the e-mail; no passwords to leak or reset. | Fast checkout, lowest security risk. |
| D7 | Stock for online | Online has **its own stock**, filled by the central admin using the existing **Transfer** feature (branch → ONL) plus its own opening stock. Overselling is **blocked** online. | Reuses what is built; no mixing with branch counters. |
| D8 | Cash on delivery | **No** in v1 | Avoids fraud and cash-handling; revisit later. |
| D9 | Returns & refunds | Policy text drafted by us, **owner approves**; admin issues refunds from the order page (Razorpay refund API) | Required for Razorpay approval and Indian e-commerce rules. |
| D10 | Domain | e.g. `shop.mcciapune.com` (store) — needs a DNS entry from MCCIA IT | Different URL as requested. |
| D11 | Content | MCCIA supplies product photos + descriptions (we provide the upload screen and sensible placeholders) | We cannot invent product imagery. |
| D12 | Event scope | The shop sells the **currently open event's** materials (NSW 2027). A closed event hides the shop with a notice. | Matches how products are modelled today (per event). |

## 4. Customer experience (storefront pages)

`/` home (hero, featured products, categories, trust strip) · `/shop` catalogue (search, category filter, sort, in-stock only) · `/p/[slug]` product page (gallery, price incl. GST, quantity, add to cart, stock state "Only 3 left"/"Out of stock", details) · cart drawer + `/cart` · `/checkout` (contact, shipping address, review, pay) · `/order/[number]` confirmation + tracking timeline + invoice download · `/account` (sign in by e-mail code; my orders, saved address) · `/track` (order number + e-mail) · policy pages: shipping, returns & refunds, privacy, terms, contact/grievance officer (legally required) · friendly 404 and out-of-service pages.

Design: same MCCIA look (light, glass cards, blue/green) but consumer-grade — large imagery, mobile-first (most buyers will be on phones), fast (Next.js server components + image optimisation), accessible, `prefers-reduced-motion` respected.

## 5. Checkout, payment and the money flow

1. **Cart** lives in the browser (product id + quantity). Prices are *never* trusted from the browser.
2. `POST /store/checkout` — server re-reads prices, GST, shipping fee and stock; **reserves stock for 20 minutes** (table `stock_reservations`) so two buyers cannot take the last unit; creates `orders` (status `PENDING_PAYMENT`) and a **Razorpay order**; returns the Razorpay order id.
3. Customer pays in Razorpay's hosted window.
4. **Two independent confirmations** (either one is enough, both safe to repeat — idempotent):
   * browser calls `POST /store/payment/verify` with Razorpay's signature (checked server-side);
   * Razorpay **webhook** `POST /store/webhooks/razorpay` (signature-verified) — covers the case where the customer closes the tab after paying.
5. On confirmed payment, in **one database transaction**: order → `PAID`; create the **tax invoice** (branch `ONL`, status `SUBMITTED`, payment recorded as the Razorpay mode + payment id); convert the reservation to a sale; write audit entries.
6. After the transaction: generate the **PDF** (same ReportLab renderer, tax-invoice variant) and **e-mail** confirmation + invoice. If e-mail fails the order is still valid; a retry job and an admin "resend" button exist.
7. **Abandoned/failed payments:** reservations expire automatically (Vercel Cron every 5 min releases them); a late successful payment for an expired reservation is auto-refunded if stock is gone, else honoured.
8. **Refunds/cancellations:** admin action → Razorpay refund → order `REFUNDED`, a **credit note** (new document type, numbered `NSW27-ONL-CN-000001`) and stock returned if the goods are restocked.

## 6. Invoices for online sales

Reuse the existing invoice engine (numbering per branch/event, versions, audit, PDF, Excel) with these additions:

* `invoices.kind` = `PROFORMA` (today) | `TAX` (online) | `CREDIT_NOTE`; title on the document follows the kind ("TAX INVOICE").
* **IGST** support: `igst_rate/igst_amount` on lines and `igst_total` on invoices; PDF/Excel/screen show CGST+SGST **or** IGST. Buyer state + place of supply stored on the invoice.
* **Shipping charge** as a normal taxed line (HSN/SAC per accountant's advice).
* Online invoices are **issued automatically** (system actor "Online Store"), cannot be edited by anyone except via credit note/re-issue, and count in sales the moment payment is confirmed.
* Customer gets a time-limited signed link to their own invoice PDF; central admin can download any.

## 7. Orders and fulfilment (central admin, "Online store" section of the staff app)

Order statuses: `PENDING_PAYMENT → PAID → PACKED → SHIPPED → DELIVERED`, plus `CANCELLED`, `REFUND_PENDING`, `REFUNDED`, `PAYMENT_FAILED`/`EXPIRED`.

Screens (central admin only, role-checked on the API **and** by the database):
* **Orders** — filter by status/date/payment, search by order no./name/phone/e-mail; badges; export to Excel.
* **Order detail** — items, address, payment (Razorpay id), invoice, timeline, internal notes; actions: mark packed, **mark shipped (courier + tracking no. → customer e-mail)**, mark delivered, cancel/refund, resend e-mail, print **packing slip** and **shipping label** text.
* **Catalogue (online)** — per product: show online yes/no, online price, photos (upload), description, category, slug, SEO title; featured flag.
* **Store settings** — shipping fee/threshold, store open/closed banner, contact details, policy pages text, support e-mail.
* **Stock** — the existing stock matrix gains the **ONL** column; transfers to/from ONL work as for any branch.

## 8. Analytics (treat Online as a branch, plus channel views)

* **Online dashboard** (same cards as a branch dashboard): orders, revenue, units, average order value, low-stock list, top products, orders by status.
* **Channel comparison on the central admin overview:** revenue/orders/units by *Online vs. each branch office*, by day/week/month; share of total; best channel per product.
* **Online-only insights:** funnel (cart → checkout → paid) and abandonment, new vs. repeat customers, sales by state/city, payment-mode split, refund rate, traffic source (simple UTM capture).
* Reports page and Excel exports include ONL automatically; audit log shows every online order/refund/admin action.

## 9. Security, privacy, compliance

* **Public API hardening:** rate limits per IP and per e-mail/phone on OTP, checkout and tracking; Cloudflare **Turnstile** (free CAPTCHA) on sign-in/checkout; strict CORS to the shop origin only; request-size limits; no stack traces.
* **Never trust the browser:** price, GST, shipping, stock and totals recomputed server-side; quantity limits per order; one active reservation per cart.
* **Payments:** card/UPI details never touch our servers; Razorpay signature checked on verify and webhook; webhook idempotent; secrets only in Vercel env vars; test mode until sign-off.
* **Customer identity:** passwordless codes (hashed, 10-minute expiry, 5 tries); customer tokens carry a different audience from staff tokens, so a customer token can never open a staff endpoint (tested).
* **Database:** new restricted role `app_storefront` — SELECT on public catalogue columns, INSERT on `orders`/`order_items`/`stock_reservations`, nothing else; customers only ever see rows matching their own e-mail (RLS). Staff RLS unchanged.
* **Privacy (DPDP Act 2023):** collect only name, phone, e-mail, address; privacy policy + consent line at checkout; deletion/export request path; no analytics cookies without consent; retention rule for guest data.
* **Legal pages & e-commerce rules:** seller name/address/GSTIN, grievance officer, return/refund policy, shipping policy, T&C — drafted by us, **approved by MCCIA** before launch.
* **Abuse:** order caps per customer/day, admin block-list, audit on every admin action.

## 10. Data model additions (new migrations 0011+)

`branches.kind` · `products`: `slug, category_id, online_enabled, online_rate, featured, seo_title, long_description` · `categories` · `product_images(product_id, url, alt, position)` · `customers(id, email, name, phone, created_at)` · `customer_addresses` · `login_codes` · `orders(id, number, customer_id, status, email, phone, ship_name, ship_address…, ship_state, subtotal, shipping_fee, tax…, total, razorpay_order_id, razorpay_payment_id, invoice_id, utm_*, created_at, paid_at)` · `order_items` · `order_events` (timeline/audit) · `shipments(order_id, courier, tracking_no, tracking_url, shipped_at, delivered_at)` · `stock_reservations(cart/order, product, qty, expires_at)` · `refunds` · `store_settings` · `invoices.kind/igst…/buyer_state` · `invoice_items.igst_*`.
Product images are stored in **Vercel Blob** (public CDN URLs) — not in the database.

## 11. API surface

Public (`/api/v1/store/…`): `GET products`, `GET products/{slug}`, `GET categories`, `GET settings` · `POST auth/request-code`, `POST auth/verify-code`, `GET me/orders` · `POST checkout`, `POST payment/verify`, `POST webhooks/razorpay`, `GET orders/{number}` (guest via signed token or signed-in), `GET orders/{number}/invoice` · `POST track`.
Staff (central admin only, under `/api/v1/admin/store/…`): orders (list/detail/status/ship/cancel/refund/resend), catalogue (online fields, image upload), settings, analytics endpoints.
Jobs: Vercel Cron `/api/v1/store/jobs/expire-reservations`, `/jobs/send-pending-emails` (secured by a secret header).

## 12. Delivery plan (phases)

Each phase ends with tests green and a deploy to a **test** URL; money stays in Razorpay test mode until Phase 9.

| Phase | Deliverable | Rough effort |
|---|---|---|
| **S0 Decisions & setup** | Owner confirms section 3; Razorpay account + KYC started; domain + DNS; Resend/e-mail sender verified; accountant confirms GST rules | owner-side, start now (KYC takes days) |
| **S1 Channel foundation** | `branches.kind`, ONL branch, remove "exactly 5 branches" assumptions (UI lists, Excel ALL, stock matrix with ONL, reports), IGST + `invoices.kind`, tax-invoice PDF/Excel variant, tests | 1 week |
| **S2 Catalogue** | Categories, images (Blob upload), online fields, admin catalogue screen, public read API | 1 week |
| **S3 Storefront shell** | `store/` Next.js app: home, shop, product page, cart, policy pages, SEO, performance, accessibility; own Vercel project + domain (test) | 1.5 weeks |
| **S4 Customer sign-in & checkout** | Passwordless codes, address form, shipping calc, reservations, `POST checkout` | 1 week |
| **S5 Payments & invoice** | Razorpay order/verify/webhook, auto tax invoice + PDF + e-mail, failures/expiry cron, idempotency tests | 1.5 weeks |
| **S6 Fulfilment** | Admin orders screens, shipping/tracking e-mails, packing slip, cancel/refund/credit note | 1 week |
| **S7 Analytics** | Online dashboard, channel comparison, funnel, exports | 1 week |
| **S8 Hardening** | Rate limits, Turnstile, RLS tests, load test, backups check, privacy/legal pages approved, penetration-style checklist | 1 week |
| **S9 Pilot & launch** | Real ₹1 payments in live mode, staff test orders end-to-end, soft launch to MCCIA staff, then public | 1 week |

Total ≈ 9–10 weeks of build once S0 is unblocked; S1–S2 can start immediately because they need no external accounts.

## 13. Testing strategy

* **API tests** (pytest, real Postgres): price/GST/IGST maths, stock reservation races, double-webhook idempotency, forged signatures, expired reservation, refund flow, customer token cannot reach staff routes, RLS for customers and for `app_storefront`, analytics numbers vs. raw rows.
* **Razorpay test mode** + webhook replay fixtures; a test-card matrix (success, failure, abandoned, late success).
* **Playwright e2e** on the storefront: browse → cart → checkout (test payment) → confirmation → invoice download → admin ships → customer tracks.
* **Non-functional:** Lighthouse ≥ 90 mobile on home/product pages, load test at 50 concurrent checkouts, accessibility checks, a pre-launch security checklist (OWASP Top 10).

## 14. Later (after launch)

Courier-API integration and live tracking, pincode serviceability, coupons and bulk/institutional pricing, GST-number capture for B2B online orders, reviews, WhatsApp/SMS updates, Marathi/Hindi storefront, abandoned-cart reminders, product bundles/packages (the `packages` table already exists), gift orders, wishlist.

## 15. Risks

| Risk | Mitigation |
|---|---|
| Razorpay KYC delay | Start in S0; build everything in test mode meanwhile |
| GST treatment wrong (IGST, shipping) | Accountant sign-off before S1 ends; configurable rates |
| Overselling during sales spikes | Reservations + row locks + tests; online stock separate from branches |
| Fake/abusive orders & OTP spam | Rate limits, Turnstile, per-customer caps, admin block-list |
| Serverless cold starts on checkout | Warm path tests; pooled DB; keep checkout work small; Pro plan if needed |
| E-mail deliverability | Verified sender domain (SPF/DKIM) via Resend; resend button |
| Photos/content late | Placeholders + "coming soon" state; launch not blocked on every product |
| Storefront and staff app drifting apart | Single API and DB; shared brand tokens package; one CI pipeline |

## 16. What the owner needs to provide (S0 checklist)

1. Yes/changes on section 3 decisions D1–D12.
2. Razorpay business account (PAN, GSTIN, bank, authorised signatory) — test keys first.
3. The shop domain and DNS access; sender e-mail address (e.g. `shop@mcciapune.com`).
4. Accountant confirmation: tax-invoice format, IGST/CGST rules, shipping-charge GST, credit-note numbering.
5. Product photos, descriptions, categories; shipping fee/free-shipping threshold; return period.
6. Names for the grievance officer and the support contact; business address for policies.
