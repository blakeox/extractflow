from __future__ import annotations

import os
from pathlib import Path

from app.services.storage import read_managed_document_text


def test_read_managed_document_text_falls_back_to_local_file_when_remote_store_misses(monkeypatch) -> None:
    import app.services.storage as storage_service

    reference = "parsed/doc-42.txt"
    parsed_path = Path(os.environ["DATA_DIR"]) / reference
    parsed_path.parent.mkdir(parents=True, exist_ok=True)
    parsed_path.write_text("Parsed body for review", encoding="utf-8")

    class MissingRemoteStore:
        def exists(self, reference: str, *, root: Path) -> bool:
            return False

        def materialize(self, reference: str, *, root: Path) -> Path:
            raise AssertionError("Remote materialization should not run when the local parsed file exists.")

    monkeypatch.setattr(storage_service, "get_blob_store", lambda: MissingRemoteStore())

    assert read_managed_document_text(reference) == "Parsed body for review"
