# MCCIA National Safety Week 2027 — Proforma Invoice System

Internal system for MCCIA's five branch offices to prepare, track and report Proforma Invoices for safety-awareness material sales, with a central-admin console (stock across branches and transfers, products and rates, users, reports, audit log).

| Part | Where | Notes |
|---|---|---|
| Staff web app | repo root (Next.js 16, Tailwind 4, shadcn) | live: `nsw-web` on Vercel |
| API | `api/` (FastAPI, SQLAlchemy, Alembic) | live: `nsw-api` on Vercel; PDFs drawn with ReportLab |
| Database | Neon PostgreSQL (Singapore) | row-level security keeps branches apart |
| Online store (pick-up) | `app/(store)/store/*` in the same Next.js app, API in `api/app/store*.py` | `/store`; see [docs/online-store-plan.md](docs/online-store-plan.md) |

## Run it locally

```
api\start-dev.bat            # local PostgreSQL + migrations + seed + API on :8000 (dev sign-in, no password)
npm install
npm run dev                  # http://localhost:3000   (needs .env.local, see .env.local.example)
```
Browser-only demo (no API): leave `NEXT_PUBLIC_API_URL` unset.

## Checks

```
npm run typecheck && npm run lint
cd api && .venv\Scripts\python -m pytest tests -q
npx playwright test          # e2e; API_E2E=1 for the real-stack journeys
```

## Documents

- [plan.md](plan.md) — the master plan, decisions and change log (start here)
- [docs/invoice-spec.md](docs/invoice-spec.md) — the invoice layout/calculation spec taken from the 2026 workbook
- [docs/deploy.md](docs/deploy.md) — going live on Vercel + Neon
- [docs/online-store-plan.md](docs/online-store-plan.md) — the online store (pick-up from branches): decisions, flow, screens, operations checklist
- [AGENTS.md](AGENTS.md) — notes for AI coding assistants (this repo uses a newer Next.js than most training data)
