from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import Mock

import httpx
from app.api import routes as api_routes
from app.core.tenant import build_tenant_setting_key, get_current_tenant_id
from app.db.database import SessionLocal
from app.main import app
from app.models import (
    Document,
    ExportRecord,
    ExtractionJob,
    ExtractionResult,
    ReviewEdit,
    Setting,
    Template,
    TemplateVersion,
)
from app.services.audit_service import record_audit_event
from app.services.storage import resolve_document_storage_path
from fastapi import HTTPException

from tests.support.sample_data import build_template_definition


def build_custom_provider_payload(
    *,
    name: str = "Private Gateway",
    mode: str = "local",
    provider_type: str = "private_gateway",
    base_url: str = "http://localhost:8001/v1",
    api_key_env_var: str | None = None,
    api_key_required: bool = False,
    model: str = "document-extractor-default",
    allow_external_processing: bool = False,
) -> dict[str, object]:
    return {
        "name": name,
        "settings": {
            "mode": mode,
            "provider_type": provider_type,
            "provider_label": name,
            "api_style": "openai_compatible",
            "base_url": base_url,
            "api_key_env_var": api_key_env_var,
            "api_key_required": api_key_required,
            "deployment": None,
            "api_version": None,
            "model": model,
            "temperature": 0.1,
            "max_tokens": 4000,
            "supports_json_mode": True,
            "allow_external_processing": allow_external_processing,
            "timeout_seconds": 120,
            "retry_count": 2,
            "chunk_size": 16000,
        },
    }


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


