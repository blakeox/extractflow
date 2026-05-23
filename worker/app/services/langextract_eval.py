from __future__ import annotations

import json
import math
import os
import re
import tempfile
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.services.executor import execute_extraction

WHITESPACE_PATTERN = re.compile(r"\s+")


class LangExtractEvalFieldExpectation(BaseModel):
    extracted_value: Any = None
    normalized_value: Any = None
    requires_review: bool | None = None


class LangExtractEvalCase(BaseModel):
    name: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    document_text: str
    template_definition: dict[str, Any]
    provider_override: dict[str, Any] | None = None
    expected_fields: dict[str, LangExtractEvalFieldExpectation] = Field(default_factory=dict)
    expected_calculated_fields: dict[str, LangExtractEvalFieldExpectation] = Field(default_factory=dict)
    expected_review_flags: list[str] = Field(default_factory=list)
    expected_document_level_note_substrings: list[str] = Field(default_factory=list)
    source_path: str | None = None

    @model_validator(mode="after")
    def validate_expectations_present(self) -> LangExtractEvalCase:
        if (
            not self.expected_fields
            and not self.expected_calculated_fields
            and not self.expected_review_flags
            and not self.expected_document_level_note_substrings
        ):
            raise ValueError("LangExtract eval cases must define at least one expected assertion.")
        return self


@dataclass
class LangExtractEvalMismatch:
    category: str
    subject: str
    detail: str


@dataclass
class LangExtractEvalCaseResult:
    name: str
    source_path: str | None
    provider_summary: dict[str, Any]
    passed: bool
    matched_checks: int
    failed_checks: int
    mismatches: list[LangExtractEvalMismatch] = field(default_factory=list)


@dataclass
class LangExtractEvalReport:
    run_id: str
    generated_at: datetime
    total_cases: int
    passed_cases: int
    failed_cases: int
    matched_checks: int
    failed_checks: int
    case_results: list[LangExtractEvalCaseResult] = field(default_factory=list)


def load_eval_cases(path: Path) -> list[LangExtractEvalCase]:
    if not path.exists():
        raise FileNotFoundError(f"LangExtract eval path does not exist: {path}")

    files = [path] if path.is_file() else sorted(item for item in path.rglob("*.json") if item.is_file())
    cases: list[LangExtractEvalCase] = []
    for file_path in files:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
        case = LangExtractEvalCase.model_validate(payload)
        case.source_path = str(file_path)
        cases.append(case)
    return cases


def run_eval_cases(cases: list[LangExtractEvalCase]) -> LangExtractEvalReport:
    case_results = [run_eval_case(case) for case in cases]
    return LangExtractEvalReport(
        run_id=datetime.now(UTC).strftime("%Y%m%d%H%M%S%f"),
        generated_at=datetime.now(UTC),
        total_cases=len(case_results),
        passed_cases=sum(1 for result in case_results if result.passed),
        failed_cases=sum(1 for result in case_results if not result.passed),
        matched_checks=sum(result.matched_checks for result in case_results),
        failed_checks=sum(result.failed_checks for result in case_results),
        case_results=case_results,
    )


def apply_eval_runtime_overrides(template_definition: dict[str, Any]) -> dict[str, Any]:
    base_url = os.environ.get("LANGEXTRACT_EVAL_BASE_URL")
    model = os.environ.get("LANGEXTRACT_EVAL_MODEL")
    if not base_url and not model:
        return template_definition

    definition = deepcopy(template_definition)
    settings = definition.setdefault("llm_provider_settings", {})
    if base_url:
        settings["base_url"] = base_url
    if model:
        settings["model"] = model
    return definition


