from __future__ import annotations

import logging

from extraction_core import FormulaEngine, topologically_sort_calculated_fields
from extraction_core.formulas import FormulaValidationError
from extraction_core.langextract import uses_langextract_provider
from extraction_core.models import (
    CalculatedFieldResult,
    ExtractionFieldDefinition,
    ExtractionFieldResult,
    ExtractionTemplate,
    ExtractionValidationSummary,
    LLMProviderSettings,
)
from extraction_core.observability import configure_logger, log_event

from app.services.parser import parse_document
from app.services.provider import ExtractionProvider
from app.services.validator import validate_calculated_field, validate_extracted_field

logger = configure_logger("extractflow.worker.executor")


def execute_extraction(
    document_path: str, document_id: int, template_definition: dict, provider_override: dict | None = None
) -> dict:
    template = ExtractionTemplate.model_validate(template_definition)
    settings = (
        LLMProviderSettings.model_validate(provider_override) if provider_override else template.llm_provider_settings
    )
    text = parse_document(document_path)
    provider = ExtractionProvider()
    provider_results = provider.extract(text, template, settings)
    extracted_fields, document_level_notes = reconcile_extracted_fields(
        template.extracted_fields,
        provider_results,
        minimum_confidence_threshold=template.minimum_confidence_threshold,
        review_required_on_low_confidence=template.review_required_on_low_confidence,
    )

    engine = FormulaEngine()
    context = {field.field_name: field.normalized_value for field in extracted_fields}
    calculated_fields: list[CalculatedFieldResult] = []
    for definition in topologically_sort_calculated_fields(template.calculated_fields):
        errors: list[str] = []
        value = None
        try:
            engine.validate_formula(
                definition.formula, set(context.keys()) | {item.name for item in template.calculated_fields}
            )
            value = engine.evaluate(definition.formula, context)
        except ZeroDivisionError:
            errors.append("Division by zero.")
        except FormulaValidationError as exc:
            errors.append(str(exc))

        display_value = ""
        if definition.output_type.value == "currency" and isinstance(value, int | float):
            currency = (definition.format.currency if definition.format else "USD") or "USD"
            value = {"amount": round(float(value), 2), "currency": currency}
            display_value = f"{currency} {value['amount']:,.2f}"
        elif value is not None:
            display_value = str(value)

        result = CalculatedFieldResult(
            field_name=definition.name,
            label=definition.label,
            output_type=definition.output_type,
            formula=definition.formula,
            depends_on=definition.depends_on,
            calculated_value=value,
            display_value=display_value,
            validation_errors=errors,
            calculation_notes="Deterministic formula evaluation.",
            requires_review=bool(errors) or definition.requires_review,
        )
        result = validate_calculated_field(
            result,
            allow_null=definition.validation.allow_null,
            min_value=definition.validation.min,
            max_value=definition.validation.max,
        )
        calculated_fields.append(result)
        context[definition.name] = value

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


def reconcile_extracted_fields(
    field_definitions: list[ExtractionFieldDefinition],
    provider_results: list[ExtractionFieldResult],
    minimum_confidence_threshold: float,
    review_required_on_low_confidence: bool,
) -> tuple[list[ExtractionFieldResult], list[str]]:
    notes: list[str] = []
    field_names = {field.name for field in field_definitions}
    grouped_results: dict[str, list[ExtractionFieldResult]] = {}

    for result in provider_results:
        if result.field_name not in field_names:
            notes.append(f"Provider returned unexpected field '{result.field_name}'.")
            continue
        grouped_results.setdefault(result.field_name, []).append(result)

    reconciled: list[ExtractionFieldResult] = []
    for definition in field_definitions:
        candidates = grouped_results.get(definition.name, [])
        if not candidates:
            result = build_missing_field_result(definition)
        else:
            result = max(candidates, key=score_extraction_result)
            if len(candidates) > 1:
                result.requires_review = True
                result.extraction_notes = append_note(
                    result.extraction_notes,
                    f"Selected highest-confidence match from {len(candidates)} chunk candidates.",
                )
        result = validate_extracted_field(definition, result)
        if definition.citation_required and not result.source_text:
            result.validation_errors.append("Citation evidence is required.")
            result.validation_status = "invalid"
            result.requires_review = True
        if review_required_on_low_confidence and result.normalized_value is not None:
            if result.confidence_score < minimum_confidence_threshold:
                result.requires_review = True
                result.extraction_notes = append_note(
                    result.extraction_notes,
                    f"Confidence {result.confidence_score:.2f} is below the {minimum_confidence_threshold:.2f} review threshold.",
                )
        reconciled.append(result)

    return reconciled, notes


def build_missing_field_result(definition: ExtractionFieldDefinition) -> ExtractionFieldResult:
    return ExtractionFieldResult(
        field_name=definition.name,
        label=definition.label,
        data_type=definition.type,
        extracted_value=None,
        normalized_value=None,
        confidence_score=0.0,
        source_text="",
        page_number=None,
        location_reference="",
        extraction_notes="Provider response did not include this schema field.",
        requires_review=True,
    )


def append_note(current: str, note: str) -> str:
    return f"{current} {note}".strip() if current else note


def score_extraction_result(result: ExtractionFieldResult) -> tuple[int, float, int]:
    has_value = int(result.normalized_value is not None)
    has_citation = int(bool(result.source_text))
    return (has_value + has_citation, result.confidence_score, len(result.source_text))


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
