#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

check_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

check_command docker
docker info >/dev/null 2>&1 || fail "Docker daemon is not running."
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is unavailable."

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
  echo "Created .env from .env.example"
fi

echo "Dev environment preflight passed."
