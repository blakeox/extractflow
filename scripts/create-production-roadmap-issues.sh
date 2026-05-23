#!/usr/bin/env bash
# Creates GitHub milestones and issues for the company production roadmap.
# Usage: ./scripts/create-production-roadmap-issues.sh
# Requires: gh auth login, push access to blakeox/extractflow

set -euo pipefail

REPO="${GITHUB_REPOSITORY:-blakeox/extractflow}"
ROADMAP_URL="https://github.com/${REPO}/blob/main/docs/PRODUCTION_ROADMAP.md"

create_milestone() {
  local title="$1"
  local description="$2"
  gh api "repos/${REPO}/milestones" \
    -f title="$title" \
    -f description="$description" \
    --jq .number
}

create_issue() {
  local title="$1"
  local body="$2"
  local milestone="$3"
  local labels="$4"
  gh issue create \
    --repo "$REPO" \
    --title "$title" \
    --body "$body" \
    --milestone "$milestone" \
    --label "$labels"
}

if [[ "${SKIP_MILESTONES:-}" != "1" ]]; then
  echo "Creating milestones on ${REPO}..."
  M0=$(create_milestone "P0: Extraction quality" "Blocking: measurable extraction quality and schema truth before company production. See ${ROADMAP_URL}")
  M1=$(create_milestone "P1: Operator trust" "Review depth, real audit trail, job control. See ${ROADMAP_URL}")
  M2=$(create_milestone "P2: Production operations" "Observability, backups, releases, capacity. See ${ROADMAP_URL}")
  M3=$(create_milestone "P3: Team self-host" "Company production: Postgres, auth, RBAC, multi-worker. See ${ROADMAP_URL}")
  M4=$(create_milestone "P4: Hosted SaaS (optional)" "Multi-tenant managed product—only if pursued. See ${ROADMAP_URL}")
  echo "Milestones: P0=#${M0} P1=#${M1} P2=#${M2} P3=#${M3} P4=#${M4}"
else
  echo "Skipping milestone creation (SKIP_MILESTONES=1)."
fi

P0="P0: Extraction quality"
P1="P1: Operator trust"
P2="P2: Production operations"
P3="P3: Team self-host"
P4="P4: Hosted SaaS (optional)"

BASE="Roadmap: [docs/PRODUCTION_ROADMAP.md](${ROADMAP_URL})"

echo "Creating P0 issues..."
create_issue "[P0] Add nightly golden-set eval CI job" "${BASE}

