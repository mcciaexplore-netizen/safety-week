"""DEV ONLY: one command that gets the real backend running locally.

    api\\start-dev.bat        (or:  .venv\\Scripts\\python start_dev.py)

It starts the local PostgreSQL, writes its (changing) address into api/.env, applies the migrations,
loads the branches / products / dev users, and then runs the API on http://localhost:8000.
Leave the window open while you work; close it (Ctrl+C) to stop the API. The database keeps running in
the background and is reused next time; data is kept in api/.pgdata.
"""

import os
import subprocess
import sys
from pathlib import Path

import pgserver

ROOT = Path(__file__).resolve().parent
PORT = os.environ.get("PORT", "8000")

DEFAULTS = {
    "DEV_LOGIN": "true",
    "SUPABASE_JWT_SECRET": "dev-only-secret-dev-only-secret-dev-only-1",
    "CORS_ORIGINS": '["http://localhost:3000","http://127.0.0.1:3000","http://localhost:3100","http://localhost:3200"]',
    "WEB_URL": "http://localhost:3000",
}

server = pgserver.get_server(ROOT / ".pgdata", cleanup_mode=None)
url = server.get_uri().replace("postgresql://", "postgresql+psycopg://", 1)

env_file = ROOT / ".env"
kept = [l for l in env_file.read_text("utf-8").splitlines() if l.strip() and not l.startswith("DATABASE_URL=")] if env_file.exists() else []
have = {l.split("=", 1)[0] for l in kept}
kept += [f"{k}={v}" for k, v in DEFAULTS.items() if k not in have]
env_file.write_text("DATABASE_URL=" + url + "\n" + "\n".join(kept) + "\n", "utf-8")
print("database ready")

py = sys.executable
for step in ([py, "-m", "alembic", "upgrade", "head"], [py, "-m", "app.seed"], [py, "-m", "app.dev_seed"]):
    subprocess.run(step, cwd=ROOT, check=True)

print(f"\nAPI starting on http://localhost:{PORT}  (central admin: admin@example.invalid, any password)\n")
subprocess.run([py, "-m", "uvicorn", "app.main:app", "--port", PORT], cwd=ROOT)
