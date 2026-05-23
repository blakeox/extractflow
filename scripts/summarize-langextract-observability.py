#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

KNOWN_EVENTS = {
    "langextract_document_rejected",
    "langextract_extraction_completed",
    "langextract_feedback_suggestions_built",
}

FEEDBACK_SKIP_FIELDS = (
    "skipped_missing_document_text",
    "skipped_missing_target_field",
    "skipped_missing_grounding",
    "skipped_span_override",
    "skipped_span_mismatch",
    "skipped_empty_context",
    "skipped_no_contextual_extractions",
)

EXTRACTION_SIGNAL_FIELDS = (
    "low_confidence_review_count",
    "multi_candidate_review_count",
    "citation_gap_count",
    "validation_error_count",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Summarize structured LangExtract observability events from JSONL logs."
    )
    parser.add_argument("paths", nargs="+", help="Log files or directories containing JSONL logs.")
    return parser.parse_args()


def iter_log_files(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for raw_path in paths:
        path = Path(raw_path)
        if path.is_dir():
            files.extend(sorted(item for item in path.rglob("*") if item.is_file()))
            continue
        if path.is_file():
            files.append(path)
    return files


def to_sorted_dict(counter: Counter[Any]) -> dict[str, int]:
    return {str(key): counter[key] for key in sorted(counter)}


def summarize_logs(paths: list[str]) -> dict[str, Any]:
    files = iter_log_files(paths)
    events_seen: Counter[str] = Counter()
    rejection_reasons: Counter[str] = Counter()
    rejection_models: Counter[str] = Counter()
    extraction_models: Counter[str] = Counter()
    invalid_lines: list[dict[str, Any]] = []

    extraction_totals = Counter()
    feedback_totals = Counter()

    lines_processed = 0
    json_records_processed = 0

    for file_path in files:
        for line_number, raw_line in enumerate(file_path.read_text(encoding="utf-8").splitlines(), start=1):
            lines_processed += 1
            line = raw_line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                invalid_lines.append({"path": str(file_path), "line_number": line_number})
                continue
            if not isinstance(payload, dict):
                continue

            json_records_processed += 1
            event = payload.get("event")
            if event not in KNOWN_EVENTS:
                continue

            events_seen[str(event)] += 1
            if event == "langextract_document_rejected":
                rejection_reasons[str(payload.get("reason", "unknown"))] += 1
                if payload.get("model"):
                    rejection_models[str(payload["model"])] += 1
                extraction_totals["rejected_document_chars"] += int(payload.get("document_chars", 0))
            elif event == "langextract_extraction_completed":
                if payload.get("model"):
                    extraction_models[str(payload["model"])] += 1
                for field in (
                    "extracted_field_count",
                    "calculated_field_count",
                    "review_required_count",
                    "document_note_count",
                    *EXTRACTION_SIGNAL_FIELDS,
                ):
                    extraction_totals[field] += int(payload.get(field, 0))
            elif event == "langextract_feedback_suggestions_built":
                for field in (
                    "reviewed_result_count",
                    "reviewed_edit_count",
                    "generated_suggestion_count",
                    "visible_suggestion_count",
                    "dismissed_suggestion_count",
                    *FEEDBACK_SKIP_FIELDS,
                ):
                    feedback_totals[field] += int(payload.get(field, 0))

    return {
        "files_processed": len(files),
        "lines_processed": lines_processed,
        "json_records_processed": json_records_processed,
        "invalid_line_count": len(invalid_lines),
        "invalid_lines": invalid_lines,
        "events_seen": to_sorted_dict(events_seen),
        "document_rejections": {
            "count": events_seen["langextract_document_rejected"],
            "reasons": to_sorted_dict(rejection_reasons),
            "models": to_sorted_dict(rejection_models),
            "rejected_document_chars_total": extraction_totals["rejected_document_chars"],
        },
        "extractions": {
            "count": events_seen["langextract_extraction_completed"],
            "models": to_sorted_dict(extraction_models),
            "extracted_field_total": extraction_totals["extracted_field_count"],
            "calculated_field_total": extraction_totals["calculated_field_count"],
            "review_required_total": extraction_totals["review_required_count"],
            "document_note_total": extraction_totals["document_note_count"],
            "low_confidence_review_total": extraction_totals["low_confidence_review_count"],
            "multi_candidate_review_total": extraction_totals["multi_candidate_review_count"],
            "citation_gap_total": extraction_totals["citation_gap_count"],
            "validation_error_total": extraction_totals["validation_error_count"],
        },
        "feedback_suggestions": {
            "count": events_seen["langextract_feedback_suggestions_built"],
            "reviewed_result_total": feedback_totals["reviewed_result_count"],
            "reviewed_edit_total": feedback_totals["reviewed_edit_count"],
            "generated_suggestion_total": feedback_totals["generated_suggestion_count"],
            "visible_suggestion_total": feedback_totals["visible_suggestion_count"],
            "dismissed_suggestion_total": feedback_totals["dismissed_suggestion_count"],
            "skip_totals": {field: feedback_totals[field] for field in FEEDBACK_SKIP_FIELDS},
        },
    }


def main() -> None:
    args = parse_args()
    print(json.dumps(summarize_logs(args.paths), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
