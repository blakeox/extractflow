#!/usr/bin/env bash
# Creates a GitHub Project board and adds production-readiness issues.
# Requires: gh auth refresh -s project,read:project
#
# Usage:
#   gh auth refresh -s project,read:project
#   ./scripts/setup-github-project.sh

set -euo pipefail

REPO="${GITHUB_REPOSITORY:-blakeox/extractflow}"
OWNER="${GITHUB_OWNER:-blakeox}"
PROJECT_TITLE="${PROJECT_TITLE:-ExtractFlow production roadmap}"

if ! gh project list --owner "$OWNER" --limit 1 >/dev/null 2>&1; then
  echo "Missing Projects API scope. Run:"
  echo "  gh auth refresh -s project,read:project"
  echo "Then approve the device login at https://github.com/login/device"
  exit 1
fi

existing_number=$(
  gh project list --owner "$OWNER" --format json --limit 100 2>/dev/null \
    | jq -r --arg title "$PROJECT_TITLE" '.projects[] | select(.title == $title) | .number' \
    | head -n 1
)

if [[ -n "$existing_number" ]]; then
  PROJECT_NUMBER="$existing_number"
  echo "Using existing project '${PROJECT_TITLE}' (#${PROJECT_NUMBER})"
else
  echo "Creating project '${PROJECT_TITLE}' for ${OWNER}..."
  PROJECT_JSON=$(gh project create --owner "$OWNER" --title "$PROJECT_TITLE" --format json)
  PROJECT_NUMBER=$(echo "$PROJECT_JSON" | jq -r .number)
fi

echo "Project #${PROJECT_NUMBER}"
echo "URL: https://github.com/users/${OWNER}/projects/${PROJECT_NUMBER}"

echo "Fetching production-readiness issues..."
ISSUE_URLS=$(gh issue list --repo "$REPO" --label production-readiness --limit 100 --json url --jq '.[].url')

count=0
skipped=0
while IFS= read -r url; do
  [[ -z "$url" ]] && continue
  if gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "$url" >/dev/null 2>&1; then
    count=$((count + 1))
  else
    skipped=$((skipped + 1))
  fi
done <<< "$ISSUE_URLS"

echo "Added ${count} issue(s) to the project (${skipped} already present or skipped)."
echo "In the GitHub UI: add Status field (Todo / In progress / Done) and group by Milestone."
