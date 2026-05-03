from __future__ import annotations

import json
import time
from datetime import datetime, UTC

from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.config import settings
from app.models import Document, ExtractionJob, ExtractionResult, TemplateVersion
from app.services.executor import execute_extraction


def write_worker_status(state: str, details: dict | None = None) -> None:
    payload = {
        "state": state,
        "timestamp": datetime.now(UTC).isoformat(),
        "details": details or {},
    }
    with open(settings.worker_status_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)


def process_once() -> None:
    with SessionLocal() as db:
        job = db.execute(
            select(ExtractionJob).where(ExtractionJob.status == "queued").order_by(ExtractionJob.created_at.asc())
        ).scalars().first()
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


def main() -> None:
    write_worker_status("starting")
    while True:
        process_once()
        time.sleep(settings.worker_poll_seconds)


if __name__ == "__main__":
    main()
