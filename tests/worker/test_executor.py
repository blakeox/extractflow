from __future__ import annotations

from unittest.mock import Mock

import httpx
import pandas as pd
import pytest
from app.services import parser as parser_service
from app.services import provider as provider_service
from app.services.executor import execute_extraction
from app.services.parser import parse_document
from app.services.provider import AzureOpenAIAdapter, ExtractionProvider, OpenAICompatibleAdapter
from app.services.validator import validate_extracted_field
from extraction_core.models import (
    ExtractionFieldDefinition,
    ExtractionFieldResult,
    ExtractionTemplate,
    LLMProviderSettings,
)
from pydantic import ValidationError

from tests.support.sample_data import build_template_definition


def test_execute_extraction_runs_mock_pipeline_and_calculates_fields(tmp_path) -> None:
    document = tmp_path / "invoice.txt"
    document.write_text("Vendor Name: Acme Corp\nInvoice total is $1200.00", encoding="utf-8")

    result = execute_extraction(str(document), 42, build_template_definition())

    assert result["document_id"] == "42"
    assert result["extraction_status"] == "completed"
    assert result["calculated_fields"][0]["calculated_value"] == {"amount": 1320.0, "currency": "USD"}
    assert "vendor_name" in result["fields_requiring_review"]


def test_execute_extraction_reconciles_fields_by_name_and_marks_missing(monkeypatch, tmp_path) -> None:
    document = tmp_path / "statement.txt"
    document.write_text("Vendor Name: Acme Corp", encoding="utf-8")

    def fake_extract(self, text, template, settings):
        return [
            ExtractionFieldResult(
                field_name="total_amount",
                label="Total Amount",
                data_type="currency",
                extracted_value="$1,200.00",
                normalized_value={"amount": 1200, "currency": "USD", "display_value": "$1,200.00"},
                confidence_score=0.92,
                source_text="$1,200.00",
                page_number=3,
                location_reference="Page 3",
            ),
            ExtractionFieldResult(
                field_name="unexpected_field",
                label="Unexpected",
                data_type="text",
                extracted_value="ignore me",
                normalized_value={"value": "ignore me"},
                confidence_score=0.99,
                source_text="ignore me",
                page_number=1,
                location_reference="Page 1",
            ),
        ]

    monkeypatch.setattr(ExtractionProvider, "extract", fake_extract)

    result = execute_extraction(str(document), 99, build_template_definition())

    extracted_fields = {field["field_name"]: field for field in result["extracted_fields"]}
    assert list(extracted_fields) == ["vendor_name", "total_amount"]
    assert extracted_fields["total_amount"]["page_number"] == 3
    assert extracted_fields["vendor_name"]["normalized_value"] is None
    assert extracted_fields["vendor_name"]["validation_status"] == "invalid"
    assert "Required field is missing." in extracted_fields["vendor_name"]["validation_errors"]
    assert "unexpected_field" in result["document_level_notes"][0]


def test_execute_extraction_marks_multiple_candidates_for_review(monkeypatch, tmp_path) -> None:
    document = tmp_path / "statement.txt"
    document.write_text("Vendor Name: Acme Corp", encoding="utf-8")

    def fake_extract(self, text, template, settings):
        return [
            ExtractionFieldResult(
                field_name="vendor_name",
                label="Vendor Name",
                data_type="text",
                extracted_value="Acme Corp",
                normalized_value={"value": "Acme Corp"},
                confidence_score=0.94,
                source_text="Acme Corp",
                page_number=1,
                location_reference="Page 1",
                extraction_notes="First candidate.",
            ),
            ExtractionFieldResult(
                field_name="vendor_name",
                label="Vendor Name",
                data_type="text",
                extracted_value="Acme Corporation",
                normalized_value={"value": "Acme Corporation"},
                confidence_score=0.82,
                source_text="Acme Corporation",
                page_number=2,
                location_reference="Page 2",
                extraction_notes="Second candidate.",
            ),
            ExtractionFieldResult(
                field_name="total_amount",
                label="Total Amount",
                data_type="currency",
                extracted_value="$1,200.00",
                normalized_value={"amount": 1200, "currency": "USD", "display_value": "$1,200.00"},
                confidence_score=0.92,
                source_text="$1,200.00",
                page_number=3,
                location_reference="Page 3",
            ),
        ]

    monkeypatch.setattr(ExtractionProvider, "extract", fake_extract)

    result = execute_extraction(str(document), 99, build_template_definition())

    extracted_fields = {field["field_name"]: field for field in result["extracted_fields"]}
    vendor = extracted_fields["vendor_name"]

    assert vendor["normalized_value"] == {"value": "Acme Corp"}
    assert vendor["requires_review"] is True
    assert "Selected highest-confidence match from 2 chunk candidates." in vendor["extraction_notes"]
    assert "vendor_name" in result["fields_requiring_review"]


