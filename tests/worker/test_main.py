from __future__ import annotations

import os
from pathlib import Path

from app import main as worker_main


def test_initialize_worker_runtime_records_docling_startup_details(monkeypatch) -> None:
    statuses: list[tuple[str, dict | None]] = []

    monkeypatch.setattr(
        worker_main.settings.__class__,
        "ensure_paths",
        lambda self: None,
    )
    monkeypatch.setattr(worker_main.settings, "docling_enabled", True)
    monkeypatch.setattr(worker_main.settings, "docling_prewarm", True)
    monkeypatch.setattr(worker_main.settings, "docling_pdf_ocr_retry", True)
    monkeypatch.setattr(worker_main.settings, "docling_image_ocr", False)
    monkeypatch.setattr(
        worker_main,
        "write_worker_status",
        lambda state, details=None: statuses.append((state, details)),
    )
    monkeypatch.setattr(
        worker_main,
        "prewarm_docling_converters",
        lambda: {"status": "completed", "attempted": True, "warmed_targets": ["pdf:plain", "pptx:plain"]},
    )

    worker_main.initialize_worker_runtime()

    assert statuses[0] == (
        "starting",
        {
            "docling_enabled": True,
            "docling_prewarm": True,
            "docling_pdf_ocr_retry": True,
            "docling_image_ocr": False,
        },
    )
    assert statuses[1] == (
        "starting",
        {
            "docling_enabled": True,
            "docling_prewarm": True,
            "docling_pdf_ocr_retry": True,
            "docling_image_ocr": False,
            "docling_prewarm_result": {
                "status": "completed",
                "attempted": True,
                "warmed_targets": ["pdf:plain", "pptx:plain"],
            },
        },
    )


def test_main_prewarms_docling_when_enabled(monkeypatch) -> None:
    events: list[object] = []

    monkeypatch.setattr(
        worker_main.settings.__class__,
        "ensure_paths",
        lambda self: events.append("ensure_paths"),
    )
    monkeypatch.setattr(worker_main.settings, "docling_prewarm", True)
    monkeypatch.setattr(
        worker_main, "write_worker_status", lambda state, details=None: events.append(("status", state))
    )
    monkeypatch.setattr(
        worker_main,
        "prewarm_docling_converters",
        lambda: events.append("prewarm") or {"status": "completed", "attempted": True, "warmed_targets": []},
    )

    class StopLoop(RuntimeError):
        pass

    def stop_after_first_iteration() -> None:
        events.append("process_once")
        raise StopLoop

    monkeypatch.setattr(worker_main, "process_once", stop_after_first_iteration)
    monkeypatch.setattr(worker_main.time, "sleep", lambda _seconds: None)

    try:
        worker_main.main()
    except StopLoop:
        pass

    assert events[:5] == ["ensure_paths", ("status", "starting"), "prewarm", ("status", "starting"), "process_once"]


def test_main_skips_docling_prewarm_when_disabled(monkeypatch) -> None:
    events: list[object] = []

    monkeypatch.setattr(
        worker_main.settings.__class__,
        "ensure_paths",
        lambda self: events.append("ensure_paths"),
    )
    monkeypatch.setattr(worker_main.settings, "docling_prewarm", False)
    monkeypatch.setattr(
        worker_main, "write_worker_status", lambda state, details=None: events.append(("status", state))
    )
    monkeypatch.setattr(worker_main, "prewarm_docling_converters", lambda: events.append("prewarm"))

    class StopLoop(RuntimeError):
        pass

    def stop_after_first_iteration() -> None:
        events.append("process_once")
        raise StopLoop

    monkeypatch.setattr(worker_main, "process_once", stop_after_first_iteration)
    monkeypatch.setattr(worker_main.time, "sleep", lambda _seconds: None)

    try:
        worker_main.main()
    except StopLoop:
        pass

    assert events[:3] == ["ensure_paths", ("status", "starting"), "process_once"]
    assert "prewarm" not in events


def test_claim_next_job_claims_oldest_queued_job_once() -> None:
    from app.core.database import SessionLocal
    from app.models import ExtractionJob

    with SessionLocal() as db:
        first = ExtractionJob(document_id=1, template_version_id=1, status="queued")
        second = ExtractionJob(document_id=2, template_version_id=2, status="queued")
        db.add_all([first, second])
        db.commit()
        first_id = first.id
        second_id = second.id

    with SessionLocal() as db:
        claimed = worker_main.claim_next_job(db)
        assert claimed is not None
        assert claimed.id == first_id
        assert claimed.status == "running"
        assert claimed.worker_id == worker_main.WORKER_ID
        assert claimed.attempt_count == 1
        assert claimed.claimed_at is not None

        no_second_claim = worker_main.claim_next_job(db)
        assert no_second_claim is not None
        assert no_second_claim.id == second_id

    with SessionLocal() as db:
        first_job = db.get(ExtractionJob, first_id)
        second_job = db.get(ExtractionJob, second_id)
        assert first_job is not None and first_job.status == "running"
        assert second_job is not None and second_job.status == "running"


