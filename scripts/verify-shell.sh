#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON:-$("$ROOT_DIR/scripts/resolve-python.sh")}"
PYTHON_BIN_DIR="$(dirname "$PYTHON_BIN")"
SHELLCHECK_BIN="$PYTHON_BIN_DIR/shellcheck"

cd "$ROOT_DIR"

if [[ ! -x "$SHELLCHECK_BIN" ]]; then
  if command -v shellcheck >/dev/null 2>&1; then
    SHELLCHECK_BIN="$(command -v shellcheck)"
  else
    echo "shellcheck is not installed for $PYTHON_BIN. Install requirements-dev.txt with that interpreter before running shell verification." >&2
    exit 1
  fi
fi

"$SHELLCHECK_BIN" -x scripts/*.sh
