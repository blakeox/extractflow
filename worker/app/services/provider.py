from __future__ import annotations

import importlib
import json
import os
import re
from typing import Any, Protocol
from urllib.parse import urlencode

import httpx
from extraction_core.langextract import (
    normalize_langextract_base_url,
    uses_langextract_provider,
)
from extraction_core.models import (
    ExtractionFieldDefinition,
    ExtractionFieldResult,
    ExtractionTemplate,
    LangExtractConfig,
    LLMProviderSettings,
)

PAGE_MARKER_PATTERN = re.compile(r"\[Page (?P<page>\d+)\]")
CURRENCY_PATTERN = re.compile(r"[-+]?\$?\s?(\d[\d,]*(?:\.\d{1,2})?)")
NUMBER_PATTERN = re.compile(r"[-+]?\d+(?:\.\d+)?")


class ProviderAdapter(Protocol):
    def supports(self, settings: LLMProviderSettings) -> bool: ...

    def extract(
        self, text: str, template: ExtractionTemplate, settings: LLMProviderSettings
    ) -> list[ExtractionFieldResult]: ...


class ExtractionProvider:
    def __init__(self) -> None:
        self._adapters: list[ProviderAdapter] = [
            MockProviderAdapter(),
            LangExtractAdapter(),
            AzureOpenAIAdapter(),
            OpenAICompatibleAdapter(),
        ]

    def extract(
        self, text: str, template: ExtractionTemplate, settings: LLMProviderSettings
    ) -> list[ExtractionFieldResult]:
        for adapter in self._adapters:
            if adapter.supports(settings):
                use_outer_chunking = not uses_langextract_provider(
                    settings.provider_type,
                    settings.api_style,
                )
                chunks = split_text_into_chunks(text, settings.chunk_size) if use_outer_chunking else [text]
                results: list[ExtractionFieldResult] = []
                for index, chunk in enumerate(chunks, start=1):
                    chunk_results = adapter.extract(
                        chunk,
                        template,
                        settings,
                    )
                    if use_outer_chunking:
                        for item in chunk_results:
                            if item.extraction_notes:
                                item.extraction_notes = f"{item.extraction_notes} Chunk {index}/{len(chunks)}."
                            else:
                                item.extraction_notes = f"Chunk {index}/{len(chunks)}."
                    results.extend(chunk_results)
                return results
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


class LangExtractAdapter:
    def supports(self, settings: LLMProviderSettings) -> bool:
        return uses_langextract_provider(settings.provider_type, settings.api_style)

    def extract(
        self, text: str, template: ExtractionTemplate, settings: LLMProviderSettings
    ) -> list[ExtractionFieldResult]:
        if settings.mode != "local":
            raise ValueError("LangExtract is only supported in local mode.")
        if settings.allow_external_processing:
            raise ValueError("LangExtract v1 requires allow_external_processing to stay disabled.")
        if not settings.base_url:
            raise ValueError("LangExtract provider requires an Ollama base URL.")
        if not template.langextract_config or not template.langextract_config.examples:
            raise ValueError("LangExtract provider requires template.langextract_config with at least one example.")
        if settings.langextract_max_document_chars is not None and len(text) > settings.langextract_max_document_chars:
            raise ValueError(
                "LangExtract document length "
                f"{len(text)} chars exceeds langextract_max_document_chars="
                f"{settings.langextract_max_document_chars}. LangExtract keeps grounded global offsets "
                f"by using internal windowing with chunk_size={settings.chunk_size}, but this project caps "
                "total document size to bound runtime and memory. Reduce document size or increase "
                "langextract_max_document_chars."
            )

        lx_module, example_data_cls, extraction_cls, ollama_model_cls = _import_langextract()
        prompt_config = template.langextract_config
        model = ollama_model_cls(
            model_id=settings.model,
            model_url=normalize_langextract_base_url(settings.base_url),
            timeout=settings.timeout_seconds,
        )
        annotated = lx_module.extract(
            text_or_documents=text,
            model=model,
            prompt_description=prompt_config.prompt_description,
            examples=build_langextract_examples(prompt_config, example_data_cls, extraction_cls),
            max_char_buffer=settings.chunk_size,
            temperature=settings.temperature,
            show_progress=False,
        )

        field_by_name = {field.name: field for field in template.extracted_fields}
        results: list[ExtractionFieldResult] = []
        for extraction in annotated.extractions or []:
            definition = field_by_name.get(extraction.extraction_class)
            results.append(build_langextract_result(definition, extraction, text))
        return results


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


def _import_langextract() -> tuple[Any, Any, Any, Any]:
    try:
        lx_module = importlib.import_module("langextract")
        data_module = importlib.import_module("langextract.core.data")
        ollama_module = importlib.import_module("langextract.providers.ollama")
    except ImportError as exc:
        raise RuntimeError(
            "LangExtract provider requires langextract to be installed in the worker environment."
        ) from exc
    return (
        lx_module,
        data_module.ExampleData,
        data_module.Extraction,
        ollama_module.OllamaLanguageModel,
    )


def build_langextract_examples(config: LangExtractConfig, example_data_cls: Any, extraction_cls: Any) -> list[Any]:
    examples: list[Any] = []
    for example in config.examples:
        examples.append(
            example_data_cls(
                text=example.text,
                extractions=[
                    extraction_cls(
                        extraction_class=item.extraction_class,
                        extraction_text=item.extraction_text,
                        attributes=item.attributes or None,
                    )
                    for item in example.extractions
                ],
            )
        )
    return examples


