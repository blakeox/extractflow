from __future__ import annotations

from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.tenant import build_tenant_setting_key
from app.models import Document, ExportRecord, ExtractionJob, ExtractionResult, Setting, Template

_TENANT_CONTROLS_SETTING = "admin.controls"


def get_tenant_controls(db: Session, tenant_id: str) -> dict[str, object]:
    setting_key = build_tenant_setting_key(tenant_id, _TENANT_CONTROLS_SETTING)
    setting = db.query(Setting).filter(Setting.key == setting_key).first()
    if not setting or not isinstance(setting.value, dict):
        return {"suspended": False, "reason": None, "updated_at": None}
    payload = setting.value
    return {
        "suspended": bool(payload.get("suspended", False)),
        "reason": payload.get("reason"),
        "updated_at": payload.get("updated_at"),
    }


def set_tenant_suspension(db: Session, tenant_id: str, *, suspended: bool, reason: str | None) -> dict[str, object]:
    setting_key = build_tenant_setting_key(tenant_id, _TENANT_CONTROLS_SETTING)
    setting = db.query(Setting).filter(Setting.key == setting_key).first()
    payload = {
        "suspended": suspended,
        "reason": reason.strip() if isinstance(reason, str) and reason.strip() else None,
        "updated_at": datetime.now().isoformat(),
    }
    if setting:
        setting.value = payload  # type: ignore[reportAttributeAccessIssue]
    else:
        db.add(Setting(key=setting_key, value=payload))
    db.commit()
    return payload


def is_tenant_suspended(db: Session, tenant_id: str) -> bool:
    return bool(get_tenant_controls(db, tenant_id).get("suspended", False))


def list_tenant_usage(db: Session) -> list[dict[str, object]]:
    tenant_ids: set[str] = set()
    tenant_id_sources = (
        db.query(Document.tenant_id).distinct().all(),
        db.query(Template.tenant_id).distinct().all(),
        db.query(ExtractionJob.tenant_id).distinct().all(),
        db.query(ExtractionResult.tenant_id).distinct().all(),
        db.query(ExportRecord.tenant_id).distinct().all(),
    )
    for rows in tenant_id_sources:
        for (tenant_id,) in rows:
            if isinstance(tenant_id, str) and tenant_id:
                tenant_ids.add(tenant_id)

    summaries: list[dict[str, object]] = []
    for tenant_id in sorted(tenant_ids):
        controls = get_tenant_controls(db, tenant_id)
        completed_jobs = (
            db.query(func.count(ExtractionJob.id))
            .filter(ExtractionJob.tenant_id == tenant_id, ExtractionJob.status == "completed")
            .scalar()
        )
        latest_activity = (
            db.query(func.max(ExtractionJob.updated_at)).filter(ExtractionJob.tenant_id == tenant_id).scalar()
        )
        summaries.append(
            {
                "tenant_id": tenant_id,
                "suspended": bool(controls.get("suspended", False)),
                "suspension_reason": controls.get("reason"),
                "documents": db.query(Document).filter(Document.tenant_id == tenant_id).count(),
                "jobs_completed": int(completed_jobs or 0),
                "results": db.query(ExtractionResult).filter(ExtractionResult.tenant_id == tenant_id).count(),
                "exports": db.query(ExportRecord).filter(ExportRecord.tenant_id == tenant_id).count(),
                "latest_activity_at": latest_activity,
            }
        )
    return summaries
