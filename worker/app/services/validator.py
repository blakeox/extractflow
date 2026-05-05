from __future__ import annotations

import re
from typing import Any

from extraction_core.models import CalculatedFieldResult, ExtractionFieldDefinition, ExtractionFieldResult


def validate_extracted_field(field: ExtractionFieldDefinition, result: ExtractionFieldResult) -> ExtractionFieldResult:
    errors: list[str] = []

    if field.required and result.normalized_value is None:
        errors.append("Required field is missing.")
    if result.normalized_value is None and not field.validation.allow_null:
        errors.append("Null is not allowed.")
    if field.allowed_values and result.normalized_value is not None:
        candidate = (
            result.normalized_value.get("value")
            if isinstance(result.normalized_value, dict)
            else result.normalized_value
        )
        if candidate not in field.allowed_values:
            errors.append("Value is outside allowed values.")
    if field.validation.regex and result.extracted_value is not None:
        if not re.match(field.validation.regex, str(result.extracted_value)):
            errors.append("Value does not match required pattern.")
    if field.validation.max_length and result.extracted_value is not None:
        if len(str(result.extracted_value)) > field.validation.max_length:
            errors.append("Value exceeds maximum length.")

    result.validation_errors = errors
    result.validation_status = "valid" if not errors else "invalid"
    result.requires_review = result.requires_review or bool(errors)
    return result


def validate_calculated_field(
    result: CalculatedFieldResult,
    allow_null: bool = True,
    min_value: float | None = None,
    max_value: float | None = None,
) -> CalculatedFieldResult:
    errors: list[str] = list(result.validation_errors)
    value = result.calculated_value
    if value is None and not allow_null:
        errors.append("Calculated value is null.")
    candidate: Any = value.get("amount") if isinstance(value, dict) and "amount" in value else value
    if candidate is not None and min_value is not None and candidate < min_value:
        errors.append("Calculated value is below minimum.")
    if candidate is not None and max_value is not None and candidate > max_value:
        errors.append("Calculated value is above maximum.")
    result.validation_errors = errors
    result.validation_status = "valid" if not errors else "invalid"
    result.requires_review = result.requires_review or bool(errors)
    return result
