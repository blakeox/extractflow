from __future__ import annotations

import json

import pytest
from app.core.config import settings
from app.db.database import SessionLocal
from app.models import Document, ExportRecord, ExtractionJob, ExtractionResult, Template, TemplateVersion
from extraction_core.runtime import DeploymentMode
from fastapi.testclient import TestClient

from tests.support.sample_data import build_template_definition


@pytest.fixture
def saas_client(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(settings, "deployment_mode", DeploymentMode.SAAS_MULTI_TENANT)
    monkeypatch.setattr(settings, "require_authentication", True)
    monkeypatch.setattr(settings, "trust_tenant_header", True)
    monkeypatch.setattr(
        settings,
        "auth_bearer_tokens_json",
        json.dumps({"tenant-token": {"actor": "tenant-user", "role": "admin"}}),
    )
    return client


def test_saas_mode_requires_tenant_header(saas_client: TestClient) -> None:
    response = saas_client.get(
        "/api/templates",
        headers={"Authorization": "Bearer tenant-token"},
    )
    assert response.status_code == 400
    assert "X-Tenant-ID" in response.json()["detail"]


def test_saas_tenant_isolation_hides_cross_tenant_records(saas_client: TestClient) -> None:
    definition = build_template_definition()
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
            definition=definition,
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
                "llm_provider": definition["llm_provider_settings"],
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

    auth_headers = {
        "Authorization": "Bearer tenant-token",
        "X-Tenant-ID": "tenant-b",
    }
    assert saas_client.get("/api/templates", headers=auth_headers).json() == []
    assert saas_client.get("/api/documents", headers=auth_headers).json() == []
    assert saas_client.get("/api/jobs", headers=auth_headers).json() == []
    assert saas_client.get("/api/exports", headers=auth_headers).json() == []
    assert saas_client.get(f"/api/jobs/{job_id}/result", headers=auth_headers).status_code == 404
    assert saas_client.post(f"/api/results/{result_id}/exports/json", headers=auth_headers).status_code == 404
    assert saas_client.get(f"/api/exports/{export_id}/download", headers=auth_headers).status_code == 404
    blocked_job = saas_client.post(
        "/api/jobs",
        headers=auth_headers,
        json={"document_id": 1, "template_version_id": version_id},
    )
    assert blocked_job.status_code == 404
