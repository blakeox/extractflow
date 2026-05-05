#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="${1:-${GITHUB_REF_NAME:-dev}}"
OUTPUT_DIR="$ROOT_DIR/dist/release/$VERSION"
RUNTIME_ARCHIVE="$OUTPUT_DIR/extractflow-desktop-runtime-$VERSION.tar.gz"
SOURCE_ARCHIVE="$OUTPUT_DIR/extractflow-source-$VERSION.tar.gz"
CHECKSUM_FILE="$OUTPUT_DIR/SHA256SUMS"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

git archive --format=tar.gz --output="$SOURCE_ARCHIVE" HEAD

./scripts/prepare-desktop-runtime.sh
tar -czf "$RUNTIME_ARCHIVE" -C "$ROOT_DIR/src-tauri/resources" desktop-runtime

shasum -a 256 "$SOURCE_ARCHIVE" "$RUNTIME_ARCHIVE" >"$CHECKSUM_FILE"

echo "Packaged release artifacts in $OUTPUT_DIR"
