from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest
from sqlalchemy import Column, Integer, Table, text

TEST_ROOT = Path(tempfile.mkdtemp(prefix="extractflow-worker-tests-"))
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_ROOT / 'worker-test.db'}"
os.environ["DATA_DIR"] = str(TEST_ROOT / "data")
os.environ["UPLOADS_DIR"] = str(TEST_ROOT / "data" / "uploads")
os.environ["EXPORTS_DIR"] = str(TEST_ROOT / "data" / "exports")
os.environ["PARSED_DIR"] = str(TEST_ROOT / "data" / "parsed")
os.environ["WORKER_STATUS_PATH"] = str(TEST_ROOT / "data" / "worker-status.json")
os.environ["WORKER_POLL_SECONDS"] = "1"

from app.models import Base  # noqa: E402

if "templates" not in Base.metadata.tables:
    Table("templates", Base.metadata, Column("id", Integer, primary_key=True))


@pytest.fixture(autouse=True)
def reset_worker_state() -> None:
    from app.core.database import engine

    with engine.begin() as connection:
        connection.execute(text("DROP TABLE IF EXISTS extraction_results"))
        connection.execute(text("DROP TABLE IF EXISTS extraction_jobs"))
        connection.execute(text("DROP TABLE IF EXISTS template_versions"))
        connection.execute(text("DROP TABLE IF EXISTS templates"))
        connection.execute(text("DROP TABLE IF EXISTS documents"))
        connection.execute(text("CREATE TABLE templates (id INTEGER PRIMARY KEY)"))
        connection.execute(
            text(
                """
                CREATE TABLE documents (
                    id INTEGER PRIMARY KEY,
                    original_filename VARCHAR(255) NOT NULL,
                    content_type VARCHAR(255) NOT NULL,
                    stored_path VARCHAR(500) NOT NULL,
                    parsed_text_path VARCHAR(500),
                    status VARCHAR(50) NOT NULL,
                    created_at DATETIME
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE template_versions (
                    id INTEGER PRIMARY KEY,
                    template_id INTEGER NOT NULL,
                    version VARCHAR(50) NOT NULL,
                    definition JSON NOT NULL,
                    created_at DATETIME
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE extraction_jobs (
                    id INTEGER PRIMARY KEY,
                    document_id INTEGER NOT NULL,
                    template_version_id INTEGER NOT NULL,
                    provider_override JSON,
                    status VARCHAR(50) NOT NULL,
                    error_message TEXT,
                    created_at DATETIME,
                    updated_at DATETIME
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE extraction_results (
                    id INTEGER PRIMARY KEY,
                    job_id INTEGER NOT NULL,
                    result_json JSON NOT NULL,
                    review_status VARCHAR(50) NOT NULL,
                    created_at DATETIME,
                    updated_at DATETIME
                )
                """
            )
        )

    data_dir = Path(os.environ["DATA_DIR"])
    if data_dir.exists():
        shutil.rmtree(data_dir)
    for key in ("UPLOADS_DIR", "EXPORTS_DIR", "PARSED_DIR"):
        Path(os.environ[key]).mkdir(parents=True, exist_ok=True)
    yield
