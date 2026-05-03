#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

./scripts/dev-doctor.sh

port_in_use() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

find_available_port() {
  local start_port="$1"
  local port="$start_port"
  while port_in_use "$port"; do
    port=$((port + 1))
  done
  echo "$port"
}

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

requested_api_port="$(read_env_value "API_PORT" "8000")"
requested_ollama_port="$(read_env_value "OLLAMA_PORT" "11434")"
requested_tauri_port="$(read_env_value "TAURI_UI_PORT" "1420")"

export API_PORT="$(find_available_port "$requested_api_port")"
export OLLAMA_PORT="$(find_available_port "$requested_ollama_port")"
export TAURI_UI_PORT="$(find_available_port "$requested_tauri_port")"
export VITE_API_BASE_URL="http://localhost:${API_PORT}/api"
export EXTRACTFLOW_PROJECT_ROOT="$ROOT_DIR"
export EXTRACTFLOW_APP_DATA_DIR="${ROOT_DIR}/.extractflow-desktop-data"

echo "Tauri UI URL: http://127.0.0.1:${TAURI_UI_PORT}"
echo "Backend URL:  ${VITE_API_BASE_URL}"

mkdir -p "$EXTRACTFLOW_APP_DATA_DIR"

docker compose -f docker-compose.desktop.yml up --build -d backend worker

temp_config="$(mktemp "${TMPDIR:-/tmp}/extractflow-tauri-dev.XXXXXX.json")"
cat >"$temp_config" <<EOF
{
  "build": {
    "devUrl": "http://127.0.0.1:${TAURI_UI_PORT}",
    "beforeDevCommand": "npm --prefix frontend run dev -- --host 127.0.0.1 --port ${TAURI_UI_PORT} --strictPort"
  }
}
EOF

cleanup() {
  rm -f "$temp_config"
}

trap cleanup EXIT

npx tauri dev --config "$temp_config"
