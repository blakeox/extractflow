from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from extraction_core.blob_store import BlobStore, BlobStoreConfig, StorageBackendKind, create_blob_store

from app.core.config import settings


def blob_store_config_from_settings() -> BlobStoreConfig:
    data_root = Path(settings.data_dir)
    return BlobStoreConfig(
        backend=StorageBackendKind(settings.storage_backend),
        data_dir=data_root,
        uploads_dir=data_root / "uploads",
        exports_dir=data_root / "exports",
        parsed_dir=Path(settings.parsed_dir),
        s3_bucket=settings.s3_bucket,
        s3_prefix=settings.s3_prefix,
        s3_endpoint_url=settings.s3_endpoint_url,
        s3_region=settings.s3_region,
    )


@lru_cache
def get_blob_store() -> BlobStore:
    return create_blob_store(blob_store_config_from_settings())
