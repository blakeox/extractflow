from __future__ import annotations

import re

TENANT_ID_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$")


def normalize_tenant_id(value: str, *, source: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{source} must not be empty.")
    if not TENANT_ID_PATTERN.fullmatch(normalized):
        raise ValueError(f"{source} must use 1-64 characters from letters, numbers, dots, hyphens, or underscores.")
    return normalized
