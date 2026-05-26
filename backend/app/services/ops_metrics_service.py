from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Document, ExtractionJob, ExtractionResult, Template


def _read_worker_status() -> tuple[str | None, str | None, dict[str, object]]:
    if not settings.worker_status_path:
        return None, None, {}

    status_path = Path(settings.worker_status_path)
    if not status_path.exists():
        return None, None, {}

    payload = json.loads(status_path.read_text(encoding="utf-8"))
    state = str(payload.get("state")) if payload.get("state") is not None else None
    timestamp = payload.get("timestamp")
    timestamp_text = str(timestamp) if timestamp is not None else None
    raw_details = payload.get("details")
    details = raw_details if isinstance(raw_details, dict) else {}
    return state, timestamp_text, details


def build_ops_metrics(db: Session, *, tenant_id: str) -> dict[str, object]:
    status_rows = (
        db.query(ExtractionJob.status, func.count(ExtractionJob.id))
        .filter(ExtractionJob.tenant_id == tenant_id)
        .group_by(ExtractionJob.status)
        .all()
    )
    jobs_by_status = {status: count for status, count in status_rows}
    queue_depth = jobs_by_status.get("queued", 0) + jobs_by_status.get("running", 0)

    worker_state, worker_timestamp, worker_details = _read_worker_status()
    active_job_id: int | None = None
    raw_job_id = worker_details.get("job_id")
    if raw_job_id is not None:
        try:
            active_job_id = int(str(raw_job_id))
        except (TypeError, ValueError):
            active_job_id = None

    return {
        "jobs_by_status": jobs_by_status,
        "queue_depth": queue_depth,
        "failed_jobs": jobs_by_status.get("failed", 0),
        "cancelled_jobs": jobs_by_status.get("cancelled", 0),
        "completed_jobs": jobs_by_status.get("completed", 0),
        "documents": db.query(Document).filter(Document.tenant_id == tenant_id).count(),
        "templates": db.query(Template).filter(Template.tenant_id == tenant_id).count(),
        "results": db.query(ExtractionResult).filter(ExtractionResult.tenant_id == tenant_id).count(),
        "worker_state": worker_state,
        "worker_timestamp": worker_timestamp,
        "worker_active_job_id": active_job_id,
    }
