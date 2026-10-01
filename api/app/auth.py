"""Authentication + the trust boundary.

The ONLY inputs trusted for "who is this and which branch are they in" are:
  1. a Supabase-signed JWT (signature, expiry and audience verified here), and
  2. the caller's row in our own `users` table, found by the JWT `sub`.
Anything in a request body, query string or header about branch/role is ignored or rejected.
"""

import uuid
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from sqlalchemy import select, text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from .config import settings
from .db import get_session
from .models import User

_bearer = HTTPBearer(auto_error=False)
_jwks: PyJWKClient | None = None


@dataclass(frozen=True)
class Principal:
    user_id: uuid.UUID
    role: str
    branch_id: uuid.UUID | None
    name: str
    email: str

    @property
    def is_super(self) -> bool:
        return self.role == "SUPER_ADMIN"

    @property
    def is_admin(self) -> bool:
        return self.role in ("SUPER_ADMIN", "BRANCH_ADMIN")


def _unauthorized(detail: str = "Invalid or expired credentials") -> HTTPException:
    return HTTPException(401, detail, headers={"WWW-Authenticate": "Bearer"})


def verify_token(token: str) -> dict:
    """Return verified claims or raise 401. The algorithm list is fixed server-side (no 'none')."""
    global _jwks
    try:
        alg = jwt.get_unverified_header(token).get("alg")
        if alg == "HS256" and settings.supabase_jwt_secret:
            key, algs = settings.supabase_jwt_secret, ["HS256"]
        elif alg in ("ES256", "RS256") and settings.supabase_url:
            _jwks = _jwks or PyJWKClient(f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json")
            key, algs = _jwks.get_signing_key_from_jwt(token).key, [alg]
        else:
            raise _unauthorized()
        return jwt.decode(
            token, key, algorithms=algs, audience="authenticated", options={"require": ["exp", "sub"]}
        )
    except (jwt.PyJWTError, jwt.PyJWKClientError):
        raise _unauthorized() from None


def apply_rls(connection: Connection, p: Principal) -> None:
    """Hand the verified identity to PostgreSQL so row level security enforces it too."""
    connection.execute(
        text(
            "SELECT set_config('app.user_id', :u, true), set_config('app.role', :r, true), "
            "set_config('app.branch_id', :b, true)"
        ),
        {"u": str(p.user_id), "r": p.role, "b": str(p.branch_id or "")},
    )
    connection.execute(text("SET LOCAL ROLE app_authenticated"))


def current_principal(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    s: Session = Depends(get_session),
) -> Principal:
    if creds is None:
        raise _unauthorized("Not authenticated")
    claims = verify_token(creds.credentials)
    try:
        auth_id = uuid.UUID(claims["sub"])
    except ValueError:
        raise _unauthorized() from None
    user = s.scalar(select(User).where(User.auth_user_id == auth_id))
    if user is None or not user.active:
        raise HTTPException(403, "No active profile for this account")
    principal = Principal(user.id, user.role, user.branch_id, user.name, user.email)
    s.info["principal"] = principal  # re-applied automatically on every later transaction
    apply_rls(s.connection(), principal)
    return principal
