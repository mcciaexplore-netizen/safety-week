"""Private object storage for generated PDFs. Objects are never public: they are read back
through the API after the normal authentication + branch checks (no public or signed URLs).

- Production (STORAGE_BACKEND=db): a table in the database (a PDF is only tens of KB, and the host's disk is wiped on deploy).
- Development / tests: a local directory.
Paths are built only from UUIDs and integers (see documents.py), never from user input.
"""

from pathlib import Path

from sqlalchemy.dialects.postgresql import insert

from .config import settings
from .db import SessionLocal
from .models import StoredFile


class LocalStorage:
    def __init__(self, root: str):
        self.root = Path(root).resolve()

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root not in p.parents:  # defence in depth against path traversal
            raise ValueError("bad storage key")
        return p

    def put(self, key: str, data: bytes) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()


class DbStorage:
    """PDFs as rows in `stored_files` (production). Uses its own owner connection: the request's RLS role has no
    access to this table, so a PDF can only be read back through the API's normal authentication + branch checks."""

    def put(self, key: str, data: bytes) -> None:
        stmt = insert(StoredFile).values(key=key, data=data)
        with SessionLocal() as s:
            s.execute(stmt.on_conflict_do_update(index_elements=[StoredFile.key], set_={"data": data}))
            s.commit()

    def get(self, key: str) -> bytes:
        with SessionLocal() as s:
            row = s.get(StoredFile, key)
            if row is None:
                raise FileNotFoundError(key)
            return bytes(row.data)


def store() -> LocalStorage | DbStorage:
    return DbStorage() if settings.storage_backend == "db" else LocalStorage(settings.storage_dir)
