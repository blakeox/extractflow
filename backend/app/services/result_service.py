from __future__ import annotations

import hashlib
from datetime import UTC, datetime

from extraction_core import evaluate_calculated_fields
from extraction_core.models import ExtractionTemplate, ExtractionValidationSummary, ReviewEditPayload
from sqlalchemy.orm import Session

from app.models import ExportRecord, ExtractionJob, ExtractionResult, ReviewEdit, TemplateVersion
from app.services.audit_service import record_audit_event
from app.services.settings_service import get_tenant_bool_setting
from app.services.storage import (
    build_export_reference,
    ensure_exports_directory,
    parse_export_format,
    resolve_export_download_path,
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
    job = (
        db.query(ExtractionJob)
        .filter(ExtractionJob.id == result.job_id, ExtractionJob.tenant_id == result.tenant_id)
        .first()
    )
    record_audit_event(
        db,
        tenant_id=result.tenant_id,
        actor=payload.reviewer,
        action="review.saved",
        object_type="result",
        object_id=result.id,
        metadata={
            "result_id": result.id,
            "job_id": result.job_id,
            "document_id": job.document_id if job else None,
            "field_names": [edit.field_name for edit in payload.edits],
            "edit_count": len(payload.edits),
        },
    )
    db.commit()
    db.refresh(result)
    return result


def assert_export_allowed(db: Session, result: ExtractionResult) -> None:
    if not get_tenant_bool_setting(db, result.tenant_id, "export.require_review_cleared"):
        return
    summary = ExtractionValidationSummary.model_validate(result.result_json)
    if result.review_status == "pending" or summary.fields_requiring_review:
        raise ValueError(
            "Export blocked until review is cleared. Save review decisions for all fields requiring review."
        )


def _latest_reviewer(db: Session, result: ExtractionResult) -> str | None:
    latest = (
        db.query(ReviewEdit)
        .filter(ReviewEdit.result_id == result.id, ReviewEdit.tenant_id == result.tenant_id)
        .order_by(ReviewEdit.created_at.desc())
        .first()
    )
    return latest.reviewer if latest else None


def export_result(
    db: Session,
    result: ExtractionResult,
    export_format: str,
    *,
    reviewer: str | None = None,
) -> ExportRecord:
    assert_export_allowed(db, result)
    summary = ExtractionValidationSummary.model_validate(result.result_json)
    exported_at = utc_now()
    timestamp = exported_at.strftime("%Y%m%d%H%M%S")
    ensure_exports_directory()
    parsed_format = parse_export_format(export_format)
    reference = build_export_reference(result.id, parsed_format, timestamp)
    write_result_export_file(
        reference=reference,
        export_format=parsed_format,
        summary=summary,
    )
    file_path = resolve_export_download_path(reference)
    content_sha256 = hashlib.sha256(file_path.read_bytes()).hexdigest()

    job = (
        db.query(ExtractionJob)
        .filter(ExtractionJob.id == result.job_id, ExtractionJob.tenant_id == result.tenant_id)
        .first()
    )
    resolved_reviewer = reviewer or _latest_reviewer(db, result) or "local-user"
    manifest = {
        "result_id": result.id,
        "job_id": result.job_id,
        "export_format": parsed_format,
        "content_sha256": content_sha256,
        "exported_at": exported_at.isoformat(),
        "reviewer": resolved_reviewer,
        "template_version_id": job.template_version_id if job else None,
        "template_name": summary.template_name,
        "template_version": summary.template_version,
    }

    record = ExportRecord(
        tenant_id=result.tenant_id,
        result_id=result.id,
        export_format=parsed_format,
        file_path=reference,
        content_sha256=content_sha256,
        exported_at=exported_at,
        reviewer=resolved_reviewer,
        template_version_id=job.template_version_id if job else None,
        manifest_json=manifest,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    record_audit_event(
        db,
        tenant_id=result.tenant_id,
        actor=resolved_reviewer,
        action="export.created",
        object_type="export",
        object_id=record.id,
        metadata={
            "result_id": result.id,
            "job_id": result.job_id,
            "document_id": job.document_id if job else None,
            "export_format": parsed_format,
            "content_sha256": content_sha256,
        },
    )
    db.commit()
    db.refresh(record)
    return record
