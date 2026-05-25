from __future__ import annotations

import json
import logging
import os
import socket
import time
from datetime import UTC, datetime
from pathlib import Path

from extraction_core.job_progress import JOB_STAGE_COMPLETED, JOB_STAGE_FAILED, JOB_STAGE_PARSING
from extraction_core.observability import configure_logger, log_event
from extraction_core.runtime_schema import ensure_extraction_job_runtime_columns
from extraction_core.storage_refs import resolve_storage_path
from sqlalchemy import select, update

from app.core.config import settings
from app.core.database import SessionLocal, engine
from app.models import AuditEvent, Document, ExtractionJob, ExtractionResult, TemplateVersion
from app.services.document_text import parse_and_persist_document_text
from app.services.executor import execute_extraction
from app.services.job_progress import build_progress_reporter, update_job_progress
from app.services.parser import prewarm_docling_converters

logger = configure_logger("extractflow.worker")
WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"


def record_worker_audit(
    db,
    *,
    tenant_id: str,
    action: str,
    object_type: str,
    object_id: int,
    metadata: dict | None = None,
) -> None:
    db.add(
        AuditEvent(
            tenant_id=tenant_id,
            actor="worker",
            action=action,
            object_type=object_type,
            object_id=str(object_id),
            metadata_json=metadata or {},
        )
    )


def is_job_cancelled(db, job_id: int) -> bool:
    job = db.get(ExtractionJob, job_id)
    return job is not None and job.status == "cancelled"


def finalize_cancelled_job(db, job: ExtractionJob, document: Document) -> None:
    document.status = "uploaded"
    db.commit()
    write_worker_status(
        "idle",
        {
            "job_id": job.id,
            "document_id": document.id,
            "tenant_id": job.tenant_id,
            "reason": "cancelled",
        },
    )


def write_worker_status(state: str, details: dict | None = None) -> None:
    payload = {
        "state": state,
        "timestamp": datetime.now(UTC).isoformat(),
        "details": details or {},
    }
    status_path = Path(settings.worker_status_path)
    status_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = status_path.with_name(f"{status_path.name}.tmp")
    with open(temp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)
    temp_path.replace(status_path)
    if state != "idle":
        log_event(logger, logging.INFO, "worker_status_updated", state=state, **payload["details"])


def process_once() -> None:
    ensure_extraction_job_runtime_columns(engine)
    with SessionLocal() as db:
        job = claim_next_job(db)
        if not job:
            write_worker_status("idle")
            return
        document = db.get(Document, job.document_id)
        template_version = db.get(TemplateVersion, job.template_version_id)
        if not document or not template_version:
            job.status = "failed"
            job.error_message = "Document or template version missing."
            job.progress_stage = JOB_STAGE_FAILED
            job.progress_pct = 0
            db.commit()
            write_worker_status(
                "failed",
                {
                    "job_id": job.id,
                    "tenant_id": job.tenant_id,
                    "worker_id": job.worker_id,
                    "attempt_count": job.attempt_count,
                    "reason": job.error_message,
                },
            )
            return
        try:
            ensure_job_tenant_consistency(job, document, template_version)
            document.status = "processing"
            update_job_progress(db, job.id, JOB_STAGE_PARSING)
            db.commit()
            write_worker_status(
                "running",
                {
                    "job_id": job.id,
                    "document_id": document.id,
                    "tenant_id": job.tenant_id,
                    "worker_id": job.worker_id,
                    "attempt_count": job.attempt_count,
                },
            )
            document_path = resolve_storage_path(document.stored_path, root=settings.data_dir)
            parsed_text_path, parsed_text = parse_and_persist_document_text(
                document.id,
                str(document_path),
            )
            document.parsed_text_path = parsed_text_path
            db.commit()

            if is_job_cancelled(db, job.id):
                finalize_cancelled_job(db, job, document)
                return

            result_json = execute_extraction(
                document_path=str(document_path),
                document_id=document.id,
                template_definition=template_version.definition,
                provider_override=job.provider_override,
                progress_reporter=build_progress_reporter(db, job.id),
                parsed_text=parsed_text,
            )
            if is_job_cancelled(db, job.id):
                finalize_cancelled_job(db, job, document)
                return

            result = db.query(ExtractionResult).filter(ExtractionResult.job_id == job.id).first()
            if result is None:
                result = ExtractionResult(
                    tenant_id=job.tenant_id, job_id=job.id, result_json=result_json, review_status="pending"
                )
                db.add(result)
            else:
                result.tenant_id = job.tenant_id
                result.result_json = result_json
                result.review_status = "pending"
            db.flush()
            job.status = "completed"
            job.progress_stage = JOB_STAGE_COMPLETED
            job.progress_pct = 100
            document.status = "completed"
            record_worker_audit(
                db,
                tenant_id=job.tenant_id,
                action="job.completed",
                object_type="job",
                object_id=job.id,
                metadata={
                    "job_id": job.id,
                    "document_id": document.id,
                    "result_id": result.id,
                },
            )
            db.commit()
            write_worker_status(
                "completed",
                {
                    "job_id": job.id,
                    "document_id": document.id,
                    "tenant_id": job.tenant_id,
                    "worker_id": job.worker_id,
                    "attempt_count": job.attempt_count,
                },
            )
        except Exception as exc:  # noqa: BLE001
            db.refresh(job)
            if job.status == "cancelled":
                finalize_cancelled_job(db, job, document)
                return
            job.status = "failed"
            job.error_message = str(exc)
            job.progress_stage = JOB_STAGE_FAILED
            job.progress_pct = 0
            document.status = "failed"
            record_worker_audit(
                db,
                tenant_id=job.tenant_id,
                action="job.failed",
                object_type="job",
                object_id=job.id,
                metadata={
                    "job_id": job.id,
                    "document_id": document.id,
                    "reason": str(exc),
                },
            )
            db.commit()
            write_worker_status(
                "failed",
                {
                    "job_id": job.id,
                    "tenant_id": job.tenant_id,
                    "worker_id": job.worker_id,
                    "attempt_count": job.attempt_count,
                    "reason": str(exc),
                },
            )