def test_validate_extracted_field_applies_required_allowed_and_regex_rules() -> None:
    field = ExtractionFieldDefinition.model_validate(
        {
            "name": "invoice_id",
            "label": "Invoice ID",
            "description": "Invoice identifier.",
            "type": "text",
            "required": True,
            "allowed_values": ["INV-100"],
            "validation": {"allow_null": False, "regex": r"^INV-\d+$", "max_length": 10},
        }
    )
    result = ExtractionFieldResult(
        field_name="invoice_id",
        label="Invoice ID",
        data_type="text",
        extracted_value="BAD-TOO-LONG",
        normalized_value="BAD-TOO-LONG",
    )

    validated = validate_extracted_field(field, result)

    assert validated.validation_status == "invalid"
    assert "Value is outside allowed values." in validated.validation_errors
    assert "Value does not match required pattern." in validated.validation_errors
    assert "Value exceeds maximum length." in validated.validation_errors


def test_parse_document_reads_csv_and_unknown_text_extensions(tmp_path) -> None:
    csv_path = tmp_path / "invoice.csv"
    pd.DataFrame([{"vendor": "Acme", "amount": 1200}]).to_csv(csv_path, index=False)
    note_path = tmp_path / "notes.custom"
    note_path.write_text("custom text input", encoding="utf-8")

    csv_text = parse_document(str(csv_path))
    fallback_text = parse_document(str(note_path))

    assert "vendor,amount" in csv_text
    assert "Acme,1200" in csv_text
    assert fallback_text == "custom text input"


def test_parse_pdf_uses_ocr_when_embedded_text_is_missing(monkeypatch, tmp_path) -> None:
    pdf_path = tmp_path / "scan.pdf"
    pdf_path.write_bytes(b"%PDF-1.4")

    class FakePage:
        def extract_text(self) -> str:
            return ""

    class FakeReader:
        def __init__(self, path: str):
            self.pages = [FakePage()]

    monkeypatch.setattr(parser_service, "PdfReader", FakeReader)
    monkeypatch.setattr(parser_service, "parse_pdf_with_ocr", lambda path: "[Page 1]\nDetected account number")

    parsed = parse_document(str(pdf_path))

    assert "Detected account number" in parsed


