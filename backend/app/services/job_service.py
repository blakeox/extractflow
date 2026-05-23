from __future__ import annotations

from extraction_core.job_progress import JOB_STAGE_QUEUED
from extraction_core.models import LLMProviderSettings

from app.models import Document, ExtractionJob
from app.schemas.api import JobResponse


def build_job_response(job: ExtractionJob) -> JobResponse:
    return JobResponse(
        id=job.id,
        document_id=job.document_id,
        template_version_id=job.template_version_id,
        provider_override=LLMProviderSettings.model_validate(job.provider_override) if job.provider_override else None,
        status=job.status,
        error_message=job.error_message,
        progress_stage=job.progress_stage,
        progress_pct=job.progress_pct or 0,
        attempt_count=job.attempt_count or 0,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


def retry_failed_job(job: ExtractionJob, document: Document) -> ExtractionJob:
    job.status = "queued"
    job.error_message = None
    job.progress_stage = JOB_STAGE_QUEUED
    job.progress_pct = 0
    job.claimed_at = None
    job.worker_id = None
    document.status = "queued"
    return job
