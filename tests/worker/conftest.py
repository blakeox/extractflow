from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest
from extraction_core.runtime import is_postgres_url
from sqlalchemy import Column, Integer, Table, inspect, text

TEST_ROOT = Path(tempfile.mkdtemp(prefix="extractflow-worker-tests-"))
if "DATABASE_URL" not in os.environ:
    os.environ["DATABASE_URL"] = f"sqlite:///{TEST_ROOT / 'worker-test.db'}"
if "DATA_DIR" not in os.environ:
    os.environ["DATA_DIR"] = str(TEST_ROOT / "data")
if "UPLOADS_DIR" not in os.environ:
    os.environ["UPLOADS_DIR"] = str(TEST_ROOT / "data" / "uploads")
if "EXPORTS_DIR" not in os.environ:
    os.environ["EXPORTS_DIR"] = str(TEST_ROOT / "data" / "exports")
if "PARSED_DIR" not in os.environ:
    os.environ["PARSED_DIR"] = str(TEST_ROOT / "data" / "parsed")
if "WORKER_STATUS_PATH" not in os.environ:
    os.environ["WORKER_STATUS_PATH"] = str(TEST_ROOT / "data" / "worker-status.json")
os.environ.setdefault("WORKER_POLL_SECONDS", "1")

from app.models import Base, Document, TemplateVersion  # noqa: E402

if "templates" not in Base.metadata.tables:
    Table("templates", Base.metadata, Column("id", Integer, primary_key=True))


def _reset_database_schema(engine) -> None:
    if is_postgres_url(os.environ["DATABASE_URL"]):
        with engine.begin() as connection:
            table_names = inspect(engine).get_table_names()
            for table_name in reversed(table_names):
                connection.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))
    else:
        Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    _seed_reference_rows(engine)


def _seed_reference_rows(engine) -> None:
    from sqlalchemy.orm import Session

    seed_definition = {
        "template_name": "Worker Test Seed",
        "template_version": "1.0.0",
        "extracted_fields": [],
    }
    with Session(engine) as session:
        if session.execute(text("SELECT 1 FROM templates WHERE id = 1")).first() is None:
            session.execute(text("INSERT INTO templates (id) VALUES (1)"))
        if session.get(Document, 1) is None:
            session.add(
                Document(
                    id=1,
                    original_filename="seed.txt",
                    content_type="text/plain",
                    stored_path="uploads/seed.txt",
                    status="uploaded",
                )
            )
        if session.get(TemplateVersion, 1) is None:
            session.add(
                TemplateVersion(
                    id=1,
                    template_id=1,
                    version="1.0.0",
                    definition=seed_definition,
                )
            )
        session.commit()

    if is_postgres_url(os.environ["DATABASE_URL"]):
        with engine.begin() as connection:
            for table_name, column_name in (
                ("templates", "id"),
                ("documents", "id"),
                ("template_versions", "id"),
            ):
                connection.execute(
                    text(
                        f"SELECT setval(pg_get_serial_sequence('{table_name}', '{column_name}'), "
                        f"COALESCE((SELECT MAX({column_name}) FROM {table_name}), 1))"
                    )
                )


@pytest.fixture(autouse=True)
def reset_worker_state() -> None:
    from app.core.database import engine

    _reset_database_schema(engine)

    data_dir = Path(os.environ["DATA_DIR"])
    if data_dir.exists():
        shutil.rmtree(data_dir)
    for key in ("UPLOADS_DIR", "EXPORTS_DIR", "PARSED_DIR"):
        Path(os.environ[key]).mkdir(parents=True, exist_ok=True)
    yield
