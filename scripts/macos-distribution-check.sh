#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PATH="${1:-$ROOT_DIR/src-tauri/target/release/bundle/macos/ExtractFlow.app}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "ERROR: App bundle not found at $APP_PATH"
  echo "Build it first with: ./scripts/tauri-build.sh"
  exit 1
fi

have_command() {
  command -v "$1" >/dev/null 2>&1
}

status_ok() {
  local label="$1"
  local value="$2"
  printf '[ok] %s: %s\n' "$label" "$value"
}

status_warn() {
  local label="$1"
  local value="$2"
  printf '[warn] %s: %s\n' "$label" "$value"
}

status_fail() {
  local label="$1"
  local value="$2"
  printf '[fail] %s: %s\n' "$label" "$value"
}

echo "Artifact: $APP_PATH"

INFO_PLIST="$APP_PATH/Contents/Info.plist"
EXECUTABLE="$APP_PATH/Contents/MacOS/extractflow"

if [[ -f "$INFO_PLIST" ]]; then
  IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$INFO_PLIST" 2>/dev/null || true)"
  VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST" 2>/dev/null || true)"
  status_ok "bundle identifier" "${IDENTIFIER:-missing}"
  status_ok "bundle version" "${VERSION:-missing}"
else
  status_fail "info plist" "missing"
fi

if [[ -x "$EXECUTABLE" ]]; then
  status_ok "executable" "$EXECUTABLE"
else
  status_fail "executable" "missing"
fi

if have_command codesign; then
  CODESIGN_OUTPUT="$(codesign -dv --verbose=4 "$APP_PATH" 2>&1 || true)"
  SIGNATURE="$(printf '%s\n' "$CODESIGN_OUTPUT" | awk -F= '/^Signature=/{print $2; exit}')"
  TEAM_ID="$(printf '%s\n' "$CODESIGN_OUTPUT" | awk -F= '/^TeamIdentifier=/{print $2; exit}')"
  if [[ "${SIGNATURE:-}" == "adhoc" ]]; then
    status_warn "codesign identity" "ad-hoc only; not distribution-ready"
  elif [[ -n "${SIGNATURE:-}" ]]; then
    status_ok "codesign identity" "$SIGNATURE"
  else
    status_fail "codesign identity" "unreadable"
  fi

  if [[ "${TEAM_ID:-not set}" == "not set" ]]; then
    status_warn "team identifier" "not set"
  else
    status_ok "team identifier" "$TEAM_ID"
  fi

  if codesign --verify --deep --strict "$APP_PATH" >/dev/null 2>&1; then
    status_ok "codesign verify" "passed"
  else
    status_warn "codesign verify" "failed"
  fi
else
  status_fail "codesign" "not installed"
fi

if have_command spctl; then
  SPCTL_OUTPUT="$(spctl -a -vv "$APP_PATH" 2>&1 || true)"
  if printf '%s\n' "$SPCTL_OUTPUT" | grep -qi "accepted"; then
    status_ok "gatekeeper assessment" "accepted"
  else
    status_warn "gatekeeper assessment" "$(printf '%s\n' "$SPCTL_OUTPUT" | tr '\n' ' ' | sed 's/  */ /g')"
  fi
else
  status_fail "spctl" "not installed"
fi

if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  status_ok "APPLE_SIGNING_IDENTITY" "configured"
else
  status_warn "APPLE_SIGNING_IDENTITY" "missing"
fi

if [[ -n "${APPLE_NOTARY_PROFILE:-}" || ( -n "${APPLE_ID:-}" && -n "${APPLE_TEAM_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ) ]]; then
  status_ok "notary credentials" "configured"
else
  status_warn "notary credentials" "missing"
fi

echo
echo "Recommended next checks:"
echo "1. Sign with a Developer ID Application certificate."
echo "2. Re-run this script and confirm Gatekeeper acceptance."
echo "3. Submit for notarization and staple the ticket before distribution."
