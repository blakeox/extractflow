from __future__ import annotations

import pytest
from app.core.config import WorkerSettings
from pydantic import ValidationError


def build_worker_settings(tmp_path, **overrides) -> dict[str, object]:
    data_dir = tmp_path / "data"
    values: dict[str, object] = {
        "data_dir": str(data_dir),
        "parsed_dir": str(data_dir / "parsed"),
        "worker_status_path": str(data_dir / "worker-status.json"),
    }
    values.update(overrides)
    return values


def test_worker_settings_reject_status_path_outside_data_dir(tmp_path) -> None:
    with pytest.raises(ValidationError, match="WORKER_STATUS_PATH must stay inside DATA_DIR"):
        WorkerSettings(**build_worker_settings(tmp_path, worker_status_path=str(tmp_path / "worker-status.json")))


def test_worker_settings_ensure_paths_creates_status_parent(tmp_path) -> None:
    settings = WorkerSettings(**build_worker_settings(tmp_path))

    settings.ensure_paths()

    assert (tmp_path / "data" / "parsed").exists()
    assert (tmp_path / "data").exists()


def test_worker_settings_allow_disabling_docling_prewarm(tmp_path) -> None:
    settings = WorkerSettings(**build_worker_settings(tmp_path, docling_prewarm=False))

    assert settings.docling_prewarm is False


def test_worker_settings_allow_disabling_docling_parser(tmp_path) -> None:
    settings = WorkerSettings(**build_worker_settings(tmp_path, EXTRACTFLOW_USE_DOCLING=False))

    assert settings.docling_enabled is False


def test_worker_settings_allow_disabling_docling_ocr_paths(tmp_path) -> None:
    settings = WorkerSettings(
        **build_worker_settings(
            tmp_path,
            docling_pdf_ocr_retry=False,
            docling_image_ocr=False,
        )
    )

    assert settings.docling_pdf_ocr_retry is False
    assert settings.docling_image_ocr is False


def test_worker_settings_accept_postgres_database_urls(tmp_path) -> None:
    settings = WorkerSettings(
        **build_worker_settings(
            tmp_path,
            database_url="postgresql+psycopg://extractflow:secret@db.internal/extractflow",
        )
    )

    assert settings.database_url == "postgresql+psycopg://extractflow:secret@db.internal/extractflow"


def test_worker_saas_settings_require_authentication(tmp_path) -> None:
    with pytest.raises(ValidationError, match="REQUIRE_AUTHENTICATION must be true for saas_multi_tenant deployments"):
        WorkerSettings(
            **build_worker_settings(
                tmp_path,
                deployment_mode="saas_multi_tenant",
                require_authentication=False,
            )
        )


def test_worker_settings_reject_invalid_current_tenant_id(tmp_path) -> None:
    with pytest.raises(ValidationError, match="CURRENT_TENANT_ID"):
        WorkerSettings(**build_worker_settings(tmp_path, current_tenant_id="bad tenant"))


def test_worker_settings_normalize_storage_backend_value(tmp_path) -> None:
    settings = WorkerSettings(**build_worker_settings(tmp_path, storage_backend=" S3 ", s3_bucket="artifacts"))

    assert settings.storage_backend == "s3"
