from __future__ import annotations

import json
import logging
import time
from datetime import UTC, datetime
from pathlib import Path

from extraction_core.observability import configure_logger, log_event
from sqlalchemy import select

from app.core.config import settings
from app.core.database import SessionLocal
from app.models import Document, ExtractionJob, ExtractionResult, TemplateVersion
from app.services.executor import execute_extraction
from app.services.parser import prewarm_docling_converters

logger = configure_logger("extractflow.worker")


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
    with SessionLocal() as db:
        job = (
            db.execute(
                select(ExtractionJob).where(ExtractionJob.status == "queued").order_by(ExtractionJob.created_at.asc())
            )
            .scalars()
            .first()
        )
        if not job:
            write_worker_status("idle")
            return
        document = db.get(Document, job.document_id)
        template_version = db.get(TemplateVersion, job.template_version_id)
        if not document or not template_version:
            job.status = "failed"
            job.error_message = "Document or template version missing."
            db.commit()
            write_worker_status("failed", {"job_id": job.id, "reason": job.error_message})
            return
        try:
            job.status = "running"
            document.status = "processing"
            db.commit()
            write_worker_status("running", {"job_id": job.id, "document_id": document.id})

            result_json = execute_extraction(
                document_path=document.stored_path,
                document_id=document.id,
                template_definition=template_version.definition,
                provider_override=job.provider_override,
            )
            result = ExtractionResult(job_id=job.id, result_json=result_json, review_status="pending")
            db.add(result)
            job.status = "completed"
            document.status = "completed"
            db.commit()
            write_worker_status("completed", {"job_id": job.id, "document_id": document.id})
        except Exception as exc:  # noqa: BLE001
            job.status = "failed"
            job.error_message = str(exc)
            document.status = "failed"
            db.commit()
            write_worker_status("failed", {"job_id": job.id, "reason": str(exc)})


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
