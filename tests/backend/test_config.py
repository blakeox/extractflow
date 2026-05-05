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
