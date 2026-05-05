from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettings(BaseSettings):
    data_dir: str = "/data"
    database_url: str = "sqlite:////data/app.db"
    worker_poll_seconds: int = Field(default=5, ge=1, le=3600)
    parsed_dir: str = "/data/parsed"
    worker_status_path: str = "/data/worker-status.json"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: str) -> str:
        if not value.startswith("sqlite:///"):
            raise ValueError("DATABASE_URL must use sqlite:/// because the current runtime only supports SQLite.")
        return value

    @model_validator(mode="after")
    def validate_runtime_paths(self) -> "WorkerSettings":
        data_root = Path(self.data_dir).expanduser().resolve()
        parsed_dir = Path(self.parsed_dir).expanduser().resolve()
        status_path = Path(self.worker_status_path).expanduser().resolve()
        if not parsed_dir.is_relative_to(data_root):
            raise ValueError("PARSED_DIR must stay inside DATA_DIR.")
        if not status_path.is_relative_to(data_root):
            raise ValueError("WORKER_STATUS_PATH must stay inside DATA_DIR.")
        return self

    def ensure_paths(self) -> None:
        Path(self.parsed_dir).mkdir(parents=True, exist_ok=True)
        Path(self.worker_status_path).parent.mkdir(parents=True, exist_ok=True)


settings = WorkerSettings()
