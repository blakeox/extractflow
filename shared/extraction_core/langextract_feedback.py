from __future__ import annotations

import json
from typing import Any

from .models import ExtractionFieldDefinition


def build_langextract_feedback_attributes(
    definition: ExtractionFieldDefinition | None, normalized_value: Any
) -> dict[str, str | list[str]]:
    if definition is None or normalized_value is None:
        return {}

    field_type = definition.type.value
    if field_type in {"text", "paragraph", "category", "citation_backed_answer"}:
        value = _stringify(_read_value(normalized_value))
        return {"value": value} if value else {}

    if field_type == "date":
        value = _stringify(_read_value(normalized_value))
        return {"value": value} if value else {}

    if field_type == "number":
        value = _stringify(_read_value(normalized_value))
        return {"value": value} if value else {}

    if field_type == "currency":
        if not isinstance(normalized_value, dict):
            value = _stringify(normalized_value)
            return {"value": value} if value else {}
        amount = _stringify(normalized_value.get("amount"))
        currency = _stringify(normalized_value.get("currency"))
        display_value = _stringify(normalized_value.get("display_value"))
        attributes: dict[str, str | list[str]] = {}
        if display_value:
            attributes["value"] = display_value
        elif amount:
            attributes["value"] = amount
        if currency:
            attributes["currency"] = currency
        return attributes

    if field_type == "boolean":
        if isinstance(normalized_value, bool):
            return {"value": "true" if normalized_value else "false"}
        value = _stringify(_read_value(normalized_value))
        return {"value": value} if value else {}

    if field_type in {"list", "multi_select"}:
        value = _read_value(normalized_value)
        if isinstance(value, list):
            items = [_stringify(item) for item in value]
            filtered = [item for item in items if item]
            return {"value": filtered} if filtered else {}
        fallback = _stringify(value)
        return {"value": [fallback]} if fallback else {}

    if field_type in {"json_object", "structured_object", "table"}:
        return _stringify_attributes(normalized_value)

    value = _stringify(_read_value(normalized_value))
    return {"value": value} if value else {}


def _read_value(value: Any) -> Any:
    if isinstance(value, dict) and "value" in value:
        return value["value"]
    return value


def _stringify_attributes(value: Any) -> dict[str, str | list[str]]:
    if not isinstance(value, dict):
        stringified = _stringify(value)
        return {"value": stringified} if stringified else {}
    attributes: dict[str, str | list[str]] = {}
    for key, item in value.items():
        if isinstance(item, list):
            normalized = [_stringify(entry) for entry in item]
            filtered = [entry for entry in normalized if entry]
            if filtered:
                attributes[key] = filtered
            continue
        stringified = _stringify(item)
        if stringified:
            attributes[key] = stringified
    return attributes


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return str(value)
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return json.dumps(value)
    if isinstance(value, dict):
        return json.dumps(value, sort_keys=True)
    return str(value).strip()
