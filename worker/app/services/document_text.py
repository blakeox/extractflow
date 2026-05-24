from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from extraction_core.storage_refs import build_storage_reference

from app.core.config import settings
from app.services.parser import parse_document


def parse_and_persist_document_text(document_id: int, document_path: str) -> tuple[str, str]:
    settings.ensure_paths()
    text = parse_document(document_path)
    parsed_root = Path(settings.parsed_dir)
    target = parsed_root / f"{document_id}-{uuid4().hex}.txt"
    target.write_text(text, encoding="utf-8")
    reference = build_storage_reference(target, root=settings.data_dir)
    return reference, text
