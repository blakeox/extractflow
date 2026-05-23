from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from extraction_core.storage_refs import build_storage_reference, resolve_storage_path

from app.core.config import settings


def build_upload_target(original_filename: str) -> tuple[str, Path]:
    data_root = Path(settings.data_dir)
    uploads_root = Path(settings.uploads_dir).expanduser().resolve()
    upload_prefix = uploads_root.relative_to(data_root.expanduser().resolve())
    safe_name = Path(original_filename).name
    reference = str(upload_prefix / f"{uuid4().hex}-{safe_name}")
    return reference, resolve_storage_path(reference, root=data_root)


def build_export_reference(result_id: int, export_format: str, timestamp: str) -> str:
    suffix = "xlsx" if export_format == "excel" else export_format
    return f"result-{result_id}-{timestamp}.{suffix}"


def build_export_target(result_id: int, export_format: str, timestamp: str) -> tuple[str, Path]:
    reference = build_export_reference(result_id, export_format, timestamp)
    return reference, resolve_export_download_path(reference)


def resolve_export_download_path(file_path: str) -> Path:
    return resolve_managed_path(file_path, root=Path(settings.exports_dir))


def resolve_document_storage_path(file_path: str) -> Path:
    return resolve_managed_path(file_path, root=Path(settings.data_dir))


def resolve_managed_path(candidate: str | Path, *, root: Path) -> Path:
    return resolve_storage_path(candidate, root=root)


def build_document_storage_reference(file_path: str | Path) -> str:
    return build_storage_reference(file_path, root=Path(settings.data_dir))