def test_schema_dry_run_endpoint_returns_field_validation(client) -> None:
    definition = build_template_definition()
    response = client.post(
        "/api/templates/dry-run",
        json={
            "definition": definition,
            "sample_text": "Vendor Name: Acme Corp\nTotal Due: $1,200.00",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["extracted_fields"]


def test_template_version_diff_endpoint_reports_field_changes(client) -> None:
    before = build_template_definition()
    after = build_template_definition()
    after["template_version"] = "1.1.0"
    after["extracted_fields"][0]["label"] = "Supplier Name"

    response = client.post(
        "/api/templates/version-diff",
        json={"before_definition": before, "after_definition": after},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["before_version"] == "1.0.0"
    assert payload["after_version"] == "1.1.0"
    assert payload["extracted_changed"]


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


def test_template_creation_rejects_langextract_without_examples(client) -> None:
    definition = build_template_definition()
    definition["llm_provider_settings"] = {
        **definition["llm_provider_settings"],
        "provider_type": "langextract",
        "provider_label": "LangExtract (Ollama)",
        "api_style": "langextract",
        "base_url": "http://host.docker.internal:11434/v1",
        "supports_json_mode": False,
    }
    definition["langextract_config"] = None

    response = client.post(
        "/api/templates",
        json={
            "name": "Invalid LangExtract Schema",
            "description": "Invalid config",
            "document_type": "invoice",
            "definition": definition,
        },
    )

    assert response.status_code == 422
    assert "langextract_config" in response.text


def test_template_creation_rejects_langextract_example_for_unknown_field(client) -> None:
    definition = build_template_definition()
    definition["llm_provider_settings"] = {
        **definition["llm_provider_settings"],
        "provider_type": "langextract",
        "provider_label": "LangExtract (Ollama)",
        "api_style": "langextract",
        "base_url": "http://host.docker.internal:11434/v1",
        "supports_json_mode": False,
    }
    definition["langextract_config"]["examples"][0]["extractions"][0]["extraction_class"] = "bogus_field"

    response = client.post(
        "/api/templates",
        json={
            "name": "Invalid LangExtract Schema",
            "description": "Invalid config",
            "document_type": "invoice",
            "definition": definition,
        },
    )

    assert response.status_code == 422
    assert "references unknown field 'bogus_field'" in response.text


def test_template_creation_rejects_langextract_when_required_field_lacks_example_coverage(client) -> None:
    definition = build_template_definition()
    definition["llm_provider_settings"] = {
        **definition["llm_provider_settings"],
        "provider_type": "langextract",
        "provider_label": "LangExtract (Ollama)",
        "api_style": "langextract",
        "base_url": "http://host.docker.internal:11434/v1",
        "supports_json_mode": False,
    }
    definition["langextract_config"]["examples"][0]["extractions"] = [
        definition["langextract_config"]["examples"][0]["extractions"][1]
    ]

    response = client.post(
        "/api/templates",
        json={
            "name": "Invalid LangExtract Coverage Schema",
            "description": "Missing required coverage",
            "document_type": "invoice",
            "definition": definition,
        },
    )

    assert response.status_code == 422
    assert (
        "LangExtract examples must cover every required extracted field. Missing example coverage for: vendor_name."
        in response.text
    )


def test_template_creation_rejects_invalid_field_json_schema(client) -> None:
    definition = build_template_definition()
    definition["extracted_fields"].append(
        {
            "name": "line_item",
            "label": "Line Item",
            "description": "Structured line item.",
            "type": "structured_object",
            "schema": {
                "type": "object",
                "properties": "not-an-object",
            },
        }
    )

    response = client.post(
        "/api/templates",
        json={
            "name": "Invalid JSON Schema",
            "description": "Invalid structured field schema",
            "document_type": "invoice",
            "definition": definition,
        },
    )

    assert response.status_code == 422
    assert "Field schema is not a valid JSON Schema" in response.text


def test_template_creation_rejects_invalid_calculated_field_formula(client) -> None:
    definition = build_template_definition()
    definition["calculated_fields"][0]["formula"] = "coalesce("

    response = client.post(
        "/api/templates",
        json={
            "name": "Invalid Formula Schema",
            "description": "Invalid calculated field formula",
            "document_type": "invoice",
            "definition": definition,
        },
    )

    assert response.status_code == 422
    assert "Calculated field 'amount_with_buffer' formula is invalid" in response.text


def test_template_creation_rejects_mismatched_calculated_field_depends_on(client) -> None:
    definition = build_template_definition()
    definition["calculated_fields"][0]["depends_on"] = []

    response = client.post(
        "/api/templates",
        json={
            "name": "Invalid Depends On Schema",
            "description": "Mismatched calculated field dependencies",
            "document_type": "invoice",
            "definition": definition,
        },
    )

    assert response.status_code == 422
    assert "depends_on must match referenced fields" in response.text


def test_template_creation_rejects_fields_marked_unusable_in_formulas(client) -> None:
    definition = build_template_definition()
    definition["extracted_fields"][1]["usable_in_formulas"] = False

    response = client.post(
        "/api/templates",
        json={
            "name": "Invalid Formula Field Usage",
            "description": "Formula references blocked field",
            "document_type": "invoice",
            "definition": definition,
        },
    )

    assert response.status_code == 422
    assert "not usable in formulas: total_amount" in response.text


def test_template_creation_rejects_circular_calculated_field_dependencies(client) -> None:
    definition = build_template_definition()
    definition["calculated_fields"] = [
        {
            "name": "a",
            "label": "A",
            "description": "A",
            "type": "calculated",
            "output_type": "number",
            "formula": "b + 1",
            "depends_on": ["b"],
        },
        {
            "name": "b",
            "label": "B",
            "description": "B",
            "type": "calculated",
            "output_type": "number",
            "formula": "a + 1",
            "depends_on": ["a"],
        },
    ]

    response = client.post(
        "/api/templates",
        json={
            "name": "Circular Formula Schema",
            "description": "Circular calculated field dependencies",
            "document_type": "invoice",
            "definition": definition,
        },
    )

    assert response.status_code == 422
    assert "Calculated field dependency graph is invalid" in response.text


def test_document_upload_records_audit_event(client) -> None:
    upload_response = client.post(
        "/api/documents",
        files={"file": ("invoice.txt", b"Vendor Name: Acme", "text/plain")},
    )
    assert upload_response.status_code == 200
    document_id = upload_response.json()["id"]

    audit_response = client.get(f"/api/audit/events?document_id={document_id}")
    assert audit_response.status_code == 200
    events = audit_response.json()["events"]
    assert any(event["action"] == "document.uploaded" for event in events)
    uploaded = next(event for event in events if event["action"] == "document.uploaded")
    assert uploaded["object_type"] == "document"
    assert uploaded["metadata"]["document_id"] == document_id
    assert uploaded["metadata"]["original_filename"] == "invoice.txt"


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


def test_document_parsed_text_endpoint_returns_stored_text(client) -> None:
    upload_response = client.post(
        "/api/documents",
        files={"file": ("invoice.txt", b"Vendor Name: Acme\nTotal Amount: $1200.00", "text/plain")},
    )
    assert upload_response.status_code == 200
    document_id = upload_response.json()["id"]

    parsed_reference = f"parsed/doc-{document_id}.txt"
    parsed_path = Path(os.environ["DATA_DIR"]) / parsed_reference
    parsed_path.parent.mkdir(parents=True, exist_ok=True)
    parsed_path.write_text("Parsed body for review", encoding="utf-8")

    with SessionLocal() as db:
        document = db.query(Document).filter(Document.id == document_id).one()
        document.parsed_text_path = parsed_reference
        db.commit()

    response = client.get(f"/api/documents/{document_id}/parsed-text")
    assert response.status_code == 200
    payload = response.json()
    assert payload["document_id"] == document_id
    assert payload["text"] == "Parsed body for review"
    assert payload["source"] == "parsed_file"


def test_parser_status_returns_worker_runtime_details(client) -> None:
    status_path = Path(os.environ["DATA_DIR"]) / "worker-status.json"
    status_path.write_text(
        json.dumps(
            {
                "state": "starting",
                "timestamp": "2026-05-15T12:00:00+00:00",
                "details": {
                    "docling_enabled": True,
                    "docling_prewarm": True,
                    "docling_pdf_ocr_retry": True,
                    "docling_image_ocr": False,
                    "docling_prewarm_result": {
                        "status": "completed",
                        "attempted": True,
                        "warmed_targets": ["pdf:plain"],
                    },
                },
            }
        ),
        encoding="utf-8",
    )

    response = client.get("/api/settings/parser-status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["state"] == "starting"
    assert payload["docling_enabled"] is True
    assert payload["docling_prewarm"] is True
    assert payload["docling_pdf_ocr_retry"] is True
    assert payload["docling_image_ocr"] is False
    assert payload["prewarm_status"] == "completed"
    assert payload["prewarm_attempted"] is True
    assert ".pdf" in payload["supported_extensions"]
    assert "PDF" in payload["supported_classes"]


def test_ops_metrics_returns_queue_and_status_counts(client) -> None:
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
            status="uploaded",
        )
        db.add(document)
        db.flush()
        document_id = document.id
        queued_job = ExtractionJob(document_id=document_id, template_version_id=version.id, status="queued")
        running_job = ExtractionJob(document_id=document_id, template_version_id=version.id, status="running")
        db.add_all(
            [
                queued_job,
                running_job,
                ExtractionJob(document_id=document_id, template_version_id=version.id, status="failed"),
                ExtractionJob(document_id=document_id, template_version_id=version.id, status="completed"),
            ]
        )
        db.commit()
        running_job_id = running_job.id

    status_path = Path(os.environ["DATA_DIR"]) / "worker-status.json"
    status_path.write_text(
        json.dumps(
            {
                "state": "running",
                "timestamp": "2026-05-15T12:05:00+00:00",
                "details": {"job_id": running_job_id, "document_id": document_id},
            }
        ),
        encoding="utf-8",
    )

    response = client.get("/api/ops/metrics")
    assert response.status_code == 200
    payload = response.json()
    assert payload["queue_depth"] == 2
    assert payload["failed_jobs"] == 1
    assert payload["completed_jobs"] == 1
    assert payload["jobs_by_status"]["queued"] == 1
    assert payload["jobs_by_status"]["running"] == 1
    assert payload["worker_state"] == "running"
    assert payload["worker_active_job_id"] == running_job_id


def test_admin_tenant_usage_and_suspend_flow(client) -> None:
    with SessionLocal() as db:
        template = Template(
            tenant_id="acme",
            name="Acme Template",
            description="Acme extraction template",
            document_type="invoice",
        )
        db.add(template)
        db.flush()
        version = TemplateVersion(
            tenant_id="acme",
            template_id=template.id,
            version="1.0.0",
            definition=build_template_definition(),
        )
        db.add(version)
        db.flush()
        document = Document(
            tenant_id="acme",
            original_filename="acme-invoice.txt",
            content_type="text/plain",
            stored_path="uploads/acme-invoice.txt",
            status="completed",
        )
        db.add(document)
        db.flush()
        job = ExtractionJob(
            tenant_id="acme",
            document_id=document.id,
            template_version_id=version.id,
            status="completed",
        )
        db.add(job)
        db.flush()
        result = ExtractionResult(tenant_id="acme", job_id=job.id, result_json={}, review_status="pending")
        db.add(result)
        db.flush()
        db.add(ExportRecord(tenant_id="acme", result_id=result.id, export_format="json", file_path="result-1.json"))
        db.commit()

    response = client.get("/api/admin/tenants/usage")
    assert response.status_code == 200
    tenants = response.json()["tenants"]
    acme = next(row for row in tenants if row["tenant_id"] == "acme")
    assert acme["documents"] == 1
    assert acme["jobs_completed"] == 1
    assert acme["exports"] == 1

    suspend_response = client.put(
        "/api/admin/tenants/acme/status",
        json={"suspended": True, "reason": "billing arrears"},
    )
    assert suspend_response.status_code == 200
    assert suspend_response.json()["suspended"] is True
    assert suspend_response.json()["suspension_reason"] == "billing arrears"


def test_job_creation_persists_provider_override(client) -> None:
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

    with SessionLocal() as db:
        version = db.query(TemplateVersion).one()

    provider_override = {
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

    job_response = client.post(
        "/api/jobs",
        json={
            "document_id": document["id"],
            "template_version_id": version.id,
            "provider_override": provider_override,
        },
    )
    assert job_response.status_code == 200
    assert job_response.json()["provider_override"]["provider_type"] == "openai"
    assert job_response.json()["provider_override"]["model"] == "gpt-4.1"

    with SessionLocal() as db:
        job = db.query(ExtractionJob).one()

    assert job.provider_override is not None
    for key, value in provider_override.items():
        assert job.provider_override[key] == value
    assert job.provider_override["deployment"] is None
    assert job.provider_override["api_version"] is None


def test_job_creation_rejects_langextract_override_without_template_examples(client) -> None:
    definition = build_template_definition()
    definition["langextract_config"] = None
    template_payload = {
        "name": "Invoice Schema",
        "description": "Invoice extraction schema.",
        "document_type": "invoice",
        "definition": definition,
    }
    client.post("/api/templates", json=template_payload)

    upload_response = client.post(
        "/api/documents",
        files={"file": ("invoice.txt", b"Vendor Name: Acme\nTotal Amount: $1200.00", "text/plain")},
    )
    assert upload_response.status_code == 200
    document = upload_response.json()

    with SessionLocal() as db:
        version = db.query(TemplateVersion).one()

    response = client.post(
        "/api/jobs",
        json={
            "document_id": document["id"],
            "template_version_id": version.id,
            "provider_override": {
                "mode": "local",
                "provider_type": "langextract",
                "provider_label": "LangExtract (Ollama)",
                "api_style": "langextract",
                "base_url": "http://host.docker.internal:11434/v1",
                "api_key_required": False,
                "model": "qwen3.5:27b",
                "temperature": 0.1,
                "max_tokens": 4000,
                "supports_json_mode": False,
                "allow_external_processing": False,
                "timeout_seconds": 120,
                "retry_count": 2,
                "chunk_size": 16000,
            },
        },
    )

    assert response.status_code == 422
    assert "langextract_config" in response.text


def test_job_creation_requires_successful_langextract_probe(client, monkeypatch) -> None:
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

    with SessionLocal() as db:
        version = db.query(TemplateVersion).one()

    def fail_probe(*_args, **_kwargs):
        raise HTTPException(
            status_code=400,
            detail="Job queueing blocked until provider probe succeeds. Configured Ollama model 'qwen3.5:27b' is not available.",
        )

    monkeypatch.setattr("app.api.routes.require_reachable_provider", fail_probe)

    response = client.post(
        "/api/jobs",
        json={
            "document_id": document["id"],
            "template_version_id": version.id,
            "provider_override": {
                "mode": "local",
                "provider_type": "langextract",
                "provider_label": "LangExtract (Ollama)",
                "api_style": "langextract",
                "base_url": "http://host.docker.internal:11434/v1",
                "api_key_required": False,
                "model": "qwen3.5:27b",
                "temperature": 0.1,
                "max_tokens": 4000,
                "supports_json_mode": False,
                "allow_external_processing": False,
                "timeout_seconds": 120,
                "retry_count": 2,
                "chunk_size": 16000,
            },
        },
    )

    assert response.status_code == 400
    assert "Job queueing blocked until provider probe succeeds." in response.text


def test_job_creation_requires_successful_langextract_probe_for_template_default(client, monkeypatch) -> None:
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
    template_payload = {
        "name": "Invoice Schema",
        "description": "Invoice extraction schema.",
        "document_type": "invoice",
        "definition": definition,
    }
    client.post("/api/templates", json=template_payload)

    upload_response = client.post(
        "/api/documents",
        files={"file": ("invoice.txt", b"Vendor Name: Acme\nTotal Amount: $1200.00", "text/plain")},
    )
    assert upload_response.status_code == 200
    document = upload_response.json()

    with SessionLocal() as db:
        version = db.query(TemplateVersion).one()

    def fail_probe(*_args, **_kwargs):
        raise HTTPException(
            status_code=400,
            detail="Job queueing blocked until provider probe succeeds. Configured Ollama model 'qwen3.5:27b' is not available.",
        )

    monkeypatch.setattr("app.api.routes.require_reachable_provider", fail_probe)

    response = client.post(
        "/api/jobs",
        json={
            "document_id": document["id"],
            "template_version_id": version.id,
        },
    )

    assert response.status_code == 400
    assert "Job queueing blocked until provider probe succeeds." in response.text


def test_document_upload_uses_unique_storage_path_for_same_filename(client) -> None:
    first = client.post(
        "/api/documents",
        files={"file": ("statement.pdf", b"first-version", "application/pdf")},
    )
    second = client.post(
        "/api/documents",
        files={"file": ("statement.pdf", b"second-version", "application/pdf")},
    )

    assert first.status_code == 200
    assert second.status_code == 200

    with SessionLocal() as db:
        documents = db.query(Document).order_by(Document.id.asc()).all()

    assert len(documents) == 2
    assert documents[0].stored_path != documents[1].stored_path
    assert not Path(documents[0].stored_path).is_absolute()
    assert not Path(documents[1].stored_path).is_absolute()
    assert documents[0].stored_path.startswith("uploads/")
    assert documents[1].stored_path.startswith("uploads/")
    assert resolve_document_storage_path(documents[0].stored_path).read_bytes() == b"first-version"
    assert resolve_document_storage_path(documents[1].stored_path).read_bytes() == b"second-version"


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
    assert review_response.json()["fields_requiring_review"] == []

    export_response = client.post(f"/api/results/{result_id}/exports/json")
    assert export_response.status_code == 200
    export_payload = export_response.json()
    assert (Path(os.environ["EXPORTS_DIR"]) / export_payload["path"]).exists()


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
    assert calculated["calculated_value"] == {"amount": 1650.0, "currency": "USD"}
    assert calculated["display_value"] == "USD 1,650.00"
    assert calculated["validation_status"] == "reviewed"
    assert review_response.json()["fields_requiring_review"] == ["vendor_name"]

    with SessionLocal() as db:
        persisted = db.query(ExtractionResult).filter(ExtractionResult.id == result_id).one()
        assert persisted.review_status == "reviewed"
        assert persisted.result_json["calculated_fields"][0]["calculated_value"] == {
            "amount": 1650.0,
            "currency": "USD",
        }
        assert persisted.result_json["fields_requiring_review"] == ["vendor_name"]


def test_review_recalculation_marks_formula_errors_for_review(client) -> None:
    template_definition = build_template_definition()
    template_definition["calculated_fields"][0]["formula"] = "1 / coalesce(total_amount.amount, 0)"
    template_definition["calculated_fields"][0]["output_type"] = "number"

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
                        "confidence_score": 0.91,
                        "source_text": "Acme Corp",
                        "page_number": 1,
                        "location_reference": "Page 1",
                        "validation_status": "valid",
                        "validation_errors": [],
                        "extraction_notes": "Extracted successfully.",
                        "requires_review": False,
                    },
                    {
                        "field_name": "total_amount",
                        "label": "Total Amount",
                        "field_kind": "extracted",
                        "data_type": "currency",
                        "extracted_value": "$0.00",
                        "normalized_value": {"amount": 0, "currency": "USD", "display_value": "$0.00"},
                        "confidence_score": 0.91,
                        "source_text": "$0.00",
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
                        "output_type": "number",
                        "formula": "1 / coalesce(total_amount.amount, 0)",
                        "depends_on": ["total_amount"],
                        "calculated_value": 1.0,
                        "display_value": "1.0",
                        "validation_status": "valid",
                        "validation_errors": [],
                        "calculation_notes": "Deterministic formula evaluation.",
                        "requires_review": False,
                    }
                ],
                "fields_requiring_review": [],
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
            "edits": [],
            "recalculate": True,
        },
    )

    assert review_response.status_code == 200
    calculated = review_response.json()["calculated_fields"][0]
    assert calculated["calculated_value"] is None
    assert calculated["validation_status"] == "invalid"
    assert calculated["validation_errors"] == ["Division by zero.", "Calculated value is null."]
    assert calculated["requires_review"] is True
    assert review_response.json()["fields_requiring_review"] == ["amount_with_buffer"]