def run_eval_case(case: LangExtractEvalCase) -> LangExtractEvalCaseResult:
    template_definition = apply_eval_runtime_overrides(case.template_definition)

    with tempfile.TemporaryDirectory(prefix="langextract-eval-") as temp_dir:
        document_path = Path(temp_dir) / "document.txt"
        document_path.write_text(case.document_text, encoding="utf-8")
        summary = execute_extraction(
            document_path=str(document_path),
            document_id=1,
            template_definition=template_definition,
            provider_override=case.provider_override,
        )

    mismatches: list[LangExtractEvalMismatch] = []
    matched_checks = 0
    failed_checks = 0

    extracted_fields = {field["field_name"]: field for field in summary["extracted_fields"]}
    calculated_fields = {field["field_name"]: field for field in summary.get("calculated_fields", [])}

    matched, failed, field_mismatches = compare_expected_fields(
        extracted_fields,
        case.expected_fields,
        category="field",
    )
    matched_checks += matched
    failed_checks += failed
    mismatches.extend(field_mismatches)

    matched, failed, field_mismatches = compare_expected_fields(
        calculated_fields,
        case.expected_calculated_fields,
        category="calculated_field",
    )
    matched_checks += matched
    failed_checks += failed
    mismatches.extend(field_mismatches)

    review_expected = sorted(set(case.expected_review_flags))
    review_actual = sorted(set(summary.get("fields_requiring_review", [])))
    if review_expected == review_actual:
        matched_checks += 1
    else:
        failed_checks += 1
        mismatches.append(
            LangExtractEvalMismatch(
                category="review_flags",
                subject="fields_requiring_review",
                detail=f"expected {review_expected!r}, got {review_actual!r}",
            )
        )

    notes = summary.get("document_level_notes", [])
    for expected_note in case.expected_document_level_note_substrings:
        if any(normalize_string(expected_note) in normalize_string(note) for note in notes):
            matched_checks += 1
        else:
            failed_checks += 1
            mismatches.append(
                LangExtractEvalMismatch(
                    category="document_note",
                    subject=expected_note,
                    detail=f"expected note containing {expected_note!r}, got {notes!r}",
                )
            )

    return LangExtractEvalCaseResult(
        name=case.name,
        source_path=case.source_path,
        provider_summary=summary.get("llm_provider", {}),
        passed=failed_checks == 0,
        matched_checks=matched_checks,
        failed_checks=failed_checks,
        mismatches=mismatches,
    )


def compare_expected_fields(
    actual_fields: dict[str, dict[str, Any]],
    expected_fields: dict[str, LangExtractEvalFieldExpectation],
    *,
    category: str,
) -> tuple[int, int, list[LangExtractEvalMismatch]]:
    matched_checks = 0
    failed_checks = 0
    mismatches: list[LangExtractEvalMismatch] = []

    for field_name, expectation in expected_fields.items():
        actual = actual_fields.get(field_name)
        if actual is None:
            failed_checks += count_field_expectations(expectation)
            mismatches.append(
                LangExtractEvalMismatch(
                    category=category,
                    subject=field_name,
                    detail="field missing from extraction output",
                )
            )
            continue

        if expectation.extracted_value is not None:
            if values_match(expectation.extracted_value, actual.get("extracted_value")):
                matched_checks += 1
            else:
                failed_checks += 1
                mismatches.append(
                    LangExtractEvalMismatch(
                        category=category,
                        subject=field_name,
                        detail=(
                            "extracted_value mismatch: "
                            f"expected {expectation.extracted_value!r}, got {actual.get('extracted_value')!r}"
                        ),
                    )
                )

        if expectation.normalized_value is not None:
            if values_match(expectation.normalized_value, actual.get("normalized_value")):
                matched_checks += 1
            else:
                failed_checks += 1
                mismatches.append(
                    LangExtractEvalMismatch(
                        category=category,
                        subject=field_name,
                        detail=(
                            "normalized_value mismatch: "
                            f"expected {expectation.normalized_value!r}, got {actual.get('normalized_value')!r}"
                        ),
                    )
                )

        if expectation.requires_review is not None:
            if expectation.requires_review == actual.get("requires_review"):
                matched_checks += 1
            else:
                failed_checks += 1
                mismatches.append(
                    LangExtractEvalMismatch(
                        category=category,
                        subject=field_name,
                        detail=(
                            "requires_review mismatch: "
                            f"expected {expectation.requires_review!r}, got {actual.get('requires_review')!r}"
                        ),
                    )
                )

    return matched_checks, failed_checks, mismatches


