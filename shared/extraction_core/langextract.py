from __future__ import annotations

LANGEXTRACT_PROVIDER_TYPE = "langextract"
LANGEXTRACT_API_STYLE = "langextract"


def uses_langextract_provider(provider_type: str, api_style: str) -> bool:
    return provider_type == LANGEXTRACT_PROVIDER_TYPE or api_style == LANGEXTRACT_API_STYLE


def normalize_langextract_base_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/v1"):
        return normalized[:-3]
    return normalized
