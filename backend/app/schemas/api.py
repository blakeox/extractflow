from __future__ import annotations

from datetime import datetime
from typing import Any

from extraction_core.models import ExtractionTemplate, LLMProviderCatalogEntry, LLMProviderSettings
from extraction_core.runtime import DeploymentMode
from pydantic import BaseModel, Field


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
    provider_override: LLMProviderSettings | None = None
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


class ProviderControlsResponse(BaseModel):
    deployment_mode: DeploymentMode
    tenant_mode: str
    allow_external_processing: bool
    require_redaction_for_external_processing: bool
    require_authentication: bool
    custom_provider_probe_max_age_hours: int


class LangExtractFeedbackSuggestionExtractionResponse(BaseModel):
    extraction_class: str
    extraction_text: str
    attributes: dict[str, str | list[str]] = Field(default_factory=dict)


class LangExtractFeedbackSuggestionResponse(BaseModel):
    key: str
    template_version_id: int
    example_text: str
    extractions: list[LangExtractFeedbackSuggestionExtractionResponse]
    occurrence_count: int
    source_result_ids: list[int] = Field(default_factory=list)
    source_field_names: list[str] = Field(default_factory=list)
    last_reviewed_at: datetime | None = None


class LangExtractFeedbackDiagnosticsResponse(BaseModel):
    reviewed_result_count: int = 0
    reviewed_edit_count: int = 0
    generated_suggestion_count: int = 0
    dismissed_suggestion_count: int = 0
    visible_suggestion_count: int = 0
    skipped_missing_document_text: int = 0
    skipped_missing_target_field: int = 0
    skipped_missing_grounding: int = 0
    skipped_span_override: int = 0
    skipped_span_mismatch: int = 0
    skipped_empty_context: int = 0
    skipped_no_contextual_extractions: int = 0


class LangExtractFeedbackSuggestionListResponse(BaseModel):
    suggestions: list[LangExtractFeedbackSuggestionResponse] = Field(default_factory=list)
    diagnostics: LangExtractFeedbackDiagnosticsResponse = Field(default_factory=LangExtractFeedbackDiagnosticsResponse)


class LangExtractFeedbackSuggestionDismissalRequest(BaseModel):
    dismissed: bool = True


class LangExtractFeedbackSuggestionDismissalResponse(BaseModel):
    template_version_id: int
    suggestion_key: str
    dismissed: bool
    updated_at: datetime


class CustomProviderProfile(BaseModel):
    id: str
    name: str
    settings: LLMProviderSettings
    last_probe_at: datetime | None = None
    last_probe_status: str | None = None
    last_probe_detail: str | None = None
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
