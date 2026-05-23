#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required. Install: https://cli.github.com/"
  exit 1
fi

git fetch origin dev master

if git diff --quiet origin/dev origin/master; then
  echo "dev and master already have the same tree."
  exit 0
fi

echo "Opening pull request: master -> dev (align branch pointers after release)"
gh pr create --base dev --head master \
  --title "Sync dev with master" \
  --body "$(cat <<'EOF'
## Summary

Align `dev` with `master` after a release merge. Trees should match; this updates branch history on `dev`.

## Test plan

- [ ] CI green (optional for pointer-only sync)

EOF
)"
