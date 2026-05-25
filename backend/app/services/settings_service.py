from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.tenant import build_tenant_setting_key
from app.models import Setting


def get_tenant_bool_setting(
    db: Session,
    tenant_id: str,
    setting_name: str,
    *,
    default: bool = False,
) -> bool:
    setting_key = build_tenant_setting_key(tenant_id, setting_name)
    setting = db.query(Setting).filter(Setting.key == setting_key).first()
    if not setting:
        return default
    value = setting.value
    if isinstance(value, bool):
        return value
    if isinstance(value, dict) and "enabled" in value:
        return bool(value["enabled"])
    return default
