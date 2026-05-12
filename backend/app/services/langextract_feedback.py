from __future__ import annotations

import json
from collections import Counter, defaultdict
from hashlib import sha256
from pathlib import Path

from extraction_core.langextract import uses_langextract_provider
from extraction_core.langextract_feedback import build_langextract_feedback_attributes
from extraction_core.models import ExtractionFieldDefinition, ExtractionTemplate, ExtractionValidationSummary
from extraction_core.observability import configure_logger, log_event
from sqlalchemy.orm import Session

from app.models import (
    Document,
    ExtractionJob,
    ExtractionResult,
    LangExtractFeedbackDecision,
    ReviewEdit,
    TemplateVersion,
)
from app.schemas.api import (
    LangExtractFeedbackDiagnosticsResponse,
    LangExtractFeedbackSuggestionDismissalResponse,
    LangExtractFeedbackSuggestionExtractionResponse,
    LangExtractFeedbackSuggestionListResponse,
    LangExtractFeedbackSuggestionResponse,
)

CONTEXT_RADIUS = 160
SKIP_MISSING_DOCUMENT_TEXT = "missing_document_text"
SKIP_MISSING_TARGET_FIELD = "missing_target_field"
SKIP_MISSING_GROUNDING = "missing_grounding"
SKIP_SPAN_OVERRIDE = "span_override"
SKIP_SPAN_MISMATCH = "span_mismatch"
SKIP_EMPTY_CONTEXT = "empty_context"
SKIP_NO_CONTEXTUAL_EXTRACTIONS = "no_contextual_extractions"
logger = configure_logger("extractflow.backend.langextract_feedback")


def list_langextract_feedback_suggestions(
    db: Session, template_version: TemplateVersion
) -> LangExtractFeedbackSuggestionListResponse:
    template = ExtractionTemplate.model_validate(template_version.definition)
    if not uses_langextract_provider(
        template.llm_provider_settings.provider_type,
        template.llm_provider_settings.api_style,
    ):
        return LangExtractFeedbackSuggestionListResponse()

    result_rows = (
        db.query(ExtractionResult, ExtractionJob, Document)
        .join(ExtractionJob, ExtractionJob.id == ExtractionResult.job_id)
        .join(Document, Document.id == ExtractionJob.document_id)
        .filter(ExtractionJob.template_version_id == template_version.id)
        .all()
    )
    if not result_rows:
        return LangExtractFeedbackSuggestionListResponse()

    result_ids = [result.id for result, _, _ in result_rows]
    review_edits = (
        db.query(ReviewEdit).filter(ReviewEdit.result_id.in_(result_ids)).order_by(ReviewEdit.created_at.asc()).all()
    )
    edits_by_result: dict[int, list[ReviewEdit]] = defaultdict(list)
    for edit in review_edits:
        edits_by_result[edit.result_id].append(edit)

    field_definitions = {field.name: field for field in template.extracted_fields}
    grouped: dict[str, LangExtractFeedbackSuggestionResponse] = {}
    skip_counts: Counter[str] = Counter()

    for result, _, document in result_rows:
        if result.id not in edits_by_result:
            continue
        document_text = _read_document_text(document)
        if not document_text:
            skip_counts[SKIP_MISSING_DOCUMENT_TEXT] += len(edits_by_result[result.id])
            continue
        summary = ExtractionValidationSummary.model_validate(result.result_json)
        for edit in edits_by_result[result.id]:
            candidate, skip_reason = _build_candidate_suggestion(
                template_version_id=template_version.id,
                result_id=result.id,
                summary=summary,
                field_definitions=field_definitions,
                document_text=document_text,
                review_edit=edit,
            )
            if candidate is None:
                if skip_reason:
                    skip_counts[skip_reason] += 1
                continue
            existing = grouped.get(candidate.key)
            if existing is None:
                grouped[candidate.key] = candidate
                continue
            existing.occurrence_count += 1
            if result.id not in existing.source_result_ids:
                existing.source_result_ids.append(result.id)
            if edit.field_name not in existing.source_field_names:
                existing.source_field_names.append(edit.field_name)
            if candidate.last_reviewed_at and (
                existing.last_reviewed_at is None or candidate.last_reviewed_at > existing.last_reviewed_at
            ):
                existing.last_reviewed_at = candidate.last_reviewed_at

    dismissed_keys = _get_dismissed_suggestion_keys(db, template_version.id, list(grouped))
    suggestions = sorted(
        (suggestion for suggestion in grouped.values() if suggestion.key not in dismissed_keys),
        key=lambda item: (
            -item.occurrence_count,
            item.last_reviewed_at.isoformat() if item.last_reviewed_at else "",
            item.key,
        ),
    )
    response = LangExtractFeedbackSuggestionListResponse(
        suggestions=suggestions,
        diagnostics=LangExtractFeedbackDiagnosticsResponse(
            reviewed_result_count=len(result_rows),
            reviewed_edit_count=len(review_edits),
            generated_suggestion_count=len(grouped),
            dismissed_suggestion_count=len(dismissed_keys),
            visible_suggestion_count=len(suggestions),
            skipped_missing_document_text=skip_counts[SKIP_MISSING_DOCUMENT_TEXT],
            skipped_missing_target_field=skip_counts[SKIP_MISSING_TARGET_FIELD],
            skipped_missing_grounding=skip_counts[SKIP_MISSING_GROUNDING],
            skipped_span_override=skip_counts[SKIP_SPAN_OVERRIDE],
            skipped_span_mismatch=skip_counts[SKIP_SPAN_MISMATCH],
            skipped_empty_context=skip_counts[SKIP_EMPTY_CONTEXT],
            skipped_no_contextual_extractions=skip_counts[SKIP_NO_CONTEXTUAL_EXTRACTIONS],
        ),
    )
    log_event(
        logger,
        20,
        "langextract_feedback_suggestions_built",
        template_version_id=template_version.id,
        reviewed_result_count=response.diagnostics.reviewed_result_count,
        reviewed_edit_count=response.diagnostics.reviewed_edit_count,
        generated_suggestion_count=response.diagnostics.generated_suggestion_count,
        visible_suggestion_count=response.diagnostics.visible_suggestion_count,
        dismissed_suggestion_count=response.diagnostics.dismissed_suggestion_count,
        skipped_missing_document_text=response.diagnostics.skipped_missing_document_text,
        skipped_missing_target_field=response.diagnostics.skipped_missing_target_field,
        skipped_missing_grounding=response.diagnostics.skipped_missing_grounding,
        skipped_span_override=response.diagnostics.skipped_span_override,
        skipped_span_mismatch=response.diagnostics.skipped_span_mismatch,
        skipped_empty_context=response.diagnostics.skipped_empty_context,
        skipped_no_contextual_extractions=response.diagnostics.skipped_no_contextual_extractions,
    )
    return response


