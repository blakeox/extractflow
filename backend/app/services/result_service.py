from __future__ import annotations

import csv
import json
from datetime import UTC, datetime
from pathlib import Path

from extraction_core import FormulaEngine, topologically_sort_calculated_fields
from extraction_core.models import ExtractionTemplate, ExtractionValidationSummary, ReviewEditPayload
from openpyxl import Workbook
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import ExportRecord, ExtractionJob, ExtractionResult, ReviewEdit, TemplateVersion


def utc_now() -> datetime:
    return datetime.now(UTC)


def apply_review_edits(db: Session, result: ExtractionResult, payload: ReviewEditPayload) -> ExtractionResult:
    summary = ExtractionValidationSummary.model_validate(result.result_json)
    field_index = {field.field_name: field for field in summary.extracted_fields}

    for edit in payload.edits:
        target = field_index[edit.field_name]
        db.add(
            ReviewEdit(
                result_id=result.id,
                reviewer=payload.reviewer,
                field_name=edit.field_name,
                previous_value=target.normalized_value,
                new_value=edit.normalized_value,
                reason=edit.reason,
            )
        )
        target.normalized_value = edit.normalized_value
        if edit.extracted_value is not None:
            target.extracted_value = edit.extracted_value
        target.validation_status = "reviewed"
        target.requires_review = False

    if payload.recalculate:
        job = db.query(ExtractionJob).filter(ExtractionJob.id == result.job_id).first()
        if job:
            job_template = db.query(TemplateVersion).filter(TemplateVersion.id == job.template_version_id).first()
        else:
            job_template = None
        if job_template:
            template = ExtractionTemplate.model_validate(job_template.definition)
            engine = FormulaEngine()
            context = {field.field_name: field.normalized_value for field in summary.extracted_fields}
            for definition in topologically_sort_calculated_fields(template.calculated_fields):
                calc = next(item for item in summary.calculated_fields if item.field_name == definition.name)
                calc.calculated_value = engine.evaluate(definition.formula, context)
                calc.validation_status = "reviewed"
                context[calc.field_name] = calc.calculated_value

    summary.reviewed_at = utc_now()
    result.result_json = summary.model_dump(mode="json")
    result.review_status = "reviewed"
    db.commit()
    db.refresh(result)
    return result


def export_result(db: Session, result: ExtractionResult, export_format: str) -> ExportRecord:
    summary = ExtractionValidationSummary.model_validate(result.result_json)
    timestamp = utc_now().strftime("%Y%m%d%H%M%S")
    Path(settings.exports_dir).mkdir(parents=True, exist_ok=True)
    path = (
        Path(settings.exports_dir)
        / f"result-{result.id}-{timestamp}.{'xlsx' if export_format == 'excel' else export_format}"
    )

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
    elif export_format == "excel":
        workbook = Workbook()
        sheet = workbook.active
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
    else:
        raise ValueError(f"Unsupported export format: {export_format}")

    record = ExportRecord(result_id=result.id, export_format=export_format, file_path=str(path))
    db.add(record)
    db.commit()
    db.refresh(record)
    return record
