from __future__ import annotations

from pydantic import BaseModel, Field, ValidationError

from .calculations import evaluate_calculated_fields
from .field_validation import validate_extracted_field
from .mock_extract import mock_extract_fields
from .models import (
    CalculatedFieldResult,
    ExtractionFieldDefinition,
    ExtractionFieldResult,
    ExtractionTemplate,
    ExtractionValidationSummary,
)


class SchemaDryRunFieldResult(BaseModel):
    field_name: str
    label: str
    data_type: str
    validation_status: str
    validation_errors: list[str] = Field(default_factory=list)
    requires_review: bool = False
    confidence_score: float = 0.0
    extracted_value: str | None = None
    normalized_value: object | None = None
    source_text: str = ""
    extraction_notes: str = ""


class SchemaDryRunResponse(BaseModel):
    ok: bool
    schema_errors: list[str] = Field(default_factory=list)
    document_level_notes: list[str] = Field(default_factory=list)
    extracted_fields: list[SchemaDryRunFieldResult] = Field(default_factory=list)
    calculated_fields: list[CalculatedFieldResult] = Field(default_factory=list)
    fields_requiring_review: list[str] = Field(default_factory=list)
    summary: ExtractionValidationSummary | None = None


def run_schema_dry_run(definition: dict, sample_text: str) -> SchemaDryRunResponse:
    stripped_text = sample_text.strip()
    if not stripped_text:
        return SchemaDryRunResponse(
            ok=False,
            schema_errors=["Sample text is required for a dry run."],
        )

    try:
        template = ExtractionTemplate.model_validate(definition)
    except ValidationError as exc:
        return SchemaDryRunResponse(
            ok=False,
            schema_errors=[error["msg"] for error in exc.errors()],
        )

    mock_settings = template.llm_provider_settings.model_copy(
        update={"provider_type": "mock", "api_style": "mock", "provider_label": "Dry run (mock)"}
    )
    provider_results = mock_extract_fields(stripped_text, template)
    extracted_fields, document_notes = reconcile_extracted_fields(
        template.extracted_fields,
        provider_results,
        minimum_confidence_threshold=template.minimum_confidence_threshold,
        review_required_on_low_confidence=template.review_required_on_low_confidence,
    )
    calculated_fields = evaluate_calculated_fields(template.calculated_fields, extracted_fields)

    summary = ExtractionValidationSummary(
        document_id="dry-run",
        document_type=template.document_type,
        template_name=template.template_name,
        template_version=template.template_version,
        llm_provider=mock_settings.model_dump(),
        extraction_status="completed",
        extracted_fields=extracted_fields,
        calculated_fields=calculated_fields,
        document_level_notes=document_notes,
        fields_requiring_review=[field.field_name for field in extracted_fields if field.requires_review]
        + [field.field_name for field in calculated_fields if field.requires_review],
    )

    field_rows = [
        SchemaDryRunFieldResult(
            field_name=field.field_name,
            label=field.label,
            data_type=field.data_type.value,
            validation_status=field.validation_status,
            validation_errors=list(field.validation_errors),
            requires_review=field.requires_review,
            confidence_score=field.confidence_score,
            extracted_value=None if field.extracted_value is None else str(field.extracted_value),
            normalized_value=field.normalized_value,
            source_text=field.source_text,
            extraction_notes=field.extraction_notes,
        )
        for field in extracted_fields
    ]

    has_invalid = any(field.validation_status == "invalid" for field in extracted_fields)
    has_invalid |= any(field.validation_errors for field in calculated_fields)

    return SchemaDryRunResponse(
        ok=not has_invalid,
        document_level_notes=document_notes,
        extracted_fields=field_rows,
        calculated_fields=calculated_fields,
        fields_requiring_review=summary.fields_requiring_review,
        summary=summary,
    )


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