def count_field_expectations(expectation: LangExtractEvalFieldExpectation) -> int:
    return sum(
        1
        for value in (
            expectation.extracted_value,
            expectation.normalized_value,
            expectation.requires_review,
        )
        if value is not None
    )


def values_match(expected: Any, actual: Any) -> bool:
    if isinstance(expected, bool) or expected is None:
        return expected == actual

    if isinstance(expected, int | float):
        if not isinstance(actual, int | float) or isinstance(actual, bool):
            return False
        return math.isclose(float(expected), float(actual), abs_tol=0.01)

    if isinstance(expected, str):
        if not isinstance(actual, str):
            return False
        return normalize_string(expected) == normalize_string(actual)

    if isinstance(expected, list):
        if not isinstance(actual, list) or len(expected) != len(actual):
            return False
        return all(values_match(expected_item, actual_item) for expected_item, actual_item in zip(expected, actual))

    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return False
        return all(
            key in actual and values_match(expected_value, actual[key]) for key, expected_value in expected.items()
        )

    return expected == actual


def normalize_string(value: str) -> str:
    normalized = value.replace("-", " ").replace("_", " ")
    return WHITESPACE_PATTERN.sub(" ", normalized).strip().casefold()


def render_eval_summary(report: LangExtractEvalReport) -> str:
    lines = [
        "LangExtract eval summary",
        f"Cases: {report.passed_cases} passed, {report.failed_cases} failed, {report.total_cases} total",
        f"Checks: {report.matched_checks} matched, {report.failed_checks} failed",
    ]
    for result in report.case_results:
        provider_label = result.provider_summary.get("provider_label") or result.provider_summary.get(
            "provider_type", "unknown-provider"
        )
        model = result.provider_summary.get("model", "unknown-model")
        status = "PASS" if result.passed else "FAIL"
        location = f" ({result.source_path})" if result.source_path else ""
        lines.append(
            f"- {status} {result.name}{location} [{provider_label} / {model}] "
            f"{result.matched_checks} matched, {result.failed_checks} failed"
        )
        for mismatch in result.mismatches:
            lines.append(f"    - {mismatch.category}:{mismatch.subject}: {mismatch.detail}")
    return "\n".join(lines)


def store_eval_report(
    database_path: Path,
    report: LangExtractEvalReport,
    *,
    source_path: Path,
    label: str | None = None,
) -> str:
    import duckdb

    connection = duckdb.connect(str(database_path))
    try:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS langextract_eval_runs (
                run_id TEXT PRIMARY KEY,
                generated_at TIMESTAMP NOT NULL,
                label TEXT,
                source_path TEXT NOT NULL,
                total_cases INTEGER NOT NULL,
                passed_cases INTEGER NOT NULL,
                failed_cases INTEGER NOT NULL,
                matched_checks INTEGER NOT NULL,
                failed_checks INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS langextract_eval_case_results (
                run_id TEXT NOT NULL,
                case_name TEXT NOT NULL,
                source_path TEXT,
                provider_type TEXT,
                provider_label TEXT,
                model TEXT,
                passed BOOLEAN NOT NULL,
                matched_checks INTEGER NOT NULL,
                failed_checks INTEGER NOT NULL,
                mismatches_json TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            INSERT INTO langextract_eval_runs
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                report.run_id,
                report.generated_at,
                label,
                str(source_path),
                report.total_cases,
                report.passed_cases,
                report.failed_cases,
                report.matched_checks,
                report.failed_checks,
            ],
        )
        for case_result in report.case_results:
            connection.execute(
                """
                INSERT INTO langextract_eval_case_results
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    report.run_id,
                    case_result.name,
                    case_result.source_path,
                    case_result.provider_summary.get("provider_type"),
                    case_result.provider_summary.get("provider_label"),
                    case_result.provider_summary.get("model"),
                    case_result.passed,
                    case_result.matched_checks,
                    case_result.failed_checks,
                    json.dumps(
                        [
                            {
                                "category": mismatch.category,
                                "subject": mismatch.subject,
                                "detail": mismatch.detail,
                            }
                            for mismatch in case_result.mismatches
                        ]
                    ),
                ],
            )
    finally:
        connection.close()
    return report.run_id
