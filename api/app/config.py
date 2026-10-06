from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Read from the environment / api/.env. Never commit real credentials."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # "production" switches on start-up safety checks (see main.py) and refuses the dev sign-in.
    environment: str = "development"
    # PostgreSQL: Neon in production (use its POOLED connection string here), a local pgserver instance in dev
    # (see app/devdb.py). Neon needs `?sslmode=require` on the URL.
    database_url: str = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/nsw"
    # Optional: Neon's DIRECT (non-pooled) connection string. Used only by `alembic upgrade`, because
    # schema migrations should not go through the pooler.
    database_url_direct: str = ""
    # Our own sign-in (POST /api/v1/auth/login) signs short-lived tokens with this secret (HS256).
    # 32+ random characters; never expose it to the browser. (SUPABASE_JWT_SECRET is still read, for old .env files.)
    jwt_secret: str = Field(default="", validation_alias=AliasChoices("JWT_SECRET", "SUPABASE_JWT_SECRET"))
    token_hours: int = 12  # how long one sign-in lasts
    # DEV ONLY: exposes POST /api/v1/dev/token (sign in as any existing profile, no password).
    # Never registered when ENVIRONMENT=production.
    dev_login: bool = False
    pdf_autogenerate: bool = True  # create the PDF right after submit/revise (else on first download)
    # Where generated PDFs are kept: "local" (a folder, dev/tests) or "db" (a table in the database, production).
    storage_backend: str = "local"
    storage_dir: str = "storage"
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3100"]


settings = Settings()
