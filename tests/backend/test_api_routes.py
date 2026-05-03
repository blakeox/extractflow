from __future__ import annotations
from pathlib import Path
from unittest.mock import Mock

import pytest

from app.db.database import SessionLocal
from app.models import Document, ExtractionJob, ExtractionResult, Template, TemplateVersion

from tests.support.sample_data import build_template_definition


def test_template_creation_lists_latest_version(client) -> None:
    payload = {
        "name": "Invoice Schema",
        "description": "Invoice extraction schema.",
        "document_type": "invoice",
        "definition": build_template_definition(),
    }

    create_response = client.post("/api/templates", json=payload)
    assert create_response.status_code == 200
    created = create_response.json()
    assert created["name"] == "Invoice Schema"
    assert created["latest_version"] == "1.0.0"

    list_response = client.get("/api/templates")
    assert list_response.status_code == 200
    assert list_response.json()[0]["name"] == "Invoice Schema"


def test_template_creation_rejects_duplicate_names(client) -> None:
    payload = {
        "name": "Invoice Schema",
        "description": "Invoice extraction schema.",
        "document_type": "invoice",
        "definition": build_template_definition(),
    }

    first = client.post("/api/templates", json=payload)
    second = client.post("/api/templates", json=payload)

    assert first.status_code == 200
    assert second.status_code == 409
    assert second.json()["detail"] == "Template name already exists."


def test_document_upload_and_job_creation(client) -> None:
    template_payload = {
        "name": "Invoice Schema",
        "description": "Invoice extraction schema.",
        "document_type": "invoice",
        "definition": build_template_definition(),
    }
    client.post("/api/templates", json=template_payload)

    upload_response = client.post(
        "/api/documents",
        files={"file": ("invoice.txt", b"Vendor Name: Acme\nTotal Amount: $1200.00", "text/plain")},
    )
    assert upload_response.status_code == 200
    document = upload_response.json()
    assert document["status"] == "uploaded"

    with SessionLocal() as db:
        version = db.query(TemplateVersion).one()

    job_response = client.post(
        "/api/jobs",
        json={"document_id": document["id"], "template_version_id": version.id},
    )
    assert job_response.status_code == 200
    assert job_response.json()["status"] == "queued"