def test_langextract_adapter_maps_grounded_extractions(monkeypatch) -> None:
    provider = ExtractionProvider()
    template = ExtractionTemplate.model_validate(build_template_definition())
    template.llm_provider_settings = LLMProviderSettings(
        mode="local",
        provider_type="langextract",
        provider_label="LangExtract (Ollama)",
        api_style="langextract",
        base_url="http://host.docker.internal:11434/v1",
        model="qwen3.5:27b",
        supports_json_mode=False,
        allow_external_processing=False,
    )
    settings = template.llm_provider_settings
    source_text = "[Page 1]\nVendor Name: Acme Corp\n\n[Page 2]\nTotal Due: $1,200.00"
    captured: dict[str, object] = {}

    class FakeCharInterval:
        def __init__(self, start_pos: int, end_pos: int):
            self.start_pos = start_pos
            self.end_pos = end_pos

    class FakeExtraction:
        def __init__(self, extraction_class: str, extraction_text: str, start_pos: int, end_pos: int, attributes=None):
            self.extraction_class = extraction_class
            self.extraction_text = extraction_text
            self.char_interval = FakeCharInterval(start_pos, end_pos)
            self.attributes = attributes or {}

    class FakeAnnotatedDocument:
        def __init__(self, extractions):
            self.extractions = extractions

    class FakeLangExtractModule:
        @staticmethod
        def extract(**kwargs):
            captured["text"] = kwargs["text_or_documents"]
            vendor_start = source_text.index("Acme Corp")
            amount_start = source_text.index("$1,200.00")
            return FakeAnnotatedDocument(
                [
                    FakeExtraction("vendor_name", "Acme Corp", vendor_start, vendor_start + len("Acme Corp")),
                    FakeExtraction("total_amount", "$1,200.00", amount_start, amount_start + len("$1,200.00")),
                ]
            )

    class FakeExampleData:
        def __init__(self, text: str, extractions):
            self.text = text
            self.extractions = extractions

    class FakeExampleExtraction:
        def __init__(self, extraction_class: str, extraction_text: str, attributes=None):
            self.extraction_class = extraction_class
            self.extraction_text = extraction_text
            self.attributes = attributes

    class FakeOllamaLanguageModel:
        def __init__(self, **kwargs):
            captured["model_kwargs"] = kwargs

    monkeypatch.setattr(
        "app.services.provider._import_langextract",
        lambda: (
            FakeLangExtractModule,
            FakeExampleData,
            FakeExampleExtraction,
            FakeOllamaLanguageModel,
        ),
    )

    results = provider.extract(source_text, template, settings)

    assert captured["text"] == source_text
    assert captured["model_kwargs"]["model_url"] == "http://host.docker.internal:11434"
    assert {item.field_name for item in results} == {"vendor_name", "total_amount"}
    vendor = next(item for item in results if item.field_name == "vendor_name")
    amount = next(item for item in results if item.field_name == "total_amount")
    assert vendor.source_text == "Acme Corp"
    assert vendor.char_start == source_text.index("Acme Corp")
    assert vendor.char_end == source_text.index("Acme Corp") + len("Acme Corp")
    assert vendor.page_number == 1
    assert amount.page_number == 2
    assert amount.char_start == source_text.index("$1,200.00")
    assert amount.char_end == source_text.index("$1,200.00") + len("$1,200.00")
    assert amount.normalized_value == {
        "amount": 1200.0,
        "currency": "USD",
        "display_value": "$1,200.00",
    }
    assert "grounded chars" in amount.extraction_notes


def test_langextract_adapter_bypasses_outer_chunking_and_keeps_global_offsets(monkeypatch) -> None:
    provider = ExtractionProvider()
    template = ExtractionTemplate.model_validate(build_template_definition())
    template.llm_provider_settings = LLMProviderSettings(
        mode="local",
        provider_type="langextract",
        provider_label="LangExtract (Ollama)",
        api_style="langextract",
        base_url="http://host.docker.internal:11434/v1",
        model="qwen3.5:27b",
        supports_json_mode=False,
        allow_external_processing=False,
        chunk_size=4,
    )
    settings = template.llm_provider_settings
    source_text = "[Page 1]\nIntro text\n\n[Page 2]\nVendor Name: Acme Corp"
    captured: dict[str, object] = {"calls": 0}

    class FakeCharInterval:
        def __init__(self, start_pos: int, end_pos: int):
            self.start_pos = start_pos
            self.end_pos = end_pos

    class FakeExtraction:
        def __init__(self, extraction_class: str, extraction_text: str, start_pos: int, end_pos: int):
            self.extraction_class = extraction_class
            self.extraction_text = extraction_text
            self.char_interval = FakeCharInterval(start_pos, end_pos)
            self.attributes = {"value": extraction_text}

    class FakeAnnotatedDocument:
        def __init__(self, extractions):
            self.extractions = extractions

    class FakeLangExtractModule:
        @staticmethod
        def extract(**kwargs):
            captured["calls"] = int(captured["calls"]) + 1
            captured["text"] = kwargs["text_or_documents"]
            vendor_start = source_text.index("Acme Corp")
            return FakeAnnotatedDocument(
                [FakeExtraction("vendor_name", "Acme Corp", vendor_start, vendor_start + len("Acme Corp"))]
            )

    class FakeExampleData:
        def __init__(self, text: str, extractions):
            self.text = text
            self.extractions = extractions

    class FakeExampleExtraction:
        def __init__(self, extraction_class: str, extraction_text: str, attributes=None):
            self.extraction_class = extraction_class
            self.extraction_text = extraction_text
            self.attributes = attributes

    class FakeOllamaLanguageModel:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    monkeypatch.setattr(
        provider_service,
        "split_text_into_chunks",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("LangExtract should not use outer chunking")),
    )
    monkeypatch.setattr(
        "app.services.provider._import_langextract",
        lambda: (
            FakeLangExtractModule,
            FakeExampleData,
            FakeExampleExtraction,
            FakeOllamaLanguageModel,
        ),
    )

    results = provider.extract(source_text, template, settings)

    assert captured["calls"] == 1
    assert captured["text"] == source_text
    vendor = results[0]
    assert vendor.page_number == 2
    assert vendor.char_start == source_text.index("Acme Corp")
    assert vendor.char_end == source_text.index("Acme Corp") + len("Acme Corp")


