from __future__ import annotations

import re
from typing import Any

from .models import ExtractionFieldDefinition, ExtractionFieldResult, ExtractionTemplate


def mock_extract_fields(text: str, template: ExtractionTemplate) -> list[ExtractionFieldResult]:
    return [mock_extract_field(text, field) for field in template.extracted_fields]


def mock_extract_field(text: str, field: ExtractionFieldDefinition) -> ExtractionFieldResult:
    lowered = text.lower()
    source = ""
    normalized: Any = None
    extracted: Any = None
    confidence = 0.35

    if field.type.value == "currency":
        match = re.search(r"\$?\s?(\d[\d,]*(?:\.\d{1,2})?)", text)
        if match:
            amount = float(match.group(1).replace(",", ""))
            normalized = {
                "amount": amount,
                "currency": field.validation.currency or "USD",
                "display_value": match.group(0).strip(),
            }
            extracted = match.group(0).strip()
            source = match.group(0).strip()
            confidence = 0.72
    elif field.type.value == "date":
        match = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", text)
        if match:
            normalized = {"value": match.group(1), "display_value": match.group(1)}
            extracted = match.group(1)
            source = match.group(1)
            confidence = 0.7
    elif field.type.value == "boolean":
        if field.name.replace("_", " ") in lowered:
            normalized = True
            extracted = "true"
            source = field.name
            confidence = 0.6
    elif field.type.value == "number":
        match = re.search(r"\b(\d+(?:\.\d+)?)\b", text)
        if match:
            normalized = {"value": float(match.group(1))}
            extracted = match.group(1)
            source = match.group(1)
            confidence = 0.65
    else:
        if field.label.lower() in lowered or field.name.replace("_", " ") in lowered:
            snippet = text[:240]
            normalized = {"value": snippet.strip()}
            extracted = snippet.strip()
            source = snippet.strip()
            confidence = 0.58

    return ExtractionFieldResult(
        field_name=field.name,
        label=field.label,
        data_type=field.type,
        extracted_value=extracted,
        normalized_value=normalized,
        confidence_score=confidence,
        source_text=source,
        page_number=1 if source else None,
        location_reference="Page 1" if source else "",
        extraction_notes="Mock extraction used." if source else "No value identified by mock extractor.",
        requires_review=confidence < 0.75,
    )
