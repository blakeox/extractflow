from __future__ import annotations

import pytest
from app.core.config import Settings
from pydantic import ValidationError


def build_backend_settings(tmp_path, **overrides) -> dict[str, object]:
    data_dir = tmp_path / "data"
    values: dict[str, object] = {
        "data_dir": str(data_dir),
        "uploads_dir": str(data_dir / "uploads"),
        "exports_dir": str(data_dir / "exports"),
        "parsed_dir": str(data_dir / "parsed"),
    }
    values.update(overrides)
    return values


def test_settings_reject_paths_outside_data_dir(tmp_path) -> None:
    with pytest.raises(ValidationError, match="UPLOADS_DIR must stay inside DATA_DIR"):
        Settings(**build_backend_settings(tmp_path, uploads_dir=str(tmp_path / "outside-uploads")))


def test_settings_default_worker_status_path_stays_inside_data_dir(tmp_path) -> None:
    settings = Settings(**build_backend_settings(tmp_path))

    assert settings.worker_status_path == str((tmp_path / "data" / "worker-status.json").resolve())


def test_settings_reject_non_array_provider_catalog_json(tmp_path) -> None:
    with pytest.raises(ValidationError, match="PROVIDER_CATALOG_JSON must be a JSON array"):
        Settings(**build_backend_settings(tmp_path, provider_catalog_json='{"provider":"custom"}'))


def test_settings_normalize_api_prefix_and_base_urls(tmp_path) -> None:
    settings = Settings(
        **build_backend_settings(
            tmp_path,
            api_prefix="/api/",
            default_openai_base_url="https://api.openai.com/v1/",
        )
    )

    assert settings.api_prefix == "/api"
    assert settings.default_openai_base_url == "https://api.openai.com/v1"


def test_settings_allow_configurable_custom_provider_probe_max_age_hours(tmp_path) -> None:
    settings = Settings(
        **build_backend_settings(
            tmp_path,
            custom_provider_probe_max_age_hours=12,
        )
    )

    assert settings.custom_provider_probe_max_age_hours == 12


def test_settings_accept_postgres_database_urls(tmp_path) -> None:
    settings = Settings(
        **build_backend_settings(
            tmp_path,
            database_url="postgresql+psycopg://extractflow:secret@db.internal/extractflow",
        )
    )

    assert settings.database_url == "postgresql+psycopg://extractflow:secret@db.internal/extractflow"


def test_saas_settings_require_authentication(tmp_path) -> None:
    with pytest.raises(ValidationError, match="REQUIRE_AUTHENTICATION must be true for saas_multi_tenant deployments"):
        Settings(
            **build_backend_settings(
                tmp_path,
                deployment_mode="saas_multi_tenant",
                require_authentication=False,
            )
        )


def test_settings_reject_invalid_current_tenant_id(tmp_path) -> None:
    with pytest.raises(ValidationError, match="CURRENT_TENANT_ID"):
        Settings(**build_backend_settings(tmp_path, current_tenant_id="bad tenant"))


def test_settings_require_auth_for_trusted_tenant_header(tmp_path) -> None:
    with pytest.raises(ValidationError, match="TRUST_TENANT_HEADER requires"):
        Settings(
            **build_backend_settings(
                tmp_path,
                deployment_mode="hosted_single_tenant",
                require_authentication=True,
                trust_tenant_header=True,
                auth_bearer_tokens_json='{"token":{"actor":"ops","role":"admin"}}',
            )
        )


def test_settings_require_bearer_tokens_when_authentication_enabled(tmp_path) -> None:
    with pytest.raises(ValidationError, match="AUTH_BEARER_TOKENS_JSON is required"):
        Settings(**build_backend_settings(tmp_path, require_authentication=True))


def test_settings_reject_auth_tokens_missing_actor(tmp_path) -> None:
    with pytest.raises(ValidationError, match="AUTH_BEARER_TOKENS_JSON actor must be a non-empty string"):
        Settings(
            **build_backend_settings(
                tmp_path,
                auth_bearer_tokens_json='{"token":{"role":"admin"}}',
            )
        )


def test_settings_require_s3_bucket_for_s3_backend(tmp_path) -> None:
    with pytest.raises(ValidationError, match="S3_BUCKET is required"):
        Settings(**build_backend_settings(tmp_path, storage_backend="s3"))


def test_settings_accept_s3_backend_with_bucket(tmp_path) -> None:
    settings = Settings(**build_backend_settings(tmp_path, storage_backend="s3", s3_bucket="artifacts"))
    assert settings.storage_backend == "s3"
    assert settings.s3_bucket == "artifacts"
