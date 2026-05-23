#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON:-$("$ROOT_DIR/scripts/resolve-python.sh")}"

cd "$ROOT_DIR"

if ! "$PYTHON_BIN" -m pytest --version >/dev/null 2>&1; then
  echo "pytest is not installed for $PYTHON_BIN. Install requirements-dev.txt with that interpreter before running Python verification." >&2
  exit 1
fi

"$PYTHON_BIN" -m ruff format --check backend worker shared tests
"$PYTHON_BIN" -m ruff check backend worker shared tests
"$PYTHON_BIN" -m pyright --project pyrightconfig.backend.json
"$PYTHON_BIN" -m pyright --project pyrightconfig.worker.json
PYTHONPATH=shared "$PYTHON_BIN" -m pytest tests/shared
PYTHONPATH=backend:shared "$PYTHON_BIN" -m pytest tests/backend
PYTHONPATH=worker:shared "$PYTHON_BIN" -m pytest tests/worker
