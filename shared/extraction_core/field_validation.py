from __future__ import annotations

import re
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from rapidfuzz import fuzz, process

from .models import ExtractionFieldDefinition, ExtractionFieldResult

FUZZY_ALLOWED_VALUE_SCORE_CUTOFF = 90


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
        candidate, canonicalization_note = canonicalize_allowed_value(candidate, field.allowed_values)
        if canonicalization_note:
            set_normalized_candidate(result, candidate)
            result.extraction_notes = append_validation_note(result.extraction_notes, canonicalization_note)
            result.requires_review = True
        if candidate not in field.allowed_values:
            errors.append("Value is outside allowed values.")
    if field.field_schema and result.normalized_value is not None:
        validation_error = validate_field_schema(field.field_schema, result.normalized_value)
        if validation_error:
            errors.append(validation_error)
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


def validate_field_schema(field_schema: dict[str, Any], normalized_value: Any) -> str | None:
    validator = Draft202012Validator(field_schema, format_checker=FormatChecker())
    for candidate in iter_schema_validation_candidates(normalized_value):
        errors = sorted(validator.iter_errors(candidate), key=lambda item: item.path)
        if not errors:
            return None
    primary_error = sorted(validator.iter_errors(normalized_value), key=lambda item: item.path)[0]
    location = ".".join(str(part) for part in primary_error.path)
    if location:
        return f"Value does not satisfy schema at '{location}': {primary_error.message}"
    return f"Value does not satisfy schema: {primary_error.message}"


def iter_schema_validation_candidates(normalized_value: Any) -> list[Any]:
    candidates = [normalized_value]
    if isinstance(normalized_value, dict):
        raw_value = normalized_value.get("value")
        if raw_value is not None:
            candidates.append(raw_value)
    return candidates


def canonicalize_allowed_value(candidate: Any, allowed_values: list[str]) -> tuple[Any, str | None]:
    if not allowed_values:
        return candidate, None
    if isinstance(candidate, str):
        return canonicalize_allowed_scalar(candidate, allowed_values)
    if isinstance(candidate, list):
        normalized_items: list[str] = []
        notes: list[str] = []
        for item in candidate:
            normalized_item, note = canonicalize_allowed_scalar(item, allowed_values)
            normalized_items.append(normalized_item)
            if note:
                notes.append(note)
        return normalized_items, " ".join(notes) if notes else None
    return candidate, None


def canonicalize_allowed_scalar(candidate: Any, allowed_values: list[str]) -> tuple[Any, str | None]:
    if not isinstance(candidate, str):
        return candidate, None
    if candidate in allowed_values:
        return candidate, None
    normalized_candidate = normalize_allowed_value_key(candidate)
    for allowed_value in allowed_values:
        if normalize_allowed_value_key(allowed_value) == normalized_candidate:
            return (
                allowed_value,
                f"Canonicalized allowed value from '{candidate}' to '{allowed_value}' using normalized comparison.",
            )
    match = process.extractOne(
        candidate, allowed_values, scorer=fuzz.WRatio, score_cutoff=FUZZY_ALLOWED_VALUE_SCORE_CUTOFF
    )
    if not match:
        return candidate, None
    canonical_value = match[0]
    return (
        canonical_value,
        f"Canonicalized allowed value from '{candidate}' to '{canonical_value}' using guarded fuzzy matching.",
    )


def set_normalized_candidate(result: ExtractionFieldResult, candidate: Any) -> None:
    normalized_value = result.normalized_value
    if isinstance(normalized_value, dict) and "value" in normalized_value:
        normalized_value["value"] = candidate
        return
    result.normalized_value = candidate


def append_validation_note(current: str, note: str) -> str:
    return f"{current} {note}".strip() if current else note


def normalize_allowed_value_key(value: str) -> str:
    return "".join(char.lower() for char in value if char.isalnum())
