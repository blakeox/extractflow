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
