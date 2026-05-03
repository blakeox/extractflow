from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


TEST_ROOT = Path(tempfile.mkdtemp(prefix="extractflow-backend-tests-"))
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_ROOT / 'backend-test.db'}"
os.environ["DATA_DIR"] = str(TEST_ROOT / "data")
os.environ["UPLOADS_DIR"] = str(TEST_ROOT / "data" / "uploads")
os.environ["EXPORTS_DIR"] = str(TEST_ROOT / "data" / "exports")
os.environ["PARSED_DIR"] = str(TEST_ROOT / "data" / "parsed")
os.environ["SEED_SAMPLES_ON_STARTUP"] = "false"


@pytest.fixture(autouse=True)
def reset_backend_state() -> None:
    from app.db.database import Base, engine
    from app.main import app

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    data_dir = Path(os.environ["DATA_DIR"])
    if data_dir.exists():
        shutil.rmtree(data_dir)
    for key in ("DATA_DIR", "UPLOADS_DIR", "EXPORTS_DIR", "PARSED_DIR"):
        Path(os.environ[key]).mkdir(parents=True, exist_ok=True)

    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client() -> TestClient:
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
