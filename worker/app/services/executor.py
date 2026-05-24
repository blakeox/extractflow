from __future__ import annotations

import logging
from collections.abc import Callable

from extraction_core import evaluate_calculated_fields
from extraction_core.dry_run import append_note, reconcile_extracted_fields
from extraction_core.job_progress import (
    JOB_STAGE_CALCULATING,
    JOB_STAGE_EXTRACTING,
    JOB_STAGE_PARSING,
    JOB_STAGE_VALIDATING,
)
from extraction_core.langextract import uses_langextract_provider
from extraction_core.models import (
    CalculatedFieldResult,
    ExtractionFieldResult,
    ExtractionTemplate,
    ExtractionValidationSummary,
    LLMProviderSettings,
)
from extraction_core.observability import configure_logger, log_event

from app.core.config import settings as app_settings
from app.services.parser import parse_document
from app.services.provider import ExtractionProvider
from app.services.redaction import MASK_CHAR, redact_text
from app.services.validator import validate_extracted_field

logger = configure_logger("extractflow.worker.executor")


def execute_extraction(
    document_path: str,
    document_id: int,
    template_definition: dict,
    provider_override: dict | None = None,
    progress_reporter: Callable[[str], None] | None = None,
    parsed_text: str | None = None,
) -> dict:
    template = ExtractionTemplate.model_validate(template_definition)
    settings = (
        LLMProviderSettings.model_validate(provider_override) if provider_override else template.llm_provider_settings
    )
    if settings.allow_external_processing and not app_settings.allow_external_processing:
        raise ValueError(
            "This deployment disables external provider processing. Choose a local provider or enable "
            "ALLOW_EXTERNAL_PROCESSING."
        )
    if (
        settings.allow_external_processing
        and app_settings.require_redaction_for_external_processing
        and not app_settings.presidio_redaction_enabled
    ):
        raise ValueError(
            "This deployment requires document redaction before external provider processing, but Presidio "
            "redaction is disabled. Enable PRESIDIO_REDACTION_ENABLED or disable "
            "REQUIRE_REDACTION_FOR_EXTERNAL_PROCESSING."
        )
    if progress_reporter:
        progress_reporter(JOB_STAGE_PARSING)
    text = parsed_text if parsed_text is not None else parse_document(document_path)
    redaction_note: str | None = None
    if settings.allow_external_processing and app_settings.require_redaction_for_external_processing:
        if document_path.lower().endswith((".csv", ".xlsx")):
            raise ValueError(
                "This deployment requires redaction before external provider processing, and spreadsheet "
                "documents are not yet supported by the Presidio redaction flow."
            )
        redaction_result = redact_text(text, app_settings.configured_redaction_entities)
        text = redaction_result.text
        redaction_note = (
            "External provider text redaction applied for "
            f"{redaction_result.span_count} spans across {len(redaction_result.entity_counts)} entity types."
        )
        log_event(
            logger,
            logging.INFO,
            "external_provider_text_redacted",
            document_id=document_id,
            model=settings.model,
            provider_type=settings.provider_type,
            span_count=redaction_result.span_count,
            entity_counts=redaction_result.entity_counts,
        )
    if progress_reporter:
        progress_reporter(JOB_STAGE_EXTRACTING)
    provider = ExtractionProvider()
    provider_results = provider.extract(text, template, settings)
    if settings.allow_external_processing and app_settings.require_redaction_for_external_processing:
        provider_results = sanitize_redacted_provider_results(provider_results)
    if progress_reporter:
        progress_reporter(JOB_STAGE_VALIDATING)
    extracted_fields, document_level_notes = reconcile_extracted_fields(
        template.extracted_fields,
        provider_results,
        minimum_confidence_threshold=template.minimum_confidence_threshold,
        review_required_on_low_confidence=template.review_required_on_low_confidence,
    )
    if redaction_note:
        document_level_notes.append(redaction_note)

    if progress_reporter:
        progress_reporter(JOB_STAGE_CALCULATING)
    calculated_fields = evaluate_calculated_fields(template.calculated_fields, extracted_fields)

    summary = ExtractionValidationSummary(
        document_id=str(document_id),
        document_type=template.document_type,
        template_name=template.template_name,
        template_version=template.template_version,
        llm_provider=settings.model_dump(),
        extraction_status="completed",
        extracted_fields=extracted_fields,
        calculated_fields=calculated_fields,
        document_level_notes=document_level_notes,
        fields_requiring_review=[field.field_name for field in extracted_fields if field.requires_review]
        + [field.field_name for field in calculated_fields if field.requires_review],
    )
    if uses_langextract_provider(settings.provider_type, settings.api_style):
        review_signals = summarize_review_signals(extracted_fields, calculated_fields)
        log_event(
            logger,
            logging.INFO,
            "langextract_extraction_completed",
            document_id=document_id,
            model=settings.model,
            provider_type=settings.provider_type,
            extracted_field_count=len(extracted_fields),
            calculated_field_count=len(calculated_fields),
            review_required_count=len(summary.fields_requiring_review),
            document_note_count=len(document_level_notes),
            **review_signals,
        )
    return summary.model_dump(mode="json")


def sanitize_redacted_provider_results(provider_results: list[ExtractionFieldResult]) -> list[ExtractionFieldResult]:
    for result in provider_results:
        if MASK_CHAR not in result.source_text and not (
            isinstance(result.extracted_value, str) and MASK_CHAR in result.extracted_value
        ):
            continue
        result.extracted_value = None
        result.normalized_value = None
        result.requires_review = True
        result.extraction_notes = append_note(
            result.extraction_notes,
            "External-provider evidence contained redacted spans, so the extracted value was cleared for review.",
        )
    return provider_results


def summarize_review_signals(
    extracted_fields: list[ExtractionFieldResult],
    calculated_fields: list[CalculatedFieldResult],
) -> dict[str, int]:
    low_confidence_review_count = 0
    multi_candidate_review_count = 0
    citation_gap_count = 0
    validation_error_count = 0

    for field in extracted_fields:
        if field.requires_review and "review threshold" in field.extraction_notes.casefold():
            low_confidence_review_count += 1
        if field.requires_review and "chunk candidates" in field.extraction_notes.casefold():
            multi_candidate_review_count += 1
        if any(error == "Citation evidence is required." for error in field.validation_errors):
            citation_gap_count += 1
        if field.validation_errors:
            validation_error_count += 1

    validation_error_count += sum(1 for field in calculated_fields if field.validation_errors)
    return {
        "low_confidence_review_count": low_confidence_review_count,
        "multi_candidate_review_count": multi_candidate_review_count,
        "citation_gap_count": citation_gap_count,
        "validation_error_count": validation_error_count,
    }
