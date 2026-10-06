"""Our own sign-in: e-mail + password -> a short-lived signed token (replaces Supabase Auth).

- Passwords are stored as argon2id hashes in `user_credentials` (never readable by the API's RLS role).
- 5 wrong passwords lock that account for 15 minutes (counted in the database, so it holds across instances).
- The token carries only the user's id (`sub`) and an expiry. Role and branch are always looked up from
  `users` on every request (see auth.current_principal), so a token can never grant more than the profile does.
- Every failure says the same thing, so the endpoint cannot be used to find out which e-mails exist.
"""

import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .auth import Principal, current_principal
from .config import settings
from .db import SessionLocal, get_session
from .models import User, UserCredential

router = APIRouter(prefix="/api/v1/auth")
Sess = Annotated[Session, Depends(get_session)]

MAX_ATTEMPTS = 5
LOCK_MINUTES = 15
_hasher = PasswordHasher()
_DUMMY = _hasher.hash("not-a-real-password")  # verified against when the e-mail is unknown, so timing looks the same


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=200)


class PasswordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: str = Field(min_length=8, max_length=128)


class ChangePasswordIn(PasswordIn):
    current_password: str = Field(min_length=1, max_length=200)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def set_password(user_id: uuid.UUID, password: str) -> None:
    """Set (or reset) a password and clear any lock. Runs on its own owner connection: the request's
    RLS role has no access to credentials, by design. Callers must already have checked who is asking."""
    h = hash_password(password)
    with SessionLocal() as s:
        cred = s.get(UserCredential, user_id)
        if cred is None:
            s.add(UserCredential(user_id=user_id, password_hash=h))
        else:
            cred.password_hash, cred.failed_attempts, cred.locked_until = h, 0, None
            cred.updated_at = datetime.now(UTC)
        s.commit()


def issue_token(user: User) -> str:
    claims = {"sub": str(user.auth_user_id), "aud": "authenticated", "exp": int(time.time()) + settings.token_hours * 3600}
    return jwt.encode(claims, settings.jwt_secret, "HS256")


def _refuse() -> HTTPException:
    return HTTPException(401, "Incorrect e-mail or password.")


@router.post("/login")
def login(body: LoginIn, s: Sess):
    if not settings.jwt_secret:
        raise HTTPException(503, "Sign-in is not configured on the server")
    user = s.scalar(select(User).where(func.lower(User.email) == body.email.strip().lower()))
    cred = s.get(UserCredential, user.id) if user else None
    if user is None or cred is None or not user.active:
        _hasher_verify(_DUMMY, body.password)  # same work either way
        raise _refuse()
    now = datetime.now(UTC)
    if cred.locked_until and cred.locked_until > now:
        mins = int((cred.locked_until - now).total_seconds() // 60) + 1
        raise HTTPException(429, f"Too many wrong passwords. Try again in {mins} minute(s), or ask the central admin to reset it.")
    if not _hasher_verify(cred.password_hash, body.password):
        cred.failed_attempts += 1
        if cred.failed_attempts >= MAX_ATTEMPTS:
            cred.failed_attempts, cred.locked_until = 0, now + timedelta(minutes=LOCK_MINUTES)
        s.commit()  # keep the count even though we raise
        raise _refuse()
    cred.failed_attempts, cred.locked_until = 0, None
    if user.auth_user_id is None:
        user.auth_user_id = user.id
    if _hasher.check_needs_rehash(cred.password_hash):
        cred.password_hash = hash_password(body.password)
    s.commit()
    return {"access_token": issue_token(user), "token_type": "bearer", "expires_in": settings.token_hours * 3600}


@router.post("/change-password", status_code=204)
def change_password(body: ChangePasswordIn, p: Annotated[Principal, Depends(current_principal)]):
    """Any signed-in user can change their own password (they must know the current one)."""
    with SessionLocal() as owner:
        cred = owner.get(UserCredential, p.user_id)
        if cred is None or not _hasher_verify(cred.password_hash, body.current_password):
            raise HTTPException(403, "The current password is not right")
    set_password(p.user_id, body.password)


def _hasher_verify(hashed: str, password: str) -> bool:
    try:
        return _hasher.verify(hashed, password)
    except (VerificationError, InvalidHashError):
        return False


