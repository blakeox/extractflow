from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def test_langextract_observability_summary_script_aggregates_known_events(tmp_path) -> None:
    log_path = tmp_path / "langextract.log"
    log_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "event": "langextract_document_rejected",
                        "reason": "document_too_large",
                        "document_chars": 250000,
                        "model": "qwen3.5:27b",
                    }
                ),
                json.dumps(
                    {
                        "event": "langextract_extraction_completed",
                        "model": "qwen3.5:27b",
                        "extracted_field_count": 3,
                        "calculated_field_count": 1,
                        "review_required_count": 2,
                        "document_note_count": 1,
                        "low_confidence_review_count": 1,
                        "multi_candidate_review_count": 1,
                        "citation_gap_count": 0,
                        "validation_error_count": 2,
                    }
                ),
                json.dumps(
                    {
                        "event": "langextract_feedback_suggestions_built",
                        "reviewed_result_count": 4,
                        "reviewed_edit_count": 6,
                        "generated_suggestion_count": 3,
                        "visible_suggestion_count": 2,
                        "dismissed_suggestion_count": 1,
                        "skipped_missing_document_text": 1,
                        "skipped_missing_target_field": 0,
                        "skipped_missing_grounding": 1,
                        "skipped_span_override": 0,
                        "skipped_span_mismatch": 2,
                        "skipped_empty_context": 0,
                        "skipped_no_contextual_extractions": 1,
                    }
                ),
                "not-json",
            ]
        ),
        encoding="utf-8",
    )

    script_path = Path(__file__).resolve().parents[2] / "scripts" / "summarize-langextract-observability.py"
    completed = subprocess.run(
        [sys.executable, str(script_path), str(log_path)],
        check=True,
        capture_output=True,
        text=True,
    )

    summary = json.loads(completed.stdout)

    assert summary["files_processed"] == 1
    assert summary["invalid_line_count"] == 1
    assert summary["events_seen"] == {
        "langextract_document_rejected": 1,
        "langextract_extraction_completed": 1,
        "langextract_feedback_suggestions_built": 1,
    }
    assert summary["document_rejections"]["reasons"] == {"document_too_large": 1}
    assert summary["document_rejections"]["rejected_document_chars_total"] == 250000
    assert summary["extractions"]["review_required_total"] == 2
    assert summary["extractions"]["multi_candidate_review_total"] == 1
    assert summary["feedback_suggestions"]["generated_suggestion_total"] == 3
    assert summary["feedback_suggestions"]["skip_totals"]["skipped_span_mismatch"] == 2
