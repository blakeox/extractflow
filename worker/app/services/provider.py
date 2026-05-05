from __future__ import annotations

import json
import os
import re
from typing import Any, Protocol
from urllib.parse import urlencode

import httpx
from extraction_core.models import (
    ExtractionFieldDefinition,
    ExtractionFieldResult,
    ExtractionTemplate,
    LLMProviderSettings,
)


class ProviderAdapter(Protocol):
    def supports(self, settings: LLMProviderSettings) -> bool: ...

    def extract(
        self, text: str, template: ExtractionTemplate, settings: LLMProviderSettings
    ) -> list[ExtractionFieldResult]: ...


class ExtractionProvider:
    def __init__(self) -> None:
        self._adapters: list[ProviderAdapter] = [
            MockProviderAdapter(),
            AzureOpenAIAdapter(),
            OpenAICompatibleAdapter(),
        ]

    def extract(
        self, text: str, template: ExtractionTemplate, settings: LLMProviderSettings
    ) -> list[ExtractionFieldResult]:
        for adapter in self._adapters:
            if adapter.supports(settings):
                return adapter.extract(text, template, settings)
        raise ValueError(f"Unsupported provider configuration: {settings.provider_type} ({settings.api_style})")


class MockProviderAdapter:
    def supports(self, settings: LLMProviderSettings) -> bool:
        return settings.provider_type == "mock" or settings.api_style == "mock"

    def extract(
        self, text: str, template: ExtractionTemplate, settings: LLMProviderSettings
    ) -> list[ExtractionFieldResult]:
        return [self._mock_extract_field(text, field) for field in template.extracted_fields]

    def _mock_extract_field(self, text: str, field: ExtractionFieldDefinition) -> ExtractionFieldResult:
        lowered = text.lower()
        source = ""
        normalized: Any = None
        extracted: Any = None
        confidence = 0.35

        if field.type.value == "currency":
            match = re.search(r"\$?\s?(\d[\d,]*(?:\.\d{1,2})?)", text)
            if match:
                amount = float(match.group(1).replace(",", ""))
                normalized = {
                    "amount": amount,
                    "currency": field.validation.currency or "USD",
                    "display_value": match.group(0).strip(),
                }
                extracted = match.group(0).strip()
                source = match.group(0).strip()
                confidence = 0.72
        elif field.type.value == "date":
            match = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", text)
            if match:
                normalized = {"value": match.group(1), "display_value": match.group(1)}
                extracted = match.group(1)
                source = match.group(1)
                confidence = 0.7
        elif field.type.value == "boolean":
            if field.name.replace("_", " ") in lowered:
                normalized = True
                extracted = "true"
                source = field.name
                confidence = 0.6
        elif field.type.value == "number":
            match = re.search(r"\b(\d+(?:\.\d+)?)\b", text)
            if match:
                normalized = {"value": float(match.group(1))}
                extracted = match.group(1)
                source = match.group(1)
                confidence = 0.65
        else:
            if field.label.lower() in lowered or field.name.replace("_", " ") in lowered:
                snippet = text[:240]
                normalized = {"value": snippet.strip()}
                extracted = snippet.strip()
                source = snippet.strip()
                confidence = 0.58

        return ExtractionFieldResult(
            field_name=field.name,
            label=field.label,
            data_type=field.type,
            extracted_value=extracted,
            normalized_value=normalized,
            confidence_score=confidence,
            source_text=source,
            page_number=1 if source else None,
            location_reference="Page 1" if source else "",
            extraction_notes="Mock extraction used." if source else "No value identified by mock extractor.",
            requires_review=confidence < 0.75,
        )


class OpenAICompatibleAdapter:
    def supports(self, settings: LLMProviderSettings) -> bool:
        return settings.api_style == "openai_compatible"

    def extract(
        self, text: str, template: ExtractionTemplate, settings: LLMProviderSettings
    ) -> list[ExtractionFieldResult]:
        if not settings.base_url:
            raise ValueError(f"Provider {settings.provider_type} requires a base URL.")

        payload = {
            "model": settings.model,
            "messages": [{"role": "user", "content": build_prompt(text, template)}],
            "temperature": settings.temperature,
            "max_tokens": settings.max_tokens,
        }
        if settings.supports_json_mode:
            payload["response_format"] = {"type": "json_object"}

        headers = {"Content-Type": "application/json"}
        if settings.api_key_required:
            headers["Authorization"] = f"Bearer {read_api_key(settings)}"

        with httpx.Client(timeout=settings.timeout_seconds) as client:
            last_error: Exception | None = None
            for _ in range(settings.retry_count + 1):
                try:
                    response = client.post(
                        f"{settings.base_url.rstrip('/')}/chat/completions",
                        json=payload,
                        headers=headers,
                    )
                    response.raise_for_status()
                    content = response.json()["choices"][0]["message"]["content"]
                    parsed = json.loads(content)
                    return [ExtractionFieldResult.model_validate(item) for item in parsed["extracted_fields"]]
                except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError, ValueError) as exc:
                    last_error = exc
            raise RuntimeError(f"Provider call failed for {settings.provider_type}: {last_error}") from last_error


class AzureOpenAIAdapter:
    def supports(self, settings: LLMProviderSettings) -> bool:
        return settings.api_style == "azure_openai"

    def extract(
        self, text: str, template: ExtractionTemplate, settings: LLMProviderSettings
    ) -> list[ExtractionFieldResult]:
        if not settings.base_url:
            raise ValueError("Azure OpenAI provider requires a base URL.")
        if not settings.deployment:
            raise ValueError("Azure OpenAI provider requires a deployment name.")
        if not settings.api_version:
            raise ValueError("Azure OpenAI provider requires an API version.")

        payload = {
            "messages": [{"role": "user", "content": build_prompt(text, template)}],
            "temperature": settings.temperature,
            "max_tokens": settings.max_tokens,
        }
        if settings.supports_json_mode:
            payload["response_format"] = {"type": "json_object"}

        url = (
            f"{settings.base_url.rstrip('/')}/openai/deployments/{settings.deployment}/chat/completions"
            f"?{urlencode({'api-version': settings.api_version})}"
        )
        headers = {
            "Content-Type": "application/json",
            "api-key": read_api_key(settings),
        }

        with httpx.Client(timeout=settings.timeout_seconds) as client:
            last_error: Exception | None = None
            for _ in range(settings.retry_count + 1):
                try:
                    response = client.post(url, json=payload, headers=headers)
                    response.raise_for_status()
                    content = response.json()["choices"][0]["message"]["content"]
                    parsed = json.loads(content)
                    return [ExtractionFieldResult.model_validate(item) for item in parsed["extracted_fields"]]
                except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError, ValueError) as exc:
                    last_error = exc
            raise RuntimeError(f"Provider call failed for {settings.provider_type}: {last_error}") from last_error


def read_api_key(settings: LLMProviderSettings) -> str:
    env_var = settings.api_key_env_var
    if not env_var:
        raise ValueError(f"Provider {settings.provider_type} requires api_key_env_var to be configured.")
    token = os.getenv(env_var)
    if not token:
        raise ValueError(f"Provider {settings.provider_type} requires environment variable {env_var}.")
    return token


def build_prompt(text: str, template: ExtractionTemplate) -> str:
    return f"""You are an expert document extraction engine.

Return only valid JSON. Do not calculate formula fields.

Document:
{text[:15000]}

Extraction Template:
{json.dumps(template.model_dump(mode="json"), indent=2)}
"""