Run \`make eval-langextract\` on a schedule (and on provider/Docling dependency bumps). Publish pass/fail + per-case deltas as CI artifacts.

**Acceptance:** Main branch shows eval status; failing cases block release tags." "$P0" "enhancement,production-readiness"
create_issue "[P0] Document per-schema quality SLOs" "${BASE}

Define how teams set accuracy targets per template version using \`evals/langextract\` and DuckDB benchmarks.

**Acceptance:** Doc + example SLO for general and lease samples." "$P0" "documentation,production-readiness"
create_issue "[P0] First-run onboarding off mock provider" "${BASE}

Wizard: probe Ollama/LangExtract → run sample doc → only then allow production uploads.

**Acceptance:** Clean install reaches one real extraction in &lt;30 min following docs." "$P0" "enhancement,production-readiness"
create_issue "[P0] Warn when mock provider is active in production" "${BASE}

Settings + extraction workspace banner when \`provider_type=mock\`.

**Acceptance:** Impossible to mistake mock for production path without dismissing warning." "$P0" "enhancement,production-readiness"
create_issue "[P0] Parser/OCR failure taxonomy and runbook" "${BASE}

Classify Docling/OCR failures; link to operator runbook (scan quality, OCR toggle, re-upload).

**Acceptance:** Top 5 failure strings mapped to remediation steps in docs." "$P0" "documentation,production-readiness"
create_issue "[P0] Persist parsed text for debug and citation review" "${BASE}

Wire \`Document.parsed_text_path\` consistently after parse; expose read-only to reviewers.

**Acceptance:** Completed jobs have retrievable parsed text under \`DATA_DIR\`." "$P0" "enhancement,production-readiness"
create_issue "[P0] Schema dry-run in builder" "${BASE}

Paste sample text or use bundled sample; run extract+validate without full job queue.

**Acceptance:** Schema author sees field-level errors before saving version." "$P0" "enhancement,production-readiness"
create_issue "[P0] Schema version diff in UI" "${BASE}

Show added/removed/changed fields and formulas between versions.

**Acceptance:** Operator picks job version with visible diff summary." "$P0" "enhancement,production-readiness"
create_issue "[P0] Block extraction when LangExtract examples incomplete" "${BASE}

Extractions page prevents Run when required-field example coverage fails (API already enforces on save).

**Acceptance:** UI matches API validation; clear message." "$P0" "enhancement,production-readiness"

echo "Creating P1 issues..."
create_issue "[P1] Structured review editors (table, JSON, structured_object)" "${BASE}

Grid/JSON editor with JSON Schema validation—not plain text for complex types.

**Acceptance:** Lease/general schemas reviewable without raw JSON editing." "$P1" "enhancement,production-readiness"
create_issue "[P1] Highlight citations in parsed document text" "${BASE}

Review panel scrolls to \`char_start\`/\`char_end\` in stored parsed text.

**Acceptance:** Reviewer answers \"where did this come from?\" in-app." "$P1" "enhancement,production-readiness"
create_issue "[P1] Audit events API" "${BASE}

\`GET /api/audit/events\` — jobs, review saves, exports, schema publishes, provider changes.

**Acceptance:** Paginated JSON events with tenant scope." "$P1" "enhancement,production-readiness"
create_issue "[P1] Wire Audit page to live audit API" "${BASE}

Remove static \`auditRows\` from App.tsx.

**Acceptance:** Audit page only shows API data; filters by document/job." "$P1" "enhancement,production-readiness"
create_issue "[P1] Export manifest with integrity metadata" "${BASE}

Record SHA-256, timestamp, reviewer, result_id on export; optional download sidecar.

**Acceptance:** Compliance question \"what was exported when?\" answerable from DB/files." "$P1" "enhancement,production-readiness"
create_issue "[P1] Cancel queued extraction jobs" "${BASE}

\`POST /api/jobs/{id}/cancel\` for \`queued\` status only.

**Acceptance:** Worker never processes cancelled jobs." "$P1" "enhancement,production-readiness"
create_issue "[P1] Job list filters and deep links" "${BASE}

Filter needs-review/failed/processing; URL \`?job=&field=\`.

**Acceptance:** Shareable links open correct workspace state." "$P1" "enhancement,production-readiness"
create_issue "[P1] Template policy: block export until review cleared" "${BASE}

Optional template flag to disable export while \`fields_requiring_review\` non-empty.

**Acceptance:** Policy enforced API-side and surfaced in UI." "$P1" "enhancement,production-readiness"

echo "Creating P2 issues..."
create_issue "[P2] Job and worker metrics" "${BASE}

Expose counters: queued/running/failed, stage duration, review backlog (Prometheus/OpenTelemetry or structured log aggregates).

**Acceptance:** Dashboard or doc with example queries." "$P2" "enhancement,production-readiness"
create_issue "[P2] Alerting runbook for operators" "${BASE}

Alerts: worker stale with queued jobs, failure rate, disk &gt;80%.

**Acceptance:** Runbook maps alert → action." "$P2" "documentation,production-readiness"
create_issue "[P2] Backup and restore procedure" "${BASE}

Document backup of uploads, exports, DB; quarterly restore drill.

**Acceptance:** Staging restore tested and logged." "$P2" "documentation,production-readiness"
create_issue "[P2] Formal database migrations (Alembic)" "${BASE}

Replace ad-hoc \`runtime_schema\` ALTERs with versioned migrations before Postgres production.

**Acceptance:** Fresh install + upgrade path tested in CI." "$P2" "enhancement,production-readiness"
create_issue "[P2] Release and upgrade gate documentation" "${BASE}

Require \`make verify-langextract-upgrade\` + rollback steps in release.yml notes.

**Acceptance:** Tagged release checklist in docs." "$P2" "documentation,production-readiness"
create_issue "[P2] Capacity and performance baselines" "${BASE}

Document p50/p95 job latency by doc type; workers per CPU/GPU.

**Acceptance:** Sizing table for company deployments." "$P2" "documentation,production-readiness"

echo "Creating P3 issues..."
create_issue "[P3] PostgreSQL as production database" "${BASE}

Document and test \`DATABASE_URL\` postgres path; docker-compose profile for companies.

**Acceptance:** Full test suite green on Postgres in CI." "$P3" "enhancement,production-readiness"
create_issue "[P3] Multi-worker job claiming" "${BASE}

\`FOR UPDATE SKIP LOCKED\` or external queue; no double execution.

**Acceptance:** 3 workers, 10 concurrent jobs, exactly-once completion." "$P3" "enhancement,production-readiness"
create_issue "[P3] Authentication for team deployments" "${BASE}

OIDC/SAML (or documented alternative); replace anonymous \`local-ui\` reviewer.

**Acceptance:** Unauthenticated API rejected when \`REQUIRE_AUTHENTICATION=true\`." "$P3" "enhancement,production-readiness"
create_issue "[P3] RBAC roles and permissions" "${BASE}

Roles: admin, operator, reviewer, viewer. Gate schema write, run, review, export, settings.

**Acceptance:** Matrix tested; forbidden actions return 403." "$P3" "enhancement,production-readiness"
create_issue "[P3] Organization-scoped templates and settings" "${BASE}

Templates/providers per org; retention policy hooks.

**Acceptance:** Two orgs on one install cannot cross-read documents." "$P3" "enhancement,production-readiness"
create_issue "[P3] Tenant isolation integration tests" "${BASE}

Cover job/document/template/result chain mismatches and header trust modes.

**Acceptance:** CI suite for \`saas_multi_tenant\` + auth enabled." "$P3" "enhancement,production-readiness"
create_issue "[P3] Spreadsheet external processing policy" "${BASE}

Cell-aware Presidio redaction or hard block with clear UI when cloud provider selected.

**Acceptance:** xlsx+external fails closed with actionable error." "$P3" "enhancement,production-readiness"
create_issue "[P3] Modularize frontend API client and pages" "${BASE}

Split App.tsx; typed API module. Enables faster P1/P3 features.

**Acceptance:** New endpoints added in one client module." "$P3" "enhancement,production-readiness"
create_issue "[P3] Company deployment guide" "${BASE}

Single doc: Postgres, auth, workers, backups, TLS reverse proxy, env contract.

**Acceptance:** External team can deploy without reading source." "$P3" "documentation,production-readiness"

echo "Creating P4 issues..."
create_issue "[P4] Multi-tenant row-level isolation audit" "${BASE}

Security review of every query path with \`tenant_id\`.

**Acceptance:** Checklist signed; pen-test items tracked." "$P4" "enhancement,production-readiness"
create_issue "[P4] Object storage for uploads and exports" "${BASE}

S3-compatible backend instead of local volume only.

**Acceptance:** Worker/backend read/write via storage abstraction." "$P4" "enhancement,production-readiness"
create_issue "[P4] Usage metering and admin console" "${BASE}

Per-tenant jobs/pages/tokens; suspend tenant; ops dashboard.

**Acceptance:** Only if pursuing managed SaaS product." "$P4" "enhancement,production-readiness"

echo "Done. View: https://github.com/${REPO}/issues"
