# Going live: everything on Vercel + Neon

Two Vercel projects from this one repo, both free-tier friendly:

| Project | Root directory | What it is |
|---|---|---|
| `nsw-web` | `/` (repo root) | The Next.js website |
| `nsw-api` | `/api` | The FastAPI backend, as a Python serverless function (`api/api/index.py` + `api/vercel.json`) |

No Chromium and no always-on server: the invoice PDF is drawn in Python by `api/app/pdf.py` (ReportLab).

## 1. Database (Neon, Singapore)
Neon -> project -> **Connect**: copy the **Pooled** and the **Direct** strings. Replace the leading `postgresql://`
with `postgresql+psycopg://` in both. Keep `?sslmode=require`. Turn **scale to zero off** for the event week and
enable point-in-time restore.

## 2. One-time database setup (from your PC)
```
cd api
$env:DATABASE_URL = "<DIRECT string>"
.venv\Scripts\python -m alembic upgrade head
.venv\Scripts\python -m app.seed
.venv\Scripts\python -m app.admin_cli create-user --email you@mcciapune.com --name "Central Admin" --role SUPER_ADMIN --password "<long password>"
```
Run `alembic upgrade head` again whenever a new release adds a migration — **before** deploying the API that needs it. Everyone else is added from the **Users** page.

> If you skip this, the API deploys fine and `/health` stays green, but every query touching the new column fails with HTTP 500. The browser then shows a misleading "blocked by CORS policy" error (a crashed response has no CORS header). Real incident, 2026-10-14: migration `0016` (delivery weights) was missing, so `/products` and `/store/catalogue` returned 500. Check with `alembic current` (it must print the newest revision) and `curl https://YOUR-API/api/v1/products`.

### Clearing test data before launch
`python -m app.purge_test_data --before YYYY-MM-DD` shows what would be removed (dry run); add `--delete --confirm "DELETE TEST DATA"` to do it. Take a Neon restore point first. Stock is computed from invoices, so deleting them gives the stock back.

## 3. API project (`nsw-api`)
```
cd api
vercel link          # create/choose the project "nsw-api"
```
Environment variables (Production), e.g. `vercel env add NAME production`:

| Name | Value |
|---|---|
| `ENVIRONMENT` | `production` |
| `DATABASE_URL` | the **pooled** string |
| `PAYMENT_DESK_DATABASE_URL` | Payment Desk's pooled PostgreSQL URL, configured as a server-only secret in `nsw-api`; used to write official Cash Receipts into the existing Payment Desk `cash_receipts` and `serial_counters` tables. Do not use a browser/public variable. |
| `JWT_SECRET` | 48+ random characters |
| `STORAGE_BACKEND` | `db` |
| `CORS_ORIGINS` | `["https://YOUR-SITE"]` |
| `EMAIL_BACKEND` | `smtp` (Gmail app password) or `resend` — needed for sign-in codes and order e-mails |
| `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` (or `RESEND_API_KEY`) | your mail account |
| `STORE_URL` | `https://YOUR-SITE/store` (links in e-mails) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | live keys for online and counter payments; the webhook (`/api/v1/store/webhooks/razorpay`) must be created in the same mode (live/test) as the keys |
| `CRON_SECRET` | random string; the daily job that frees uncollected orders uses it |

Then `vercel deploy --prod`. The API refuses to start in production if the secret is short, `DEV_LOGIN` is on,
CORS lists localhost, or PDFs would be written to disk. Check `https://YOUR-API/health`.

## 4. Website project (`nsw-web`)
From the repo root: `vercel link`, set `NEXT_PUBLIC_API_URL=https://YOUR-API` (Production), then `vercel deploy --prod`.
Do **not** set `NEXT_PUBLIC_DEV_LOGIN`. Put the site's final address in the API's `CORS_ORIGINS` and redeploy the API.

## 5. Check list
Sign in as each role, submit an invoice, download its PDF, run a stock transfer, open Audit logs.

## Limits to know
- PDFs print Latin text only (English names). Any other character (e.g. Devanagari) shows as `?`.
- A cold API call can take ~1-2 s after a quiet spell; later calls are fast.
