from __future__ import annotations

from pathlib import Path


def resolve_storage_path(candidate: str | Path, *, root: str | Path) -> Path:
    resolved_root = Path(root).expanduser().resolve()
    raw_candidate = Path(candidate).expanduser()
    resolved_candidate = (
        raw_candidate.resolve() if raw_candidate.is_absolute() else (resolved_root / raw_candidate).resolve()
    )
    if not resolved_candidate.is_relative_to(resolved_root):
        raise ValueError(f"Managed path must stay inside {resolved_root}.")
    return resolved_candidate


def build_storage_reference(candidate: str | Path, *, root: str | Path) -> str:
    resolved_root = Path(root).expanduser().resolve()
    resolved_candidate = resolve_storage_path(candidate, root=resolved_root)
    return resolved_candidate.relative_to(resolved_root).as_posix()
