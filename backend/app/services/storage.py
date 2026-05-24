from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Literal
from uuid import uuid4

from extraction_core.models import ExtractionValidationSummary
from extraction_core.storage_refs import build_storage_reference, resolve_storage_path
from openpyxl import Workbook

from app.core.config import settings

ExportFormat = Literal["json", "csv", "excel"]
ALLOWED_EXPORT_FORMATS: frozenset[ExportFormat] = frozenset({"json", "csv", "excel"})
_EXPORT_SUFFIX_BY_FORMAT: dict[ExportFormat, str] = {
    "json": "json",
    "csv": "csv",
    "excel": "xlsx",
}


def parse_export_format(export_format: str) -> ExportFormat:
    normalized = export_format.strip().lower()
    if normalized not in ALLOWED_EXPORT_FORMATS:
        raise ValueError(f"Unsupported export format: {export_format}")
    return normalized


def build_upload_target(original_filename: str) -> tuple[str, Path]:
    data_root = Path(settings.data_dir)
    uploads_root = Path(settings.uploads_dir).expanduser().resolve()
    upload_prefix = uploads_root.relative_to(data_root.expanduser().resolve())
    safe_name = Path(original_filename).name
    reference = str(upload_prefix / f"{uuid4().hex}-{safe_name}")
    return reference, resolve_storage_path(reference, root=data_root)


def build_export_reference(result_id: int, export_format: ExportFormat, timestamp: str) -> str:
    suffix = _EXPORT_SUFFIX_BY_FORMAT[export_format]
    return f"result-{result_id}-{timestamp}.{suffix}"


def build_export_target(result_id: int, export_format: ExportFormat, timestamp: str) -> tuple[str, Path]:
    reference = build_export_reference(result_id, export_format, timestamp)
    return reference, resolve_export_download_path(reference)


def ensure_exports_directory() -> Path:
    exports_root = Path(settings.exports_dir).expanduser().resolve()
    exports_root.mkdir(parents=True, exist_ok=True)
    return exports_root


def write_result_export_file(
    *,
    reference: str,
    export_format: ExportFormat,
    summary: ExtractionValidationSummary,
) -> str:
    path = resolve_export_download_path(reference)

    if export_format == "json":
        path.write_text(json.dumps(summary.model_dump(mode="json"), indent=2), encoding="utf-8")
    elif export_format == "csv":
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["field_name", "label", "kind", "value", "status", "requires_review"])
            for field in summary.extracted_fields:
                writer.writerow(
                    [
                        field.field_name,
                        field.label,
                        "extracted",
                        json.dumps(field.normalized_value),
                        field.validation_status,
                        field.requires_review,
                    ]
                )
            for field in summary.calculated_fields:
                writer.writerow(
                    [
                        field.field_name,
                        field.label,
                        "calculated",
                        json.dumps(field.calculated_value),
                        field.validation_status,
                        field.requires_review,
                    ]
                )
    else:
        workbook = Workbook()
        sheet = workbook.active
        if sheet is None:
            sheet = workbook.create_sheet("Extraction Results")
        else:
            sheet.title = "Extraction Results"
        sheet.append(["field_name", "label", "kind", "value", "status", "requires_review"])
        for field in summary.extracted_fields:
            sheet.append(
                [
                    field.field_name,
                    field.label,
                    "extracted",
                    json.dumps(field.normalized_value),
                    field.validation_status,
                    field.requires_review,
                ]
            )
        for field in summary.calculated_fields:
            sheet.append(
                [
                    field.field_name,
                    field.label,
                    "calculated",
                    json.dumps(field.calculated_value),
                    field.validation_status,
                    field.requires_review,
                ]
            )
        workbook.save(path)

    return reference


def resolve_export_download_path(file_path: str) -> Path:
    return resolve_managed_path(file_path, root=Path(settings.exports_dir))


def resolve_document_storage_path(file_path: str) -> Path:
    return resolve_managed_path(file_path, root=Path(settings.data_dir))


def resolve_managed_path(candidate: str | Path, *, root: Path) -> Path:
    reference = candidate.as_posix() if isinstance(candidate, Path) else candidate
    return resolve_storage_path(reference, root=root)


def build_document_storage_reference(file_path: str | Path) -> str:
    return build_storage_reference(file_path, root=Path(settings.data_dir))


def read_managed_document_text(reference: str) -> str | None:
    try:
        path = resolve_document_storage_path(reference)
    except ValueError:
        return None
    if not path.exists():
        return None
    try:
        content = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    return content if content.strip() else None
