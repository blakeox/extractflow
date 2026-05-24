from __future__ import annotations

import os
import re
from pathlib import Path

_SAFE_STORAGE_REFERENCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)*$")


def normalize_storage_reference(reference: str) -> str:
    normalized = os.path.normpath(reference).replace("\\", "/")
    if os.path.isabs(normalized):
        raise ValueError("Invalid storage reference.")
    cleaned = normalized.lstrip("/")
    if not cleaned or cleaned in {".", ".."} or ".." in cleaned.split("/"):
        raise ValueError("Invalid storage reference.")
    if not _SAFE_STORAGE_REFERENCE.fullmatch(cleaned):
        raise ValueError("Invalid storage reference.")
    return cleaned


def resolve_storage_path(candidate: str, *, root: str | Path) -> Path:
    resolved_root = Path(root).expanduser().resolve()
    cleaned = normalize_storage_reference(candidate)
    resolved_candidate = resolved_root
    for segment in cleaned.split("/"):
        resolved_candidate /= segment
    resolved_candidate = resolved_candidate.resolve()
    if not resolved_candidate.is_relative_to(resolved_root):
        raise ValueError(f"Managed path must stay inside {resolved_root}.")
    return resolved_candidate


def build_storage_reference(candidate: str | Path, *, root: str | Path) -> str:
    resolved_root = Path(root).expanduser().resolve()
    raw = Path(candidate).expanduser()
    if raw.is_absolute():
        resolved = raw.resolve()
        if not resolved.is_relative_to(resolved_root):
            raise ValueError(f"Managed path must stay inside {resolved_root}.")
        reference = resolved.relative_to(resolved_root).as_posix()
    else:
        reference = raw.as_posix()
    return normalize_storage_reference(reference)
