from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path

from app.db.database import SessionLocal
from app.models import Document, ExtractionJob, ExtractionResult, ReviewEdit, Template, TemplateVersion
from app.services.langextract_feedback import (
    list_langextract_feedback_suggestions,
    set_langextract_feedback_suggestion_dismissed,
)

from tests.support.sample_data import build_template_definition


def _build_result_payload(
    *,
    document_id: int,
    llm_provider: dict,
    vendor_start: int,
    vendor_end: int,
    amount_start: int | None = None,
    amount_end: int | None = None,
    include_amount: bool = True,
    reviewed_at: str = "2026-05-10T12:00:00Z",
) -> dict:
    extracted_fields = [
        {
            "field_name": "vendor_name",
            "label": "Vendor Name",
            "field_kind": "extracted",
            "data_type": "text",
            "extracted_value": "Acme Corp",
            "normalized_value": {"value": "Acme Corporation"},
            "confidence_score": 1.0,
            "source_text": "Acme Corp",
            "char_start": vendor_start,
            "char_end": vendor_end,
            "page_number": 1,
            "location_reference": "Page 1",
            "validation_status": "reviewed",
            "validation_errors": [],
            "extraction_notes": "LangExtract grounded chars.",
            "requires_review": False,
        }
    ]
    if include_amount and amount_start is not None and amount_end is not None:
        extracted_fields.append(
            {
                "field_name": "total_amount",
                "label": "Total Amount",
                "field_kind": "extracted",
                "data_type": "currency",
                "extracted_value": "$1,200.00",
                "normalized_value": {
                    "amount": 1200,
                    "currency": "USD",
                    "display_value": "$1,200.00",
                },
                "confidence_score": 1.0,
                "source_text": "$1,200.00",
                "char_start": amount_start,
                "char_end": amount_end,
                "page_number": 1,
                "location_reference": "Page 1",
                "validation_status": "valid",
                "validation_errors": [],
                "extraction_notes": "LangExtract grounded chars.",
                "requires_review": False,
            }
        )
    return {
        "document_id": str(document_id),
        "document_type": "invoice",
        "template_name": "Invoice Extraction",
        "template_version": "1.0.0",
        "llm_provider": llm_provider,
        "extraction_status": "completed",
        "extracted_fields": extracted_fields,
        "calculated_fields": [],
        "fields_requiring_review": [],
        "document_level_notes": [],
        "reviewed_at": reviewed_at,
    }


def _create_langextract_template_version(db) -> TemplateVersion:
    definition = build_template_definition()
    definition["llm_provider_settings"] = {
        **definition["llm_provider_settings"],
        "provider_type": "langextract",
        "provider_label": "LangExtract (Ollama)",
        "api_style": "langextract",
        "base_url": "http://host.docker.internal:11434/v1",
        "supports_json_mode": False,
    }
    template = Template(
        name=f"Invoice Schema {datetime.now(UTC).isoformat()}",
        description="Invoice extraction schema.",
        document_type="invoice",
    )
    db.add(template)
    db.flush()
    version = TemplateVersion(template_id=template.id, version="1.0.0", definition=definition)
    db.add(version)
    db.flush()
    return version


def _create_result_with_review_edit(
    db,
    *,
    template_version_id: int,
    parsed_text_path: str | None,
    stored_path: str,
    content_type: str,
    result_json: dict,
    reviewed_field_name: str = "vendor_name",
) -> tuple[int, int]:
    document = Document(
        original_filename="invoice.txt",
        content_type=content_type,
        stored_path=stored_path,
        parsed_text_path=parsed_text_path,
        status="completed",
    )
    db.add(document)
    db.flush()
    job = ExtractionJob(document_id=document.id, template_version_id=template_version_id, status="completed")
    db.add(job)
    db.flush()
    result = ExtractionResult(job_id=job.id, result_json=result_json, review_status="reviewed")
    db.add(result)
    db.flush()
    db.add(
        ReviewEdit(
            result_id=result.id,
            reviewer="qa-user",
            field_name=reviewed_field_name,
            previous_value={"value": "Acme Corp"},
            new_value={"value": "Acme Corporation"},
            reason="Normalized legal name.",
        )
    )
    db.commit()
    return result.id, document.id


