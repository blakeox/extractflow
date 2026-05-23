from __future__ import annotations

from extraction_core import evaluate_calculated_fields
from extraction_core.models import CalculatedFieldDefinition, DataType, ExtractionFieldResult


def test_evaluate_calculated_fields_uses_shaped_currency_context_for_follow_on_formulas() -> None:
    definitions = [
        CalculatedFieldDefinition(
            name="buffered_amount",
            label="Buffered Amount",
            description="Buffered amount.",
            output_type=DataType.CURRENCY,
            formula="coalesce(total_amount.amount, 0) * 1.10",
            depends_on=[],
        ),
        CalculatedFieldDefinition(
            name="buffered_plus_fee",
            label="Buffered Plus Fee",
            description="Buffered amount plus fee.",
            output_type=DataType.CURRENCY,
            formula="buffered_amount.amount + 5",
            depends_on=[],
        ),
    ]
    extracted_fields = [
        ExtractionFieldResult(
            field_name="total_amount",
            label="Total Amount",
            data_type=DataType.CURRENCY,
            normalized_value={"amount": 1200.0, "currency": "USD", "display_value": "$1,200.00"},
        )
    ]

    results = evaluate_calculated_fields(definitions, extracted_fields)

    assert [result.field_name for result in results] == ["buffered_amount", "buffered_plus_fee"]
    assert results[0].calculated_value == {"amount": 1320.0, "currency": "USD"}
    assert results[0].display_value == "USD 1,320.00"
    assert results[0].depends_on == ["total_amount"]
    assert results[1].calculated_value == {"amount": 1325.0, "currency": "USD"}
    assert results[1].depends_on == ["buffered_amount"]


def test_evaluate_calculated_fields_turns_formula_syntax_errors_into_reviewable_results() -> None:
    definitions = [
        CalculatedFieldDefinition(
            name="broken_calc",
            label="Broken Calc",
            description="Broken formula.",
            output_type=DataType.NUMBER,
            formula="coalesce(",
            depends_on=[],
            validation={"allow_null": False},
        )
    ]

    results = evaluate_calculated_fields(definitions, [])

    assert results[0].calculated_value is None
    assert results[0].requires_review is True
    assert results[0].validation_status == "invalid"
    assert results[0].validation_errors == ["Invalid formula syntax: '(' was never closed", "Calculated value is null."]


def test_evaluate_calculated_fields_can_return_null_without_review_for_divide_by_zero() -> None:
    definitions = [
        CalculatedFieldDefinition(
            name="safe_ratio",
            label="Safe Ratio",
            description="Safe ratio.",
            output_type=DataType.NUMBER,
            formula="1 / coalesce(total_amount.amount, 0)",
            depends_on=["total_amount"],
            error_handling={"on_divide_by_zero": "return_null"},
        )
    ]
    extracted_fields = [
        ExtractionFieldResult(
            field_name="total_amount",
            label="Total Amount",
            data_type=DataType.CURRENCY,
            normalized_value={"amount": 0, "currency": "USD", "display_value": "$0.00"},
        )
    ]

    results = evaluate_calculated_fields(definitions, extracted_fields)

    assert results[0].calculated_value is None
    assert results[0].validation_errors == []
    assert results[0].validation_status == "valid"
    assert results[0].requires_review is False
    assert "Division by zero returned null by policy." in results[0].calculation_notes


def test_evaluate_calculated_fields_can_return_null_without_review_for_missing_input() -> None:
    definitions = [
        CalculatedFieldDefinition(
            name="derived_total",
            label="Derived Total",
            description="Derived total.",
            output_type=DataType.NUMBER,
            formula="total_amount.amount + 1",
            depends_on=["total_amount"],
            error_handling={"on_missing_input": "return_null"},
        )
    ]
    extracted_fields = [
        ExtractionFieldResult(
            field_name="total_amount",
            label="Total Amount",
            data_type=DataType.CURRENCY,
            normalized_value=None,
        )
    ]

    results = evaluate_calculated_fields(definitions, extracted_fields)

    assert results[0].calculated_value is None
    assert results[0].validation_errors == []
    assert results[0].validation_status == "valid"
    assert results[0].requires_review is False
    assert "Missing input returned null by policy." in results[0].calculation_notes
