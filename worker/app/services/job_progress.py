from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol

from extraction_core.job_progress import JOB_STAGE_PROGRESS_PCT
from sqlalchemy.orm import Session

from app.models import ExtractionJob


class JobProgressReporter(Protocol):
    def __call__(self, stage: str) -> None: ...


def update_job_progress(db: Session, job_id: int, stage: str) -> None:
    job = db.get(ExtractionJob, job_id)
    if job is None:
        return
    job.progress_stage = stage
    job.progress_pct = JOB_STAGE_PROGRESS_PCT.get(stage, job.progress_pct or 0)
    job.updated_at = datetime.now(UTC)
    db.commit()


def build_progress_reporter(db: Session, job_id: int) -> JobProgressReporter:
    def report(stage: str) -> None:
        update_job_progress(db, job_id, stage)

    return report
