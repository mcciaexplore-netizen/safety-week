from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from .config import settings

# prepare_threshold=None: no server-side prepared statements, so the same code works behind Neon's
# connection pooler (pgbouncer, transaction mode). pool_recycle: Neon closes idle connections.
engine = create_engine(settings.database_url, pool_pre_ping=True, pool_recycle=300, pool_size=3, max_overflow=4, connect_args={"prepare_threshold": None})
SessionLocal = sessionmaker(engine, expire_on_commit=False)


@event.listens_for(Session, "after_begin")
def _reapply_rls(session, transaction, connection):
    """A commit ends SET LOCAL; re-apply so a later query in the same request is never unrestricted."""
    principal = session.info.get("principal")
    if principal is not None:
        from .auth import apply_rls  # local import: auth imports this module

        apply_rls(connection, principal)


def get_session() -> Iterator[Session]:
    """FastAPI dependency: one session per request (auth adds the principal to it)."""
    with SessionLocal() as session:
        yield session
