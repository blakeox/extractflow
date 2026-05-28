from __future__ import annotations

from enum import StrEnum

from fastapi import Depends, HTTPException

from app.core.auth import AuthContext, resolve_auth_context


class Role(StrEnum):
    ADMIN = "admin"
    OPERATOR = "operator"
    REVIEWER = "reviewer"
    VIEWER = "viewer"


class Permission(StrEnum):
    READ = "read"
    RUN_JOBS = "run_jobs"
    REVIEW = "review"
    EXPORT = "export"
    WRITE_SCHEMA = "write_schema"
    MANAGE_SETTINGS = "manage_settings"
    DEV_STATUS = "dev_status"


ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.VIEWER: frozenset({Permission.READ}),
    Role.REVIEWER: frozenset({Permission.READ, Permission.REVIEW, Permission.EXPORT}),
    Role.OPERATOR: frozenset({Permission.READ, Permission.RUN_JOBS}),
    Role.ADMIN: frozenset(Permission),
}


def _parse_role(value: str) -> Role:
    try:
        return Role(value.lower())
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=f"Unknown role: {value}") from exc


def require_permission(permission: Permission):
    def dependency(auth: AuthContext = Depends(resolve_auth_context)) -> AuthContext:
        role = _parse_role(auth.role)
        allowed = ROLE_PERMISSIONS[role]
        if permission not in allowed:
            raise HTTPException(status_code=403, detail=f"Role '{role.value}' cannot perform this action.")
        return auth

    return dependency
