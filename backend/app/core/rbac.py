from __future__ import annotations

from enum import StrEnum


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
