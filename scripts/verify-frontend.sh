#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

npm run format:check
npm --prefix frontend run lint
npm --prefix frontend run test -- --run
npm --prefix frontend run build