def build_langextract_result(
    definition: ExtractionFieldDefinition | None, extraction: Any, text: str
) -> ExtractionFieldResult:
    start = getattr(getattr(extraction, "char_interval", None), "start_pos", None)
    end = getattr(getattr(extraction, "char_interval", None), "end_pos", None)
    grounded = isinstance(start, int) and isinstance(end, int) and start >= 0 and end >= start
    source_text = text[start:end] if grounded else ""
    page_number, location_reference = infer_page_reference(text, start if grounded else None)
    extracted_text = extraction.extraction_text.strip()
    attributes = extraction.attributes or {}
    normalized_value = normalize_langextract_value(definition, extracted_text, attributes)
    notes = (
        f"LangExtract grounded chars {start}-{end}." if grounded else "LangExtract returned an ungrounded extraction."
    )

    if definition is None:
        return ExtractionFieldResult(
            field_name=extraction.extraction_class,
            label=extraction.extraction_class,
            data_type="text",
            extracted_value=extracted_text,
            normalized_value={"value": extracted_text} if extracted_text else None,
            confidence_score=1.0 if grounded else 0.0,
            source_text=source_text,
            char_start=start if grounded else None,
            char_end=end if grounded else None,
            page_number=page_number,
            location_reference=location_reference,
            extraction_notes=notes,
            requires_review=not grounded,
        )

    return ExtractionFieldResult(
        field_name=definition.name,
        label=definition.label,
        data_type=definition.type,
        extracted_value=extracted_text or None,
        normalized_value=normalized_value,
        confidence_score=1.0 if grounded and normalized_value is not None else 0.0,
        source_text=source_text,
        char_start=start if grounded else None,
        char_end=end if grounded else None,
        page_number=page_number,
        location_reference=location_reference,
        extraction_notes=notes,
        requires_review=not grounded,
    )


def normalize_langextract_value(
    definition: ExtractionFieldDefinition | None, extracted_text: str, attributes: dict[str, Any]
) -> Any:
    raw_value = attributes.get("value", extracted_text)
    if definition is None:
        return {"value": extracted_text} if extracted_text else None

    field_type = definition.type.value
    if field_type in {"text", "paragraph", "category", "citation_backed_answer"}:
        value = stringify_langextract_value(raw_value)
        return {"value": value} if value else None

    if field_type == "date":
        value = stringify_langextract_value(raw_value)
        return {"value": value, "display_value": value} if value else None

    if field_type == "number":
        number = parse_number(raw_value)
        return {"value": number} if number is not None else None

    if field_type == "currency":
        amount = parse_currency_amount(raw_value if raw_value else extracted_text)
        if amount is None:
            return None
        currency = stringify_langextract_value(attributes.get("currency")) or definition.validation.currency or "USD"
        display_value = extracted_text or f"{currency} {amount:,.2f}"
        return {
            "amount": amount,
            "currency": currency,
            "display_value": display_value,
        }

    if field_type == "boolean":
        boolean = parse_boolean(raw_value)
        return boolean

    if field_type in {"list", "multi_select"}:
        if isinstance(raw_value, list):
            values = [str(item).strip() for item in raw_value if str(item).strip()]
        else:
            values = [part.strip() for part in str(raw_value).split(",") if part.strip()]
        return {"value": values} if values else None

    if field_type in {"json_object", "structured_object", "table"}:
        if attributes:
            return attributes
        return {"value": extracted_text} if extracted_text else None

    return {"value": stringify_langextract_value(raw_value)} if stringify_langextract_value(raw_value) else None


def infer_page_reference(text: str, start_pos: int | None) -> tuple[int | None, str]:
    if start_pos is None:
        return None, ""
    marker = None
    for match in PAGE_MARKER_PATTERN.finditer(text):
        if match.start() > start_pos:
            break
        marker = match
    if marker is None:
        return None, ""
    page = int(marker.group("page"))
    return page, f"Page {page}"


def stringify_langextract_value(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(str(item) for item in value if str(item).strip()).strip()
    return str(value).strip() if value is not None else ""


def parse_currency_amount(value: Any) -> float | None:
    candidate = stringify_langextract_value(value)
    match = CURRENCY_PATTERN.search(candidate)
    if not match:
        return None
    return float(match.group(1).replace(",", ""))


def parse_number(value: Any) -> float | None:
    candidate = stringify_langextract_value(value)
    match = NUMBER_PATTERN.search(candidate)
    if not match:
        return None
    return float(match.group(0))


def parse_boolean(value: Any) -> bool | None:
    candidate = stringify_langextract_value(value).lower()
    if candidate in {"true", "yes", "y", "1"}:
        return True
    if candidate in {"false", "no", "n", "0"}:
        return False
    return None


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
{text}

Extraction Template:
{json.dumps(template.model_dump(mode="json"), indent=2)}
"""


def split_text_into_chunks(text: str, chunk_size: int, overlap: int = 500) -> list[str]:
    normalized = text.strip()
    if not normalized:
        return [""]

    if chunk_size <= 0 or len(normalized) <= chunk_size:
        return [normalized]

    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(start + chunk_size, len(normalized))
        if end < len(normalized):
            last_break = max(
                normalized.rfind("\n\n", start, end),
                normalized.rfind("\n", start, end),
                normalized.rfind(" ", start, end),
            )
            if last_break > start + (chunk_size // 2):
                end = last_break
        chunk = normalized[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(normalized):
            break
        start = max(end - overlap, start + 1)

    return chunks or [normalized]
