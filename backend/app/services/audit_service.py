from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditEvent


def _metadata_id_matches(value: Any, expected: int) -> bool:
    if value is None:
        return False
    try:
        return int(value) == expected
    except (TypeError, ValueError):
        return False


def record_audit_event(
    db: Session,
    *,
    tenant_id: str,
    actor: str,
    action: str,
    object_type: str,
    object_id: str | int,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    event = AuditEvent(
        tenant_id=tenant_id,
        actor=actor,
        action=action,
        object_type=object_type,
        object_id=str(object_id),
        metadata_json=metadata or {},
    )
    db.add(event)
    return event


def _build_audit_event_query(
    db: Session,
    *,
    tenant_id: str,
    action: str | None = None,
    from_time: datetime | None = None,
    to_time: datetime | None = None,
):
    query = db.query(AuditEvent).filter(AuditEvent.tenant_id == tenant_id)
    if action:
        query = query.filter(AuditEvent.action == action)
    if from_time:
        query = query.filter(AuditEvent.created_at >= from_time)
    if to_time:
        query = query.filter(AuditEvent.created_at <= to_time)
    return query


def _filter_audit_events_by_metadata(
    events: list[AuditEvent],
    *,
    result_id: int | None = None,
    document_id: int | None = None,
    job_id: int | None = None,
) -> list[AuditEvent]:
    if not (result_id is not None or document_id is not None or job_id is not None):
        return events

    filtered: list[AuditEvent] = []
    for event in events:
        metadata = event.metadata_json or {}
        if result_id is not None and not _metadata_id_matches(metadata.get("result_id"), result_id):
            continue
        if document_id is not None and not _metadata_id_matches(metadata.get("document_id"), document_id):
            continue
        if job_id is not None and not _metadata_id_matches(metadata.get("job_id"), job_id):
            continue
        filtered.append(event)
    return filtered


def list_audit_events_page(
    db: Session,
    *,
    tenant_id: str,
    result_id: int | None = None,
    document_id: int | None = None,
    job_id: int | None = None,
    action: str | None = None,
    from_time: datetime | None = None,
    to_time: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[AuditEvent], int]:
    query = _build_audit_event_query(
        db,
        tenant_id=tenant_id,
        action=action,
        from_time=from_time,
        to_time=to_time,
    )
    ordered_query = query.order_by(AuditEvent.created_at.desc())
    metadata_filtered = result_id is not None or document_id is not None or job_id is not None

    if not metadata_filtered:
        events = ordered_query.offset(offset).limit(limit).all()
        return events, query.count()

    filtered_events = _filter_audit_events_by_metadata(
        ordered_query.all(),
        result_id=result_id,
        document_id=document_id,
        job_id=job_id,
    )
    total = len(filtered_events)
    return filtered_events[offset : offset + limit], total


def list_audit_events(
    db: Session,
    *,
    tenant_id: str,
    result_id: int | None = None,
    document_id: int | None = None,
    job_id: int | None = None,
    action: str | None = None,
    from_time: datetime | None = None,
    to_time: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[AuditEvent]:
    events, _ = list_audit_events_page(
        db,
        tenant_id=tenant_id,
        result_id=result_id,
        document_id=document_id,
        job_id=job_id,
        action=action,
        from_time=from_time,
        to_time=to_time,
        limit=limit,
        offset=offset,
    )
    return events