def test_process_once_fails_job_when_tenant_chain_is_inconsistent(monkeypatch) -> None:
    from app.core.database import SessionLocal
    from app.main import process_once
    from app.models import Document, ExtractionJob, TemplateVersion

    with SessionLocal() as db:
        document = Document(
            tenant_id="tenant-a",
            original_filename="invoice.txt",
            content_type="text/plain",
            stored_path="uploads/invoice.txt",
            status="uploaded",
        )
        db.add(document)
        db.flush()
        version = TemplateVersion(
            tenant_id="tenant-b",
            template_id=1,
            version="1.0.0",
            definition={"template_name": "Invoice Extraction", "template_version": "1.0.0", "extracted_fields": []},
        )
        db.add(version)
        db.flush()
        job = ExtractionJob(
            tenant_id="tenant-a",
            document_id=document.id,
            template_version_id=version.id,
            status="queued",
        )
        db.add(job)
        db.commit()
        job_id = job.id

    monkeypatch.setattr(worker_main, "execute_extraction", lambda **kwargs: {"unexpected": True})

    process_once()

    with SessionLocal() as db:
        from app.models import AuditEvent

        refreshed_job = db.get(ExtractionJob, job_id)
        assert refreshed_job is not None
        assert refreshed_job.status == "failed"
        assert "Tenant mismatch between job, document, and template version." in refreshed_job.error_message
        failed_events = (
            db.query(AuditEvent).filter(AuditEvent.action == "job.failed", AuditEvent.object_id == str(job_id)).all()
        )
        assert len(failed_events) == 1
        assert failed_events[0].metadata_json["job_id"] == job_id


def test_process_once_stops_when_job_cancelled_during_parse(monkeypatch) -> None:
    from app.core.database import SessionLocal
    from app.models import Document, ExtractionJob, TemplateVersion

    uploads_dir = Path(os.environ["UPLOADS_DIR"])
    uploads_dir.mkdir(parents=True, exist_ok=True)
    document_path = uploads_dir / "invoice.txt"
    document_path.write_text("Vendor Name: Acme", encoding="utf-8")

    with SessionLocal() as db:
        document = Document(
            original_filename="invoice.txt",
            content_type="text/plain",
            stored_path="uploads/invoice.txt",
            status="uploaded",
        )
        db.add(document)
        db.flush()
        version = TemplateVersion(
            template_id=1,
            version="1.0.0",
            definition={
                "template_name": "Invoice Extraction",
                "template_version": "1.0.0",
                "extracted_fields": [],
            },
        )
        db.add(version)
        db.flush()
        job = ExtractionJob(
            document_id=document.id,
            template_version_id=version.id,
            status="queued",
        )
        db.add(job)
        db.commit()
        job_id = job.id
        document_id = document.id

    def cancel_during_parse(document_id_arg: int, document_path_arg: str) -> tuple[str, str]:
        with SessionLocal() as db:
            queued_job = db.get(ExtractionJob, job_id)
            assert queued_job is not None
            queued_job.status = "cancelled"
            db.commit()
        return ("parsed/invoice.txt", "Vendor Name: Acme")

    def fail_execute(**_kwargs: object) -> dict[str, object]:
        raise AssertionError("execute_extraction should not run")

    monkeypatch.setattr(
        worker_main,
        "parse_and_persist_document_text",
        cancel_during_parse,
    )
    monkeypatch.setattr(worker_main, "execute_extraction", fail_execute)
    monkeypatch.setattr(worker_main, "write_worker_status", lambda *_args, **_kwargs: None)

    worker_main.process_once()

    with SessionLocal() as db:
        from app.models import ExtractionResult

        refreshed_job = db.get(ExtractionJob, job_id)
        refreshed_document = db.get(Document, document_id)
        assert refreshed_job is not None
        assert refreshed_job.status == "cancelled"
        assert refreshed_document is not None
        assert refreshed_document.status == "uploaded"
        assert db.query(ExtractionResult).filter(ExtractionResult.job_id == job_id).count() == 0


def test_process_once_records_job_completed_audit_event(monkeypatch) -> None:
    from app.core.database import SessionLocal
    from app.models import AuditEvent, Document, ExtractionJob, TemplateVersion

    uploads_dir = Path(os.environ["UPLOADS_DIR"])
    uploads_dir.mkdir(parents=True, exist_ok=True)
    document_path = uploads_dir / "invoice-complete.txt"
    document_path.write_text("Vendor Name: Acme", encoding="utf-8")

    with SessionLocal() as db:
        document = Document(
            original_filename="invoice-complete.txt",
            content_type="text/plain",
            stored_path="uploads/invoice-complete.txt",
            status="uploaded",
        )
        db.add(document)
        db.flush()
        version = TemplateVersion(
            template_id=1,
            version="1.0.0",
            definition={
                "template_name": "Invoice Extraction",
                "template_version": "1.0.0",
                "extracted_fields": [],
            },
        )
        db.add(version)
        db.flush()
        job = ExtractionJob(
            document_id=document.id,
            template_version_id=version.id,
            status="queued",
        )
        db.add(job)
        db.commit()
        job_id = job.id

    def fake_execute_extraction(**kwargs):
        return {
            "document_id": str(kwargs["document_id"]),
            "document_type": "invoice",
            "template_name": "Invoice Extraction",
            "template_version": "1.0.0",
            "llm_provider": {},
            "extraction_status": "completed",
            "extracted_fields": [],
            "calculated_fields": [],
            "fields_requiring_review": [],
            "document_level_notes": [],
            "reviewed_at": None,
        }

    monkeypatch.setattr(worker_main, "execute_extraction", fake_execute_extraction)
    monkeypatch.setattr(worker_main, "write_worker_status", lambda *_args, **_kwargs: None)

    worker_main.process_once()

    with SessionLocal() as db:
        events = (
            db.query(AuditEvent).filter(AuditEvent.action == "job.completed", AuditEvent.object_id == str(job_id)).all()
        )
        assert len(events) == 1
        assert events[0].metadata_json["job_id"] == job_id
