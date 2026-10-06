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
Run `alembic upgrade head` again whenever a new release adds a migration. Everyone else is added from the **Users** page.

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
| `JWT_SECRET` | 48+ random characters |
| `STORAGE_BACKEND` | `db` |
| `CORS_ORIGINS` | `["https://YOUR-SITE"]` |

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
