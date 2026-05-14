from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import duckdb
from app.services.langextract_eval import (
    LangExtractEvalCaseResult,
    LangExtractEvalMismatch,
    LangExtractEvalReport,
    store_eval_report,
)


def test_store_eval_report_writes_run_and_case_rows(tmp_path) -> None:
    report = LangExtractEvalReport(
        run_id="run-1",
        generated_at=datetime.now(UTC),
        total_cases=1,
        passed_cases=1,
        failed_cases=0,
        matched_checks=4,
        failed_checks=0,
        case_results=[
            LangExtractEvalCaseResult(
                name="invoice-basic",
                source_path="/tmp/invoice-basic.json",
                provider_summary={
                    "provider_type": "langextract",
                    "provider_label": "LangExtract (Ollama)",
                    "model": "qwen3.5:27b",
                },
                passed=True,
                matched_checks=4,
                failed_checks=0,
                mismatches=[
                    LangExtractEvalMismatch(
                        category="field",
                        subject="vendor_name",
                        detail="normalized_value mismatch",
                    )
                ],
            )
        ],
    )
    database_path = tmp_path / "benchmarks.duckdb"

    run_id = store_eval_report(
        database_path,
        report,
        source_path=Path("/tmp/cases"),
        label="local-smoke",
    )

    assert run_id == "run-1"
    connection = duckdb.connect(str(database_path))
    try:
        run_row = connection.execute(
            "SELECT label, total_cases, passed_cases, failed_cases FROM langextract_eval_runs WHERE run_id = ?",
            [run_id],
        ).fetchone()
        case_row = connection.execute(
            """
            SELECT case_name, provider_type, provider_label, model, passed, matched_checks, failed_checks, mismatches_json
            FROM langextract_eval_case_results
            WHERE run_id = ?
            """,
            [run_id],
        ).fetchone()
    finally:
        connection.close()

    assert run_row == ("local-smoke", 1, 1, 0)
    assert case_row is not None
    assert case_row[:7] == ("invoice-basic", "langextract", "LangExtract (Ollama)", "qwen3.5:27b", True, 4, 0)
    assert json.loads(case_row[7])[0]["subject"] == "vendor_name"
