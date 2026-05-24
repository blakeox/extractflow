from __future__ import annotations

from app.db.database import SessionLocal
from app.services.audit_service import list_audit_events, record_audit_event


def test_list_audit_events_matches_metadata_ids_as_strings() -> None:
    with SessionLocal() as db:
        record_audit_event(
            db,
            tenant_id="default",
            actor="qa-user",
            action="review.saved",
            object_type="result",
            object_id=21,
            metadata={"result_id": "21", "job_id": "7", "document_id": "2"},
        )
        record_audit_event(
            db,
            tenant_id="default",
            actor="qa-user",
            action="export.created",
            object_type="export",
            object_id=99,
            metadata={"result_id": 22, "job_id": 8},
        )
        db.commit()

        by_result = list_audit_events(db, tenant_id="default", result_id=21)
        assert len(by_result) == 1
        assert by_result[0].action == "review.saved"

        by_job = list_audit_events(db, tenant_id="default", job_id=7)
        assert len(by_job) == 1
        assert by_job[0].action == "review.saved"

        by_action = list_audit_events(db, tenant_id="default", action="export.created")
        assert len(by_action) == 1
        assert by_action[0].object_id == "99"
