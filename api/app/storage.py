"""Private object storage for generated PDFs. Objects are never public: they are read back
through the API after the normal authentication + branch checks (no public or signed URLs).

- Production: a PRIVATE Supabase Storage bucket (service-role key, server side only).
- Development / tests: a local directory.
Paths are built only from UUIDs and integers (see documents.py), never from user input.
"""

from pathlib import Path

import httpx

from .config import settings


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


class SupabaseStorage:
    def __init__(self):
        self.base = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/{settings.storage_bucket}"
        self.headers = {"apikey": settings.supabase_service_key,
                        "Authorization": f"Bearer {settings.supabase_service_key}"}

    def put(self, key: str, data: bytes) -> None:
        r = httpx.post(f"{self.base}/{key}", content=data, timeout=60,
                       headers={**self.headers, "Content-Type": "application/pdf", "x-upsert": "true"})
        r.raise_for_status()

    def get(self, key: str) -> bytes:
        r = httpx.get(f"{self.base}/{key}", headers=self.headers, timeout=60)
        r.raise_for_status()
        return r.content


def store() -> LocalStorage | SupabaseStorage:
    if settings.supabase_url and settings.supabase_service_key:
        return SupabaseStorage()
    return LocalStorage(settings.storage_dir)
