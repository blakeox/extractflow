from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"


def test_alembic_upgrade_head_creates_core_tables(tmp_path: Path) -> None:
    db_path = tmp_path / "migrate-test.db"
    env = {
        **os.environ,
        "DATABASE_URL": f"sqlite:///{db_path}",
        "PYTHONPATH": f"{BACKEND_ROOT}{os.pathsep}{REPO_ROOT / 'shared'}",
    }
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr

    connection = sqlite3.connect(db_path)
    try:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    finally:
        connection.close()

    assert "alembic_version" in tables
    assert "extraction_jobs" in tables
    assert "audit_events" in tables
    assert "exports" in tables
