# MCCIA Online Store — Plan and status

Status: **built (pick-up + pay-at-pick-up), Razorpay online payment still to do.** Updated 2026-10-07 after the owner's decisions.

## 1. What the store is

A public shop for MCCIA's safety merchandise, inside the same website at `/store` (own domain can be pointed at it later — see section 8). A visitor browses, adds to the cart, **chooses which of the five branches to collect from**, sees that branch's stock, and places the order. **There is no delivery and no courier**: the branch packs the order and the customer collects it, paying **online (coming last)** or **at the branch counter**.

## 2. Decisions (confirmed by the owner)

| Topic | Decision |
|---|---|
| Delivery | **None.** Pick-up only, from any of the five branches |
| Payment | **Pay at pick-up** now (cash/UPI/card at the counter). **Razorpay online payment last** |
| Prices | Shelf price (before GST) shown first, **GST-inclusive price in small brackets underneath** |
| Customers | Guest checkout, or sign in with a **6-digit e-mail code** (no passwords) |
| Branch & stock | At checkout the shopper picks the pick-up branch and sees that branch's stock; the order can only be placed if the branch has everything |
| Invoice | The order **is an ordinary invoice of the pick-up branch**, e-mailed as a PDF immediately; it states pay-at-pick-up and the balance due. When the customer collects and pays, the branch records the payment (invoice version 2, "Paid at pick-up") |
| Analytics | Online orders count in the pick-up branch AND are compared with branch-office sales in the central admin's **Online store** page |
| Web address | Same Vercel address for now (`/store`); a separate domain later |
| Cash on pick-up | Yes (it is the default) |

Not needed because there is no delivery: shipping fees, couriers, tracking numbers, IGST/place-of-supply, address capture, refunds-for-returns by post.

## 3. How it fits the existing system

* **Same API and database.** New public router `api/app/store.py` (`/api/v1/store/*`), staff router `api/app/store_orders.py` (`/api/v1/store-orders`, `/api/v1/admin/store/analytics`). Migration `0011`.
* **An order = an invoice + an `orders` row.** `services.create_invoice` is reused, so numbering (`NSW27-TIL-000012`), stock (counted the moment the invoice is submitted), PDF, Excel, audit and branch dashboards work unchanged. The `orders` row adds customer, pick-up status and payment method.
* **No sixth branch.** Online sales belong to the branch the customer chose; "online" is identified by the existence of an `orders` row. This keeps branch stock and staff workflows simple.
* **Shoppers are not staff.** Shopper tokens use audience `customer`; staff endpoints accept only `authenticated`, so a shopper token can never open a staff screen (tested). Customers and sign-in codes are owner-only tables (no grants for the staff database role).

## 4. Order flow

`PLACED` (stock reserved, invoice e-mailed) → `READY` (branch packed it, customer e-mailed) → `PICKED_UP` (payment recorded, invoice version 2) · or `CANCELLED` (shopper, or branch admin) · or `EXPIRED` (not collected within `PICKUP_HOLD_DAYS`, default 3; stock freed by a daily scheduled job and the customer e-mailed).

Race safety: placing an order takes a per-branch database lock, re-checks stock and creates the invoice in one transaction, so the last unit cannot be sold twice. Prices, GST and totals are always computed on the server.

## 5. Screens

**Shop (`/store`)**: home with hero and how-it-works steps; catalogue with search, category chips, sort, "in stock at my branch"; product page (price block, stock at all five branches, quantity, add to cart); cart; checkout (1 branch with live availability, 2 details, 3 payment: pay at pick-up / pay online "coming soon"); order page (progress, pick-up address, items, download invoice, cancel); account (e-mail-code sign-in, details, my orders); help (how pick-up works, payment, privacy and contact).
**Staff**: *Online orders* (branches see their own; central admin sees all, filter by branch) with Mark ready, Collected (records payment mode), Cancel (admins); central admin *Online store* analytics (online vs offices cards, 14-day chart, per-branch table, top online products, orders by status); *Products* gained category, photo URL and "show in online store".

## 6. Security and privacy

Server-side prices/stock; rate limits in the database (5 codes per e-mail per hour, 5 code guesses, 5 open orders per e-mail); order pages open only with the signed link from the e-mail, the owner's sign-in, or order number + e-mail; the same "not found" answer whether an order does not exist or is not yours; no card data (Razorpay hosted page later); only name, phone and e-mail are collected. Still to add before a heavy public launch: bot protection (Cloudflare Turnstile) on sign-in/checkout and per-IP rate limiting at the edge; a restricted database role for the public router (today it uses the server's owner connection with explicit queries); privacy/terms text approved by MCCIA.

## 7. Operations checklist (before announcing the store)

1. Event: dates set, every 2027 rate confirmed, status **Open** (the store is closed until then).
2. Each branch has opening stock entered (a branch with no stock set shows "out of stock"); use Transfer to move stock between branches.
3. **E-mail**: set `EMAIL_BACKEND` (`smtp` with an app password, or `resend` with a verified domain), `EMAIL_FROM`, `STORE_URL` on the API project. Without it sign-in codes and invoice e-mails are only logged, so shoppers cannot sign in.
4. Set `CRON_SECRET` on the API project (the daily clean-up job in `api/vercel.json` uses it).
5. Add product photos/categories in Admin > Products (placeholders are shown until then).
6. Smoke test one order end to end (order → ready → collected → analytics).

## 8. Later

* **Razorpay online payment** (the last phase, per the owner): `POST /store/orders` with `payment_method=ONLINE` creates a Razorpay order; payment is verified server-side (signature) and by webhook, then the order is marked paid and the invoice records the payment; failed/abandoned payments release the stock; refunds from the admin screen.
* Separate store domain: add the domain to the Vercel project and a host-based rewrite of `/` to `/store` (and a separate staff domain if wanted).
* Photo upload (Vercel Blob) instead of pasting a photo URL; reviews, coupons, WhatsApp/SMS updates, Marathi/Hindi storefront, receipt/credit-note documents, a printable packing slip.

## 9. Tests

`api/tests/test_store.py` (catalogue stock per branch, e-mail-code sign-in incl. brute force and token isolation, order placement with stock hold and e-mailed invoice, overselling and validation, staff ready/collect/cancel and branch isolation incl. database policies, analytics, expiry job, per-e-mail cap, store closed) and `e2e/store.spec.ts` (shop → cart → checkout → order page → branch hands over → central admin analytics; needs the real API).