def test_execute_extraction_marks_ungrounded_langextract_results_for_review(monkeypatch, tmp_path) -> None:
    document = tmp_path / "invoice.txt"
    document.write_text("Vendor Name: Acme Corp", encoding="utf-8")
    definition = build_template_definition()
    definition["llm_provider_settings"] = {
        **definition["llm_provider_settings"],
        "mode": "local",
        "provider_type": "langextract",
        "provider_label": "LangExtract (Ollama)",
        "api_style": "langextract",
        "base_url": "http://host.docker.internal:11434/v1",
        "model": "qwen3.5:27b",
        "supports_json_mode": False,
        "allow_external_processing": False,
    }
    definition["calculated_fields"] = []

    class FakeExtraction:
        def __init__(self, extraction_class: str, extraction_text: str, attributes=None):
            self.extraction_class = extraction_class
            self.extraction_text = extraction_text
            self.attributes = attributes or {"value": extraction_text}

    class FakeAnnotatedDocument:
        def __init__(self, extractions):
            self.extractions = extractions

    class FakeLangExtractModule:
        @staticmethod
        def extract(**kwargs):
            return FakeAnnotatedDocument([FakeExtraction("vendor_name", "Acme Corp")])

    class FakeExampleData:
        def __init__(self, text: str, extractions):
            self.text = text
            self.extractions = extractions

    class FakeExampleExtraction:
        def __init__(self, extraction_class: str, extraction_text: str, attributes=None):
            self.extraction_class = extraction_class
            self.extraction_text = extraction_text
            self.attributes = attributes

    class FakeOllamaLanguageModel:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    monkeypatch.setattr(
        "app.services.provider._import_langextract",
        lambda: (
            FakeLangExtractModule,
            FakeExampleData,
            FakeExampleExtraction,
            FakeOllamaLanguageModel,
        ),
    )

    result = execute_extraction(str(document), 42, definition)

    vendor = next(field for field in result["extracted_fields"] if field["field_name"] == "vendor_name")
    assert vendor["source_text"] == ""
    assert vendor["confidence_score"] == 0.0
    assert vendor["requires_review"] is True
    assert "Citation evidence is required." in vendor["validation_errors"]
    assert "vendor_name" in result["fields_requiring_review"]


def test_langextract_adapter_requires_template_examples() -> None:
    provider = ExtractionProvider()
    definition = build_template_definition()
    definition["langextract_config"] = None
    template = ExtractionTemplate.model_validate(definition)
    settings = LLMProviderSettings(
        mode="local",
        provider_type="langextract",
        provider_label="LangExtract (Ollama)",
        api_style="langextract",
        base_url="http://host.docker.internal:11434/v1",
        model="qwen3.5:27b",
        supports_json_mode=False,
        allow_external_processing=False,
    )

    with pytest.raises(ValueError, match="langextract_config"):
        provider.extract("Vendor Name: Acme Corp", template, settings)


def test_langextract_adapter_rejects_documents_over_configured_limit() -> None:
    provider = ExtractionProvider()
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        mode="local",
        provider_type="langextract",
        provider_label="LangExtract (Ollama)",
        api_style="langextract",
        base_url="http://host.docker.internal:11434/v1",
        model="qwen3.5:27b",
        supports_json_mode=False,
        allow_external_processing=False,
        chunk_size=16000,
        langextract_max_document_chars=12,
    )
    source_text = "Vendor Name: Acme Corp"

    with pytest.raises(
        ValueError,
        match=(
            r"LangExtract document length \d+ chars exceeds "
            r"langextract_max_document_chars=12\."
        ),
    ):
        provider.extract(source_text, template, settings)


