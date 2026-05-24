from __future__ import annotations

from extraction_core.dry_run import run_schema_dry_run

from tests.support.sample_data import build_template_definition


def test_schema_dry_run_rejects_empty_sample_text() -> None:
    response = run_schema_dry_run(build_template_definition(), "   ")

    assert response.ok is False
    assert response.schema_errors == ["Sample text is required for a dry run."]


def test_schema_dry_run_extracts_and_validates_currency_field() -> None:
    definition = build_template_definition()
    response = run_schema_dry_run(
        definition,
        "Vendor Name: Acme Corp\nTotal Due: $1,200.00",
    )

    assert response.ok is True
    assert response.extracted_fields
    total_field = next(field for field in response.extracted_fields if field.field_name == "total_amount")
    assert total_field.validation_status == "valid"
    assert total_field.extracted_value is not None


def test_schema_dry_run_surfaces_invalid_schema() -> None:
    definition = build_template_definition()
    definition.pop("template_name")

    response = run_schema_dry_run(definition, "sample text")

    assert response.ok is False
    assert response.schema_errors
