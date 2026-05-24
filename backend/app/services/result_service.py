from __future__ import annotations

from datetime import UTC, datetime
from extraction_core import evaluate_calculated_fields
from extraction_core.models import ExtractionTemplate, ExtractionValidationSummary, ReviewEditPayload
from sqlalchemy.orm import Session

from app.models import ExportRecord, ExtractionJob, ExtractionResult, ReviewEdit, TemplateVersion
from app.services.storage import (
    build_export_reference,
    ensure_exports_directory,
    parse_export_format,
    write_result_export_file,
)


def utc_now() -> datetime:
    return datetime.now(UTC)


def recompute_fields_requiring_review(summary: ExtractionValidationSummary) -> None:
    summary.fields_requiring_review = [
        field.field_name for field in summary.extracted_fields if field.requires_review
    ] + [field.field_name for field in summary.calculated_fields if field.requires_review]


def apply_review_edits(db: Session, result: ExtractionResult, payload: ReviewEditPayload) -> ExtractionResult:
    summary = ExtractionValidationSummary.model_validate(result.result_json)
    field_index = {field.field_name: field for field in summary.extracted_fields}

    if payload.approve_high_confidence_min is not None:
        threshold = payload.approve_high_confidence_min
        for field in summary.extracted_fields:
            if not field.requires_review or field.validation_status == "invalid":
                continue
            score = field.confidence_score
            if score is not None and score >= threshold:
                field.validation_status = "reviewed"
                field.requires_review = False

    if not payload.edits and payload.approve_high_confidence_min is None:
        for field in summary.extracted_fields:
            if field.requires_review:
                field.validation_status = "reviewed"
                field.requires_review = False
        for calc in summary.calculated_fields:
            if calc.requires_review:
                calc.validation_status = "reviewed"
                calc.requires_review = False
    for edit in payload.edits:
        target = field_index[edit.field_name]
        db.add(
            ReviewEdit(
                tenant_id=result.tenant_id,
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
        job = (
            db.query(ExtractionJob)
            .filter(ExtractionJob.id == result.job_id, ExtractionJob.tenant_id == result.tenant_id)
            .first()
        )
        if job:
            job_template = (
                db.query(TemplateVersion)
                .filter(
                    TemplateVersion.id == job.template_version_id,
                    TemplateVersion.tenant_id == result.tenant_id,
                )
                .first()
            )
        else:
            job_template = None
        if job_template:
            template = ExtractionTemplate.model_validate(job_template.definition)
            summary.calculated_fields = evaluate_calculated_fields(template.calculated_fields, summary.extracted_fields)
            for calc in summary.calculated_fields:
                if calc.requires_review:
                    continue
                calc.validation_status = "reviewed"

    recompute_fields_requiring_review(summary)
    summary.reviewed_at = utc_now()
    result.result_json = summary.model_dump(mode="json")
    result.review_status = "reviewed"
    db.commit()
    db.refresh(result)
    return result


def export_result(db: Session, result: ExtractionResult, export_format: str) -> ExportRecord:
    summary = ExtractionValidationSummary.model_validate(result.result_json)
    timestamp = utc_now().strftime("%Y%m%d%H%M%S")
    ensure_exports_directory()
    parsed_format = parse_export_format(export_format)
    reference = build_export_reference(result.id, parsed_format, timestamp)
    write_result_export_file(
        reference=reference,
        export_format=parsed_format,
        summary=summary,
    )

    record = ExportRecord(
        tenant_id=result.tenant_id,
        result_id=result.id,
        export_format=parsed_format,
        file_path=reference,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record