def test_langextract_provider_settings_require_matching_identity() -> None:
    with pytest.raises(ValidationError, match="provider_type and api_style"):
        LLMProviderSettings(
            mode="local",
            provider_type="langextract",
            provider_label="LangExtract (Ollama)",
            api_style="openai_compatible",
            base_url="http://host.docker.internal:11434/v1",
            model="qwen3.5:27b",
            supports_json_mode=False,
            allow_external_processing=False,
        )


def test_llm_provider_extract_builds_request_and_parses_response(monkeypatch) -> None:
    provider = ExtractionProvider()
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        provider_type="openai",
        base_url="http://llm.local/v1",
        model="test-model",
        api_style="openai_compatible",
        supports_json_mode=False,
    )

    mock_response = Mock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {
        "choices": [
            {
                "message": {
                    "content": '{"extracted_fields":[{"field_name":"vendor_name","label":"Vendor Name","field_kind":"extracted","data_type":"text","extracted_value":"Acme Corp","normalized_value":{"value":"Acme Corp"},"confidence_score":0.9,"source_text":"Acme Corp","page_number":1,"location_reference":"Page 1","validation_status":"valid","validation_errors":[],"extraction_notes":"ok","requires_review":false}]}'
                }
            }
        ]
    }

    captured: dict[str, object] = {}

    class FakeClient:
        def __init__(self, timeout: int):
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url: str, json: dict, headers: dict):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return mock_response

    monkeypatch.setattr(httpx, "Client", FakeClient)

    results = provider.extract("Vendor Name: Acme Corp", template, settings)

    assert captured["url"] == "http://llm.local/v1/chat/completions"
    assert captured["timeout"] == 120
    assert "response_format" not in captured["json"]
    assert results[0].field_name == "vendor_name"
    assert results[0].normalized_value == {"value": "Acme Corp"}


def test_llm_provider_extract_uses_chunking_for_large_documents(monkeypatch) -> None:
    provider = ExtractionProvider()
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        provider_type="openai",
        base_url="http://llm.local/v1",
        model="test-model",
        api_style="openai_compatible",
        chunk_size=40,
    )

    captured_payloads: list[dict] = []

    class FakeResponse:
        def __init__(self, payload_index: int):
            self.payload_index = payload_index

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            if self.payload_index == 0:
                content = '{"extracted_fields":[{"field_name":"vendor_name","label":"Vendor Name","field_kind":"extracted","data_type":"text","extracted_value":"Acme Corp","normalized_value":{"value":"Acme Corp"},"confidence_score":0.9,"source_text":"Acme Corp","page_number":1,"location_reference":"Page 1","validation_status":"valid","validation_errors":[],"extraction_notes":"ok","requires_review":false}]}'
            else:
                content = '{"extracted_fields":[{"field_name":"total_amount","label":"Total Amount","field_kind":"extracted","data_type":"currency","extracted_value":"$1200.00","normalized_value":{"amount":1200,"currency":"USD","display_value":"$1200.00"},"confidence_score":0.88,"source_text":"$1200.00","page_number":2,"location_reference":"Page 2","validation_status":"valid","validation_errors":[],"extraction_notes":"ok","requires_review":false}]}'
            return {"choices": [{"message": {"content": content}}]}

    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url: str, json: dict, headers: dict):
            captured_payloads.append(json)
            return FakeResponse(len(captured_payloads) - 1)

    monkeypatch.setattr(httpx, "Client", FakeClient)

    text = "Vendor Name: Acme Corp\n" + ("x" * 60) + "\nTotal Amount: $1200.00"
    results = provider.extract(text, template, settings)

    assert len(captured_payloads) >= 2
    assert {item.field_name for item in results} == {"vendor_name", "total_amount"}


def test_llm_provider_extract_propagates_invalid_json(monkeypatch) -> None:
    provider = ExtractionProvider()
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        provider_type="openai",
        base_url="http://llm.local/v1",
        model="test-model",
        api_style="openai_compatible",
    )

    mock_response = Mock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"choices": [{"message": {"content": "not-json"}}]}

    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url: str, json: dict, headers: dict):
            return mock_response

    monkeypatch.setattr(httpx, "Client", FakeClient)

    with pytest.raises(RuntimeError, match="Provider call failed"):
        provider.extract("Vendor Name: Acme Corp", template, settings)


