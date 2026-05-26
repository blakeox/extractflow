#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${DATA_DIR:-${ROOT_DIR}/data}"

if [[ ! -d "${DATA_DIR}" ]]; then
  echo "DATA_DIR does not exist: ${DATA_DIR}" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="extractflow-data-backup-${STAMP}.tar.gz"
PARENT="$(cd "$(dirname "${DATA_DIR}")" && pwd)"
BASE="$(basename "${DATA_DIR}")"

tar -czf "${ROOT_DIR}/${ARCHIVE}" -C "${PARENT}" "${BASE}"
echo "Created ${ROOT_DIR}/${ARCHIVE}"