def test_review_accepts_confirm_without_field_edits(client) -> None:
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
                        "validation_errors": ["Vendor name needs review."],
                        "extraction_notes": "Low confidence extraction.",
                        "requires_review": True,
                    }
                ],
                "calculated_fields": [],
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
            "edits": [],
            "recalculate": False,
        },
    )

    assert review_response.status_code == 200
    reviewed_field = review_response.json()["extracted_fields"][0]
    assert reviewed_field["normalized_value"] == {"value": "Acme Corp"}
    assert reviewed_field["validation_status"] == "reviewed"
    assert reviewed_field["requires_review"] is False
    assert review_response.json()["fields_requiring_review"] == []
    assert review_response.json()["reviewed_at"] is not None

    with SessionLocal() as db:
        persisted = db.query(ExtractionResult).filter(ExtractionResult.id == result_id).one()
        assert persisted.review_status == "reviewed"
        assert persisted.result_json["fields_requiring_review"] == []
        assert persisted.result_json["extracted_fields"][0]["requires_review"] is False


def test_langextract_feedback_suggestions_surface_contextual_review_examples(client) -> None:
    template_definition = build_template_definition()
    template_definition["llm_provider_settings"] = {
        **template_definition["llm_provider_settings"],
        "provider_type": "langextract",
        "provider_label": "LangExtract (Ollama)",
        "api_style": "langextract",
        "base_url": "http://host.docker.internal:11434/v1",
        "supports_json_mode": False,
    }
    parsed_text = "Invoice Vendor: Acme Corp\nTotal Due: $1,200.00\n"
    parsed_path = Path(os.environ["PARSED_DIR"]) / "invoice-langextract-feedback.txt"
    parsed_path.write_text(parsed_text, encoding="utf-8")
    vendor_start = parsed_text.index("Acme Corp")
    vendor_end = vendor_start + len("Acme Corp")
    amount_start = parsed_text.index("$1,200.00")
    amount_end = amount_start + len("$1,200.00")

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
            parsed_text_path=parsed_path.relative_to(Path(os.environ["DATA_DIR"])).as_posix(),
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
                        "char_start": vendor_start,
                        "char_end": vendor_end,
                        "page_number": 1,
                        "location_reference": "Page 1",
                        "validation_status": "invalid",
                        "validation_errors": ["Required field is missing."],
                        "extraction_notes": "LangExtract grounded chars.",
                        "requires_review": True,
                    },
                    {
                        "field_name": "total_amount",
                        "label": "Total Amount",
                        "field_kind": "extracted",
                        "data_type": "currency",
                        "extracted_value": "$1,200.00",
                        "normalized_value": {
                            "amount": 1200,
                            "currency": "USD",
                            "display_value": "$1,200.00",
                        },
                        "confidence_score": 1.0,
                        "source_text": "$1,200.00",
                        "char_start": amount_start,
                        "char_end": amount_end,
                        "page_number": 1,
                        "location_reference": "Page 1",
                        "validation_status": "valid",
                        "validation_errors": [],
                        "extraction_notes": "LangExtract grounded chars.",
                        "requires_review": False,
                    },
                ],
                "calculated_fields": [],
                "fields_requiring_review": ["vendor_name"],
                "document_level_notes": [],
                "reviewed_at": None,
            },
        )
        db.add(result)
        db.commit()
        result_id = result.id
        version_id = version.id

    review_response = client.post(
        f"/api/results/{result_id}/review",
        json={
            "reviewer": "qa-user",
            "edits": [
                {
                    "field_name": "vendor_name",
                    "normalized_value": {"value": "Acme Corporation"},
                    "reason": "Normalized legal name.",
                }
            ],
            "recalculate": False,
        },
    )
    assert review_response.status_code == 200

    suggestions_response = client.get(f"/api/template-versions/{version_id}/langextract-feedback-suggestions")

    assert suggestions_response.status_code == 200
    payload = suggestions_response.json()
    suggestions = payload["suggestions"]
    assert len(suggestions) == 1
    assert payload["diagnostics"]["reviewed_result_count"] == 1
    assert payload["diagnostics"]["reviewed_edit_count"] == 1
    assert payload["diagnostics"]["visible_suggestion_count"] == 1
    assert suggestions[0]["template_version_id"] == version_id
    assert suggestions[0]["example_text"] == parsed_text.strip()
    assert suggestions[0]["occurrence_count"] == 1
    assert suggestions[0]["source_result_ids"] == [result_id]
    assert suggestions[0]["source_field_names"] == ["vendor_name"]
    assert suggestions[0]["extractions"] == [
        {
            "extraction_class": "vendor_name",
            "extraction_text": "Acme Corp",
            "attributes": {"value": "Acme Corporation"},
        },
        {
            "extraction_class": "total_amount",
            "extraction_text": "$1,200.00",
            "attributes": {"value": "$1,200.00", "currency": "USD"},
        },
    ]
    assert suggestions[0]["last_reviewed_at"] is not None


def test_langextract_feedback_suggestions_skip_span_overrides(client) -> None:
    template_definition = build_template_definition()
    template_definition["llm_provider_settings"] = {
        **template_definition["llm_provider_settings"],
        "provider_type": "langextract",
        "provider_label": "LangExtract (Ollama)",
        "api_style": "langextract",
        "base_url": "http://host.docker.internal:11434/v1",
        "supports_json_mode": False,
    }
    parsed_text = "Invoice Vendor: Acme Corp\n"
    parsed_path = Path(os.environ["PARSED_DIR"]) / "invoice-langextract-span-override.txt"
    parsed_path.write_text(parsed_text, encoding="utf-8")
    vendor_start = parsed_text.index("Acme Corp")
    vendor_end = vendor_start + len("Acme Corp")

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
            parsed_text_path=parsed_path.relative_to(Path(os.environ["DATA_DIR"])).as_posix(),
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
                        "char_start": vendor_start,
                        "char_end": vendor_end,
                        "page_number": 1,
                        "location_reference": "Page 1",
                        "validation_status": "invalid",
                        "validation_errors": ["Required field is missing."],
                        "extraction_notes": "LangExtract grounded chars.",
                        "requires_review": True,
                    }
                ],
                "calculated_fields": [],
                "fields_requiring_review": ["vendor_name"],
                "document_level_notes": [],
                "reviewed_at": None,
            },
        )
        db.add(result)
        db.commit()
        result_id = result.id
        version_id = version.id

    review_response = client.post(
        f"/api/results/{result_id}/review",
        json={
            "reviewer": "qa-user",
            "edits": [
                {
                    "field_name": "vendor_name",
                    "normalized_value": {"value": "Acme Corporation"},
                    "extracted_value": "Acme Corporation",
                    "reason": "Reviewer corrected the extracted span.",
                }
            ],
            "recalculate": False,
        },
    )
    assert review_response.status_code == 200

    suggestions_response = client.get(f"/api/template-versions/{version_id}/langextract-feedback-suggestions")

    assert suggestions_response.status_code == 200
    payload = suggestions_response.json()
    assert payload["suggestions"] == []
    assert payload["diagnostics"]["skipped_span_override"] == 1


