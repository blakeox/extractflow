from __future__ import annotations

from enum import Enum


class DeploymentMode(str, Enum):
    LOCAL = "local"
    HOSTED_SINGLE_TENANT = "hosted_single_tenant"
    SAAS_MULTI_TENANT = "saas_multi_tenant"


def tenant_mode_for_deployment(mode: DeploymentMode) -> str:
    if mode == DeploymentMode.SAAS_MULTI_TENANT:
        return "multi_tenant"
    return "single_tenant"


def is_sqlite_url(database_url: str) -> bool:
    return database_url.startswith("sqlite:///")


def is_postgres_url(database_url: str) -> bool:
    return database_url.startswith(("postgresql://", "postgresql+psycopg://", "postgres://"))


def validate_supported_database_url(database_url: str) -> str:
    normalized = database_url.strip()
    if is_sqlite_url(normalized) or is_postgres_url(normalized):
        return normalized
    raise ValueError("DATABASE_URL must use sqlite:/// or a PostgreSQL URL.")


def database_connect_args(database_url: str) -> dict[str, object]:
    if is_sqlite_url(database_url):
        return {"check_same_thread": False}
    return {}
