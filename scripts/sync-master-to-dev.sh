#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required. Install: https://cli.github.com/"
  exit 1
fi

git fetch origin dev master

DEV_SHA="$(git rev-parse origin/dev)"
MASTER_SHA="$(git rev-parse origin/master)"

if [[ "$DEV_SHA" == "$MASTER_SHA" ]]; then
  echo "dev and master already point at the same commit (${DEV_SHA})."
  exit 0
fi

if git diff --quiet origin/dev origin/master; then
  echo "dev and master have the same tree but different tips (common after squash release)."
  echo "Opening pull request: master -> dev (squash merge; no merge commits on dev)"
  EXISTING="$(gh pr list --base dev --head master --state open --json number -q '.[0].number' || true)"
  if [[ -n "$EXISTING" ]]; then
    echo "Open sync PR already exists: #${EXISTING}"
    gh pr view "$EXISTING" --web 2>/dev/null || gh pr view "$EXISTING"
    exit 0
  fi
  gh pr create --base dev --head master \
    --title "Sync dev with master" \
    --body "$(cat <<'EOF'
## Summary

Align `dev` with `master` after a release merge. File trees already match; this updates the `dev` branch pointer without a local merge commit (branch protection disallows merge commits on `dev`).

Merge this PR with **squash merge**.

## Test plan

- [ ] CI green (pointer-only sync)

EOF
)"
  echo "After the PR merges, dev and master will share the same release tip."
  exit 0
fi

echo "dev and master differ in content; opening pull request: master -> dev"
gh pr create --base dev --head master \
  --title "Sync dev with master" \
  --body "$(cat <<'EOF'
## Summary

Merge `master` into `dev` after a release so integration branch includes production fixes.

## Test plan

- [ ] CI green

EOF
)"
