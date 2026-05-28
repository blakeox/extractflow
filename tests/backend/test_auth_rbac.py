from __future__ import annotations

import json

import pytest
from app.core.config import settings
from app.db.database import SessionLocal
from app.models import Document, Setting, Template, TemplateVersion
from extraction_core.runtime import DeploymentMode
from fastapi.testclient import TestClient

from tests.support.sample_data import build_template_definition


@pytest.fixture
def auth_tokens() -> str:
    return json.dumps(
        {
            "admin-token": {"actor": "admin-user", "role": "admin"},
            "viewer-token": {"actor": "viewer-user", "role": "viewer"},
            "operator-token": {"actor": "operator-user", "role": "operator"},
            "reviewer-token": {"actor": "reviewer-user", "role": "reviewer"},
        }
    )


@pytest.fixture
def authed_client(client: TestClient, auth_tokens: str, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(settings, "require_authentication", True)
    monkeypatch.setattr(settings, "auth_bearer_tokens_json", auth_tokens)
    return client


def test_unauthenticated_api_rejected_when_auth_required(authed_client: TestClient) -> None:
    response = authed_client.get("/api/templates")
    assert response.status_code == 401
    assert response.json()["detail"] == "Authentication required."


def test_health_stays_public_when_auth_required(authed_client: TestClient) -> None:
    assert authed_client.get("/api/health").status_code == 200
    assert authed_client.get("/healthz").status_code == 200


def test_viewer_cannot_queue_jobs(authed_client: TestClient) -> None:
    headers = {"Authorization": "Bearer viewer-token"}
    response = authed_client.post(
        "/api/jobs",
        headers=headers,
        json={"document_id": 1, "template_version_id": 1},
    )
    assert response.status_code == 403


def test_operator_can_upload_documents(authed_client: TestClient) -> None:
    headers = {"Authorization": "Bearer operator-token"}
    response = authed_client.post(
        "/api/documents",
        headers=headers,
        files={"file": ("invoice.txt", b"Vendor: Acme", "text/plain")},
    )
    assert response.status_code == 200


def test_admin_can_read_templates_when_auth_required(authed_client: TestClient) -> None:
    response = authed_client.get(
        "/api/templates",
        headers={"Authorization": "Bearer admin-token"},
    )
    assert response.status_code == 200


def test_admin_can_read_tenant_usage_console(authed_client: TestClient) -> None:
    response = authed_client.get(
        "/api/admin/tenants/usage",
        headers={"Authorization": "Bearer admin-token"},
    )
    assert response.status_code == 200


def test_viewer_cannot_read_tenant_usage_console(authed_client: TestClient) -> None:
    response = authed_client.get(
        "/api/admin/tenants/usage",
        headers={"Authorization": "Bearer viewer-token"},
    )
    assert response.status_code == 403


def test_suspended_tenant_is_blocked_for_non_admin_routes(
    authed_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "deployment_mode", DeploymentMode.SAAS_MULTI_TENANT)
    monkeypatch.setattr(settings, "trust_tenant_header", True)

    with SessionLocal() as db:
        db.add(
            Setting(
                key="tenant:acme:admin.controls",
                value={"suspended": True, "reason": "billing"},
            )
        )
        db.commit()

    response = authed_client.get(
        "/api/templates",
        headers={"Authorization": "Bearer admin-token", "X-Tenant-ID": "acme"},
    )
    assert response.status_code == 403
    assert "suspended" in response.json()["detail"]


def test_spreadsheet_external_job_blocked_at_api(
    authed_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "require_redaction_for_external_processing", True)
    monkeypatch.setattr(settings, "presidio_redaction_enabled", True)
    monkeypatch.setattr(settings, "allow_external_processing", True)

    definition = build_template_definition()
    definition["llm_provider_settings"]["allow_external_processing"] = True
    definition["llm_provider_settings"]["mode"] = "cloud"
    definition["llm_provider_settings"]["provider_type"] = "openai"

    with SessionLocal() as db:
        template = Template(
            tenant_id="default",
            name="Sheet Schema",
            description="Sheet extraction schema.",
            document_type="invoice",
        )
        db.add(template)
        db.flush()
        version = TemplateVersion(
            tenant_id="default",
            template_id=template.id,
            version="1.0.0",
            definition=definition,
        )
        db.add(version)
        db.flush()
        document = Document(
            tenant_id="default",
            original_filename="invoice.xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            stored_path="uploads/invoice.xlsx",
            status="uploaded",
        )
        db.add(document)
        db.commit()
        version_id = version.id
        document_id = document.id

    response = authed_client.post(
        "/api/jobs",
        headers={"Authorization": "Bearer operator-token"},
        json={"document_id": document_id, "template_version_id": version_id},
    )
    assert response.status_code == 400
    assert "spreadsheet documents are not yet supported" in response.json()["detail"]