def set_langextract_feedback_suggestion_dismissed(
    db: Session, template_version: TemplateVersion, suggestion_key: str, dismissed: bool
) -> LangExtractFeedbackSuggestionDismissalResponse:
    record = (
        db.query(LangExtractFeedbackDecision)
        .filter(
            LangExtractFeedbackDecision.template_version_id == template_version.id,
            LangExtractFeedbackDecision.suggestion_key == suggestion_key,
        )
        .first()
    )
    if record is None:
        record = LangExtractFeedbackDecision(
            template_version_id=template_version.id,
            suggestion_key=suggestion_key,
            dismissed=dismissed,
        )
        db.add(record)
    else:
        record.dismissed = dismissed
    db.commit()
    db.refresh(record)
    return LangExtractFeedbackSuggestionDismissalResponse(
        template_version_id=record.template_version_id,
        suggestion_key=record.suggestion_key,
        dismissed=record.dismissed,
        updated_at=record.updated_at,
    )


def _build_candidate_suggestion(
    *,
    template_version_id: int,
    result_id: int,
    summary: ExtractionValidationSummary,
    field_definitions: dict[str, ExtractionFieldDefinition],
    document_text: str,
    review_edit: ReviewEdit,
) -> tuple[LangExtractFeedbackSuggestionResponse | None, str | None]:
    target = next(
        (field for field in summary.extracted_fields if field.field_name == review_edit.field_name),
        None,
    )
    if target is None:
        return None, SKIP_MISSING_TARGET_FIELD
    if not _field_is_grounded(target) or not target.source_text.strip():
        return None, SKIP_MISSING_GROUNDING
    if _field_has_span_override(target):
        return None, SKIP_SPAN_OVERRIDE
    if not _field_matches_document_span(target, document_text):
        return None, SKIP_SPAN_MISMATCH

    window_start, window_end = _build_context_window(
        document_text,
        target.char_start or 0,
        target.char_end or 0,
    )
    example_text = document_text[window_start:window_end].strip()
    if not example_text:
        return None, SKIP_EMPTY_CONTEXT

    extractions: list[LangExtractFeedbackSuggestionExtractionResponse] = []
    target_included = False
    for field in sorted(
        summary.extracted_fields,
        key=lambda item: (item.char_start if item.char_start is not None else 10**9, item.field_name),
    ):
        if not _field_is_grounded(field):
            continue
        if field.char_start is None or field.char_end is None:
            continue
        if field.char_start < window_start or field.char_end > window_end:
            continue
        if not _field_matches_document_span(field, document_text):
            continue
        extraction_text = _get_feedback_extraction_text(field)
        if extraction_text is None:
            continue
        definition = field_definitions.get(field.field_name)
        attributes = build_langextract_feedback_attributes(definition, field.normalized_value)
        extractions.append(
            LangExtractFeedbackSuggestionExtractionResponse(
                extraction_class=field.field_name,
                extraction_text=extraction_text,
                attributes=attributes,
            )
        )
        if field.field_name == target.field_name:
            target_included = True

    if not target_included or not extractions:
        return None, SKIP_NO_CONTEXTUAL_EXTRACTIONS

    suggestion_key = _build_suggestion_key(example_text, extractions)
    return (
        LangExtractFeedbackSuggestionResponse(
            key=suggestion_key,
            template_version_id=template_version_id,
            example_text=example_text,
            extractions=extractions,
            occurrence_count=1,
            source_result_ids=[result_id],
            source_field_names=[review_edit.field_name],
            last_reviewed_at=summary.reviewed_at,
        ),
        None,
    )