def test_langextract_feedback_suggestion_dismissal_persists_across_fetches(client) -> None:
    template_definition = build_template_definition()
    template_definition["llm_provider_settings"] = {
        **template_definition["llm_provider_settings"],
        "provider_type": "langextract",
        "provider_label": "LangExtract (Ollama)",
        "api_style": "langextract",
        "base_url": "http://host.docker.internal:11434/v1",
        "supports_json_mode": False,
    }
    parsed_text = "Invoice Vendor: Acme Corp\nTotal Due: $1,200.00\n"
    parsed_path = Path(os.environ["PARSED_DIR"]) / "invoice-langextract-dismissal.txt"
    parsed_path.write_text(parsed_text, encoding="utf-8")
    vendor_start = parsed_text.index("Acme Corp")
    vendor_end = vendor_start + len("Acme Corp")
    amount_start = parsed_text.index("$1,200.00")
    amount_end = amount_start + len("$1,200.00")

    with SessionLocal() as db:
        template = Template(
            name="Dismissible Invoice Schema", description="Invoice extraction schema.", document_type="invoice"
        )
        db.add(template)
        db.flush()
        version = TemplateVersion(template_id=template.id, version="1.0.0", definition=template_definition)
        db.add(version)
        db.flush()
        document = Document(
            original_filename="invoice.txt",
            content_type="text/plain",
            stored_path=str(Path("invoice.txt")),
            parsed_text_path=parsed_path.relative_to(Path(os.environ["DATA_DIR"])).as_posix(),
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
                        "char_start": vendor_start,
                        "char_end": vendor_end,
                        "page_number": 1,
                        "location_reference": "Page 1",
                        "validation_status": "invalid",
                        "validation_errors": ["Required field is missing."],
                        "extraction_notes": "LangExtract grounded chars.",
                        "requires_review": True,
                    },
                    {
                        "field_name": "total_amount",
                        "label": "Total Amount",
                        "field_kind": "extracted",
                        "data_type": "currency",
                        "extracted_value": "$1,200.00",
                        "normalized_value": {
                            "amount": 1200,
                            "currency": "USD",
                            "display_value": "$1,200.00",
                        },
                        "confidence_score": 1.0,
                        "source_text": "$1,200.00",
                        "char_start": amount_start,
                        "char_end": amount_end,
                        "page_number": 1,
                        "location_reference": "Page 1",
                        "validation_status": "valid",
                        "validation_errors": [],
                        "extraction_notes": "LangExtract grounded chars.",
                        "requires_review": False,
                    },
                ],
                "calculated_fields": [],
                "fields_requiring_review": ["vendor_name"],
                "document_level_notes": [],
                "reviewed_at": None,
            },
        )
        db.add(result)
        db.flush()
        db.add(
            ReviewEdit(
                result_id=result.id,
                reviewer="qa-user",
                field_name="vendor_name",
                previous_value={"value": "Acme Corp"},
                new_value={"value": "Acme Corporation"},
                reason="Normalized legal name.",
            )
        )
        db.commit()
        version_id = version.id

    suggestions_response = client.get(f"/api/template-versions/{version_id}/langextract-feedback-suggestions")
    assert suggestions_response.status_code == 200
    payload = suggestions_response.json()
    suggestions = payload["suggestions"]
    assert len(suggestions) == 1
    suggestion_key = suggestions[0]["key"]

    dismiss_response = client.put(
        f"/api/template-versions/{version_id}/langextract-feedback-suggestions/{suggestion_key}/dismissal",
        json={"dismissed": True},
    )

    assert dismiss_response.status_code == 200
    assert dismiss_response.json()["dismissed"] is True
    assert dismiss_response.json()["suggestion_key"] == suggestion_key

    refetched_response = client.get(f"/api/template-versions/{version_id}/langextract-feedback-suggestions")
    assert refetched_response.status_code == 200
    refetched_payload = refetched_response.json()
    assert refetched_payload["suggestions"] == []
    assert refetched_payload["diagnostics"]["dismissed_suggestion_count"] == 1


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

    csv_path = Path(os.environ["EXPORTS_DIR"]) / csv_response.json()["path"]
    excel_path = Path(os.environ["EXPORTS_DIR"]) / excel_response.json()["path"]
    assert csv_path.exists()
    assert excel_path.exists()
    assert "vendor_name" in csv_path.read_text(encoding="utf-8")

    unsupported_response = client.post(f"/api/results/{result_id}/exports/xml")
    assert unsupported_response.status_code == 400
    assert "Unsupported export format" in unsupported_response.json()["detail"]


def test_export_list_and_download_routes_return_saved_export_metadata(client) -> None:
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
        job_id = job.id

    export_response = client.post(f"/api/results/{result_id}/exports/json")
    assert export_response.status_code == 200
    export_payload = export_response.json()

    list_response = client.get("/api/exports")
    assert list_response.status_code == 200
    assert list_response.json()[0]["id"] == export_payload["export_id"]
    assert list_response.json()[0]["result_id"] == result_id
    assert list_response.json()[0]["job_id"] == job_id
    assert list_response.json()[0]["export_format"] == "json"
    assert list_response.json()[0]["file_path"].startswith("result-")

    download_response = client.get(f"/api/exports/{export_payload['export_id']}/download")
    assert download_response.status_code == 200
    assert "attachment;" in download_response.headers["content-disposition"]
    assert download_response.content


