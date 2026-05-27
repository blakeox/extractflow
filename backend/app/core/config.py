import json
from pathlib import Path

from extraction_core.runtime import (
    DeploymentMode,
    tenant_mode_for_deployment,
    validate_supported_database_url,
)
from extraction_core.tenancy import normalize_tenant_id
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Schema-Driven Document Extraction"
    api_prefix: str = "/api"
    deployment_mode: DeploymentMode = DeploymentMode.LOCAL
    database_url: str = "sqlite:////data/app.db"
    data_dir: str = "/data"
    uploads_dir: str = "/data/uploads"
    exports_dir: str = "/data/exports"
    parsed_dir: str = "/data/parsed"
    worker_status_path: str | None = None
    seed_samples_on_startup: bool = False
    allow_external_processing: bool = True
    require_redaction_for_external_processing: bool = False
    presidio_redaction_enabled: bool = True
    require_authentication: bool = False
    auth_bearer_tokens_json: str | None = None
    current_tenant_id: str = "default"
    trust_tenant_header: bool = False
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000", "http://frontend:3000"])
    worker_poll_seconds: int = Field(default=5, ge=1, le=3600)
    provider_catalog_json: str | None = None
    default_local_provider_base_url: str = "http://host.docker.internal:11434/v1"
    default_lm_studio_base_url: str = "http://localhost:1234/v1"
    default_openai_base_url: str = "https://api.openai.com/v1"
    default_deepseek_base_url: str = "https://api.deepseek.com/v1"
    default_kimi_base_url: str = "https://api.moonshot.ai/v1"
    default_azure_openai_base_url: str = "https://example.openai.azure.com"
    default_azure_openai_api_version: str = "2024-10-21"
    default_azure_openai_deployment: str = "gpt-4.1-mini"
    custom_provider_probe_max_age_hours: int = Field(default=24, ge=1, le=168)

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("api_prefix")
    @classmethod
    def validate_api_prefix(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized.startswith("/"):
            raise ValueError("API_PREFIX must start with '/'.")
        if normalized != "/" and normalized.endswith("/"):
            normalized = normalized.rstrip("/")
        return normalized

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: str) -> str:
        return validate_supported_database_url(value)

    @field_validator(
        "default_local_provider_base_url",
        "default_lm_studio_base_url",
        "default_openai_base_url",
        "default_deepseek_base_url",
        "default_kimi_base_url",
        "default_azure_openai_base_url",
    )
    @classmethod
    def validate_base_urls(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized.startswith(("http://", "https://")):
            raise ValueError("Provider base URLs must start with http:// or https://.")
        return normalized.rstrip("/")

    @field_validator("provider_catalog_json")
    @classmethod
    def validate_provider_catalog_json(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        parsed = json.loads(value)
        if not isinstance(parsed, list):
            raise ValueError("PROVIDER_CATALOG_JSON must be a JSON array.")
        return value

    @field_validator("auth_bearer_tokens_json")
    @classmethod
    def validate_auth_bearer_tokens_json(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        parsed = json.loads(value)
        if not isinstance(parsed, dict):
            raise ValueError("AUTH_BEARER_TOKENS_JSON must be a JSON object.")
        allowed_roles = {"admin", "operator", "reviewer", "viewer"}
        for token, payload in parsed.items():
            if not isinstance(token, str) or not token.strip():
                raise ValueError("AUTH_BEARER_TOKENS_JSON keys must be non-empty strings.")
            if not isinstance(payload, dict):
                raise ValueError("AUTH_BEARER_TOKENS_JSON values must be objects.")
            role = payload.get("role")
            actor = payload.get("actor")
            if not isinstance(actor, str) or not actor.strip():
                raise ValueError("AUTH_BEARER_TOKENS_JSON actor must be a non-empty string.")
            if not isinstance(role, str) or role.lower() not in allowed_roles:
                raise ValueError("AUTH_BEARER_TOKENS_JSON role must be admin, operator, reviewer, or viewer.")
        return value

    @field_validator("current_tenant_id")
    @classmethod
    def validate_current_tenant_id(cls, value: str) -> str:
        return normalize_tenant_id(value, source="CURRENT_TENANT_ID")

    @model_validator(mode="after")
    def validate_runtime_paths(self) -> "Settings":
        data_root = Path(self.data_dir).expanduser().resolve()
        if not self.worker_status_path:
            self.worker_status_path = str(data_root / "worker-status.json")
        runtime_paths = {
            "UPLOADS_DIR": Path(self.uploads_dir).expanduser().resolve(),
            "EXPORTS_DIR": Path(self.exports_dir).expanduser().resolve(),
            "PARSED_DIR": Path(self.parsed_dir).expanduser().resolve(),
            "WORKER_STATUS_PATH": Path(self.worker_status_path).expanduser().resolve(),
        }
        for env_name, path in runtime_paths.items():
            if not path.is_relative_to(data_root):
                raise ValueError(f"{env_name} must stay inside DATA_DIR.")
        if self.deployment_mode == DeploymentMode.SAAS_MULTI_TENANT and not self.require_authentication:
            raise ValueError("REQUIRE_AUTHENTICATION must be true for saas_multi_tenant deployments.")
        if self.trust_tenant_header and (
            self.deployment_mode != DeploymentMode.SAAS_MULTI_TENANT or not self.require_authentication
        ):
            raise ValueError(
                "TRUST_TENANT_HEADER requires a saas_multi_tenant deployment with REQUIRE_AUTHENTICATION=true."
            )
        if self.require_authentication and not self.auth_bearer_tokens_json:
            raise ValueError("AUTH_BEARER_TOKENS_JSON is required when REQUIRE_AUTHENTICATION=true.")
        return self

    def runtime_directories(self) -> dict[str, Path]:
        return {
            "data_dir": Path(self.data_dir),
            "uploads_dir": Path(self.uploads_dir),
            "exports_dir": Path(self.exports_dir),
            "parsed_dir": Path(self.parsed_dir),
        }

    def ensure_dirs(self) -> None:
        for path in self.runtime_directories().values():
            path.mkdir(parents=True, exist_ok=True)

    @property
    def tenant_mode(self) -> str:
        return tenant_mode_for_deployment(self.deployment_mode)


settings = Settings()
settings.ensure_dirs()
