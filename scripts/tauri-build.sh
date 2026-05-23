#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

read_env_value() {
  local key="$1"
  local default_value="$2"
  local value
  value="$(awk -F= -v search_key="$key" '$1 == search_key {print substr($0, index($0, "=") + 1)}' .env | tail -n1)"
  if [[ -z "$value" ]]; then
    echo "$default_value"
  else
    echo "$value"
  fi
}

API_PORT="$(read_env_value "API_PORT" "8000")"
export API_PORT
export VITE_API_BASE_URL="http://localhost:${API_PORT}/api"
export EXTRACTFLOW_PROJECT_ROOT="$ROOT_DIR"

./scripts/prepare-desktop-runtime.sh

npx tauri build