def _get_dismissed_suggestion_keys(db: Session, template_version_id: int, suggestion_keys: list[str]) -> set[str]:
    if not suggestion_keys:
        return set()
    rows = (
        db.query(LangExtractFeedbackDecision.suggestion_key)
        .filter(
            LangExtractFeedbackDecision.template_version_id == template_version_id,
            LangExtractFeedbackDecision.dismissed.is_(True),
            LangExtractFeedbackDecision.suggestion_key.in_(suggestion_keys),
        )
        .all()
    )
    return {key for (key,) in rows}


def _read_document_text(document: Document) -> str | None:
    for candidate in (document.parsed_text_path, document.stored_path if "text" in document.content_type else None):
        if not candidate:
            continue
        path = Path(candidate)
        if not path.exists():
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if content.strip():
            return content
    return None


def _field_is_grounded(field) -> bool:
    return (
        isinstance(field.char_start, int)
        and isinstance(field.char_end, int)
        and field.char_start >= 0
        and field.char_end >= field.char_start
    )


def _field_has_span_override(field) -> bool:
    extracted_value = field.extracted_value
    if extracted_value is None:
        return False
    if not isinstance(extracted_value, str):
        return True
    return extracted_value.strip() != field.source_text.strip()


def _get_feedback_extraction_text(field) -> str | None:
    source_text = field.source_text.strip()
    if not source_text:
        return None
    if _field_has_span_override(field):
        return None
    return source_text


def _field_matches_document_span(field, document_text: str) -> bool:
    if field.char_start is None or field.char_end is None:
        return False
    if field.char_end > len(document_text):
        return False
    return document_text[field.char_start : field.char_end].strip() == field.source_text.strip()


def _build_context_window(text: str, start: int, end: int) -> tuple[int, int]:
    left = max(0, start - CONTEXT_RADIUS)
    right = min(len(text), end + CONTEXT_RADIUS)
    return left, right


def _build_suggestion_key(example_text: str, extractions: list[LangExtractFeedbackSuggestionExtractionResponse]) -> str:
    payload = {
        "example_text": example_text,
        "extractions": [
            {
                "extraction_class": extraction.extraction_class,
                "extraction_text": extraction.extraction_text,
                "attributes": extraction.attributes,
            }
            for extraction in extractions
        ],
    }
    digest = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    return digest[:16]
