from __future__ import annotations

import os

from extraction_core.models import LLMProviderCatalogEntry


def get_provider_health(entry: LLMProviderCatalogEntry) -> dict[str, object]:
    settings = entry.settings
    checks: list[str] = []
    ready = True

    if settings.api_style != "mock" and not settings.base_url:
        ready = False
        checks.append("Missing base_url")

    if settings.api_key_required:
        if not settings.api_key_env_var:
            ready = False
            checks.append("Missing api_key_env_var")
        elif not os.getenv(settings.api_key_env_var):
            ready = False
            checks.append(f"Missing environment variable {settings.api_key_env_var}")

    if settings.api_style == "azure_openai":
        if not settings.deployment:
            ready = False
            checks.append("Missing Azure deployment name")
        if not settings.api_version:
            ready = False
            checks.append("Missing Azure API version")

    if settings.api_style == "mock":
        checks.append("Bootstrap provider only")
    elif ready:
        checks.append("Configuration present")

    return {
        "provider_key": entry.key,
        "provider_type": entry.provider_type,
        "ready": ready,
        "status": "ready" if ready else "not_ready",
        "checks": checks,
    }
