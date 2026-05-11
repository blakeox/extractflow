from __future__ import annotations

import os

from extraction_core.models import LLMProviderCatalogEntry


def get_provider_health(entry: LLMProviderCatalogEntry) -> dict[str, object]:
    settings = entry.settings
    checks: list[str] = []
    ready = True
    status = "ready"

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
    elif settings.api_style == "langextract":
        if settings.mode != "local":
            ready = False
            status = "not_ready"
            checks.append("LangExtract is only supported in local mode")
        if settings.allow_external_processing:
            ready = False
            status = "not_ready"
            checks.append("LangExtract v1 must keep allow_external_processing disabled")
        ready = False
        if status == "ready":
            status = "probe_required"
        checks.append("Run a live probe to confirm Ollama runtime and model availability")

    if settings.api_style == "mock":
        checks.append("Bootstrap provider only")
    elif ready:
        checks.append("Configuration present")
    elif status == "ready":
        status = "not_ready"

    return {
        "provider_key": entry.key,
        "provider_type": entry.provider_type,
        "ready": ready,
        "status": status,
        "checks": checks,
    }
