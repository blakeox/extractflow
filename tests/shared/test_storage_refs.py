from __future__ import annotations

from pathlib import Path

import pytest
from extraction_core.storage_refs import (
    build_storage_reference,
    normalize_storage_reference,
    resolve_storage_path,
)


def test_normalize_storage_reference_accepts_safe_relative_paths() -> None:
    assert normalize_storage_reference("uploads/sample.txt") == "uploads/sample.txt"


def test_normalize_storage_reference_rejects_parent_segments() -> None:
    with pytest.raises(ValueError, match="Invalid storage reference"):
        normalize_storage_reference("../outside.txt")


def test_resolve_storage_path_accepts_safe_relative_reference(tmp_path: Path) -> None:
    resolved = resolve_storage_path("uploads/sample.txt", root=tmp_path)

    assert resolved == (tmp_path / "uploads" / "sample.txt").resolve()


def test_resolve_storage_path_rejects_absolute_candidate(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Invalid storage reference"):
        resolve_storage_path("/etc/passwd", root=tmp_path)


def test_build_storage_reference_returns_posix_relative_path(tmp_path: Path) -> None:
    target = tmp_path / "nested" / "doc.txt"
    target.parent.mkdir(parents=True)
    target.write_text("ok", encoding="utf-8")

    reference = build_storage_reference(target, root=tmp_path)

    assert reference == "nested/doc.txt"
