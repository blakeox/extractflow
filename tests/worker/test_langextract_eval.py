from __future__ import annotations

import json
from pathlib import Path

from app.services.langextract_eval import (
    LangExtractEvalCase,
    apply_eval_runtime_overrides,
    load_eval_cases,
    render_eval_summary,
    run_eval_case,
    run_eval_cases,
)


def test_apply_eval_runtime_overrides_updates_llm_settings(
    monkeypatch,
) -> None:
    monkeypatch.setenv("LANGEXTRACT_EVAL_BASE_URL", "http://127.0.0.1:11434/v1")
    monkeypatch.setenv("LANGEXTRACT_EVAL_MODEL", "qwen2.5:3b")

    definition = apply_eval_runtime_overrides(
        {
            "template_name": "Invoice Extraction Eval",
            "llm_provider_settings": {
                "base_url": "http://host.docker.internal:11434/v1",
                "model": "qwen3.5:27b",
            },
        }
    )

    assert definition["llm_provider_settings"]["base_url"] == "http://127.0.0.1:11434/v1"
    assert definition["llm_provider_settings"]["model"] == "qwen2.5:3b"


def test_load_eval_cases_reads_sorted_json_files(tmp_path) -> None:
    case_a = tmp_path / "b-case.json"
    case_b = tmp_path / "a-case.json"
    payload = {
        "name": "case",
        "document_text": "Example",
        "template_definition": {"template_name": "x"},
        "expected_fields": {
            "vendor_name": {
                "extracted_value": "Acme Corp",
            }
        },
    }
    case_a.write_text(json.dumps({**payload, "name": "b-case"}), encoding="utf-8")
    case_b.write_text(json.dumps({**payload, "name": "a-case"}), encoding="utf-8")

    cases = load_eval_cases(tmp_path)

    assert [case.name for case in cases] == ["a-case", "b-case"]
    assert cases[0].source_path is not None
    assert cases[0].source_path.endswith("a-case.json")


def test_run_eval_case_matches_tolerant_field_values_and_review_flags(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.langextract_eval.execute_extraction",
        lambda **kwargs: {
            "llm_provider": {
                "provider_label": "LangExtract (Ollama)",
                "provider_type": "langextract",
                "model": "qwen3.5:27b",
            },
            "extracted_fields": [
                {
                    "field_name": "vendor_name",
                    "extracted_value": "  ACME   CORP ",
                    "normalized_value": {"value": "Acme Corp"},
                    "requires_review": False,
                },
                {
                    "field_name": "total_amount",
                    "extracted_value": "$1,200.00",
                    "normalized_value": {
                        "amount": 1200.0001,
                        "currency": "usd",
                        "display_value": "$1,200.00",
                        "extra_key": "ignored",
                    },
                    "requires_review": False,
                },
            ],
            "calculated_fields": [
                {
                    "field_name": "amount_with_buffer",
                    "normalized_value": {"amount": 1320.0, "currency": "USD"},
                    "requires_review": False,
                }
            ],
            "fields_requiring_review": [],
            "document_level_notes": ["Selected highest-confidence match from 2 chunk candidates."],
        },
    )

    case = LangExtractEvalCase.model_validate(
        {
            "name": "invoice-basic",
            "document_text": "Invoice Vendor: Acme Corp\nTotal Due: $1,200.00",
            "template_definition": {"template_name": "Invoice Extraction Eval"},
            "expected_fields": {
                "vendor_name": {
                    "extracted_value": "Acme Corp",
                    "normalized_value": {"value": "Acme Corp"},
                    "requires_review": False,
                },
                "total_amount": {
                    "extracted_value": "$1,200.00",
                    "normalized_value": {
                        "amount": 1200.0,
                        "currency": "USD",
                        "display_value": "$1,200.00",
                    },
                    "requires_review": False,
                },
            },
            "expected_calculated_fields": {
                "amount_with_buffer": {
                    "normalized_value": {"amount": 1320.0, "currency": "USD"},
                    "requires_review": False,
                }
            },
            "expected_review_flags": [],
            "expected_document_level_note_substrings": ["highest confidence match"],
        }
    )

    result = run_eval_case(case)

    assert result.passed is True
    assert result.failed_checks == 0
    assert result.matched_checks == 10


def test_run_eval_case_reports_missing_fields_and_review_flag_mismatches(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.langextract_eval.execute_extraction",
        lambda **kwargs: {
            "llm_provider": {
                "provider_label": "LangExtract (Ollama)",
                "provider_type": "langextract",
                "model": "qwen3.5:27b",
            },
            "extracted_fields": [],
            "calculated_fields": [],
            "fields_requiring_review": ["vendor_name"],
            "document_level_notes": [],
        },
    )

    case = LangExtractEvalCase.model_validate(
        {
            "name": "missing-field",
            "document_text": "Vendor Name: Acme Corp",
            "template_definition": {"template_name": "Invoice Extraction Eval"},
            "expected_fields": {
                "vendor_name": {
                    "extracted_value": "Acme Corp",
                    "normalized_value": {"value": "Acme Corp"},
                    "requires_review": False,
                }
            },
            "expected_review_flags": [],
            "expected_document_level_note_substrings": ["unexpected field"],
        }
    )

    result = run_eval_case(case)
    report = run_eval_cases([case])
    summary = render_eval_summary(report)

    assert result.passed is False
    assert result.failed_checks == 5
    assert any(mismatch.category == "field" for mismatch in result.mismatches)
    assert any(mismatch.category == "review_flags" for mismatch in result.mismatches)
    assert "FAIL missing-field" in summary


def test_repository_eval_cases_validate_and_use_unique_names() -> None:
    cases_dir = Path(__file__).resolve().parents[2] / "evals" / "langextract" / "cases"

    cases = load_eval_cases(cases_dir)

    assert len(cases) >= 5
    assert len({case.name for case in cases}) == len(cases)
    assert all(case.source_path and case.source_path.endswith(".json") for case in cases)
