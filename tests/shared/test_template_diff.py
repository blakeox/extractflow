from __future__ import annotations

from extraction_core.template_diff import diff_template_definitions

from tests.support.sample_data import build_template_definition


def test_template_diff_reports_added_and_removed_fields() -> None:
    before = build_template_definition()
    after = build_template_definition()
    after["template_version"] = "1.1.0"
    after["extracted_fields"] = [
        *after["extracted_fields"],
        {
            "name": "purchase_order",
            "label": "Purchase order",
            "description": "Purchase order identifier.",
            "type": "text",
            "required": False,
            "citation_required": False,
            "allowed_values": [],
            "field_schema": None,
            "validation": {"allow_null": True},
        },
    ]
    after["extracted_fields"] = [
        field for field in after["extracted_fields"] if field["name"] != "vendor_name"
    ]

    diff = diff_template_definitions(before, after)

    assert diff.before_version == "1.0.0"
    assert diff.after_version == "1.1.0"
    assert "purchase_order" in diff.extracted_added
    assert "vendor_name" in diff.extracted_removed


def test_template_diff_reports_modified_field_metadata() -> None:
    before = build_template_definition()
    after = build_template_definition()
    after["extracted_fields"][0]["label"] = "Supplier Name"

    diff = diff_template_definitions(before, after)

    assert diff.extracted_changed
    assert diff.extracted_changed[0].name == before["extracted_fields"][0]["name"]
    assert any("required" in detail for detail in diff.extracted_changed[0].details)
