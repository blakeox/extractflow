#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR / "worker"))
sys.path.insert(0, str(ROOT_DIR / "shared"))


def main() -> int:
    from app.services.langextract_eval import load_eval_cases, render_eval_summary, run_eval_cases

    parser = argparse.ArgumentParser(
        description="Run LangExtract golden-set evaluation cases against the configured local runtime."
    )
    parser.add_argument(
        "paths",
        nargs="*",
        default=[str(ROOT_DIR / "evals" / "langextract" / "cases")],
        help="One or more JSON case files or directories of JSON cases. Defaults to evals/langextract/cases.",
    )
    parser.add_argument(
        "--duckdb",
        help="Optional DuckDB path for storing benchmark run history.",
    )
    parser.add_argument(
        "--label",
        help="Optional freeform label stored with the DuckDB benchmark run.",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Only load and validate eval case JSON; do not call a live LangExtract runtime.",
    )
    args = parser.parse_args()

    cases = []
    for path_arg in args.paths:
        case_path = Path(path_arg)
        if not case_path.exists():
            parser.error(f"path does not exist: {case_path}")
        cases.extend(load_eval_cases(case_path))
    if not cases:
        print(f"No LangExtract eval cases found under {', '.join(args.paths)}.")
        return 1

    if args.validate_only:
        print(f"Validated {len(cases)} LangExtract eval case(s).")
        for case in cases:
            print(f"- {case.name}")
        return 0

    report = run_eval_cases(cases)
    print(render_eval_summary(report))
    if args.duckdb:
        from app.services.langextract_eval import store_eval_report

        run_id = store_eval_report(
            Path(args.duckdb), report, source_path=Path(args.paths[0]), label=args.label
        )
        print(f"Stored benchmark run {run_id} in {Path(args.duckdb)}")
    return 0 if report.failed_cases == 0 and report.failed_checks == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
