"""Document bytes storage.

Two backends behind one interface: a mounted volume ("local", the default, so the portal runs without
extra infrastructure) and any S3-compatible service ("s3"). Database rows hold the metadata; only the
bytes live here, addressed by an opaque storage key that callers never build by hand.
"""
import hashlib
import re
import shutil
import uuid
from abc import ABC, abstractmethod
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import BinaryIO

from app.core.config import get_settings

CHUNK = 1024 * 1024
_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def build_key(opportunity_id: uuid.UUID, document_id: uuid.UUID, file_name: str) -> str:
    safe = _SAFE.sub("_", file_name)[-80:].lstrip(".") or "file"
    return f"opportunities/{opportunity_id}/{date.today():%Y/%m}/{document_id}_{safe}"


class Storage(ABC):
    @abstractmethod
    def save(self, key: str, stream: BinaryIO, max_bytes: int) -> tuple[int, str]:
        """Store the stream, returning (size_bytes, sha256). Raises ValueError if max_bytes is exceeded."""

    @abstractmethod
    def open(self, key: str) -> Iterator[bytes]: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...


class LocalStorage(Storage):
    def __init__(self, root: str):
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not str(path).startswith(str(self.root.resolve())):
            raise ValueError("Invalid storage key.")
        return path

    def save(self, key: str, stream: BinaryIO, max_bytes: int) -> tuple[int, str]:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        digest, size = hashlib.sha256(), 0
        tmp = path.with_suffix(path.suffix + ".part")
        try:
            with tmp.open("wb") as out:
                while chunk := stream.read(CHUNK):
                    size += len(chunk)
                    if size > max_bytes:
                        raise ValueError("File is too large.")
                    digest.update(chunk)
                    out.write(chunk)
            tmp.replace(path)
        except Exception:
            tmp.unlink(missing_ok=True)
            raise
        return size, digest.hexdigest()

    def open(self, key: str) -> Iterator[bytes]:
        with self._path(key).open("rb") as fh:
            while chunk := fh.read(CHUNK):
                yield chunk

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class S3Storage(Storage):
    def __init__(self) -> None:
        import boto3  # imported lazily: only needed when the S3 backend is selected

        s = get_settings()
        self.bucket = s.s3_bucket
        self.client = boto3.client(
            "s3", endpoint_url=s.s3_endpoint_url, region_name=s.s3_region, use_ssl=s.s3_use_ssl,
            aws_access_key_id=s.s3_access_key_id, aws_secret_access_key=s.s3_secret_access_key,
        )

    def save(self, key: str, stream: BinaryIO, max_bytes: int) -> tuple[int, str]:
        import tempfile

        digest, size = hashlib.sha256(), 0
        with tempfile.SpooledTemporaryFile(max_size=32 * CHUNK) as buf:
            while chunk := stream.read(CHUNK):
                size += len(chunk)
                if size > max_bytes:
                    raise ValueError("File is too large.")
                digest.update(chunk)
                buf.write(chunk)
            buf.seek(0)
            self.client.upload_fileobj(buf, self.bucket, key)
        return size, digest.hexdigest()

    def open(self, key: str) -> Iterator[bytes]:
        body = self.client.get_object(Bucket=self.bucket, Key=key)["Body"]
        while chunk := body.read(CHUNK):
            yield chunk

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        s = get_settings()
        _storage = S3Storage() if s.storage_backend == "s3" else LocalStorage(s.local_storage_path)
    return _storage


def copy_stream(src: BinaryIO, dst: BinaryIO) -> None:
    shutil.copyfileobj(src, dst, CHUNK)
