#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/src-tauri/resources/desktop-runtime"

rm -rf "$RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR"

cp "$ROOT_DIR/docker-compose.desktop.yml" "$RUNTIME_DIR/docker-compose.desktop.yml"
cp "$ROOT_DIR/.env.example" "$RUNTIME_DIR/.env.example"
cp -R "$ROOT_DIR/backend" "$RUNTIME_DIR/backend"
cp -R "$ROOT_DIR/worker" "$RUNTIME_DIR/worker"
cp -R "$ROOT_DIR/shared" "$RUNTIME_DIR/shared"
cp -R "$ROOT_DIR/samples" "$RUNTIME_DIR/samples"
touch "$RUNTIME_DIR/.gitkeep"

echo "Prepared desktop runtime bundle at $RUNTIME_DIR"
