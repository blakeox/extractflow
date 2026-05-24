from __future__ import annotations

import os
from pathlib import Path, PurePosixPath

_INVALID_PATH_PARTS = frozenset({".", ".."})


def _validated_relative_candidate(candidate: str | Path) -> PurePosixPath:
    if isinstance(candidate, Path):
        if candidate.is_absolute() or candidate.drive:
            raise ValueError("Managed paths must be relative to the storage root.")
        relative = PurePosixPath(*candidate.parts)
    else:
        normalized = os.path.normpath(str(candidate)).replace("\\", "/")
        if os.path.isabs(normalized):
            raise ValueError("Managed paths must be relative to the storage root.")
        relative = PurePosixPath(normalized)

    if relative.is_absolute() or any(part in _INVALID_PATH_PARTS for part in relative.parts):
        raise ValueError("Managed path must not contain parent-directory segments.")
    return relative


def resolve_storage_path(candidate: str | Path, *, root: str | Path) -> Path:
    resolved_root = Path(root).expanduser().resolve()
    raw_candidate = Path(candidate).expanduser()
    if raw_candidate.is_absolute():
        resolved_candidate = raw_candidate.resolve()
    else:
        relative = _validated_relative_candidate(candidate)
        resolved_candidate = (resolved_root / Path(*relative.parts)).resolve()
    if not resolved_candidate.is_relative_to(resolved_root):
        raise ValueError(f"Managed path must stay inside {resolved_root}.")
    return resolved_candidate


def build_storage_reference(candidate: str | Path, *, root: str | Path) -> str:
    resolved_root = Path(root).expanduser().resolve()
    resolved_candidate = resolve_storage_path(candidate, root=resolved_root)
    return resolved_candidate.relative_to(resolved_root).as_posix()
