# Going live with real authentication (Supabase + hosting)

Everything below is a one-time set-up **you** do in your own accounts. Nothing here can be done from the code.
Until you do it, the web app keeps running in demo mode (mock login), and the API tests run on a local throw-away PostgreSQL.

## 1. Supabase (database + login)

1. Sign up at https://supabase.com and click **New project**. Choose a region near Pune (Mumbai `ap-south-1` if offered), set a strong **database password** and save it in a password manager.
2. Wait for the project to finish provisioning, then collect four values:
   - **Project URL** — Project Settings → API → *Project URL* (`https://xxxx.supabase.co`).
   - **anon public key** — Project Settings → API → *anon public*. Safe for the browser.
   - **service_role key** — same page. **Secret. Never put it in the web app or in Git.** Only used by `app/admin_cli.py`.
   - **Database connection string** — Project Settings → Database → *Connection string* → *URI*. Use the **Session pooler** string (works on IPv4). It looks like `postgresql://postgres.xxxx:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`. Change the start to `postgresql+psycopg://`.
3. JWT verification — Project Settings → API (or *JWT Keys*):
   - If it shows a **JWT Secret** (legacy HS256): copy it into `SUPABASE_JWT_SECRET`.
   - If your project uses the newer **asymmetric signing keys**: leave `SUPABASE_JWT_SECRET` empty; the API reads the public keys from `SUPABASE_URL` automatically.
4. Authentication → Sign In / Providers → keep **Email** on. Turn **off** *Allow new users to sign up* (Authentication → Sign In / Providers → *User Signups*) — only admins create users. (You do not need to change *Confirm email*: the CLI creates users already confirmed.)

## 2. Create the schema and data in Supabase

On your computer, in `api/`:

```
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env        (then edit .env: DATABASE_URL, SUPABASE_URL, SUPABASE_JWT_SECRET, SUPABASE_SERVICE_KEY)
.venv\Scripts\alembic upgrade head
.venv\Scripts\python -m app.seed
```

This creates the tables, the row-level-security policies, the five branches, the 2027 event and the starting product catalogue.

### PDF storage bucket

Supabase dashboard -> **Storage** -> **New bucket** -> name it exactly `invoice-pdfs` and leave **Public bucket OFF** (private). No policies are needed: the API reads and writes it with the service_role key and hands PDFs to users only after checking who they are and which branch they belong to.

## 3. Create your users

```
.venv\Scripts\python -m app.admin_cli create-user --email you@mccia.org --name "Your Name" --role SUPER_ADMIN --password "a-strong-password"
.venv\Scripts\python -m app.admin_cli create-user --email tilak1@mccia.org --name "Tilak User" --role BRANCH_USER --branch TIL --password "..."
```
Branches: `SBR` SB Road, `TIL` Tilak Road, `BHO` Bhosari, `HAD` Hadapsar, `AHL` Ahilyanagar. Roles: `SUPER_ADMIN` (no branch), `BRANCH_ADMIN`, `BRANCH_USER`.
A person who has a login but no profile row is refused (HTTP 403). To deactivate someone, set `active = false` in the `users` table.

## 4. Run everything locally against Supabase

- API: `cd api` then `.venv\Scripts\uvicorn app.main:app --port 8000`
- Web: create `.env.local` in the project root (see `.env.local.example`):
  ```
  NEXT_PUBLIC_API_URL=http://localhost:8000
  NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
  ```
  then `npm run dev`. The login page now uses real accounts. (Invoice data still uses the browser mock until Phase 6 connects it to the API.)

## 5. Deploy (later, when you want it online)

| Piece | Where | What you do |
|---|---|---|
| Web app | **Vercel** (free tier is fine) | Import the Git repo, root directory = project root, add the three `NEXT_PUBLIC_*` variables. |
| API | **Render** or **Railway** | New *Web Service*, root directory `api`. Build: `pip install -r requirements.txt && playwright install --with-deps chromium` (the PDF maker needs Chromium; a Docker image based on `mcr.microsoft.com/playwright/python` also works). Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Env vars: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_KEY`, `WEB_URL=https://your-web-domain`, `PRINT_TOKEN_SECRET=<random 32+ chars>`, `CORS_ORIGINS=["https://your-web-domain"]`. |
| Database / login | Supabase (step 1) | Already done. Turn on daily backups (Project Settings → Database → Backups; paid plans have point-in-time recovery). |
| Domain | Your DNS provider | Point e.g. `safety.mccia.org` at Vercel (Vercel shows the exact records). |

Never commit `.env` files. If the `service_role` key or database password is ever pasted somewhere public, rotate it in Supabase (Project Settings → API / Database) immediately.

## 6. Check it worked

1. Sign in on the login page with a Tilak account, pick **Tilak Road** → you land on the Tilak dashboard.
2. Sign in with the same account but pick **Bhosari** → you must be refused ("This account belongs to Tilak Road…").
3. `GET http://localhost:8000/api/v1/me` with that account's token returns its branch — that answer, not the browser, decides what you can see.
