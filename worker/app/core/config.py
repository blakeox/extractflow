from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettings(BaseSettings):
    database_url: str = "sqlite:////data/app.db"
    worker_poll_seconds: int = 5
    parsed_dir: str = "/data/parsed"
    worker_status_path: str = "/tmp/worker-status.json"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = WorkerSettings()
Path(settings.parsed_dir).mkdir(parents=True, exist_ok=True)
