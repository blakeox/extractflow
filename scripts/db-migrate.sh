#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}/backend"

export PYTHONPATH="${ROOT}/backend:${ROOT}/shared"
export DATABASE_URL="${DATABASE_URL:-sqlite:////data/extractflow.db}"

alembic upgrade head
