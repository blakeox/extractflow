#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON:-$("$ROOT_DIR/scripts/resolve-python.sh")}"

cd "$ROOT_DIR"

./scripts/scan-secrets.py --staged
npm run format:check
./scripts/verify-shell.sh
"$PYTHON_BIN" -m compileall backend worker shared tests >/dev/null
./scripts/verify-frontend.sh