def test_job_creation_rejects_missing_document_or_template(client) -> None:
    response = client.post(
        "/api/jobs",
        json={"document_id": 999, "template_version_id": 999},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Document or template version not found."


def test_review_and_export_flow_updates_result_and_writes_file(client) -> None:
    template_definition = build_template_definition()

    with SessionLocal() as db:
        template = Template(name="Invoice Schema", description="Invoice extraction schema.", document_type="invoice")
        db.add(template)
        db.flush()
        version = TemplateVersion(template_id=template.id, version="1.0.0", definition=template_definition)
        db.add(version)
        db.flush()
        document = Document(
            original_filename="invoice.txt",
            content_type="text/plain",
            stored_path=str(Path("invoice.txt")),
            status="completed",
        )
        db.add(document)
        db.flush()
        job = ExtractionJob(document_id=document.id, template_version_id=version.id, status="completed")
        db.add(job)
        db.flush()
        result = ExtractionResult(
            job_id=job.id,
            result_json={
                "document_id": str(document.id),
                "document_type": "invoice",
                "template_name": "Invoice Extraction",
                "template_version": "1.0.0",
                "llm_provider": template_definition["llm_provider_settings"],
                "extraction_status": "completed",
                "extracted_fields": [
                    {
                        "field_name": "vendor_name",
                        "label": "Vendor Name",
                        "field_kind": "extracted",
                        "data_type": "text",
                        "extracted_value": "Acme Corp",
                        "normalized_value": {"value": "Acme Corp"},
                        "confidence_score": 0.42,
                        "source_text": "Acme Corp",
                        "page_number": 1,
                        "location_reference": "Page 1",
                        "validation_status": "invalid",
                        "validation_errors": ["Required field is missing."],
                        "extraction_notes": "Mock extraction used.",
                        "requires_review": True,
                    }
                ],
                "calculated_fields": [
                    {
                        "field_name": "amount_with_buffer",
                        "label": "Amount With Buffer",
                        "field_kind": "calculated",
                        "output_type": "currency",
                        "formula": "coalesce(total_amount.amount, 0) * 1.10",
                        "depends_on": ["total_amount"],
                        "calculated_value": {"amount": 0, "currency": "USD"},
                        "display_value": "USD 0.00",
                        "validation_status": "valid",
                        "validation_errors": [],
                        "calculation_notes": "Deterministic formula evaluation.",
                        "requires_review": False,
                    }
                ],
                "fields_requiring_review": ["vendor_name"],
                "document_level_notes": [],
                "reviewed_at": None,
            },
        )
        db.add(result)
        db.commit()
        result_id = result.id

    review_response = client.post(
        f"/api/results/{result_id}/review",
        json={
            "reviewer": "qa-user",
            "edits": [
                {
                    "field_name": "vendor_name",
                    "normalized_value": {"value": "Acme Corporation"},
                    "reason": "Normalized vendor spelling.",
                }
            ],
            "recalculate": False,
        },
    )
    assert review_response.status_code == 200
    assert review_response.json()["extracted_fields"][0]["normalized_value"] == {"value": "Acme Corporation"}

    export_response = client.post(f"/api/results/{result_id}/exports/json")
    assert export_response.status_code == 200
    export_payload = export_response.json()
    assert Path(export_payload["path"]).exists()


def test_review_recalculation_updates_calculated_fields(client) -> None:
    template_definition = build_template_definition()

    with SessionLocal() as db:
        template = Template(name="Invoice Schema", description="Invoice extraction schema.", document_type="invoice")
        db.add(template)
        db.flush()
        version = TemplateVersion(template_id=template.id, version="1.0.0", definition=template_definition)
        db.add(version)
        db.flush()
        document = Document(
            original_filename="invoice.txt",
            content_type="text/plain",
            stored_path=str(Path("invoice.txt")),
            status="completed",
        )
        db.add(document)
        db.flush()
        job = ExtractionJob(document_id=document.id, template_version_id=version.id, status="completed")
        db.add(job)
        db.flush()
        result = ExtractionResult(
            job_id=job.id,
            result_json={
                "document_id": str(document.id),
                "document_type": "invoice",
                "template_name": "Invoice Extraction",
                "template_version": "1.0.0",
                "llm_provider": template_definition["llm_provider_settings"],
                "extraction_status": "completed",
                "extracted_fields": [
                    {
                        "field_name": "vendor_name",
                        "label": "Vendor Name",
                        "field_kind": "extracted",
                        "data_type": "text",
                        "extracted_value": "Acme Corp",
                        "normalized_value": {"value": "Acme Corp"},
                        "confidence_score": 0.42,
                        "source_text": "Acme Corp",
                        "page_number": 1,
                        "location_reference": "Page 1",
                        "validation_status": "valid",
                        "validation_errors": [],
                        "extraction_notes": "Mock extraction used.",
                        "requires_review": True,
                    },
                    {
                        "field_name": "total_amount",
                        "label": "Total Amount",
                        "field_kind": "extracted",
                        "data_type": "currency",
                        "extracted_value": "$1,200.00",
                        "normalized_value": {"amount": 1200, "currency": "USD", "display_value": "$1,200.00"},
                        "confidence_score": 0.91,
                        "source_text": "$1,200.00",
                        "page_number": 1,
                        "location_reference": "Page 1",
                        "validation_status": "valid",
                        "validation_errors": [],
                        "extraction_notes": "Extracted successfully.",
                        "requires_review": False,
                    },
                ],
                "calculated_fields": [
                    {
                        "field_name": "amount_with_buffer",
                        "label": "Amount With Buffer",
                        "field_kind": "calculated",
                        "output_type": "currency",
                        "formula": "coalesce(total_amount.amount, 0) * 1.10",
                        "depends_on": ["total_amount"],
                        "calculated_value": {"amount": 1320, "currency": "USD"},
                        "display_value": "USD 1320.00",
                        "validation_status": "valid",
                        "validation_errors": [],
                        "calculation_notes": "Deterministic formula evaluation.",
                        "requires_review": False,
                    }
                ],
                "fields_requiring_review": ["vendor_name"],
                "document_level_notes": [],
                "reviewed_at": None,
            },
        )
        db.add(result)
        db.commit()
        result_id = result.id

    review_response = client.post(
        f"/api/results/{result_id}/review",
        json={
            "reviewer": "qa-user",
            "edits": [
                {
                    "field_name": "total_amount",
                    "normalized_value": {"amount": 1500, "currency": "USD", "display_value": "$1,500.00"},
                    "reason": "Adjusted to approved total.",
                }
            ],
            "recalculate": True,
        },
    )

    assert review_response.status_code == 200
    calculated = review_response.json()["calculated_fields"][0]
    assert calculated["calculated_value"] == pytest.approx(1650.0)
    assert calculated["validation_status"] == "reviewed"


def test_export_routes_cover_csv_excel_and_invalid_format(client) -> None:
    template_definition = build_template_definition()

    with SessionLocal() as db:
        template = Template(name="Invoice Schema", description="Invoice extraction schema.", document_type="invoice")
        db.add(template)
        db.flush()
        version = TemplateVersion(template_id=template.id, version="1.0.0", definition=template_definition)
        db.add(version)
        db.flush()
        document = Document(
            original_filename="invoice.txt",
            content_type="text/plain",
            stored_path=str(Path("invoice.txt")),
            status="completed",
        )
        db.add(document)
        db.flush()
        job = ExtractionJob(document_id=document.id, template_version_id=version.id, status="completed")
        db.add(job)
        db.flush()
        result = ExtractionResult(
            job_id=job.id,
            result_json={
                "document_id": str(document.id),
                "document_type": "invoice",
                "template_name": "Invoice Extraction",
                "template_version": "1.0.0",
                "llm_provider": template_definition["llm_provider_settings"],
                "extraction_status": "completed",
                "extracted_fields": [
                    {
                        "field_name": "vendor_name",
                        "label": "Vendor Name",
                        "field_kind": "extracted",
                        "data_type": "text",
                        "extracted_value": "Acme Corp",
                        "normalized_value": {"value": "Acme Corp"},
                        "confidence_score": 0.42,
                        "source_text": "Acme Corp",
                        "page_number": 1,
                        "location_reference": "Page 1",
                        "validation_status": "valid",
                        "validation_errors": [],
                        "extraction_notes": "Mock extraction used.",
                        "requires_review": False,
                    }
                ],
                "calculated_fields": [],
                "fields_requiring_review": [],
                "document_level_notes": [],
                "reviewed_at": None,
            },
        )
        db.add(result)
        db.commit()
        result_id = result.id

    csv_response = client.post(f"/api/results/{result_id}/exports/csv")
    excel_response = client.post(f"/api/results/{result_id}/exports/excel")

    assert csv_response.status_code == 200
    assert excel_response.status_code == 200

    csv_path = Path(csv_response.json()["path"])
    excel_path = Path(excel_response.json()["path"])
    assert csv_path.exists()
    assert excel_path.exists()
    assert "vendor_name" in csv_path.read_text(encoding="utf-8")

    with pytest.raises(ValueError, match="Unsupported export format: xml"):
        client.post(f"/api/results/{result_id}/exports/xml")


def test_provider_settings_round_trip(client) -> None:
    payload = {
        "settings": {
            "mode": "local",
            "provider_type": "mock",
            "base_url": None,
            "model": "mock-extractor",
            "temperature": 0.1,
            "max_tokens": 4000,
            "supports_json_mode": True,
            "allow_external_processing": False,
            "timeout_seconds": 120,
            "retry_count": 2,
            "chunk_size": 16000,
        }
    }

    put_response = client.put("/api/settings/provider", json=payload)
    assert put_response.status_code == 200
    get_response = client.get("/api/settings/provider")
    assert get_response.status_code == 200
    assert get_response.json()["provider_type"] == "mock"


def test_provider_catalog_lists_remote_and_local_options(client) -> None:
    response = client.get("/api/settings/providers")
    assert response.status_code == 200
    payload = response.json()
    provider_types = {item["provider_type"] for item in payload["providers"]}

    assert {"mock", "ollama", "lm_studio", "openai", "azure_openai", "deepseek", "kimi"}.issubset(provider_types)


def test_provider_health_reports_missing_cloud_credentials(client) -> None:
    response = client.get("/api/settings/providers/health")
    assert response.status_code == 200
    payload = response.json()
    health_by_type = {item["provider_type"]: item for item in payload}

    assert health_by_type["mock"]["ready"] is True
    assert health_by_type["azure_openai"]["ready"] is False
    assert "Missing environment variable AZURE_OPENAI_API_KEY" in health_by_type["azure_openai"]["checks"]


def test_provider_probe_reports_not_ready_when_key_missing(client) -> None:
    response = client.post(
        "/api/settings/providers/probe",
        json={
            "settings": {
                "mode": "cloud",
                "provider_type": "openai",
                "provider_label": "OpenAI",
                "api_style": "openai_compatible",
                "base_url": "https://api.openai.com/v1",
                "api_key_env_var": "OPENAI_API_KEY",
                "api_key_required": True,
                "model": "gpt-4.1",
                "temperature": 0.1,
                "max_tokens": 4000,
                "supports_json_mode": True,
                "allow_external_processing": True,
                "timeout_seconds": 120,
                "retry_count": 2,
                "chunk_size": 16000,
            }
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "not_ready"
    assert "OPENAI_API_KEY" in response.json()["detail"]


def test_provider_probe_reports_reachable_response(client, monkeypatch) -> None:
    mock_response = Mock()
    mock_response.status_code = 200

    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str, headers: dict):
            return mock_response

    monkeypatch.setattr("app.services.provider_probe.httpx.Client", FakeClient)

    response = client.post(
        "/api/settings/providers/probe",
        json={
            "settings": {
                "mode": "local",
                "provider_type": "ollama",
                "provider_label": "Ollama",
                "api_style": "openai_compatible",
                "base_url": "http://host.docker.internal:11434/v1",
                "api_key_required": False,
                "model": "qwen3.5:27b",
                "temperature": 0.1,
                "max_tokens": 4000,
                "supports_json_mode": True,
                "allow_external_processing": False,
                "timeout_seconds": 120,
                "retry_count": 2,
                "chunk_size": 16000,
            }
        },
    )

    assert response.status_code == 200
    assert response.json()["reachable"] is True
    assert response.json()["status_code"] == 200


def test_custom_provider_profile_crud_and_activation(client) -> None:
    payload = {
        "name": "Private Gateway",
        "settings": {
            "mode": "local",
            "provider_type": "private_gateway",
            "provider_label": "Private Gateway",
            "api_style": "openai_compatible",
            "base_url": "http://localhost:8001/v1",
            "api_key_env_var": None,
            "api_key_required": False,
            "deployment": None,
            "api_version": None,
            "model": "document-extractor-default",
            "temperature": 0.1,
            "max_tokens": 4000,
            "supports_json_mode": True,
            "allow_external_processing": False,
            "timeout_seconds": 120,
            "retry_count": 2,
            "chunk_size": 16000,
        },
    }

    create_response = client.post("/api/settings/providers/custom", json=payload)
    assert create_response.status_code == 200
    profile = create_response.json()
    profile_id = profile["id"]
    assert profile["name"] == "Private Gateway"

    list_response = client.get("/api/settings/providers/custom")
    assert list_response.status_code == 200
    assert list_response.json()["profiles"][0]["name"] == "Private Gateway"

    update_response = client.put(
        f"/api/settings/providers/custom/{profile_id}",
        json={
            "name": "Private Gateway Updated",
            "settings": {
                **payload["settings"],
                "model": "document-extractor-v2",
            },
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["name"] == "Private Gateway Updated"
    assert update_response.json()["settings"]["model"] == "document-extractor-v2"

    activate_response = client.post(f"/api/settings/providers/custom/{profile_id}/activate")
    assert activate_response.status_code == 200
    assert activate_response.json()["provider_type"] == "private_gateway"
    assert client.get("/api/settings/provider").json()["model"] == "document-extractor-v2"

    delete_response = client.delete(f"/api/settings/providers/custom/{profile_id}")
    assert delete_response.status_code == 200
    assert delete_response.json()["deleted"] is True
    assert client.get("/api/settings/providers/custom").json()["profiles"] == []


def test_review_requires_at_least_one_edit(client) -> None:
    response = client.post(
        "/api/results/1/review",
        json={"reviewer": "qa-user", "edits": [], "recalculate": True},
    )

    assert response.status_code == 422
