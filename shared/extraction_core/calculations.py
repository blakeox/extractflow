from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from .formulas import (
    FormulaEngine,
    FormulaValidationError,
    collect_formula_references,
    topologically_sort_calculated_fields,
)
from .models import CalculatedFieldDefinition, CalculatedFieldResult, ExtractionFieldResult


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


def evaluate_calculated_fields(
    calculated_definitions: list[CalculatedFieldDefinition],
    extracted_fields: list[ExtractionFieldResult],
) -> list[CalculatedFieldResult]:
    engine = FormulaEngine()
    context = {field.field_name: field.normalized_value for field in extracted_fields}
    available_fields = set(context.keys()) | {item.name for item in calculated_definitions}
    calculated_fields: list[CalculatedFieldResult] = []

    for definition in topologically_sort_calculated_fields(calculated_definitions):
        errors: list[str] = []
        notes: list[str] = []
        value = None
        try:
            engine.validate_formula(definition.formula, available_fields)
            value = engine.evaluate(definition.formula, context)
        except ZeroDivisionError:
            apply_error_handling(
                definition.error_handling.on_divide_by_zero,
                "Division by zero.",
                "Division by zero returned null by policy.",
                errors,
                notes,
            )
        except TypeError:
            apply_error_handling(
                definition.error_handling.on_missing_input,
                "Missing input.",
                "Missing input returned null by policy.",
                errors,
                notes,
            )
        except FormulaValidationError as exc:
            if str(exc) == "Attribute access is only supported on structured field values.":
                apply_error_handling(
                    definition.error_handling.on_missing_input,
                    "Missing input.",
                    "Missing input returned null by policy.",
                    errors,
                    notes,
                )
            else:
                errors.append(str(exc))

        value, display_value = normalize_calculated_output(definition, value)
        try:
            depends_on = sorted(collect_formula_references(definition.formula, available_fields))
        except FormulaValidationError:
            depends_on = definition.depends_on
        result = CalculatedFieldResult(
            field_name=definition.name,
            label=definition.label,
            output_type=definition.output_type,
            formula=definition.formula,
            depends_on=depends_on,
            calculated_value=value,
            display_value=display_value,
            validation_errors=errors,
            calculation_notes=build_calculation_notes(notes),
            requires_review=bool(errors) or definition.requires_review,
        )
        result = validate_calculated_field(
            result,
            allow_null=definition.validation.allow_null,
            min_value=definition.validation.min,
            max_value=definition.validation.max,
        )
        calculated_fields.append(result)
        context[definition.name] = result.calculated_value

    return calculated_fields


def normalize_calculated_output(definition: CalculatedFieldDefinition, value: Any) -> tuple[Any, str]:
    if definition.output_type.value == "currency" and isinstance(value, int | float | Decimal):
        currency = (definition.format.currency if definition.format else "USD") or "USD"
        amount = float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
        return {"amount": amount, "currency": currency}, f"{currency} {amount:,.2f}"
    return value, "" if value is None else str(value)


def apply_error_handling(
    policy: str,
    flagged_error: str,
    note: str,
    errors: list[str],
    notes: list[str],
) -> None:
    if policy == "return_null_and_flag_review":
        errors.append(flagged_error)
        return
    if policy == "return_null":
        notes.append(note)
        return
    raise ValueError(f"Unsupported error handling policy: {policy}")


def build_calculation_notes(notes: list[str]) -> str:
    base_note = "Deterministic formula evaluation."
    if not notes:
        return base_note
    return " ".join([base_note, *notes])
