from __future__ import annotations

from extraction_core.tenancy import normalize_tenant_id
from fastapi import Header, HTTPException

from app.core.config import settings


def current_tenant_id_dependency(x_tenant_id: str | None = Header(default=None, alias="X-Tenant-ID")) -> str:
    if not settings.trust_tenant_header or settings.deployment_mode.value != "saas_multi_tenant":
        return settings.current_tenant_id
    if x_tenant_id is None:
        raise HTTPException(status_code=400, detail="X-Tenant-ID header is required for this deployment.")
    try:
        return normalize_tenant_id(x_tenant_id, source="X-Tenant-ID")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def get_current_tenant_id(x_tenant_id: str | None = Header(default=None, alias="X-Tenant-ID")) -> str:
    return current_tenant_id_dependency(x_tenant_id)


def build_tenant_setting_key(tenant_id: str, key: str) -> str:
    return f"tenant:{tenant_id}:{key}"
