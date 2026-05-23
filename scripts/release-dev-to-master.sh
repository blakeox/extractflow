#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required. Install: https://cli.github.com/"
  exit 1
fi

git fetch origin dev master

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
COMPARE="$(gh api "repos/${REPO}/compare/master...dev" --jq '{ahead_by,behind_by,status}')"
AHEAD="$(echo "$COMPARE" | jq -r '.ahead_by')"
BEHIND="$(echo "$COMPARE" | jq -r '.behind_by')"
STATUS="$(echo "$COMPARE" | jq -r '.status')"

if [[ "$AHEAD" == "0" && "$BEHIND" == "0" ]]; then
  echo "dev and master are already in sync."
  exit 0
fi

if [[ "$AHEAD" == "0" ]]; then
  echo "dev has no commits ahead of master. Merge or rebase master into dev first."
  exit 1
fi

echo "dev is ${AHEAD} commit(s) ahead and ${BEHIND} behind master (status: ${STATUS})."

if [[ "$BEHIND" == "0" ]]; then
  echo "Opening pull request: dev -> master"
  gh pr create --base master --head dev \
    --title "Release: promote dev to master" \
    --body "$(cat <<'EOF'
## Summary

Promote the current `dev` branch to `master`.

## After merge

Run `./scripts/sync-master-to-dev.sh` so `dev` stays aligned with `master`.

## Test plan

- [ ] CI green on this PR

EOF
)"
  exit 0
fi

RELEASE_BRANCH="chore/release-dev-to-master-$(date +%Y%m%d)"
echo "Branches diverged; using release branch ${RELEASE_BRANCH}"

git checkout -B "$RELEASE_BRANCH" origin/dev
git merge origin/master -s ours -m "Merge master into release branch (keep dev tree)."
git push -u origin "$RELEASE_BRANCH"

gh pr create --base master --head "$RELEASE_BRANCH" \
  --title "Release: promote dev to master" \
  --body "$(cat <<EOF
## Summary

Promote \`dev\` to \`master\` via release branch (histories diverged; file tree from \`dev\`).

## After merge

Run \`./scripts/sync-master-to-dev.sh\`.

## Test plan

- [ ] CI green on this PR
EOF
)"

echo "Release PR opened. After it merges, run: ./scripts/sync-master-to-dev.sh"