def test_review_route_returns_404_for_missing_result(client) -> None:
    response = client.post(
        "/api/results/999/review",
        json={
            "reviewer": "qa-user",
            "edits": [
                {
                    "field_name": "vendor_name",
                    "normalized_value": {"value": "Acme Corporation"},
                    "reason": "Normalized vendor spelling.",
                }
            ],
            "recalculate": True,
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Result not found."


def test_export_route_returns_404_for_missing_result(client) -> None:
    response = client.post("/api/results/999/exports/json")

    assert response.status_code == 404
    assert response.json()["detail"] == "Result not found."


def test_export_download_route_returns_404_for_missing_export(client) -> None:
    response = client.get("/api/exports/999/download")

    assert response.status_code == 404
    assert response.json()["detail"] == "Export not found."


def test_export_download_route_rejects_paths_outside_exports_dir(client, tmp_path) -> None:
    outside_file = tmp_path / "outside.json"
    outside_file.write_text("{}", encoding="utf-8")

    with SessionLocal() as db:
        template = Template(name="Export Path Test", description="", document_type="invoice")
        db.add(template)
        db.flush()
        version = TemplateVersion(
            template_id=template.id,
            version="1.0.0",
            definition=build_template_definition(),
        )
        db.add(version)
        db.flush()
        document = Document(
            original_filename="invoice.txt",
            content_type="text/plain",
            stored_path="uploads/invoice.txt",
            status="completed",
        )
        db.add(document)
        db.flush()
        job = ExtractionJob(
            document_id=document.id,
            template_version_id=version.id,
            status="completed",
        )
        db.add(job)
        db.flush()
        result = ExtractionResult(
            job_id=job.id,
            result_json={"extracted_fields": [], "calculated_fields": []},
        )
        db.add(result)
        db.flush()
        record = ExportRecord(result_id=result.id, export_format="json", file_path=str(outside_file))
        db.add(record)
        db.commit()
        export_id = record.id

    response = client.get(f"/api/exports/{export_id}/download")

    assert response.status_code == 400
    assert "Invalid storage reference" in response.json()["detail"]


def test_export_download_route_uses_original_reference_filename(client, monkeypatch, tmp_path) -> None:
    reference = "result-42-20260101T120000.json"
    cached_path = tmp_path / "extractflow__exports__result-42-20260101T120000.json"
    cached_path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(api_routes, "resolve_export_download_path", lambda _: cached_path)

    with SessionLocal() as db:
        template = Template(name="Export Filename Test", description="", document_type="invoice")
        db.add(template)
        db.flush()
        version = TemplateVersion(
            template_id=template.id,
            version="1.0.0",
            definition=build_template_definition(),
        )
        db.add(version)
        db.flush()
        document = Document(
            original_filename="invoice.txt",
            content_type="text/plain",
            stored_path="uploads/invoice.txt",
            status="completed",
        )
        db.add(document)
        db.flush()
        job = ExtractionJob(
            document_id=document.id,
            template_version_id=version.id,
            status="completed",
        )
        db.add(job)
        db.flush()
        result = ExtractionResult(
            job_id=job.id,
            result_json={"extracted_fields": [], "calculated_fields": []},
        )
        db.add(result)
        db.flush()
        record = ExportRecord(result_id=result.id, export_format="json", file_path=reference)
        db.add(record)
        db.commit()
        export_id = record.id

    response = client.get(f"/api/exports/{export_id}/download")

    assert response.status_code == 200
    assert reference in response.headers["content-disposition"]
    assert cached_path.name not in response.headers["content-disposition"]


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


def test_provider_settings_defaults_to_mock_when_unset(client) -> None:
    response = client.get("/api/settings/provider")

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider_type"] == "mock"
    assert payload["model"] == "mock-extractor"
    assert payload["allow_external_processing"] is False
    assert payload["is_persisted_default"] is False


def test_provider_settings_reject_invalid_langextract_policy(client) -> None:
    response = client.put(
        "/api/settings/provider",
        json={
            "settings": {
                "mode": "cloud",
                "provider_type": "langextract",
                "provider_label": "LangExtract (Ollama)",
                "api_style": "langextract",
                "base_url": "http://host.docker.internal:11434/v1",
                "model": "qwen3.5:27b",
                "temperature": 0.1,
                "max_tokens": 4000,
                "supports_json_mode": False,
                "allow_external_processing": True,
                "timeout_seconds": 120,
                "retry_count": 2,
                "chunk_size": 16000,
            }
        },
    )

    assert response.status_code == 422
    assert "LangExtract only supports local mode." in response.text


def test_provider_settings_reject_mismatched_langextract_identity(client) -> None:
    response = client.put(
        "/api/settings/provider",
        json={
            "settings": {
                "mode": "local",
                "provider_type": "langextract",
                "provider_label": "LangExtract (Ollama)",
                "api_style": "openai_compatible",
                "base_url": "http://host.docker.internal:11434/v1",
                "model": "qwen3.5:27b",
                "temperature": 0.1,
                "max_tokens": 4000,
                "supports_json_mode": False,
                "allow_external_processing": False,
                "timeout_seconds": 120,
                "retry_count": 2,
                "chunk_size": 16000,
            }
        },
    )

    assert response.status_code == 422
    assert "provider_type and api_style" in response.text


def test_readyz_reports_database_and_storage_checks(client) -> None:
    response = client.get("/readyz")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["checks"]["database"]["ready"] is True
    assert payload["checks"]["storage"]["data_dir"]["ready"] is True
    assert payload["checks"]["storage"]["uploads_dir"]["ready"] is True


def test_request_id_header_is_generated(client) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.headers["x-request-id"]


def test_request_id_header_is_propagated(client) -> None:
    response = client.get("/readyz", headers={"X-Request-ID": "req-123"})

    assert response.status_code == 200
    assert response.headers["x-request-id"] == "req-123"


def test_provider_catalog_lists_remote_and_local_options(client) -> None:
    response = client.get("/api/settings/providers")
    assert response.status_code == 200
    payload = response.json()
    provider_types = {item["provider_type"] for item in payload["providers"]}

    assert {
        "mock",
        "langextract",
        "ollama",
        "lm_studio",
        "openai",
        "azure_openai",
        "deepseek",
        "kimi",
    }.issubset(provider_types)


def test_provider_health_reports_missing_cloud_credentials(client) -> None:
    response = client.get("/api/settings/providers/health")
    assert response.status_code == 200
    payload = response.json()
    health_by_type = {item["provider_type"]: item for item in payload}

    assert health_by_type["mock"]["ready"] is True
    assert health_by_type["langextract"]["ready"] is False
    assert health_by_type["langextract"]["status"] == "probe_required"
    assert (
        "Run a live probe to confirm Ollama runtime and model availability" in health_by_type["langextract"]["checks"]
    )
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


def test_provider_probe_reports_timeout_errors(client, monkeypatch) -> None:
    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str, headers: dict):
            raise httpx.ConnectTimeout("probe timed out")

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
    assert response.json()["reachable"] is False
    assert response.json()["status"] == "error"
    assert "timed out" in response.json()["detail"]


def test_provider_probe_uses_ollama_tags_endpoint_for_langextract(client, monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeResponse:
        status_code = 200

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
            return FakeResponse()

    monkeypatch.setattr("app.services.provider_probe.httpx.Client", FakeClient)

    response = client.post(
        "/api/settings/providers/probe",
        json={
            "settings": {
                "mode": "local",
                "provider_type": "langextract",
                "provider_label": "LangExtract (Ollama)",
                "api_style": "langextract",
                "base_url": "http://host.docker.internal:11434/v1",
                "api_key_required": False,
                "model": "qwen3.5:27b",
                "temperature": 0.1,
                "max_tokens": 4000,
                "supports_json_mode": False,
                "allow_external_processing": False,
                "timeout_seconds": 120,
                "retry_count": 2,
                "chunk_size": 16000,
            }
        },
    )

    assert response.status_code == 200
    assert response.json()["reachable"] is True
    assert captured["url"] == "http://host.docker.internal:11434/api/generate"
    assert captured["json"] == {
        "model": "qwen3.5:27b",
        "prompt": "ping",
        "stream": False,
        "options": {"num_predict": 1},
    }
    assert captured["headers"] == {"Content-Type": "application/json"}
    assert "qwen3.5:27b" in response.json()["detail"]


def test_provider_probe_rejects_missing_langextract_model(client, monkeypatch) -> None:
    class FakeResponse:
        status_code = 404
        text = ""

        @staticmethod
        def json():
            return {"error": "model 'qwen3.5:27b' not found"}

    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url: str, json: dict, headers: dict):
            return FakeResponse()

    monkeypatch.setattr("app.services.provider_probe.httpx.Client", FakeClient)

    response = client.post(
        "/api/settings/providers/probe",
        json={
            "settings": {
                "mode": "local",
                "provider_type": "langextract",
                "provider_label": "LangExtract (Ollama)",
                "api_style": "langextract",
                "base_url": "http://host.docker.internal:11434/v1",
                "api_key_required": False,
                "model": "qwen3.5:27b",
                "temperature": 0.1,
                "max_tokens": 4000,
                "supports_json_mode": False,
                "allow_external_processing": False,
                "timeout_seconds": 120,
                "retry_count": 2,
                "chunk_size": 16000,
            }
        },
    )

    assert response.status_code == 200
    assert response.json()["reachable"] is False
    assert response.json()["status"] == "not_ready"
    assert response.json()["detail"] == "model 'qwen3.5:27b' not found"


def test_template_creation_rejects_mismatched_langextract_identity(client) -> None:
    definition = build_template_definition()
    definition["llm_provider_settings"] = {
        **definition["llm_provider_settings"],
        "provider_type": "langextract",
        "provider_label": "LangExtract (Ollama)",
        "api_style": "openai_compatible",
        "base_url": "http://host.docker.internal:11434/v1",
        "supports_json_mode": False,
    }
    response = client.post(
        "/api/templates",
        json={
            "name": "Mismatched LangExtract Schema",
            "description": "Invalid provider identity",
            "document_type": "invoice",
            "definition": definition,
        },
    )

    assert response.status_code == 422
    assert "provider_type and api_style" in response.text


def test_custom_provider_profile_crud_and_activation(client, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.routes.require_reachable_provider",
        lambda settings, action: {
            "provider_type": settings.provider_type,
            "reachable": True,
            "status": "reachable",
            "detail": "Endpoint responded with HTTP 200.",
        },
    )

    payload = build_custom_provider_payload()

    create_response = client.post("/api/settings/providers/custom", json=payload)
    assert create_response.status_code == 200
    profile = create_response.json()
    profile_id = profile["id"]
    assert profile["name"] == "Private Gateway"
    assert profile["last_probe_at"] is not None
    assert profile["last_probe_status"] == "reachable"
    assert profile["last_probe_detail"] == "Endpoint responded with HTTP 200."

    list_response = client.get("/api/settings/providers/custom")
    assert list_response.status_code == 200
    assert list_response.json()["profiles"][0]["name"] == "Private Gateway"
    assert list_response.json()["profiles"][0]["last_probe_status"] == "reachable"

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
    assert update_response.json()["last_probe_status"] == "reachable"
    assert update_response.json()["last_probe_detail"] == "Endpoint responded with HTTP 200."

    activate_response = client.post(f"/api/settings/providers/custom/{profile_id}/activate")
    assert activate_response.status_code == 200
    assert activate_response.json()["provider_type"] == "private_gateway"
    assert client.get("/api/settings/provider").json()["model"] == "document-extractor-v2"

    delete_response = client.delete(f"/api/settings/providers/custom/{profile_id}")
    assert delete_response.status_code == 200
    assert delete_response.json()["deleted"] is True
    assert client.get("/api/settings/providers/custom").json()["profiles"] == []


def test_provider_controls_returns_probe_freshness_threshold(client) -> None:
    response = client.get("/api/settings/providers/controls")

    assert response.status_code == 200
    payload = response.json()
    assert payload["deployment_mode"] == "local"
    assert payload["tenant_mode"] == "single_tenant"
    assert payload["allow_external_processing"] is True
    assert payload["require_redaction_for_external_processing"] is False
    assert payload["require_authentication"] is False
    assert payload["custom_provider_probe_max_age_hours"] == 24


def test_provider_catalog_hides_external_providers_when_disabled(client, monkeypatch) -> None:
    monkeypatch.setattr("app.services.provider_catalog.settings.allow_external_processing", False)

    response = client.get("/api/settings/providers")

    assert response.status_code == 200
    provider_types = {provider["provider_type"] for provider in response.json()["providers"]}
    assert provider_types == {"mock", "langextract", "ollama", "lm_studio"}


def test_provider_settings_reject_external_processing_when_disabled(client, monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.settings.allow_external_processing", False)

    response = client.put(
        "/api/settings/provider",
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

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "This deployment disables external provider processing. Choose a local provider or enable "
        "ALLOW_EXTERNAL_PROCESSING."
    )


def test_provider_settings_allow_external_processing_when_redaction_flow_enabled(client, monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.settings.allow_external_processing", True)
    monkeypatch.setattr("app.api.routes.settings.require_redaction_for_external_processing", True)
    monkeypatch.setattr("app.api.routes.settings.presidio_redaction_enabled", True)

    response = client.put(
        "/api/settings/provider",
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
    assert response.json()["allow_external_processing"] is True


def test_custom_provider_profile_save_requires_successful_probe(client, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.routes.require_reachable_provider",
        Mock(
            side_effect=HTTPException(
                status_code=400,
                detail="Custom provider save blocked until provider probe succeeds. Missing environment variable OPENAI_API_KEY.",
            )
        ),
    )

    payload = build_custom_provider_payload(
        mode="cloud",
        base_url="https://gateway.example/v1",
        api_key_env_var="OPENAI_API_KEY",
        api_key_required=True,
        allow_external_processing=True,
    )

    response = client.post("/api/settings/providers/custom", json=payload)

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Custom provider save blocked until provider probe succeeds. Missing environment variable OPENAI_API_KEY."
    )


def test_custom_provider_profile_save_blocks_unreachable_probe_results(client, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.routes.require_reachable_provider",
        Mock(
            side_effect=HTTPException(
                status_code=400,
                detail="Custom provider save blocked until provider probe succeeds. Endpoint responded with HTTP 503.",
            )
        ),
    )

    response = client.post(
        "/api/settings/providers/custom",
        json=build_custom_provider_payload(
            name="Remote Gateway",
            mode="cloud",
            provider_type="openai",
            base_url="https://gateway.example/v1",
            api_key_env_var="OPENAI_API_KEY",
            api_key_required=True,
            model="gpt-4.1",
            allow_external_processing=True,
        ),
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Custom provider save blocked until provider probe succeeds. Endpoint responded with HTTP 503."
    )


def test_custom_provider_profile_rejects_duplicate_names(client, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.routes.require_reachable_provider",
        lambda settings, action: {
            "provider_type": settings.provider_type,
            "reachable": True,
            "status": "reachable",
            "detail": "Endpoint responded with HTTP 200.",
        },
    )

    first = client.post("/api/settings/providers/custom", json=build_custom_provider_payload())
    second = client.post("/api/settings/providers/custom", json=build_custom_provider_payload())

    assert first.status_code == 200
    assert second.status_code == 409
    assert second.json()["detail"] == "Custom provider profile name already exists."


def test_custom_provider_profile_update_requires_successful_probe(client, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.routes.require_reachable_provider",
        lambda settings, action: {
            "provider_type": settings.provider_type,
            "reachable": True,
            "status": "reachable",
            "detail": "Endpoint responded with HTTP 200.",
        },
    )
    create_response = client.post("/api/settings/providers/custom", json=build_custom_provider_payload())
    assert create_response.status_code == 200
    profile_id = create_response.json()["id"]

    monkeypatch.setattr(
        "app.api.routes.require_reachable_provider",
        Mock(
            side_effect=HTTPException(
                status_code=400,
                detail="Custom provider save blocked until provider probe succeeds. Missing environment variable OPENAI_API_KEY.",
            )
        ),
    )

    response = client.put(
        f"/api/settings/providers/custom/{profile_id}",
        json=build_custom_provider_payload(
            name="OpenAI Gateway",
            mode="cloud",
            provider_type="openai",
            base_url="https://api.openai.com/v1",
            api_key_env_var="OPENAI_API_KEY",
            api_key_required=True,
            model="gpt-4.1",
            allow_external_processing=True,
        ),
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Custom provider save blocked until provider probe succeeds. Missing environment variable OPENAI_API_KEY."
    )
    profiles = client.get("/api/settings/providers/custom").json()["profiles"]
    assert len(profiles) == 1
    assert profiles[0]["name"] == "Private Gateway"
    assert profiles[0]["settings"]["provider_type"] == "private_gateway"


def test_custom_provider_profile_update_rejects_missing_profile_id(client, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.routes.require_reachable_provider",
        lambda settings, action: {
            "provider_type": settings.provider_type,
            "reachable": True,
            "status": "reachable",
            "detail": "Endpoint responded with HTTP 200.",
        },
    )

    response = client.put(
        "/api/settings/providers/custom/missing-profile",
        json=build_custom_provider_payload(name="Missing Profile"),
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Custom provider profile not found."


def test_custom_provider_profile_update_rejects_duplicate_names(client, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.routes.require_reachable_provider",
        lambda settings, action: {
            "provider_type": settings.provider_type,
            "reachable": True,
            "status": "reachable",
            "detail": "Endpoint responded with HTTP 200.",
        },
    )

    first = client.post("/api/settings/providers/custom", json=build_custom_provider_payload(name="Gateway A"))
    second = client.post("/api/settings/providers/custom", json=build_custom_provider_payload(name="Gateway B"))

    response = client.put(
        f"/api/settings/providers/custom/{second.json()['id']}",
        json=build_custom_provider_payload(name="Gateway A"),
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert response.status_code == 409
    assert response.json()["detail"] == "Custom provider profile name already exists."


def test_custom_provider_profile_activation_requires_successful_probe(client, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.routes.require_reachable_provider",
        lambda settings, action: {
            "provider_type": settings.provider_type,
            "reachable": True,
            "status": "reachable",
            "detail": "Endpoint responded with HTTP 200.",
        },
    )
    create_response = client.post("/api/settings/providers/custom", json=build_custom_provider_payload())
    assert create_response.status_code == 200
    profile_id = create_response.json()["id"]

    monkeypatch.setattr(
        "app.api.routes.require_reachable_provider",
        Mock(
            side_effect=HTTPException(
                status_code=400,
                detail="Custom provider activation blocked until provider probe succeeds. Missing environment variable OPENAI_API_KEY.",
            )
        ),
    )

    response = client.post(f"/api/settings/providers/custom/{profile_id}/activate")

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Custom provider activation blocked until provider probe succeeds. Missing environment variable OPENAI_API_KEY."
    )
    provider_response = client.get("/api/settings/provider")
    assert provider_response.status_code == 200
    assert provider_response.json()["provider_type"] == "mock"


def test_custom_provider_profile_reverify_refreshes_probe_metadata(client, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.routes.require_reachable_provider",
        lambda settings, action: {
            "provider_type": settings.provider_type,
            "reachable": True,
            "status": "reachable",
            "detail": "Endpoint responded with HTTP 200.",
        },
    )
    create_response = client.post("/api/settings/providers/custom", json=build_custom_provider_payload())
    assert create_response.status_code == 200
    profile_id = create_response.json()["id"]

    with SessionLocal() as db:
        setting = (
            db.query(Setting)
            .filter(Setting.key == build_tenant_setting_key("default", "custom_provider_profiles"))
            .first()
        )
        assert setting is not None
        payload = list(setting.value)
        payload[0] = {
            **payload[0],
            "last_probe_at": (datetime.now(UTC) - timedelta(days=2)).isoformat(),
            "last_probe_detail": "Old probe.",
        }
        setting.value = payload
        db.commit()

    response = client.post(f"/api/settings/providers/custom/{profile_id}/reverify")

    assert response.status_code == 200
    assert response.json()["last_probe_status"] == "reachable"
    assert response.json()["last_probe_detail"] == "Endpoint responded with HTTP 200."
    assert response.json()["last_probe_at"] is not None


def test_custom_provider_profile_activation_requires_recent_probe(client, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.routes.require_reachable_provider",
        lambda settings, action: {
            "provider_type": settings.provider_type,
            "reachable": True,
            "status": "reachable",
            "detail": "Endpoint responded with HTTP 200.",
        },
    )
    create_response = client.post("/api/settings/providers/custom", json=build_custom_provider_payload())
    assert create_response.status_code == 200
    profile_id = create_response.json()["id"]

    with SessionLocal() as db:
        setting = (
            db.query(Setting)
            .filter(Setting.key == build_tenant_setting_key("default", "custom_provider_profiles"))
            .first()
        )
        assert setting is not None
        payload = list(setting.value)
        payload[0] = {
            **payload[0],
            "last_probe_at": (datetime.now(UTC) - timedelta(days=2)).isoformat(),
        }
        setting.value = payload
        db.commit()

    response = client.post(f"/api/settings/providers/custom/{profile_id}/activate")

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Custom provider activation blocked until the saved profile is reverified. "
        "Last successful probe is older than 24 hours."
    )


def test_custom_provider_profile_activation_rejects_missing_profile_id(client) -> None:
    response = client.post("/api/settings/providers/custom/missing-profile/activate")

    assert response.status_code == 404
    assert response.json()["detail"] == "Custom provider profile not found."


def test_custom_provider_profile_delete_rejects_missing_profile_id(client) -> None:
    response = client.delete("/api/settings/providers/custom/missing-profile")

    assert response.status_code == 404
    assert response.json()["detail"] == "Custom provider profile not found."


def test_tenant_scoping_hides_other_tenant_records(client) -> None:
    with SessionLocal() as db:
        template = Template(
            tenant_id="tenant-a",
            name="Tenant A Schema",
            description="A",
            document_type="invoice",
        )
        db.add(template)
        db.flush()
        version = TemplateVersion(
            tenant_id="tenant-a",
            template_id=template.id,
            version="1.0.0",
            definition=build_template_definition(),
        )
        db.add(version)
        db.flush()
        document = Document(
            tenant_id="tenant-a",
            original_filename="invoice.txt",
            content_type="text/plain",
            stored_path="uploads/tenant-a.txt",
            status="completed",
        )
        db.add(document)
        db.flush()
        job = ExtractionJob(
            tenant_id="tenant-a",
            document_id=document.id,
            template_version_id=version.id,
            status="completed",
        )
        db.add(job)
        db.flush()
        result = ExtractionResult(
            tenant_id="tenant-a",
            job_id=job.id,
            result_json={
                "document_id": str(document.id),
                "document_type": "invoice",
                "template_name": "Tenant A Schema",
                "template_version": "1.0.0",
                "llm_provider": build_template_definition()["llm_provider_settings"],
                "extraction_status": "completed",
                "extracted_fields": [],
                "calculated_fields": [],
                "fields_requiring_review": [],
                "document_level_notes": [],
                "reviewed_at": None,
            },
        )
        db.add(result)
        db.flush()
        export = ExportRecord(
            tenant_id="tenant-a",
            result_id=result.id,
            export_format="json",
            file_path="result-1.json",
        )
        db.add(export)
        db.commit()
        job_id = job.id
        result_id = result.id
        export_id = export.id
        version_id = version.id

    app.dependency_overrides[get_current_tenant_id] = lambda: "tenant-b"
    try:
        assert client.get("/api/templates").json() == []
        assert client.get("/api/documents").json() == []
        assert client.get("/api/jobs").json() == []
        assert client.get("/api/exports").json() == []

        job_response = client.post(
            "/api/jobs",
            json={"document_id": 1, "template_version_id": version_id},
        )
        assert job_response.status_code == 404
        assert client.get(f"/api/jobs/{job_id}/result").status_code == 404
        assert client.post(f"/api/results/{result_id}/exports/json").status_code == 404
        assert client.get(f"/api/exports/{export_id}/download").status_code == 404
    finally:
        app.dependency_overrides.pop(get_current_tenant_id, None)


def test_provider_settings_are_tenant_scoped(client) -> None:
    tenant_a_payload = {
        "settings": {
            "mode": "local",
            "provider_type": "mock",
            "base_url": None,
            "model": "tenant-a-model",
            "temperature": 0.1,
            "max_tokens": 4000,
            "supports_json_mode": True,
            "allow_external_processing": False,
            "timeout_seconds": 120,
            "retry_count": 2,
            "chunk_size": 16000,
        }
    }

    assert client.put("/api/settings/provider", json=tenant_a_payload).status_code == 200

    app.dependency_overrides[get_current_tenant_id] = lambda: "tenant-b"
    try:
        default_response = client.get("/api/settings/provider")
        assert default_response.status_code == 200
        assert default_response.json()["model"] == "mock-extractor"

        update_response = client.put(
            "/api/settings/provider",
            json={
                "settings": {
                    **tenant_a_payload["settings"],
                    "model": "tenant-b-model",
                }
            },
        )
        assert update_response.status_code == 200
        assert client.get("/api/settings/provider").json()["model"] == "tenant-b-model"
    finally:
        app.dependency_overrides.pop(get_current_tenant_id, None)

    assert client.get("/api/settings/provider").json()["model"] == "tenant-a-model"


def test_retry_failed_job_requeues_work(client) -> None:
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
            status="failed",
        )
        db.add(document)
        db.flush()
        job = ExtractionJob(
            document_id=document.id,
            template_version_id=version.id,
            status="failed",
            error_message="Provider timed out.",
            progress_stage="failed",
            progress_pct=0,
            attempt_count=2,
        )
        db.add(job)
        db.commit()
        job_id = job.id
        document_id = document.id

    response = client.post(f"/api/jobs/{job_id}/retry")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "queued"
    assert payload["error_message"] is None
    assert payload["progress_stage"] == "queued"
    assert payload["progress_pct"] == 0
    assert payload["attempt_count"] == 2

    with SessionLocal() as db:
        refreshed_job = db.query(ExtractionJob).filter(ExtractionJob.id == job_id).one()
        refreshed_document = db.query(Document).filter(Document.id == document_id).one()
        assert refreshed_job.status == "queued"
        assert refreshed_job.error_message is None
        assert refreshed_job.worker_id is None
        assert refreshed_document.status == "queued"


def test_retry_failed_job_rejects_external_provider_when_processing_disabled(client, monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.settings.allow_external_processing", False)
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
            status="failed",
        )
        db.add(document)
        db.flush()
        job = ExtractionJob(
            document_id=document.id,
            template_version_id=version.id,
            status="failed",
            error_message="Provider timed out.",
            progress_stage="failed",
            progress_pct=0,
            attempt_count=2,
            provider_override={
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
            },
        )
        db.add(job)
        db.commit()
        job_id = job.id
        document_id = document.id

    response = client.post(f"/api/jobs/{job_id}/retry")

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "This deployment disables external provider processing. Choose a local provider or enable "
        "ALLOW_EXTERNAL_PROCESSING."
    )

    with SessionLocal() as db:
        refreshed_job = db.query(ExtractionJob).filter(ExtractionJob.id == job_id).one()
        refreshed_document = db.query(Document).filter(Document.id == document_id).one()
        assert refreshed_job.status == "failed"
        assert refreshed_document.status == "failed"


def test_retry_cancelled_job_returns_conflict(client) -> None:
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
            status="queued",
        )
        db.add(document)
        db.flush()
        job = ExtractionJob(document_id=document.id, template_version_id=version.id, status="queued")
        db.add(job)
        db.commit()
        job_id = job.id

    cancel_response = client.post(f"/api/jobs/{job_id}/cancel")
    assert cancel_response.status_code == 200
    assert cancel_response.json()["status"] == "cancelled"

    retry_response = client.post(f"/api/jobs/{job_id}/retry")
    assert retry_response.status_code == 409
    assert retry_response.json()["detail"] == "Only failed jobs can be retried."


