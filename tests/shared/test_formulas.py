from __future__ import annotations

import pytest
from extraction_core import FormulaEngine, FormulaValidationError, topologically_sort_calculated_fields
from extraction_core.models import CalculatedFieldDefinition, DataType


def test_formula_engine_handles_nested_attributes_and_helpers() -> None:
    engine = FormulaEngine()

    value = engine.evaluate(
        "coalesce(total_amount.amount, 0) + months_between(start_date, end_date)",
        {
            "total_amount": {"amount": 1200.0, "currency": "USD"},
            "start_date": "2025-01-01",
            "end_date": "2025-04-01",
        },
    )

    assert value == 1203.0


def test_formula_engine_rejects_unknown_fields() -> None:
    engine = FormulaEngine()

    with pytest.raises(FormulaValidationError, match="Unknown field reference"):
        engine.validate_formula("missing_field + 1", {"known_field"})


def test_topological_sort_orders_dependencies_before_dependents() -> None:
    fields = [
        CalculatedFieldDefinition(
            name="net_amount",
            label="Net Amount",
            description="Net amount.",
            output_type=DataType.CURRENCY,
            formula="gross_amount - discount_amount",
            depends_on=["gross_amount", "discount_amount"],
        ),
        CalculatedFieldDefinition(
            name="discount_ratio",
            label="Discount Ratio",
            description="Discount ratio.",
            output_type=DataType.PERCENTAGE,
            formula="discount_amount / gross_amount",
            depends_on=["discount_amount", "gross_amount"],
        ),
        CalculatedFieldDefinition(
            name="buffered_amount",
            label="Buffered Amount",
            description="Buffered amount.",
            output_type=DataType.CURRENCY,
            formula="net_amount * 1.1",
            depends_on=["net_amount"],
        ),
    ]

    ordered = topologically_sort_calculated_fields(fields)

    assert [field.name for field in ordered] == ["net_amount", "discount_ratio", "buffered_amount"]


def test_topological_sort_detects_cycles() -> None:
    fields = [
        CalculatedFieldDefinition(
            name="a",
            label="A",
            description="A",
            output_type=DataType.NUMBER,
            formula="b + 1",
            depends_on=["b"],
        ),
        CalculatedFieldDefinition(
            name="b",
            label="B",
            description="B",
            output_type=DataType.NUMBER,
            formula="a + 1",
            depends_on=["a"],
        ),
    ]

    with pytest.raises(FormulaValidationError, match="Circular dependency"):
        topologically_sort_calculated_fields(fields)
