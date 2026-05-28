from pathlib import Path

from extraction_core.runtime import (
    DeploymentMode,
    tenant_mode_for_deployment,
    validate_supported_database_url,
)
from extraction_core.tenancy import normalize_tenant_id
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettings(BaseSettings):
    deployment_mode: DeploymentMode = DeploymentMode.LOCAL
    data_dir: str = "/data"
    database_url: str = "sqlite:////data/app.db"
    allow_external_processing: bool = True
    require_redaction_for_external_processing: bool = False
    presidio_redaction_enabled: bool = True
    presidio_redaction_entities: str = "EMAIL_ADDRESS,PHONE_NUMBER,CREDIT_CARD,US_SSN,IBAN_CODE,IP_ADDRESS"
    require_authentication: bool = False
    current_tenant_id: str = "default"
    worker_poll_seconds: int = Field(default=5, ge=1, le=3600)
    parsed_dir: str = "/data/parsed"
    worker_status_path: str = "/data/worker-status.json"
    docling_enabled: bool = Field(default=True, validation_alias="EXTRACTFLOW_USE_DOCLING")
    docling_prewarm: bool = True
    docling_pdf_ocr_retry: bool = True
    docling_image_ocr: bool = True
    storage_backend: str = "local"
    s3_bucket: str | None = None
    s3_prefix: str = "extractflow"
    s3_endpoint_url: str | None = None
    s3_region: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: str) -> str:
        return validate_supported_database_url(value)

    @field_validator("current_tenant_id")
    @classmethod
    def validate_current_tenant_id(cls, value: str) -> str:
        return normalize_tenant_id(value, source="CURRENT_TENANT_ID")

    @model_validator(mode="after")
    def validate_runtime_paths(self) -> "WorkerSettings":
        data_root = Path(self.data_dir).expanduser().resolve()
        parsed_dir = Path(self.parsed_dir).expanduser().resolve()
        status_path = Path(self.worker_status_path).expanduser().resolve()
        if not parsed_dir.is_relative_to(data_root):
            raise ValueError("PARSED_DIR must stay inside DATA_DIR.")
        if not status_path.is_relative_to(data_root):
            raise ValueError("WORKER_STATUS_PATH must stay inside DATA_DIR.")
        if self.deployment_mode == DeploymentMode.SAAS_MULTI_TENANT and not self.require_authentication:
            raise ValueError("REQUIRE_AUTHENTICATION must be true for saas_multi_tenant deployments.")
        backend = self.storage_backend.strip().lower()
        if backend not in {"local", "s3"}:
            raise ValueError("STORAGE_BACKEND must be 'local' or 's3'.")
        if backend == "s3" and not self.s3_bucket:
            raise ValueError("S3_BUCKET is required when STORAGE_BACKEND=s3.")
        return self

    def ensure_paths(self) -> None:
        Path(self.parsed_dir).mkdir(parents=True, exist_ok=True)
        Path(self.worker_status_path).parent.mkdir(parents=True, exist_ok=True)

    @property
    def configured_redaction_entities(self) -> list[str]:
        return [item.strip() for item in self.presidio_redaction_entities.split(",") if item.strip()]

    @property
    def tenant_mode(self) -> str:
        return tenant_mode_for_deployment(self.deployment_mode)


settings = WorkerSettings()