def test_llm_provider_extract_retries_until_timeout_exhausted(monkeypatch) -> None:
    provider = ExtractionProvider()
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        provider_type="openai",
        base_url="http://llm.local/v1",
        model="test-model",
        api_style="openai_compatible",
        retry_count=2,
    )

    attempts = {"count": 0}

    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url: str, json: dict, headers: dict):
            attempts["count"] += 1
            raise httpx.ReadTimeout("timed out")

    monkeypatch.setattr(httpx, "Client", FakeClient)

    with pytest.raises(RuntimeError, match="Provider call failed for openai"):
        provider.extract("Vendor Name: Acme Corp", template, settings)

    assert attempts["count"] == 3


def test_openai_compatible_adapter_requires_api_key_when_configured(monkeypatch) -> None:
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        mode="cloud",
        provider_type="openai",
        provider_label="OpenAI",
        api_style="openai_compatible",
        base_url="https://api.openai.com/v1",
        api_key_env_var="OPENAI_API_KEY",
        api_key_required=True,
        model="gpt-4.1",
    )

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    adapter = OpenAICompatibleAdapter()

    with pytest.raises(ValueError, match="OPENAI_API_KEY"):
        adapter.extract("Vendor Name: Acme Corp", template, settings)


def test_openai_compatible_adapter_reads_api_key_from_environment(monkeypatch) -> None:
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        mode="cloud",
        provider_type="openai",
        provider_label="OpenAI",
        api_style="openai_compatible",
        base_url="https://api.openai.com/v1",
        api_key_env_var="OPENAI_API_KEY",
        api_key_required=True,
        model="gpt-4.1",
    )

    mock_response = Mock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {
        "choices": [
            {
                "message": {
                    "content": '{"extracted_fields":[{"field_name":"vendor_name","label":"Vendor Name","field_kind":"extracted","data_type":"text","extracted_value":"Acme Corp","normalized_value":{"value":"Acme Corp"},"confidence_score":0.9,"source_text":"Acme Corp","page_number":1,"location_reference":"Page 1","validation_status":"valid","validation_errors":[],"extraction_notes":"ok","requires_review":false}]}'
                }
            }
        ]
    }

    captured: dict[str, object] = {}

    class FakeClient:
        def __init__(self, timeout: int):
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url: str, json: dict, headers: dict):
            captured["headers"] = headers
            return mock_response

    monkeypatch.setenv("OPENAI_API_KEY", "test-token")
    monkeypatch.setattr(httpx, "Client", FakeClient)

    adapter = OpenAICompatibleAdapter()
    result = adapter.extract("Vendor Name: Acme Corp", template, settings)

    assert result[0].field_name == "vendor_name"
    assert captured["headers"] == {"Content-Type": "application/json", "Authorization": "Bearer test-token"}


def test_azure_openai_adapter_builds_deployment_scoped_request(monkeypatch) -> None:
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        mode="cloud",
        provider_type="azure_openai",
        provider_label="Azure OpenAI",
        api_style="azure_openai",
        base_url="https://example.openai.azure.com",
        api_key_env_var="AZURE_OPENAI_API_KEY",
        api_key_required=True,
        deployment="doc-extract-prod",
        api_version="2024-10-21",
        model="gpt-4.1-mini",
    )

    mock_response = Mock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {
        "choices": [
            {
                "message": {
                    "content": '{"extracted_fields":[{"field_name":"vendor_name","label":"Vendor Name","field_kind":"extracted","data_type":"text","extracted_value":"Acme Corp","normalized_value":{"value":"Acme Corp"},"confidence_score":0.9,"source_text":"Acme Corp","page_number":1,"location_reference":"Page 1","validation_status":"valid","validation_errors":[],"extraction_notes":"ok","requires_review":false}]}'
                }
            }
        ]
    }

    captured: dict[str, object] = {}

    class FakeClient:
        def __init__(self, timeout: int):
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url: str, json: dict, headers: dict):
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return mock_response

    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "azure-token")
    monkeypatch.setattr(httpx, "Client", FakeClient)

    adapter = AzureOpenAIAdapter()
    result = adapter.extract("Vendor Name: Acme Corp", template, settings)

    assert result[0].field_name == "vendor_name"
    assert (
        captured["url"]
        == "https://example.openai.azure.com/openai/deployments/doc-extract-prod/chat/completions?api-version=2024-10-21"
    )
    assert captured["headers"] == {"Content-Type": "application/json", "api-key": "azure-token"}


