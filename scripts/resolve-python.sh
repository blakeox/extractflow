#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

is_supported_python() {
  local candidate="$1"
  local version

  if ! command -v "$candidate" >/dev/null 2>&1; then
    return 1
  fi

  if ! version="$("$candidate" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null)"; then
    return 1
  fi

  case "$version" in
    3.11|3.12|3.13)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

if [[ -n "${PYTHON:-}" ]]; then
  if command -v "$PYTHON" >/dev/null 2>&1; then
    command -v "$PYTHON"
    exit 0
  fi

  echo "Configured PYTHON '$PYTHON' was not found on PATH." >&2
  exit 1
fi

if [[ -x "$ROOT_DIR/.venv/bin/python" ]] && is_supported_python "$ROOT_DIR/.venv/bin/python"; then
  echo "$ROOT_DIR/.venv/bin/python"
  exit 0
fi

for candidate in python3.13 python3.12 python3.11 python3; do
  if is_supported_python "$candidate"; then
    command -v "$candidate"
    exit 0
  fi
done

echo "No supported Python interpreter found. Install Python 3.11, 3.12, or 3.13, or set PYTHON explicitly." >&2
exit 1
