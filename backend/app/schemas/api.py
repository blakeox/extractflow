from __future__ import annotations

from datetime import datetime
from typing import Any

from extraction_core.models import ExtractionTemplate, LLMProviderCatalogEntry, LLMProviderSettings
from pydantic import BaseModel


class TemplateCreateRequest(BaseModel):
    name: str
    description: str = ""
    document_type: str
    definition: ExtractionTemplate


class TemplateResponse(BaseModel):
    id: int
    name: str
    description: str
    document_type: str
    is_locked: bool
    latest_version: str
    created_at: datetime
    updated_at: datetime


class TemplateVersionResponse(BaseModel):
    id: int
    template_id: int
    version: str
    definition: dict[str, Any]
    created_at: datetime


class TemplateVersionCreateRequest(BaseModel):
    definition: ExtractionTemplate


class JobCreateRequest(BaseModel):
    document_id: int
    template_version_id: int
    provider_override: LLMProviderSettings | None = None


class JobResponse(BaseModel):
    id: int
    document_id: int
    template_version_id: int
    status: str
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class ResultEnvelope(BaseModel):
    result_id: int
    job_id: int
    result: dict[str, Any]


class DocumentResponse(BaseModel):
    id: int
    original_filename: str
    content_type: str
    status: str
    created_at: datetime


class ProviderSettingsRequest(BaseModel):
    settings: LLMProviderSettings


class ProviderCatalogResponse(BaseModel):
    providers: list[LLMProviderCatalogEntry]


class ProviderHealthResponse(BaseModel):
    provider_key: str
    provider_type: str
    ready: bool
    status: str
    checks: list[str]


class ProviderProbeRequest(BaseModel):
    settings: LLMProviderSettings


class ProviderProbeResponse(BaseModel):
    provider_type: str
    reachable: bool
    status: str
    detail: str
    endpoint: str | None = None
    status_code: int | None = None


class CustomProviderProfile(BaseModel):
    id: str
    name: str
    settings: LLMProviderSettings
    created_at: datetime
    updated_at: datetime


class CustomProviderProfileRequest(BaseModel):
    name: str
    settings: LLMProviderSettings


class CustomProviderProfileListResponse(BaseModel):
    profiles: list[CustomProviderProfile]


class ExportResponse(BaseModel):
    id: int
    result_id: int
    job_id: int
    export_format: str
    file_path: str
    created_at: datetime
