#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON:-$("$ROOT_DIR/scripts/resolve-python.sh")}"

cd "$ROOT_DIR"

EVAL_PATH="${1:-$ROOT_DIR/evals/langextract/cases}"
if [[ $# -gt 0 ]]; then
  shift
fi

./scripts/verify-python.sh
"$PYTHON_BIN" ./scripts/evaluate-langextract.py "$EVAL_PATH" "$@"