def test_retry_job_rejects_non_failed_status(client) -> None:
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
        db.commit()
        job_id = job.id

    response = client.post(f"/api/jobs/{job_id}/retry")
    assert response.status_code == 409
    assert response.json()["detail"] == "Only failed jobs can be retried."


def test_review_approve_high_confidence_leaves_low_confidence_flagged(client) -> None:
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
                        "confidence_score": 0.92,
                        "source_text": "Acme Corp",
                        "validation_status": "valid",
                        "validation_errors": [],
                        "requires_review": True,
                    },
                    {
                        "field_name": "total_amount",
                        "label": "Total Amount",
                        "field_kind": "extracted",
                        "data_type": "currency",
                        "extracted_value": "$1,200.00",
                        "normalized_value": {"amount": 1200, "currency": "USD"},
                        "confidence_score": 0.55,
                        "source_text": "$1,200.00",
                        "validation_status": "valid",
                        "validation_errors": [],
                        "requires_review": True,
                    },
                ],
                "calculated_fields": [],
                "fields_requiring_review": ["vendor_name", "total_amount"],
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
            "edits": [],
            "recalculate": False,
            "approve_high_confidence_min": 0.85,
        },
    )

    assert review_response.status_code == 200
    fields = {item["field_name"]: item for item in review_response.json()["extracted_fields"]}
    assert fields["vendor_name"]["requires_review"] is False
    assert fields["total_amount"]["requires_review"] is True
    assert review_response.json()["fields_requiring_review"] == ["total_amount"]


