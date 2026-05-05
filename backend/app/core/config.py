import json
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Schema-Driven Document Extraction"
    api_prefix: str = "/api"
    database_url: str = "sqlite:////data/app.db"
    data_dir: str = "/data"
    uploads_dir: str = "/data/uploads"
    exports_dir: str = "/data/exports"
    parsed_dir: str = "/data/parsed"
    seed_samples_on_startup: bool = False
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
        if not value.startswith("sqlite:///"):
            raise ValueError("DATABASE_URL must use sqlite:/// because the current runtime only supports SQLite.")
        return value

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

    @model_validator(mode="after")
    def validate_runtime_paths(self) -> "Settings":
        data_root = Path(self.data_dir).expanduser().resolve()
        runtime_paths = {
            "UPLOADS_DIR": Path(self.uploads_dir).expanduser().resolve(),
            "EXPORTS_DIR": Path(self.exports_dir).expanduser().resolve(),
            "PARSED_DIR": Path(self.parsed_dir).expanduser().resolve(),
        }
        for env_name, path in runtime_paths.items():
            if not path.is_relative_to(data_root):
                raise ValueError(f"{env_name} must stay inside DATA_DIR.")
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


settings = Settings()
settings.ensure_dirs()
