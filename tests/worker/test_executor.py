from __future__ import annotations

from pathlib import Path
from unittest.mock import Mock

import httpx
import pandas as pd
import pytest

from app.services.executor import execute_extraction
from app.services.parser import parse_document
from app.services.provider import AzureOpenAIAdapter, ExtractionProvider, OpenAICompatibleAdapter
from app.services.validator import validate_extracted_field
from extraction_core.models import ExtractionFieldDefinition, ExtractionFieldResult, ExtractionTemplate, LLMProviderSettings

from tests.support.sample_data import build_template_definition


def test_execute_extraction_runs_mock_pipeline_and_calculates_fields(tmp_path) -> None:
    document = tmp_path / "invoice.txt"
    document.write_text("Vendor Name: Acme Corp\nInvoice total is $1200.00", encoding="utf-8")

    result = execute_extraction(str(document), 42, build_template_definition())

    assert result["document_id"] == "42"
    assert result["extraction_status"] == "completed"
    assert result["calculated_fields"][0]["calculated_value"] == {"amount": 1320.0, "currency": "USD"}
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
    assert captured["url"] == "https://example.openai.azure.com/openai/deployments/doc-extract-prod/chat/completions?api-version=2024-10-21"
    assert captured["headers"] == {"Content-Type": "application/json", "api-key": "azure-token"}
