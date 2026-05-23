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
PROJECT_TITLE="${PROJECT_TITLE:-Company production readiness}"

if ! gh auth status 2>&1 | grep -q 'project'; then
  echo "Missing 'project' scope. Run:"
  echo "  gh auth refresh -s project,read:project"
  exit 1
fi

echo "Creating project '${PROJECT_TITLE}' for ${OWNER}..."
PROJECT_JSON=$(gh project create --owner "$OWNER" --title "$PROJECT_TITLE" --format json)
PROJECT_NUMBER=$(echo "$PROJECT_JSON" | jq -r .number)
PROJECT_ID=$(echo "$PROJECT_JSON" | jq -r .id)

echo "Project #${PROJECT_NUMBER} (id=${PROJECT_ID})"
echo "URL: https://github.com/users/${OWNER}/projects/${PROJECT_NUMBER}"

echo "Fetching production-readiness issues..."
ISSUE_URLS=$(gh issue list --repo "$REPO" --label production-readiness --limit 100 --json url --jq '.[].url')

count=0
while IFS= read -r url; do
  [[ -z "$url" ]] && continue
  gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "$url" >/dev/null
  count=$((count + 1))
done <<< "$ISSUE_URLS"

echo "Added ${count} issues to the project."
echo "In the GitHub UI, group by Milestone and add Status columns: Todo / In progress / Done."
