from __future__ import annotations

import json
import shutil
from copy import deepcopy
from pathlib import Path

from extraction_core.job_progress import JOB_STAGE_QUEUED
from extraction_core.langextract import uses_langextract_provider
from extraction_core.models import ExtractionTemplate, LLMProviderSettings, ReviewEditPayload
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.tenant import build_tenant_setting_key, get_current_tenant_id
from app.db.database import get_db
from app.models import Document, ExportRecord, ExtractionJob, ExtractionResult, Setting, Template, TemplateVersion
from app.schemas.api import (
    CustomProviderProfileListResponse,
    CustomProviderProfileRequest,
    DocumentResponse,
    ExportResponse,
    JobCreateRequest,
    JobResponse,
    LangExtractFeedbackSuggestionDismissalRequest,
    LangExtractFeedbackSuggestionDismissalResponse,
    LangExtractFeedbackSuggestionListResponse,
    ParserStatusResponse,
    ProviderCatalogResponse,
    ProviderControlsResponse,
    ProviderHealthResponse,
    ProviderProbeRequest,
    ProviderProbeResponse,
    ProviderSettingsRequest,
    ResultEnvelope,
    TemplateCreateRequest,
    TemplateResponse,
    TemplateVersionCreateRequest,
    TemplateVersionResponse,
)
from app.services.job_service import build_job_response, retry_failed_job
from app.services.langextract_feedback import (
    list_langextract_feedback_suggestions,
    set_langextract_feedback_suggestion_dismissed,
)
from app.services.provider_catalog import list_provider_catalog
from app.services.provider_health import get_provider_health
from app.services.provider_probe import probe_provider, require_reachable_provider
from app.services.provider_profiles import (
    create_custom_provider_profile,
    delete_custom_provider_profile,
    get_custom_provider_profile,
    list_custom_provider_profiles,
    record_custom_provider_profile_probe,
    require_fresh_custom_provider_profile_probe,
    update_custom_provider_profile,
)
from app.services.result_service import apply_review_edits, export_result
from app.services.storage import build_upload_target, resolve_export_download_path
from app.services.template_service import create_template, create_template_version

router = APIRouter()


@router.get("/health")
def healthcheck():
    return {"status": "ok"}


@router.get("/dev/status")
def dev_status(db: Session = Depends(get_db), tenant_id: str = Depends(get_current_tenant_id)):
    return {
        "templates": db.query(Template).filter(Template.tenant_id == tenant_id).count(),
        "documents": db.query(Document).filter(Document.tenant_id == tenant_id).count(),
        "jobs": db.query(ExtractionJob).filter(ExtractionJob.tenant_id == tenant_id).count(),
        "results": db.query(ExtractionResult).filter(ExtractionResult.tenant_id == tenant_id).count(),
    }


@router.get("/templates", response_model=list[TemplateResponse])
def list_templates(db: Session = Depends(get_db), tenant_id: str = Depends(get_current_tenant_id)):
    templates = db.query(Template).filter(Template.tenant_id == tenant_id).all()
    responses = []
    for template in templates:
        latest = max(template.versions, key=lambda item: item.created_at) if template.versions else None
        responses.append(
            TemplateResponse(
                id=template.id,
                name=template.name,
                description=template.description,
                document_type=template.document_type,
                is_locked=template.is_locked,
                latest_version=latest.version if latest else "n/a",
                created_at=template.created_at,
                updated_at=template.updated_at,
            )
        )
    return responses


@router.post("/templates", response_model=TemplateResponse)
def create_template_endpoint(
    payload: TemplateCreateRequest,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(get_current_tenant_id),
):
    existing = db.query(Template).filter(Template.tenant_id == tenant_id, Template.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=409, detail="Template name already exists.")
    create_template(db, payload.name, payload.description, payload.document_type, payload.definition, tenant_id)
    return list_templates(db, tenant_id=tenant_id)[-1]