def test_review_json_object_field_round_trip(client) -> None:
    template_definition = build_template_definition()
    template_definition["extracted_fields"].append(
        {
            "name": "metadata",
            "label": "Metadata",
            "description": "Structured metadata blob.",
            "type": "json_object",
            "required": False,
        }
    )

    with SessionLocal() as db:
        template = Template(name="Metadata Schema", description="Metadata schema.", document_type="invoice")
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
                        "field_name": "metadata",
                        "label": "Metadata",
                        "field_kind": "extracted",
                        "data_type": "json_object",
                        "extracted_value": {"vendor": "Acme"},
                        "normalized_value": {"vendor": "Acme"},
                        "confidence_score": 0.5,
                        "validation_status": "invalid",
                        "validation_errors": [],
                        "requires_review": True,
                    }
                ],
                "calculated_fields": [],
                "fields_requiring_review": ["metadata"],
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
                    "field_name": "metadata",
                    "normalized_value": {"vendor": "Acme Updated", "tier": "gold"},
                    "reason": "Corrected metadata.",
                }
            ],
            "recalculate": False,
        },
    )
    assert review_response.status_code == 200
    field = review_response.json()["extracted_fields"][0]
    assert field["normalized_value"] == {"vendor": "Acme Updated", "tier": "gold"}


def test_audit_events_list_returns_upload_review_export_chain(client) -> None:
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
                        "validation_status": "invalid",
                        "validation_errors": [],
                        "requires_review": True,
                    }
                ],
                "calculated_fields": [],
                "fields_requiring_review": ["vendor_name"],
                "document_level_notes": [],
                "reviewed_at": None,
            },
        )
        db.add(result)
        db.commit()
        result_id = result.id

    client.post(
        f"/api/results/{result_id}/review",
        json={
            "reviewer": "qa-user",
            "edits": [
                {
                    "field_name": "vendor_name",
                    "normalized_value": {"value": "Acme Corporation"},
                    "reason": "Reviewed.",
                }
            ],
            "recalculate": False,
        },
    )
    client.post(f"/api/results/{result_id}/exports/json")

    audit_response = client.get("/api/audit/events")
    assert audit_response.status_code == 200
    actions = {event["action"] for event in audit_response.json()["events"]}
    assert "review.saved" in actions
    assert "export.created" in actions


def test_cancel_queued_job_updates_status(client) -> None:
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
            status="queued",
        )
        db.add(document)
        db.flush()
        job = ExtractionJob(document_id=document.id, template_version_id=version.id, status="queued")
        db.add(job)
        db.commit()
        job_id = job.id

    response = client.post(f"/api/jobs/{job_id}/cancel")
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"


def test_export_manifest_includes_sha256(client) -> None:
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
            review_status="reviewed",
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
                        "confidence_score": 0.99,
                        "validation_status": "reviewed",
                        "validation_errors": [],
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
        job_id = job.id
        template_version_id = version.id

    export_response = client.post(f"/api/results/{result_id}/exports/json")
    assert export_response.status_code == 200
    payload = export_response.json()
    assert payload["content_sha256"]
    assert len(payload["content_sha256"]) == 64
    assert payload["reviewer"] == "local-user"
    assert payload["template_version_id"] == template_version_id
    assert payload["manifest"]["result_id"] == result_id
    assert payload["manifest"]["job_id"] == job_id
    assert payload["manifest"]["export_format"] == "json"
    assert payload["manifest"]["content_sha256"] == payload["content_sha256"]

    list_response = client.get("/api/exports")
    assert list_response.status_code == 200
    listed = list_response.json()[0]
    assert listed["content_sha256"] == payload["content_sha256"]
    assert listed["manifest_json"]["result_id"] == result_id
    assert listed["reviewer"] == "local-user"


