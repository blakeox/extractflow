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
        "path",
        nargs="?",
        default=str(ROOT_DIR / "evals" / "langextract" / "cases"),
        help="JSON case file or directory of JSON cases. Defaults to evals/langextract/cases.",
    )
    args = parser.parse_args()

    case_path = Path(args.path)
    if not case_path.exists():
        parser.error(f"path does not exist: {case_path}")

    cases = load_eval_cases(case_path)
    if not cases:
        print(f"No LangExtract eval cases found under {case_path}.")
        return 1

    report = run_eval_cases(cases)
    print(render_eval_summary(report))
    return 0 if report.failed_cases == 0 and report.failed_checks == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
