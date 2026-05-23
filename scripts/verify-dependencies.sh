#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON:-$("$ROOT_DIR/scripts/resolve-python.sh")}"

cd "$ROOT_DIR"

echo "Auditing npm dependencies (frontend)..."
npm --prefix frontend audit --audit-level=moderate

if ! "$PYTHON_BIN" -m pip_audit --version >/dev/null 2>&1; then
  echo "pip-audit is not installed for $PYTHON_BIN. Install requirements-dev.txt before running dependency audits." >&2
  exit 1
fi

echo "Auditing pip dependencies (backend + worker)..."
"$PYTHON_BIN" -m pip_audit \
  -r backend/requirements.txt \
  -r worker/requirements.txt