def test_export_blocked_when_review_backlog_enabled(client) -> None:
    template_definition = build_template_definition()

    client.put(
        "/api/settings/export-policy",
        json={"require_review_cleared": True},
    )

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
            review_status="pending",
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
                        "validation_status": "invalid",
                        "validation_errors": [],
                        "requires_review": True,
                    }
                ],
                "calculated_fields": [],
                "fields_requiring_review": ["vendor_name"],
                "document_level_notes": [],
                "reviewed_at": None,
            },
        )
        db.add(result)
        db.commit()
        result_id = result.id

    blocked = client.post(f"/api/results/{result_id}/exports/json")
    assert blocked.status_code == 409

    review_clear = client.post(
        f"/api/results/{result_id}/review",
        json={
            "reviewer": "qa-user",
            "edits": [
                {
                    "field_name": "vendor_name",
                    "normalized_value": {"value": "Acme Corporation"},
                    "reason": "Reviewed.",
                }
            ],
            "recalculate": False,
        },
    )
    assert review_clear.status_code == 200

    allowed = client.post(f"/api/results/{result_id}/exports/json")
    assert allowed.status_code == 200


def test_result_routes_include_review_status_for_review_gating(client) -> None:
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
            review_status="pending",
            result_json={
                "document_id": str(document.id),
                "document_type": "invoice",
                "template_name": "Invoice Extraction",
                "template_version": "1.0.0",
                "llm_provider": template_definition["llm_provider_settings"],
                "extraction_status": "completed",
                "extracted_fields": [],
                "calculated_fields": [],
                "fields_requiring_review": [],
                "document_level_notes": [],
                "reviewed_at": None,
            },
        )
        db.add(result)
        db.commit()
        job_id = job.id
        result_id = result.id

    get_response = client.get(f"/api/jobs/{job_id}/result")
    assert get_response.status_code == 200
    assert get_response.json()["result"]["review_status"] == "pending"

    review_response = client.post(
        f"/api/results/{result_id}/review",
        json={"reviewer": "qa-user", "edits": [], "recalculate": False},
    )
    assert review_response.status_code == 200
    assert review_response.json()["review_status"] == "reviewed"


def test_review_table_field_round_trip(client) -> None:
    template_definition = build_template_definition()
    template_definition["extracted_fields"].append(
        {
            "name": "line_items",
            "label": "Line Items",
            "description": "Invoice line items.",
            "type": "table",
            "required": False,
        }
    )

    with SessionLocal() as db:
        template = Template(name="Table Schema", description="Table schema.", document_type="invoice")
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
                        "field_name": "line_items",
                        "label": "Line Items",
                        "field_kind": "extracted",
                        "data_type": "table",
                        "extracted_value": [{"sku": "A1", "qty": 2}],
                        "normalized_value": [{"sku": "A1", "qty": 2}],
                        "confidence_score": 0.5,
                        "validation_status": "invalid",
                        "validation_errors": [],
                        "requires_review": True,
                    }
                ],
                "calculated_fields": [],
                "fields_requiring_review": ["line_items"],
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
                    "field_name": "line_items",
                    "normalized_value": [{"sku": "A1", "qty": 3}, {"sku": "B2", "qty": 1}],
                    "reason": "Corrected quantities.",
                }
            ],
            "recalculate": False,
        },
    )
    assert review_response.status_code == 200
    field = review_response.json()["extracted_fields"][0]
    assert field["normalized_value"] == [{"sku": "A1", "qty": 3}, {"sku": "B2", "qty": 1}]


def test_review_structured_object_field_round_trip(client) -> None:
    template_definition = build_template_definition()
    template_definition["extracted_fields"].append(
        {
            "name": "party",
            "label": "Party",
            "description": "Structured party details.",
            "type": "structured_object",
            "schema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "active": {"type": "boolean"},
                },
            },
        }
    )

    with SessionLocal() as db:
        template = Template(name="Structured Schema", description="Structured schema.", document_type="invoice")
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
                        "field_name": "party",
                        "label": "Party",
                        "field_kind": "extracted",
                        "data_type": "structured_object",
                        "extracted_value": {"name": "Acme", "active": True},
                        "normalized_value": {"name": "Acme", "active": True},
                        "confidence_score": 0.5,
                        "validation_status": "invalid",
                        "validation_errors": [],
                        "requires_review": True,
                    }
                ],
                "calculated_fields": [],
                "fields_requiring_review": ["party"],
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
                    "field_name": "party",
                    "normalized_value": {"name": "Acme Corporation", "active": False},
                    "reason": "Corrected party.",
                }
            ],
            "recalculate": False,
        },
    )
    assert review_response.status_code == 200
    field = review_response.json()["extracted_fields"][0]
    assert field["normalized_value"] == {"name": "Acme Corporation", "active": False}


def test_audit_events_filter_by_job_id(client) -> None:
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
                "extracted_fields": [],
                "calculated_fields": [],
                "fields_requiring_review": [],
                "document_level_notes": [],
                "reviewed_at": None,
            },
        )
        db.add(result)
        db.commit()
        result_id = result.id
        job_id = job.id

    client.post(f"/api/results/{result_id}/exports/json")

    filtered = client.get(f"/api/audit/events?job_id={job_id}")
    assert filtered.status_code == 200
    events = filtered.json()["events"]
    assert events
    assert all(event["metadata"]["job_id"] == job_id for event in events)


def test_audit_events_metadata_filters_apply_before_pagination(client) -> None:
    with SessionLocal() as db:
        record_audit_event(
            db,
            tenant_id="default",
            actor="qa-user",
            action="job.started",
            object_type="job",
            object_id="other-1",
            metadata={"job_id": 99},
        )
        record_audit_event(
            db,
            tenant_id="default",
            actor="qa-user",
            action="review.saved",
            object_type="result",
            object_id="11",
            metadata={"job_id": 5},
        )
        record_audit_event(
            db,
            tenant_id="default",
            actor="qa-user",
            action="job.completed",
            object_type="job",
            object_id="other-2",
            metadata={"job_id": 99},
        )
        record_audit_event(
            db,
            tenant_id="default",
            actor="qa-user",
            action="export.created",
            object_type="export",
            object_id="22",
            metadata={"job_id": 5},
        )
        db.commit()

    first_page = client.get("/api/audit/events?job_id=5&limit=1")
    assert first_page.status_code == 200
    assert first_page.json()["total"] == 2
    assert len(first_page.json()["events"]) == 1
    assert all(event["metadata"]["job_id"] == 5 for event in first_page.json()["events"])

    second_page = client.get("/api/audit/events?job_id=5&limit=1&offset=1")
    assert second_page.status_code == 200
    assert second_page.json()["total"] == 2
    assert len(second_page.json()["events"]) == 1
    assert all(event["metadata"]["job_id"] == 5 for event in second_page.json()["events"])
    assert {event["object_id"] for event in first_page.json()["events"] + second_page.json()["events"]} == {"11", "22"}


def test_cancel_completed_job_returns_conflict(client) -> None:
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
        db.commit()
        job_id = job.id

    response = client.post(f"/api/jobs/{job_id}/cancel")
    assert response.status_code == 409


def test_cancel_job_records_audit_event(client) -> None:
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
            status="queued",
        )
        db.add(document)
        db.flush()
        job = ExtractionJob(document_id=document.id, template_version_id=version.id, status="queued")
        db.add(job)
        db.commit()
        job_id = job.id

    cancel_response = client.post(f"/api/jobs/{job_id}/cancel")
    assert cancel_response.status_code == 200

    audit_response = client.get(f"/api/audit/events?job_id={job_id}")
    assert audit_response.status_code == 200
    actions = {event["action"] for event in audit_response.json()["events"]}
    assert "job.cancelled" in actions


def test_cancel_running_job_succeeds(client) -> None:
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
            status="processing",
        )
        db.add(document)
        db.flush()
        job = ExtractionJob(document_id=document.id, template_version_id=version.id, status="running")
        db.add(job)
        db.commit()
        job_id = job.id

    response = client.post(f"/api/jobs/{job_id}/cancel")
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"


def test_audit_events_filter_by_result_id_and_action(client) -> None:
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
            review_status="reviewed",
            result_json={
                "document_id": str(document.id),
                "document_type": "invoice",
                "template_name": "Invoice Extraction",
                "template_version": "1.0.0",
                "llm_provider": template_definition["llm_provider_settings"],
                "extraction_status": "completed",
                "extracted_fields": [],
                "calculated_fields": [],
                "fields_requiring_review": [],
                "document_level_notes": [],
                "reviewed_at": None,
            },
        )
        db.add(result)
        db.commit()
        result_id = result.id

    client.post(f"/api/results/{result_id}/exports/json")

    by_result = client.get(f"/api/audit/events?result_id={result_id}")
    assert by_result.status_code == 200
    assert by_result.json()["events"]
    assert all(event["metadata"]["result_id"] == result_id for event in by_result.json()["events"])

    by_action = client.get("/api/audit/events?action=export.created")
    assert by_action.status_code == 200
    assert all(event["action"] == "export.created" for event in by_action.json()["events"])