def test_list_langextract_feedback_suggestions_dedupes_matching_review_examples() -> None:
    parsed_text = "Invoice Vendor: Acme Corp\nTotal Due: $1,200.00\n"
    parsed_path = Path(os.environ["PARSED_DIR"]) / "langextract-feedback-dedupe.txt"
    parsed_path.write_text(parsed_text, encoding="utf-8")
    vendor_start = parsed_text.index("Acme Corp")
    vendor_end = vendor_start + len("Acme Corp")
    amount_start = parsed_text.index("$1,200.00")
    amount_end = amount_start + len("$1,200.00")

    with SessionLocal() as db:
        version = _create_langextract_template_version(db)
        payload = _build_result_payload(
            document_id=1,
            llm_provider=version.definition["llm_provider_settings"],
            vendor_start=vendor_start,
            vendor_end=vendor_end,
            amount_start=amount_start,
            amount_end=amount_end,
        )
        _create_result_with_review_edit(
            db,
            template_version_id=version.id,
            parsed_text_path=str(parsed_path),
            stored_path=str(parsed_path),
            content_type="text/plain",
            result_json=payload,
        )
        _create_result_with_review_edit(
            db,
            template_version_id=version.id,
            parsed_text_path=str(parsed_path),
            stored_path=str(parsed_path),
            content_type="text/plain",
            result_json=payload,
        )

        feedback = list_langextract_feedback_suggestions(db, version)

    assert feedback.diagnostics.reviewed_result_count == 2
    assert feedback.diagnostics.reviewed_edit_count == 2
    assert feedback.diagnostics.generated_suggestion_count == 1
    assert feedback.diagnostics.visible_suggestion_count == 1
    assert len(feedback.suggestions) == 1
    suggestion = feedback.suggestions[0]
    assert suggestion.example_text == parsed_text.strip()
    assert suggestion.occurrence_count == 2
    assert len(suggestion.source_result_ids) == 2
    assert suggestion.source_field_names == ["vendor_name"]
    assert [item.extraction_class for item in suggestion.extractions] == [
        "vendor_name",
        "total_amount",
    ]


def test_list_langextract_feedback_suggestions_returns_empty_without_readable_document_text() -> None:
    with SessionLocal() as db:
        version = _create_langextract_template_version(db)
        payload = _build_result_payload(
            document_id=1,
            llm_provider=version.definition["llm_provider_settings"],
            vendor_start=0,
            vendor_end=9,
            include_amount=False,
        )
        _create_result_with_review_edit(
            db,
            template_version_id=version.id,
            parsed_text_path=None,
            stored_path=str(Path(os.environ["PARSED_DIR"]) / "missing-file.txt"),
            content_type="application/pdf",
            result_json=payload,
        )

        feedback = list_langextract_feedback_suggestions(db, version)

    assert feedback.suggestions == []
    assert feedback.diagnostics.skipped_missing_document_text == 1


def test_list_langextract_feedback_suggestions_skips_stale_document_span_mismatches() -> None:
    parsed_text = "Invoice Vendor: Different Corp\n"
    parsed_path = Path(os.environ["PARSED_DIR"]) / "langextract-feedback-stale-span.txt"
    parsed_path.write_text(parsed_text, encoding="utf-8")

    with SessionLocal() as db:
        version = _create_langextract_template_version(db)
        payload = _build_result_payload(
            document_id=1,
            llm_provider=version.definition["llm_provider_settings"],
            vendor_start=0,
            vendor_end=len("Acme Corp"),
            include_amount=False,
        )
        _create_result_with_review_edit(
            db,
            template_version_id=version.id,
            parsed_text_path=str(parsed_path),
            stored_path=str(parsed_path),
            content_type="text/plain",
            result_json=payload,
        )

        feedback = list_langextract_feedback_suggestions(db, version)

    assert feedback.suggestions == []
    assert feedback.diagnostics.skipped_span_mismatch == 1


def test_list_langextract_feedback_suggestions_filters_persisted_dismissals() -> None:
    parsed_text = "Invoice Vendor: Acme Corp\nTotal Due: $1,200.00\n"
    parsed_path = Path(os.environ["PARSED_DIR"]) / "langextract-feedback-dismissed.txt"
    parsed_path.write_text(parsed_text, encoding="utf-8")
    vendor_start = parsed_text.index("Acme Corp")
    vendor_end = vendor_start + len("Acme Corp")
    amount_start = parsed_text.index("$1,200.00")
    amount_end = amount_start + len("$1,200.00")

    with SessionLocal() as db:
        version = _create_langextract_template_version(db)
        payload = _build_result_payload(
            document_id=1,
            llm_provider=version.definition["llm_provider_settings"],
            vendor_start=vendor_start,
            vendor_end=vendor_end,
            amount_start=amount_start,
            amount_end=amount_end,
        )
        _create_result_with_review_edit(
            db,
            template_version_id=version.id,
            parsed_text_path=str(parsed_path),
            stored_path=str(parsed_path),
            content_type="text/plain",
            result_json=payload,
        )

        feedback = list_langextract_feedback_suggestions(db, version)
        assert len(feedback.suggestions) == 1

        dismissal = set_langextract_feedback_suggestion_dismissed(db, version, feedback.suggestions[0].key, True)
        feedback_after_dismissal = list_langextract_feedback_suggestions(db, version)

    assert dismissal.dismissed is True
    assert feedback_after_dismissal.suggestions == []
    assert feedback_after_dismissal.diagnostics.dismissed_suggestion_count == 1


def test_list_langextract_feedback_suggestions_skips_non_langextract_templates() -> None:
    with SessionLocal() as db:
        definition = build_template_definition()
        template = Template(
            name="Mock Invoice Schema", description="Invoice extraction schema.", document_type="invoice"
        )
        db.add(template)
        db.flush()
        version = TemplateVersion(template_id=template.id, version="1.0.0", definition=definition)
        db.add(version)
        db.commit()

        feedback = list_langextract_feedback_suggestions(db, version)

    assert feedback.suggestions == []