@router.post("/templates/{template_id}/versions", response_model=TemplateVersionResponse)
def create_template_version_endpoint(
    template_id: int,
    payload: TemplateVersionCreateRequest,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(get_current_tenant_id),
):
    template = db.query(Template).filter(Template.id == template_id, Template.tenant_id == tenant_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found.")
    definition = ExtractionTemplate.model_validate(payload.definition)
    version = create_template_version(db, template, definition)
    return TemplateVersionResponse(
        id=version.id,
        template_id=version.template_id,
        version=version.version,
        definition=version.definition,
        created_at=version.created_at,
    )


@router.get("/templates/{template_id}/versions", response_model=list[TemplateVersionResponse])
def list_template_versions(
    template_id: int, db: Session = Depends(get_db), tenant_id: str = Depends(get_current_tenant_id)
):
    versions = (
        db.query(TemplateVersion)
        .filter(TemplateVersion.template_id == template_id, TemplateVersion.tenant_id == tenant_id)
        .order_by(TemplateVersion.created_at.desc())
        .all()
    )
    return [
        TemplateVersionResponse(
            id=item.id,
            template_id=item.template_id,
            version=item.version,
            definition=item.definition,
            created_at=item.created_at,
        )
        for item in versions
    ]


@router.get(
    "/template-versions/{template_version_id}/langextract-feedback-suggestions",
    response_model=LangExtractFeedbackSuggestionListResponse,
)
def get_langextract_feedback_suggestions(
    template_version_id: int, db: Session = Depends(get_db), tenant_id: str = Depends(get_current_tenant_id)
):
    template_version = (
        db.query(TemplateVersion)
        .filter(TemplateVersion.id == template_version_id, TemplateVersion.tenant_id == tenant_id)
        .first()
    )
    if not template_version:
        raise HTTPException(status_code=404, detail="Template version not found.")
    return list_langextract_feedback_suggestions(db, template_version)


@router.put(
    "/template-versions/{template_version_id}/langextract-feedback-suggestions/{suggestion_key}/dismissal",
    response_model=LangExtractFeedbackSuggestionDismissalResponse,
)
def set_langextract_feedback_suggestion_dismissal(
    template_version_id: int,
    suggestion_key: str,
    payload: LangExtractFeedbackSuggestionDismissalRequest,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(get_current_tenant_id),
):
    template_version = (
        db.query(TemplateVersion)
        .filter(TemplateVersion.id == template_version_id, TemplateVersion.tenant_id == tenant_id)
        .first()
    )
    if not template_version:
        raise HTTPException(status_code=404, detail="Template version not found.")
    return set_langextract_feedback_suggestion_dismissed(
        db,
        template_version,
        suggestion_key,
        payload.dismissed,
    )


@router.post("/documents", response_model=DocumentResponse)
def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    tenant_id: str = Depends(get_current_tenant_id),
):
    original_filename = Path(file.filename or "").name
    if not original_filename:
        raise HTTPException(status_code=400, detail="Uploaded file must include a filename.")

    reference, target = build_upload_target(original_filename)
    with target.open("wb") as handle:
        shutil.copyfileobj(file.file, handle)
    document = Document(
        tenant_id=tenant_id,
        original_filename=original_filename,
        content_type=file.content_type or "application/octet-stream",
        stored_path=reference,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return DocumentResponse(
        id=document.id,
        original_filename=document.original_filename,
        content_type=document.content_type,
        status=document.status,
        created_at=document.created_at,
    )


@router.get("/documents", response_model=list[DocumentResponse])
def list_documents(db: Session = Depends(get_db), tenant_id: str = Depends(get_current_tenant_id)):
    docs = db.query(Document).filter(Document.tenant_id == tenant_id).order_by(Document.created_at.desc()).all()
    return [
        DocumentResponse(
            id=doc.id,
            original_filename=doc.original_filename,
            content_type=doc.content_type,
            status=doc.status,
            created_at=doc.created_at,
        )
        for doc in docs
    ]


@router.post("/jobs", response_model=JobResponse)
def create_job(
    payload: JobCreateRequest,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(get_current_tenant_id),
):
    document = db.query(Document).filter(Document.id == payload.document_id, Document.tenant_id == tenant_id).first()
    template_version = (
        db.query(TemplateVersion)
        .filter(TemplateVersion.id == payload.template_version_id, TemplateVersion.tenant_id == tenant_id)
        .first()
    )
    if not document or not template_version:
        raise HTTPException(status_code=404, detail="Document or template version not found.")
    template_definition = ExtractionTemplate.model_validate(template_version.definition)
    effective_provider = payload.provider_override or template_definition.llm_provider_settings
    validate_job_provider(template_definition, effective_provider)
    job = ExtractionJob(
        tenant_id=tenant_id,
        document_id=payload.document_id,
        template_version_id=payload.template_version_id,
        provider_override=payload.provider_override.model_dump() if payload.provider_override else None,
        progress_stage=JOB_STAGE_QUEUED,
        progress_pct=0,
    )
    db.add(job)
    document.status = "queued"
    db.commit()
    db.refresh(job)
    return build_job_response(job)


@router.get("/jobs", response_model=list[JobResponse])
def list_jobs(db: Session = Depends(get_db), tenant_id: str = Depends(get_current_tenant_id)):
    jobs = (
        db.query(ExtractionJob)
        .filter(ExtractionJob.tenant_id == tenant_id)
        .order_by(ExtractionJob.created_at.desc())
        .all()
    )
    return [build_job_response(job) for job in jobs]


@router.post("/jobs/{job_id}/retry", response_model=JobResponse)
def retry_job(job_id: int, db: Session = Depends(get_db), tenant_id: str = Depends(get_current_tenant_id)):
    job = db.query(ExtractionJob).filter(ExtractionJob.id == job_id, ExtractionJob.tenant_id == tenant_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job.status != "failed":
        raise HTTPException(status_code=409, detail="Only failed jobs can be retried.")
    document = db.query(Document).filter(Document.id == job.document_id, Document.tenant_id == tenant_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found.")
    template_version = (
        db.query(TemplateVersion)
        .filter(TemplateVersion.id == job.template_version_id, TemplateVersion.tenant_id == tenant_id)
        .first()
    )
    if not template_version:
        raise HTTPException(status_code=404, detail="Template version not found.")
    template_definition = ExtractionTemplate.model_validate(template_version.definition)
    effective_provider = (
        LLMProviderSettings.model_validate(job.provider_override)
        if job.provider_override
        else template_definition.llm_provider_settings
    )
    validate_job_provider(template_definition, effective_provider)
    retry_failed_job(job, document)
    db.commit()
    db.refresh(job)
    return build_job_response(job)


@router.get("/jobs/{job_id}/result", response_model=ResultEnvelope)
def get_job_result(job_id: int, db: Session = Depends(get_db), tenant_id: str = Depends(get_current_tenant_id)):
    result = (
        db.query(ExtractionResult)
        .filter(ExtractionResult.job_id == job_id, ExtractionResult.tenant_id == tenant_id)
        .first()
    )
    if not result:
        raise HTTPException(status_code=404, detail="Result not found.")
    return ResultEnvelope(result_id=result.id, job_id=job_id, result=result.result_json)


@router.post("/results/{result_id}/review")
def review_result(
    result_id: int,
    payload: ReviewEditPayload,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(get_current_tenant_id),
):
    result = (
        db.query(ExtractionResult)
        .filter(ExtractionResult.id == result_id, ExtractionResult.tenant_id == tenant_id)
        .first()
    )
    if not result:
        raise HTTPException(status_code=404, detail="Result not found.")
    updated = apply_review_edits(db, result, payload)
    return updated.result_json


@router.post("/results/{result_id}/exports/{export_format}")
def export_result_endpoint(
    result_id: int,
    export_format: str,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(get_current_tenant_id),
):
    result = (
        db.query(ExtractionResult)
        .filter(ExtractionResult.id == result_id, ExtractionResult.tenant_id == tenant_id)
        .first()
    )
    if not result:
        raise HTTPException(status_code=404, detail="Result not found.")
    record = export_result(db, result, export_format)
    return {"export_id": record.id, "path": record.file_path}


@router.get("/exports/{export_id}/download")
def download_export(export_id: int, db: Session = Depends(get_db), tenant_id: str = Depends(get_current_tenant_id)):
    record = db.query(ExportRecord).filter(ExportRecord.id == export_id, ExportRecord.tenant_id == tenant_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Export not found.")
    try:
        download_path = resolve_export_download_path(record.file_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(download_path, filename=download_path.name)


@router.get("/exports", response_model=list[ExportResponse])
def list_exports(db: Session = Depends(get_db), tenant_id: str = Depends(get_current_tenant_id)):
    records = (
        db.query(ExportRecord)
        .filter(ExportRecord.tenant_id == tenant_id)
        .order_by(ExportRecord.created_at.desc())
        .all()
    )
    responses: list[ExportResponse] = []
    for record in records:
        result = (
            db.query(ExtractionResult)
            .filter(ExtractionResult.id == record.result_id, ExtractionResult.tenant_id == tenant_id)
            .first()
        )
        responses.append(
            ExportResponse(
                id=record.id,
                result_id=record.result_id,
                job_id=result.job_id if result else 0,
                export_format=record.export_format,
                file_path=record.file_path,
                created_at=record.created_at,
            )
        )
    return responses


@router.get("/settings/provider")
def get_provider_settings(db: Session = Depends(get_db), tenant_id: str = Depends(get_current_tenant_id)):
    setting = db.query(Setting).filter(Setting.key == build_tenant_setting_key(tenant_id, "default_provider")).first()
    if setting:
        return {**setting.value, "is_persisted_default": True}

    default_provider = next(
        (provider.settings for provider in list_provider_catalog() if provider.provider_type == "mock"), None
    )
    default_value = default_provider.model_dump() if default_provider else LLMProviderSettings().model_dump()
    return {**default_value, "is_persisted_default": False}


@router.get("/settings/providers", response_model=ProviderCatalogResponse)
def get_provider_catalog():
    return ProviderCatalogResponse(providers=list_provider_catalog())


@router.get("/settings/providers/health", response_model=list[ProviderHealthResponse])
def get_provider_catalog_health():
    return [
        ProviderHealthResponse.model_validate(get_provider_health(provider)) for provider in list_provider_catalog()
    ]


@router.get("/settings/providers/controls", response_model=ProviderControlsResponse)
def get_provider_controls():
    return ProviderControlsResponse(
        deployment_mode=settings.deployment_mode,
        tenant_mode=settings.tenant_mode,
        allow_external_processing=settings.allow_external_processing,
        require_redaction_for_external_processing=settings.require_redaction_for_external_processing,
        require_authentication=settings.require_authentication,
        custom_provider_probe_max_age_hours=settings.custom_provider_probe_max_age_hours,
    )


@router.get("/settings/parser-status", response_model=ParserStatusResponse)
def get_parser_status():
    details: dict[str, object] = {}
    state = "unknown"
    timestamp: str | None = None

    status_path = Path(settings.worker_status_path)
    if status_path.exists():
        payload = json.loads(status_path.read_text(encoding="utf-8"))
        state = str(payload.get("state") or state)
        timestamp = payload.get("timestamp")
        raw_details = payload.get("details")
        if isinstance(raw_details, dict):
            details = raw_details

    prewarm_result = details.get("docling_prewarm_result")
    prewarm_status = None
    prewarm_attempted = False
    prewarm_error = None
    if isinstance(prewarm_result, dict):
        prewarm_status = str(prewarm_result.get("status")) if prewarm_result.get("status") is not None else None
        prewarm_attempted = bool(prewarm_result.get("attempted"))
        prewarm_error = str(prewarm_result.get("error")) if prewarm_result.get("error") is not None else None

    return ParserStatusResponse(
        state=state,
        timestamp=timestamp,
        docling_enabled=bool(details.get("docling_enabled", True)),
        docling_prewarm=bool(details.get("docling_prewarm", True)),
        docling_pdf_ocr_retry=bool(details.get("docling_pdf_ocr_retry", True)),
        docling_image_ocr=bool(details.get("docling_image_ocr", True)),
        prewarm_status=prewarm_status,
        prewarm_attempted=prewarm_attempted,
        prewarm_error=prewarm_error,
        supported_extensions=[".pdf", ".docx", ".pptx", ".html", ".htm", ".png", ".jpg", ".jpeg", ".tiff"],
        supported_classes=["PDF", "DOCX", "PPTX", "HTML", "Images", "CSV", "Excel", "Plain text", "Markdown"],
    )


@router.post("/settings/providers/probe", response_model=ProviderProbeResponse)
def probe_provider_endpoint(payload: ProviderProbeRequest):
    enforce_provider_policy(payload.settings)
    return ProviderProbeResponse.model_validate(probe_provider(payload.settings))


@router.get("/settings/providers/custom", response_model=CustomProviderProfileListResponse)
def list_custom_provider_profiles_endpoint(
    db: Session = Depends(get_db), tenant_id: str = Depends(get_current_tenant_id)
):
    return CustomProviderProfileListResponse(profiles=list_custom_provider_profiles(db, tenant_id))


@router.post("/settings/providers/custom")
def create_custom_provider_profile_endpoint(
    payload: CustomProviderProfileRequest,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(get_current_tenant_id),
):
    enforce_provider_policy(payload.settings)
    probe_result = require_reachable_provider(payload.settings, "Custom provider save")
    profile = create_custom_provider_profile(db, tenant_id, payload.name, payload.settings)
    return record_custom_provider_profile_probe(
        db,
        tenant_id,
        profile.id,
        status=str(probe_result["status"]),
        detail=str(probe_result["detail"]),
    )


@router.put("/settings/providers/custom/{profile_id}")
def update_custom_provider_profile_endpoint(
    profile_id: str,
    payload: CustomProviderProfileRequest,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(get_current_tenant_id),
):
    enforce_provider_policy(payload.settings)
    probe_result = require_reachable_provider(payload.settings, "Custom provider save")
    update_custom_provider_profile(db, tenant_id, profile_id, payload.name, payload.settings)
    return record_custom_provider_profile_probe(
        db,
        tenant_id,
        profile_id,
        status=str(probe_result["status"]),
        detail=str(probe_result["detail"]),
    )


@router.delete("/settings/providers/custom/{profile_id}")
def delete_custom_provider_profile_endpoint(
    profile_id: str, db: Session = Depends(get_db), tenant_id: str = Depends(get_current_tenant_id)
):
    delete_custom_provider_profile(db, tenant_id, profile_id)
    return {"deleted": True}


@router.post("/settings/providers/custom/{profile_id}/reverify")
def reverify_custom_provider_profile_endpoint(
    profile_id: str, db: Session = Depends(get_db), tenant_id: str = Depends(get_current_tenant_id)
):
    profile = get_custom_provider_profile(db, tenant_id, profile_id)
    probe_result = require_reachable_provider(profile.settings, "Custom provider reverification")
    return record_custom_provider_profile_probe(
        db,
        tenant_id,
        profile_id,
        status=str(probe_result["status"]),
        detail=str(probe_result["detail"]),
    )


@router.post("/settings/providers/custom/{profile_id}/activate")
def activate_custom_provider_profile_endpoint(
    profile_id: str, db: Session = Depends(get_db), tenant_id: str = Depends(get_current_tenant_id)
):
    profile = get_custom_provider_profile(db, tenant_id, profile_id)
    enforce_provider_policy(profile.settings)
    require_fresh_custom_provider_profile_probe(profile)
    probe_result = require_reachable_provider(profile.settings, "Custom provider activation")
    setting_key = build_tenant_setting_key(tenant_id, "default_provider")
    setting = db.query(Setting).filter(Setting.key == setting_key).first()
    data = profile.settings.model_dump(mode="json")
    if setting:
        setting.value = data
    else:
        setting = Setting(key=setting_key, value=data)
        db.add(setting)
    db.commit()
    record_custom_provider_profile_probe(
        db,
        tenant_id,
        profile_id,
        status=str(probe_result["status"]),
        detail=str(probe_result["detail"]),
    )
    return {**data, "is_persisted_default": True}


@router.put("/settings/provider")
def update_provider_settings(
    payload: ProviderSettingsRequest,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(get_current_tenant_id),
):
    enforce_provider_policy(payload.settings)
    setting_key = build_tenant_setting_key(tenant_id, "default_provider")
    setting = db.query(Setting).filter(Setting.key == setting_key).first()
    data = payload.settings.model_dump()
    if setting:
        setting.value = data
    else:
        setting = Setting(key=setting_key, value=data)
        db.add(setting)
    db.commit()
    return {**data, "is_persisted_default": True}


def validate_job_provider(template: ExtractionTemplate, effective_provider: LLMProviderSettings) -> ExtractionTemplate:
    enforce_provider_policy(effective_provider)
    effective_definition = deepcopy(template.model_dump(mode="json"))
    effective_definition["llm_provider_settings"] = effective_provider.model_dump(mode="json")
    try:
        effective_template = ExtractionTemplate.model_validate(effective_definition)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if uses_langextract_provider(effective_provider.provider_type, effective_provider.api_style):
        require_reachable_provider(effective_provider, "Job queueing")
    return effective_template


def enforce_provider_policy(provider_settings: LLMProviderSettings) -> None:
    if provider_settings.allow_external_processing and not settings.allow_external_processing:
        raise HTTPException(
            status_code=400,
            detail="This deployment disables external provider processing. Choose a local provider or enable ALLOW_EXTERNAL_PROCESSING.",
        )
    if provider_settings.allow_external_processing and (
        settings.require_redaction_for_external_processing and not settings.presidio_redaction_enabled
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "This deployment requires document redaction before external provider processing, but Presidio "
                "redaction is disabled. Enable PRESIDIO_REDACTION_ENABLED or disable "
                "REQUIRE_REDACTION_FOR_EXTERNAL_PROCESSING."
            ),
        )
