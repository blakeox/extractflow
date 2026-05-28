from __future__ import annotations

import os
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Protocol

from extraction_core.storage_refs import normalize_storage_reference, resolve_storage_path


class StorageBackendKind(StrEnum):
    LOCAL = "local"
    S3 = "s3"


@dataclass(frozen=True)
class BlobStoreConfig:
    backend: StorageBackendKind = StorageBackendKind.LOCAL
    data_dir: Path = Path("/data")
    uploads_dir: Path = Path("/data/uploads")
    exports_dir: Path = Path("/data/exports")
    parsed_dir: Path = Path("/data/parsed")
    s3_bucket: str | None = None
    s3_prefix: str = "extractflow"
    s3_endpoint_url: str | None = None
    s3_region: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "data_dir", Path(self.data_dir).expanduser().resolve())
        object.__setattr__(self, "uploads_dir", Path(self.uploads_dir).expanduser().resolve())
        object.__setattr__(self, "exports_dir", Path(self.exports_dir).expanduser().resolve())
        object.__setattr__(self, "parsed_dir", Path(self.parsed_dir).expanduser().resolve())
        if self.backend == StorageBackendKind.S3 and not self.s3_bucket:
            raise ValueError("S3_BUCKET is required when STORAGE_BACKEND=s3.")


class BlobStore(Protocol):
    def materialize(self, reference: str, *, root: Path) -> Path: ...

    def write_bytes(self, reference: str, payload: bytes, *, root: Path) -> str: ...

    def exists(self, reference: str, *, root: Path) -> bool: ...


class LocalBlobStore:
    def materialize(self, reference: str, *, root: Path) -> Path:
        return resolve_storage_path(reference, root=root)

    def write_bytes(self, reference: str, payload: bytes, *, root: Path) -> str:
        path = self.materialize(reference, root=root)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        return normalize_storage_reference(reference)

    def exists(self, reference: str, *, root: Path) -> bool:
        try:
            return self.materialize(reference, root=root).exists()
        except ValueError:
            return False


class S3BlobStore:
    def __init__(self, config: BlobStoreConfig) -> None:
        import boto3  # type: ignore[reportMissingImports]

        client_kwargs: dict[str, str] = {}
        if config.s3_endpoint_url:
            client_kwargs["endpoint_url"] = config.s3_endpoint_url
        if config.s3_region:
            client_kwargs["region_name"] = config.s3_region
        self._config = config
        self._client = boto3.client("s3", **client_kwargs)

    def _object_key(self, reference: str, *, root: Path) -> str:
        cleaned = normalize_storage_reference(reference)
        data_root = self._config.data_dir
        if root.resolve() == data_root.resolve():
            relative = cleaned
        elif root.resolve().is_relative_to(data_root):
            root_label = root.resolve().relative_to(data_root).as_posix()
            relative = f"{root_label}/{cleaned}"
        else:
            relative = f"{root.name}/{cleaned}"
        prefix = self._config.s3_prefix.strip("/")
        return f"{prefix}/{relative}" if prefix else relative

    def materialize(self, reference: str, *, root: Path) -> Path:
        cache_root = self._config.data_dir / ".cache" / "s3"
        cache_root.mkdir(parents=True, exist_ok=True)
        safe_name = self._object_key(reference, root=root).replace("/", "__")
        destination = cache_root / safe_name
        if destination.exists():
            return destination
        response = self._client.get_object(
            Bucket=self._config.s3_bucket,
            Key=self._object_key(reference, root=root),
        )
        destination.write_bytes(response["Body"].read())
        return destination

    def write_bytes(self, reference: str, payload: bytes, *, root: Path) -> str:
        self._client.put_object(
            Bucket=self._config.s3_bucket,
            Key=self._object_key(reference, root=root),
            Body=payload,
        )
        return normalize_storage_reference(reference)

    def exists(self, reference: str, *, root: Path) -> bool:
        from botocore.exceptions import ClientError  # type: ignore[reportMissingImports]

        try:
            self._client.head_object(
                Bucket=self._config.s3_bucket,
                Key=self._object_key(reference, root=root),
            )
            return True
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise


def create_blob_store(config: BlobStoreConfig) -> BlobStore:
    if config.backend == StorageBackendKind.S3:
        return S3BlobStore(config)
    return LocalBlobStore()


def storage_backend_from_env(
    *,
    backend: str | None = None,
    data_dir: str | Path = "/data",
    uploads_dir: str | Path | None = None,
    exports_dir: str | Path | None = None,
    parsed_dir: str | Path | None = None,
    s3_bucket: str | None = None,
    s3_prefix: str | None = None,
    s3_endpoint_url: str | None = None,
    s3_region: str | None = None,
) -> BlobStoreConfig:
    resolved_backend = StorageBackendKind((backend or os.getenv("STORAGE_BACKEND", "local")).strip().lower())
    data_root = Path(data_dir)
    return BlobStoreConfig(
        backend=resolved_backend,
        data_dir=data_root,
        uploads_dir=Path(uploads_dir or os.getenv("UPLOADS_DIR", str(data_root / "uploads"))),
        exports_dir=Path(exports_dir or os.getenv("EXPORTS_DIR", str(data_root / "exports"))),
        parsed_dir=Path(parsed_dir or os.getenv("PARSED_DIR", str(data_root / "parsed"))),
        s3_bucket=s3_bucket or os.getenv("S3_BUCKET"),
        s3_prefix=(s3_prefix or os.getenv("S3_PREFIX") or "extractflow").strip("/"),
        s3_endpoint_url=s3_endpoint_url or os.getenv("S3_ENDPOINT_URL"),
        s3_region=s3_region or os.getenv("AWS_REGION") or os.getenv("S3_REGION"),
    )
