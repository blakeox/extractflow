from __future__ import annotations

from pydantic import BaseModel, Field

from .models import CalculatedFieldDefinition, ExtractionFieldDefinition, ExtractionTemplate


class TemplateFieldChange(BaseModel):
    name: str
    change: str
    details: list[str] = Field(default_factory=list)


class TemplateVersionDiff(BaseModel):
    before_version: str
    after_version: str
    extracted_added: list[str] = Field(default_factory=list)
    extracted_removed: list[str] = Field(default_factory=list)
    extracted_changed: list[TemplateFieldChange] = Field(default_factory=list)
    calculated_added: list[str] = Field(default_factory=list)
    calculated_removed: list[str] = Field(default_factory=list)
    calculated_changed: list[TemplateFieldChange] = Field(default_factory=list)
    langextract_changed: bool = False


def diff_template_definitions(
    before_definition: dict,
    after_definition: dict,
) -> TemplateVersionDiff:
    before = ExtractionTemplate.model_validate(before_definition)
    after = ExtractionTemplate.model_validate(after_definition)

    before_extracted = {field.name: field for field in before.extracted_fields}
    after_extracted = {field.name: field for field in after.extracted_fields}
    before_calculated = {field.name: field for field in before.calculated_fields}
    after_calculated = {field.name: field for field in after.calculated_fields}

    extracted_added = sorted(set(after_extracted) - set(before_extracted))
    extracted_removed = sorted(set(before_extracted) - set(after_extracted))
    extracted_changed = [
        change
        for name in sorted(set(before_extracted) & set(after_extracted))
        if (change := describe_field_change(name, before_extracted[name], after_extracted[name]))
    ]

    calculated_added = sorted(set(after_calculated) - set(before_calculated))
    calculated_removed = sorted(set(before_calculated) - set(after_calculated))
    calculated_changed = [
        change
        for name in sorted(set(before_calculated) & set(after_calculated))
        if (change := describe_calculated_change(name, before_calculated[name], after_calculated[name]))
    ]

    langextract_changed = before.langextract_config != after.langextract_config

    return TemplateVersionDiff(
        before_version=before.template_version,
        after_version=after.template_version,
        extracted_added=extracted_added,
        extracted_removed=extracted_removed,
        extracted_changed=extracted_changed,
        calculated_added=calculated_added,
        calculated_removed=calculated_removed,
        calculated_changed=calculated_changed,
        langextract_changed=langextract_changed,
    )


def describe_field_change(
    name: str,
    before: ExtractionFieldDefinition,
    after: ExtractionFieldDefinition,
) -> TemplateFieldChange | None:
    details: list[str] = []
    if before.label != after.label:
        details.append(f"label: {before.label!r} -> {after.label!r}")
    if before.type != after.type:
        details.append(f"type: {before.type.value} -> {after.type.value}")
    if before.required != after.required:
        details.append(f"required: {before.required} -> {after.required}")
    if before.citation_required != after.citation_required:
        details.append(f"citation_required: {before.citation_required} -> {after.citation_required}")
    if before.allowed_values != after.allowed_values:
        details.append("allowed_values updated")
    if before.field_schema != after.field_schema:
        details.append("field_schema updated")
    if not details:
        return None
    return TemplateFieldChange(name=name, change="modified", details=details)


def describe_calculated_change(
    name: str,
    before: CalculatedFieldDefinition,
    after: CalculatedFieldDefinition,
) -> TemplateFieldChange | None:
    details: list[str] = []
    if before.formula != after.formula:
        details.append(f"formula: {before.formula!r} -> {after.formula!r}")
    if before.depends_on != after.depends_on:
        details.append(f"depends_on: {before.depends_on!r} -> {after.depends_on!r}")
    if before.output_type != after.output_type:
        details.append(f"output_type: {before.output_type.value} -> {after.output_type.value}")
    if not details:
        return None
    return TemplateFieldChange(name=name, change="modified", details=details)
