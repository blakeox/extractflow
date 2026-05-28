from __future__ import annotations

from app.core.rbac import Permission


def resolve_api_permission(method: str, path: str, *, api_prefix: str) -> Permission | None:
    prefix = api_prefix.rstrip("/")
    if not path.startswith(prefix):
        return None
    relative = path[len(prefix) :] or "/"

    if relative == "/health":
        return None
    if relative == "/dev/status":
        return Permission.DEV_STATUS
    if method == "GET" and relative.endswith("/download") and relative.startswith("/exports/"):
        return Permission.EXPORT
    if method == "POST" and "/review" in relative:
        return Permission.REVIEW
    if method == "POST" and "/exports/" in relative:
        return Permission.EXPORT
    if method == "PUT" and relative.startswith("/settings/"):
        return Permission.MANAGE_SETTINGS
    if method == "POST" and relative.startswith("/settings/providers/"):
        return Permission.MANAGE_SETTINGS
    if method == "DELETE" and relative.startswith("/settings/providers/custom/"):
        return Permission.MANAGE_SETTINGS
    if method == "POST" and relative == "/documents":
        return Permission.RUN_JOBS
    if method == "POST" and relative == "/jobs":
        return Permission.RUN_JOBS
    if method == "POST" and (relative.endswith("/retry") or relative.endswith("/cancel")):
        return Permission.RUN_JOBS
    if (
        method == "POST"
        and relative.startswith("/templates")
        and relative
        not in {
            "/templates/dry-run",
            "/templates/version-diff",
        }
    ):
        return Permission.WRITE_SCHEMA
    if method == "PUT" and relative.startswith("/template-versions/") and "/dismissal" in relative:
        return Permission.MANAGE_SETTINGS
    if method == "GET":
        return Permission.READ
    return Permission.READ
