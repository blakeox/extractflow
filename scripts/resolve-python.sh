#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${PYTHON:-}" ]]; then
  if command -v "$PYTHON" >/dev/null 2>&1; then
    command -v "$PYTHON"
    exit 0
  fi

  echo "Configured PYTHON '$PYTHON' was not found on PATH." >&2
  exit 1
fi

for candidate in python3.13 python3.12 python3.11 python3; do
  if ! command -v "$candidate" >/dev/null 2>&1; then
    continue
  fi

  version="$("$candidate" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  case "$version" in
    3.11|3.12|3.13)
      command -v "$candidate"
      exit 0
      ;;
  esac
done

echo "No supported Python interpreter found. Install Python 3.11, 3.12, or 3.13, or set PYTHON explicitly." >&2
exit 1
