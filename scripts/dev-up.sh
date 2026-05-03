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

requested_web_port="$(read_env_value "WEB_PORT" "3000")"
requested_api_port="$(read_env_value "API_PORT" "8000")"
requested_ollama_port="$(read_env_value "OLLAMA_PORT" "11434")"

export WEB_PORT="$(find_available_port "$requested_web_port")"
export API_PORT="$(find_available_port "$requested_api_port")"
export OLLAMA_PORT="$(find_available_port "$requested_ollama_port")"
export VITE_API_BASE_URL="http://localhost:${API_PORT}/api"

frontend_url="http://localhost:${WEB_PORT}"

if [[ "$requested_web_port" != "$WEB_PORT" ]]; then
  echo "WEB_PORT rotated from $requested_web_port to $WEB_PORT"
fi
if [[ "$requested_api_port" != "$API_PORT" ]]; then
  echo "API_PORT rotated from $requested_api_port to $API_PORT"
fi
if [[ "$requested_ollama_port" != "$OLLAMA_PORT" ]]; then
  echo "OLLAMA_PORT rotated from $requested_ollama_port to $OLLAMA_PORT"
fi

echo "Frontend URL: $frontend_url"
echo "Backend URL:  ${VITE_API_BASE_URL}"

open_browser() {
  local url="$1"
  if command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 &
    echo "Opening $url"
    return
  fi
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
    echo "Opening $url"
    return
  fi
  echo "Frontend available at $url"
}

docker compose --env-file .env up --build "$@" &
compose_pid=$!

trap 'kill "$compose_pid" >/dev/null 2>&1 || true' INT TERM

for _ in $(seq 1 60); do
  if curl -fsS "$frontend_url" >/dev/null 2>&1; then
    open_browser "$frontend_url"
    break
  fi
  sleep 2
done

wait "$compose_pid"
