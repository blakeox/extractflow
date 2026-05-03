from pathlib import Path

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
    cors_origins: list[str] = ["http://localhost:3000", "http://frontend:3000"]
    worker_poll_seconds: int = 5
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

    def ensure_dirs(self) -> None:
        for path in [self.data_dir, self.uploads_dir, self.exports_dir, self.parsed_dir]:
            Path(path).mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_dirs()