def test_process_once_marks_job_failed_when_document_or_template_missing() -> None:
    from app.core.database import SessionLocal
    from app.main import process_once
    from app.models import ExtractionJob

    with SessionLocal() as db:
        job = ExtractionJob(document_id=999, template_version_id=999, status="queued")
        db.add(job)
        db.commit()
        job_id = job.id

    process_once()

    with SessionLocal() as db:
        refreshed = db.get(ExtractionJob, job_id)
        assert refreshed is not None
        assert refreshed.status == "failed"
        assert refreshed.error_message == "Document or template version missing."


def test_process_once_marks_job_and_document_failed_when_extraction_raises(tmp_path, monkeypatch) -> None:
    from app.core.database import SessionLocal
    from app.main import process_once
    from app.models import Document, ExtractionJob, TemplateVersion

    document_path = tmp_path / "invoice.txt"
    document_path.write_text("Vendor Name: Acme Corp", encoding="utf-8")

    with SessionLocal() as db:
        document = Document(
            original_filename="invoice.txt",
            content_type="text/plain",
            stored_path=str(document_path),
            status="uploaded",
        )
        db.add(document)
        db.flush()
        version = TemplateVersion(template_id=1, version="1.0.0", definition=build_template_definition())
        db.add(version)
        db.flush()
        job = ExtractionJob(document_id=document.id, template_version_id=version.id, status="queued")
        db.add(job)
        db.commit()
        document_id = document.id
        job_id = job.id

    def fail_execute_extraction(**kwargs):
        raise RuntimeError("provider timeout")

    monkeypatch.setattr("app.main.execute_extraction", fail_execute_extraction)

    process_once()

    with SessionLocal() as db:
        refreshed_job = db.get(ExtractionJob, job_id)
        refreshed_document = db.get(Document, document_id)
        assert refreshed_job is not None
        assert refreshed_document is not None
        assert refreshed_job.status == "failed"
        assert refreshed_job.error_message == "provider timeout"
        assert refreshed_document.status == "failed"


def test_process_once_marks_langextract_job_failed_when_document_exceeds_limit(tmp_path) -> None:
    from app.core.database import SessionLocal
    from app.main import process_once
    from app.models import Document, ExtractionJob, TemplateVersion

    document_text = "Vendor Name: Acme Corp"
    document_path = tmp_path / "invoice.txt"
    document_path.write_text(document_text, encoding="utf-8")

    definition = build_template_definition()
    definition["llm_provider_settings"] = {
        **definition["llm_provider_settings"],
        "mode": "local",
        "provider_type": "langextract",
        "provider_label": "LangExtract (Ollama)",
        "api_style": "langextract",
        "base_url": "http://host.docker.internal:11434/v1",
        "model": "qwen3.5:27b",
        "supports_json_mode": False,
        "allow_external_processing": False,
        "langextract_max_document_chars": 12,
    }

    with SessionLocal() as db:
        document = Document(
            original_filename="invoice.txt",
            content_type="text/plain",
            stored_path=str(document_path),
            status="uploaded",
        )
        db.add(document)
        db.flush()
        version = TemplateVersion(template_id=1, version="1.0.0", definition=definition)
        db.add(version)
        db.flush()
        job = ExtractionJob(document_id=document.id, template_version_id=version.id, status="queued")
        db.add(job)
        db.commit()
        document_id = document.id
        job_id = job.id

    process_once()

    expected_error = (
        "LangExtract document length "
        f"{len(document_text)} chars exceeds langextract_max_document_chars=12. "
        "LangExtract keeps grounded global offsets by using internal windowing with chunk_size=16000, "
        "but this project caps total document size to bound runtime and memory. Reduce document size or "
        "increase langextract_max_document_chars."
    )

    with SessionLocal() as db:
        refreshed_job = db.get(ExtractionJob, job_id)
        refreshed_document = db.get(Document, document_id)
        assert refreshed_job is not None
        assert refreshed_document is not None
        assert refreshed_job.status == "failed"
        assert refreshed_job.error_message == expected_error
        assert refreshed_document.status == "failed"
