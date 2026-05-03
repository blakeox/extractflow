from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.database import get_db
from app.models import Document, ExportRecord, ExtractionJob, ExtractionResult, Setting, Template, TemplateVersion
from app.schemas.api import (
    DocumentResponse,
    ExportResponse,
    JobCreateRequest,
    JobResponse,
    CustomProviderProfileListResponse,
    CustomProviderProfileRequest,
    ProviderCatalogResponse,
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
from app.services.provider_catalog import list_provider_catalog
from app.services.provider_health import get_provider_health
from app.services.provider_profiles import (
    create_custom_provider_profile,
    delete_custom_provider_profile,
    get_custom_provider_profile,
    list_custom_provider_profiles,
    update_custom_provider_profile,
)
from app.services.provider_probe import probe_provider
from app.services.result_service import apply_review_edits, export_result
from app.services.template_service import create_template, create_template_version
from extraction_core.models import ExtractionTemplate
from extraction_core.models import LLMProviderSettings, ReviewEditPayload


router = APIRouter()


@router.get("/health")
def healthcheck():
    return {"status": "ok"}


@router.get("/dev/status")
def dev_status(db: Session = Depends(get_db)):
    return {
        "templates": db.query(Template).count(),
        "documents": db.query(Document).count(),
        "jobs": db.query(ExtractionJob).count(),
        "results": db.query(ExtractionResult).count(),
    }


@router.get("/templates", response_model=list[TemplateResponse])
def list_templates(db: Session = Depends(get_db)):
    templates = db.query(Template).all()
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
def create_template_endpoint(payload: TemplateCreateRequest, db: Session = Depends(get_db)):
    existing = db.query(Template).filter(Template.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=409, detail="Template name already exists.")
    template = create_template(db, payload.name, payload.description, payload.document_type, payload.definition)
    return list_templates(db)[-1]


@router.post("/templates/{template_id}/versions", response_model=TemplateVersionResponse)
def create_template_version_endpoint(template_id: int, payload: TemplateVersionCreateRequest, db: Session = Depends(get_db)):
    template = db.query(Template).filter(Template.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found.")
    definition = ExtractionTemplate.model_validate(payload.definition)
    version = create_template_version(db, template, definition)
    return TemplateVersionResponse(id=version.id, template_id=version.template_id, version=version.version, definition=version.definition, created_at=version.created_at)


@router.get("/templates/{template_id}/versions", response_model=list[TemplateVersionResponse])
def list_template_versions(template_id: int, db: Session = Depends(get_db)):
    versions = db.query(TemplateVersion).filter(TemplateVersion.template_id == template_id).order_by(TemplateVersion.created_at.desc()).all()
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


@router.post("/documents", response_model=DocumentResponse)
def upload_document(file: UploadFile = File(...), db: Session = Depends(get_db)):
    target = Path(settings.uploads_dir) / file.filename
    with target.open("wb") as handle:
        shutil.copyfileobj(file.file, handle)
    document = Document(original_filename=file.filename, content_type=file.content_type or "application/octet-stream", stored_path=str(target))
    db.add(document)
    db.commit()
    db.refresh(document)
    return DocumentResponse(id=document.id, original_filename=document.original_filename, content_type=document.content_type, status=document.status, created_at=document.created_at)


@router.get("/documents", response_model=list[DocumentResponse])
def list_documents(db: Session = Depends(get_db)):
    docs = db.query(Document).order_by(Document.created_at.desc()).all()
    return [DocumentResponse(id=doc.id, original_filename=doc.original_filename, content_type=doc.content_type, status=doc.status, created_at=doc.created_at) for doc in docs]


@router.post("/jobs", response_model=JobResponse)
def create_job(payload: JobCreateRequest, db: Session = Depends(get_db)):
    document = db.query(Document).filter(Document.id == payload.document_id).first()
    template_version = db.query(TemplateVersion).filter(TemplateVersion.id == payload.template_version_id).first()
    if not document or not template_version:
        raise HTTPException(status_code=404, detail="Document or template version not found.")
    job = ExtractionJob(
        document_id=payload.document_id,
        template_version_id=payload.template_version_id,
        provider_override=payload.provider_override.model_dump() if payload.provider_override else None,
    )
    db.add(job)
    document.status = "queued"
    db.commit()
    db.refresh(job)
    return JobResponse(id=job.id, document_id=job.document_id, template_version_id=job.template_version_id, status=job.status, error_message=job.error_message, created_at=job.created_at, updated_at=job.updated_at)


@router.get("/jobs", response_model=list[JobResponse])
def list_jobs(db: Session = Depends(get_db)):
    jobs = db.query(ExtractionJob).order_by(ExtractionJob.created_at.desc()).all()
    return [JobResponse(id=job.id, document_id=job.document_id, template_version_id=job.template_version_id, status=job.status, error_message=job.error_message, created_at=job.created_at, updated_at=job.updated_at) for job in jobs]


@router.get("/jobs/{job_id}/result", response_model=ResultEnvelope)
def get_job_result(job_id: int, db: Session = Depends(get_db)):
    result = db.query(ExtractionResult).filter(ExtractionResult.job_id == job_id).first()
    if not result:
        raise HTTPException(status_code=404, detail="Result not found.")
    return ResultEnvelope(result_id=result.id, job_id=job_id, result=result.result_json)


@router.post("/results/{result_id}/review")
def review_result(result_id: int, payload: ReviewEditPayload, db: Session = Depends(get_db)):
    result = db.query(ExtractionResult).filter(ExtractionResult.id == result_id).first()
    if not result:
        raise HTTPException(status_code=404, detail="Result not found.")
    updated = apply_review_edits(db, result, payload)
    return updated.result_json


@router.post("/results/{result_id}/exports/{export_format}")
def export_result_endpoint(result_id: int, export_format: str, db: Session = Depends(get_db)):
    result = db.query(ExtractionResult).filter(ExtractionResult.id == result_id).first()
    if not result:
        raise HTTPException(status_code=404, detail="Result not found.")
    record = export_result(db, result, export_format)
    return {"export_id": record.id, "path": record.file_path}


@router.get("/exports/{export_id}/download")
def download_export(export_id: int, db: Session = Depends(get_db)):
    record = db.query(ExportRecord).filter(ExportRecord.id == export_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Export not found.")
    return FileResponse(record.file_path, filename=Path(record.file_path).name)


@router.get("/exports", response_model=list[ExportResponse])
def list_exports(db: Session = Depends(get_db)):
    records = db.query(ExportRecord).order_by(ExportRecord.created_at.desc()).all()
    responses: list[ExportResponse] = []
    for record in records:
        result = db.query(ExtractionResult).filter(ExtractionResult.id == record.result_id).first()
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
def get_provider_settings(db: Session = Depends(get_db)):
    setting = db.query(Setting).filter(Setting.key == "default_provider").first()
    if setting:
        return setting.value

    default_provider = next((provider.settings for provider in list_provider_catalog() if provider.provider_type == "mock"), None)
    return default_provider.model_dump() if default_provider else LLMProviderSettings().model_dump()


@router.get("/settings/providers", response_model=ProviderCatalogResponse)
def get_provider_catalog():
    return ProviderCatalogResponse(providers=list_provider_catalog())


@router.get("/settings/providers/health", response_model=list[ProviderHealthResponse])
def get_provider_catalog_health():
    return [ProviderHealthResponse.model_validate(get_provider_health(provider)) for provider in list_provider_catalog()]


@router.post("/settings/providers/probe", response_model=ProviderProbeResponse)
def probe_provider_endpoint(payload: ProviderProbeRequest):
    return ProviderProbeResponse.model_validate(probe_provider(payload.settings))


@router.get("/settings/providers/custom", response_model=CustomProviderProfileListResponse)
def list_custom_provider_profiles_endpoint(db: Session = Depends(get_db)):
    return CustomProviderProfileListResponse(profiles=list_custom_provider_profiles(db))


@router.post("/settings/providers/custom")
def create_custom_provider_profile_endpoint(payload: CustomProviderProfileRequest, db: Session = Depends(get_db)):
    return create_custom_provider_profile(db, payload.name, payload.settings)


@router.put("/settings/providers/custom/{profile_id}")
def update_custom_provider_profile_endpoint(profile_id: str, payload: CustomProviderProfileRequest, db: Session = Depends(get_db)):
    return update_custom_provider_profile(db, profile_id, payload.name, payload.settings)


@router.delete("/settings/providers/custom/{profile_id}")
def delete_custom_provider_profile_endpoint(profile_id: str, db: Session = Depends(get_db)):
    delete_custom_provider_profile(db, profile_id)
    return {"deleted": True}


@router.post("/settings/providers/custom/{profile_id}/activate")
def activate_custom_provider_profile_endpoint(profile_id: str, db: Session = Depends(get_db)):
    profile = get_custom_provider_profile(db, profile_id)
    setting = db.query(Setting).filter(Setting.key == "default_provider").first()
    data = profile.settings.model_dump(mode="json")
    if setting:
        setting.value = data
    else:
        setting = Setting(key="default_provider", value=data)
        db.add(setting)
    db.commit()
    return data


@router.put("/settings/provider")
def update_provider_settings(payload: ProviderSettingsRequest, db: Session = Depends(get_db)):
    setting = db.query(Setting).filter(Setting.key == "default_provider").first()
    data = payload.settings.model_dump()
    if setting:
        setting.value = data
    else:
        setting = Setting(key="default_provider", value=data)
        db.add(setting)
    db.commit()
    return data
