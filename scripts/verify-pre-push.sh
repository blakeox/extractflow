#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

./scripts/scan-secrets.py
./scripts/verify-shell.sh
./scripts/verify-python.sh
./scripts/verify-frontend.sh
