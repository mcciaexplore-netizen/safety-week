"""Dev only: start a persistent local PostgreSQL (no Docker/Supabase needed) and print its URL.

    python -m app.devdb        ->  DATABASE_URL=postgresql+psycopg://...

The server keeps running after this script exits. Production uses Supabase via DATABASE_URL.
"""

from pathlib import Path

import pgserver

if __name__ == "__main__":
    server = pgserver.get_server(Path(__file__).resolve().parents[1] / ".pgdata", cleanup_mode=None)
    print("DATABASE_URL=" + server.get_uri().replace("postgresql://", "postgresql+psycopg://", 1))
