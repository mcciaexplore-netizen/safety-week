from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Read from the environment / api/.env. Never commit real credentials."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Supabase/Postgres in production; a local pgserver instance in dev (see app/devdb.py).
    database_url: str = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/nsw"
    # Supabase Auth. Use the JWT secret (HS256 projects) OR just the project URL (asymmetric
    # signing keys, verified through the project's JWKS). Never expose these to the browser.
    supabase_url: str = ""
    supabase_jwt_secret: str = ""
    supabase_service_key: str = ""  # only used by app/admin_cli.py to create users
    # DEV ONLY: exposes POST /api/v1/dev/token (sign in as any existing profile, no password).
    # Ignored whenever SUPABASE_URL is set, so it cannot be switched on in a real deployment.
    dev_login: bool = False
    # PDF generation: Chromium opens WEB_URL/print/invoice/... (the same template as the preview).
    web_url: str = "http://localhost:3000"
    print_token_secret: str = ""  # set in production if you run more than one API instance
    pdf_autogenerate: bool = True  # render right after submit/revise (else on first download)
    storage_dir: str = "storage"  # local dev storage; Supabase Storage is used when its keys are set
    storage_bucket: str = "invoice-pdfs"  # must be a PRIVATE bucket
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3100"]


settings = Settings()