def claim_next_job(db) -> ExtractionJob | None:
    for _ in range(5):
        candidate_id = db.execute(
            select(ExtractionJob.id)
            .where(ExtractionJob.status == "queued")
            .order_by(ExtractionJob.created_at.asc())
            .limit(1)
        ).scalar_one_or_none()
        if candidate_id is None:
            return None

        claimed_at = datetime.now(UTC)
        claim_result = db.execute(
            update(ExtractionJob)
            .where(ExtractionJob.id == candidate_id, ExtractionJob.status == "queued")
            .values(
                status="running",
                claimed_at=claimed_at,
                worker_id=WORKER_ID,
                attempt_count=ExtractionJob.attempt_count + 1,
            )
        )
        if claim_result.rowcount == 1:
            db.commit()
            return db.get(ExtractionJob, candidate_id)
        db.rollback()
    return None


def ensure_job_tenant_consistency(job: ExtractionJob, document: Document, template_version: TemplateVersion) -> None:
    tenant_ids = {job.tenant_id, document.tenant_id, template_version.tenant_id}
    if len(tenant_ids) != 1:
        raise ValueError(
            "Tenant mismatch between job, document, and template version. "
            f"job={job.tenant_id}, document={document.tenant_id}, template_version={template_version.tenant_id}."
        )


def build_docling_startup_details() -> dict[str, object]:
    return {
        "docling_enabled": settings.docling_enabled,
        "docling_prewarm": settings.docling_prewarm,
        "docling_pdf_ocr_retry": settings.docling_pdf_ocr_retry,
        "docling_image_ocr": settings.docling_image_ocr,
    }


def initialize_worker_runtime() -> None:
    settings.ensure_paths()
    startup_details = build_docling_startup_details()
    log_event(
        logger,
        logging.INFO,
        "worker_starting",
        poll_seconds=settings.worker_poll_seconds,
        **startup_details,
    )
    write_worker_status("starting", startup_details)
    if settings.docling_prewarm:
        startup_details = {
            **startup_details,
            "docling_prewarm_result": prewarm_docling_converters(),
        }
        write_worker_status("starting", startup_details)


def main() -> None:
    initialize_worker_runtime()
    while True:
        process_once()
        time.sleep(settings.worker_poll_seconds)


if __name__ == "__main__":
    main()
