from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError
from extraction_core.blob_store import (
    BlobStoreConfig,
    LocalBlobStore,
    S3BlobStore,
    StorageBackendKind,
    create_blob_store,
)


def test_local_blob_store_round_trip(tmp_path: Path) -> None:
    store = LocalBlobStore()
    reference = "uploads/sample.txt"
    target = tmp_path / "uploads" / "sample.txt"
    target.parent.mkdir(parents=True)
    target.write_text("hello", encoding="utf-8")

    materialized = store.materialize(reference, root=tmp_path)
    assert materialized.read_text(encoding="utf-8") == "hello"
    assert store.exists(reference, root=tmp_path)


def test_create_blob_store_selects_backend() -> None:
    local = create_blob_store(BlobStoreConfig(backend=StorageBackendKind.LOCAL, data_dir=Path("/data")))
    assert isinstance(local, LocalBlobStore)


def test_s3_object_key_includes_root_namespace(tmp_path: Path) -> None:
    config = BlobStoreConfig(
        backend=StorageBackendKind.S3,
        data_dir=tmp_path,
        s3_bucket="artifacts",
        s3_prefix="extractflow",
    )
    with patch("boto3.client") as client_factory:
        client_factory.return_value = MagicMock()
        store = S3BlobStore(config)
    exports_root = tmp_path / "exports"
    assert store._object_key("result-1.json", root=exports_root) == "extractflow/exports/result-1.json"
    assert store._object_key("uploads/doc.pdf", root=tmp_path) == "extractflow/uploads/doc.pdf"


def test_s3_exists_handles_missing_object(tmp_path: Path) -> None:
    config = BlobStoreConfig(
        backend=StorageBackendKind.S3,
        data_dir=tmp_path,
        s3_bucket="artifacts",
    )
    client = MagicMock()
    client.head_object.side_effect = ClientError(
        {"Error": {"Code": "404", "Message": "Not Found"}},
        "HeadObject",
    )
    with patch("boto3.client", return_value=client):
        store = S3BlobStore(config)
    assert store.exists("uploads/missing.pdf", root=tmp_path) is False
