from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from presidio_analyzer import Pattern, PatternRecognizer

MASK_CHAR = "*"


@dataclass(frozen=True)
class RedactionResult:
    text: str
    entity_counts: dict[str, int]
    span_count: int


_RECOGNIZERS: dict[str, PatternRecognizer] = {
    "EMAIL_ADDRESS": PatternRecognizer(
        supported_entity="EMAIL_ADDRESS",
        name="email",
        patterns=[
            Pattern(
                "email",
                r"\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}\b",
                0.85,
            )
        ],
    ),
    "PHONE_NUMBER": PatternRecognizer(
        supported_entity="PHONE_NUMBER",
        name="phone",
        patterns=[
            Pattern(
                "phone",
                r"(?:(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4})",
                0.65,
            )
        ],
    ),
    "CREDIT_CARD": PatternRecognizer(
        supported_entity="CREDIT_CARD",
        name="credit_card",
        patterns=[Pattern("credit_card", r"\b(?:\d[ -]*?){13,16}\b", 0.7)],
    ),
    "US_SSN": PatternRecognizer(
        supported_entity="US_SSN",
        name="us_ssn",
        patterns=[Pattern("us_ssn", r"\b\d{3}-\d{2}-\d{4}\b", 0.85)],
    ),
    "IBAN_CODE": PatternRecognizer(
        supported_entity="IBAN_CODE",
        name="iban",
        patterns=[Pattern("iban", r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b", 0.7)],
    ),
    "IP_ADDRESS": PatternRecognizer(
        supported_entity="IP_ADDRESS",
        name="ip_address",
        patterns=[
            Pattern(
                "ip_address",
                r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b",
                0.6,
            )
        ],
    ),
}


def redact_text(text: str, entity_types: list[str]) -> RedactionResult:
    spans = []
    counts: Counter[str] = Counter()
    for entity_type in entity_types:
        recognizer = _RECOGNIZERS.get(entity_type)
        if recognizer is None:
            raise ValueError(f"Unsupported Presidio redaction entity type: {entity_type}.")
        for result in recognizer.analyze(text=text, entities=[entity_type], nlp_artifacts=None):
            spans.append((result.start, result.end, entity_type))

    merged_spans = _merge_spans(spans)
    masked_text = _mask_text(text, merged_spans)
    for _start, _end, entity_type in merged_spans:
        counts[entity_type] += 1

    return RedactionResult(text=masked_text, entity_counts=dict(counts), span_count=len(merged_spans))


def _merge_spans(spans: list[tuple[int, int, str]]) -> list[tuple[int, int, str]]:
    if not spans:
        return []
    sorted_spans = sorted(spans, key=lambda item: (item[0], -(item[1] - item[0])))
    merged: list[tuple[int, int, str]] = [sorted_spans[0]]
    for start, end, entity_type in sorted_spans[1:]:
        last_start, last_end, last_type = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end), last_type)
            continue
        merged.append((start, end, entity_type))
    return merged


def _mask_text(text: str, spans: list[tuple[int, int, str]]) -> str:
    if not spans:
        return text
    chars = list(text)
    for start, end, _entity_type in spans:
        for index in range(start, end):
            if not chars[index].isspace():
                chars[index] = MASK_CHAR
    return "".join(chars)
