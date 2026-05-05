from __future__ import annotations

import os
from urllib.parse import urlencode

import httpx
from extraction_core.models import LLMProviderSettings


def probe_provider(settings: LLMProviderSettings) -> dict[str, object]:
    if settings.api_style == "mock":
        return {
            "provider_type": settings.provider_type,
            "reachable": True,
            "status": "ready",
            "detail": "Mock provider is always available for bootstrap runs.",
            "endpoint": None,
            "status_code": None,
        }

    if not settings.base_url:
        return _failure(settings, "Base URL is required before probing.")

    if settings.api_key_required:
        missing_key = _missing_api_key(settings)
        if missing_key:
            return _failure(settings, f"Missing environment variable {missing_key}.")

    if settings.api_style == "azure_openai":
        if not settings.deployment:
            return _failure(settings, "Azure deployment name is required before probing.")
        if not settings.api_version:
            return _failure(settings, "Azure API version is required before probing.")
        endpoint = (
            f"{settings.base_url.rstrip('/')}/openai/deployments/{settings.deployment}/chat/completions"
            f"?{urlencode({'api-version': settings.api_version})}"
        )
        headers = {"api-key": _read_api_key(settings) or ""}
        return _probe_endpoint(settings, endpoint, headers)

    endpoint = f"{settings.base_url.rstrip('/')}/models"
    headers: dict[str, str] = {}
    token = _read_api_key(settings)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return _probe_endpoint(settings, endpoint, headers)


def _probe_endpoint(settings: LLMProviderSettings, endpoint: str, headers: dict[str, str]) -> dict[str, object]:
    try:
        with httpx.Client(timeout=min(settings.timeout_seconds, 10)) as client:
            response = client.get(endpoint, headers=headers)
        reachable = response.status_code in {200, 204, 400, 401, 403, 404, 405}
        return {
            "provider_type": settings.provider_type,
            "reachable": reachable,
            "status": "reachable" if reachable else "unreachable",
            "detail": (
                f"Endpoint responded with HTTP {response.status_code}."
                if reachable
                else f"Unexpected HTTP {response.status_code} from probe endpoint."
            ),
            "endpoint": endpoint,
            "status_code": response.status_code,
        }
    except httpx.HTTPError as exc:
        return {
            "provider_type": settings.provider_type,
            "reachable": False,
            "status": "error",
            "detail": str(exc),
            "endpoint": endpoint,
            "status_code": None,
        }


def _missing_api_key(settings: LLMProviderSettings) -> str | None:
    env_var = settings.api_key_env_var
    if not env_var:
        return "unset api_key_env_var"
    if not os.getenv(env_var):
        return env_var
    return None


def _read_api_key(settings: LLMProviderSettings) -> str | None:
    env_var = settings.api_key_env_var
    if not env_var:
        return None
    return os.getenv(env_var)


def _failure(settings: LLMProviderSettings, detail: str) -> dict[str, object]:
    return {
        "provider_type": settings.provider_type,
        "reachable": False,
        "status": "not_ready",
        "detail": detail,
        "endpoint": None,
        "status_code": None,
    }
