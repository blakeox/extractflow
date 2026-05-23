# Production readiness roadmap (company / self-host)

ExtractFlow is open source for **teams and companies** running their own deployment—not only for local demos. This roadmap defines what “production ready” means and how we sequence work.

**Target deployment:** team self-host (5–50 users, one org, your infrastructure). Hosted multi-tenant SaaS is optional and listed last.

## Production definition

| Dimension  | Bar                                                              |
| ---------- | ---------------------------------------------------------------- |
| Extraction | Golden-set accuracy gates; regressions caught in CI              |
| Trust      | Auditable review + exports; recoverable failures                 |
| Ops        | Metrics, backups, upgrade/rollback runbooks                      |
| Security   | Auth, RBAC, tenant isolation, external-processing policy         |
| Scale      | Postgres + multiple workers without job corruption               |
| UX         | Operators complete upload → review → export without reading logs |

## Architecture constraint (do not break)

Keep the durable contract:

`Schema version → Job queue → Worker → ExtractionValidationSummary → Review → Export`

Swap SQLite, polling, and auth—but not the result envelope or formula/review semantics.

## Phases

### P0 — Extraction quality & schema truth (blocking)

Real providers and measurable quality before calling deployments “production.”

- Golden-set eval in CI (nightly + provider/Docling bumps)
- Per-schema quality SLOs and benchmark reporting
- Onboarding off `mock`; production warning when mock is active
- Parser/OCR failure taxonomy + operator runbook
- Parsed text available for debug and citation review
- Schema dry-run, version diff, LangExtract readiness gates

**Gate:** Golden-set stable; new installs complete a real extraction in &lt;30 minutes.

### P1 — Operator trust

Humans can defend exports; audit is real—not mock UI.

- Structured review for `table`, `json_object`, `structured_object`
- Citation highlight in parsed document text
- Audit API + live Audit page (`ReviewEdit`, jobs, exports)
- Export manifest (hash, timestamp, reviewer)
- Job cancel, filters, deep links (extend retry/progress work)
- Optional policy: block export while review backlog exists

**Gate:** Playbook: PDF → review → export → audit chain visible end-to-end.

### P2 — Production operations

Run like a service: observe, backup, release safely.

- Metrics and alerts (queue depth, failures, stage latency)
- Backup/restore for `/data` (or object storage path) with drill
- Formal DB migrations (Alembic) before/at Postgres cutover
- Release gate: `verify-langextract-upgrade` + rollback checklist
- Capacity doc (jobs/hour per hardware profile)

**Gate:** 72-hour soak; quarterly restore drill passes.

### P3 — Team self-host (company production)

What most companies need from the open-source edition.

- PostgreSQL as recommended production database
- Job queue: `FOR UPDATE SKIP LOCKED` or Redis/SQS
- Multiple workers, no double-processing
- Authentication (OIDC/SAML recommended)
- RBAC: admin, operator, reviewer, viewer
- Org-scoped templates, providers, retention
- Tenant isolation integration tests
- Spreadsheet + external LLM: redaction or hard block
- Frontend modularization (API client, split workspace pages)

**Gate:** 30-day pilot; internal 99% job completion SLA (excluding provider outages).

### P4 — Hosted SaaS (optional)

Only if the project pursues a managed product: multi-tenant hardening, object storage, metering, admin console.

## Minimum company production checklist

- [ ] Real default provider in prod (not `mock`)
- [ ] Golden-set eval green on release tag
- [ ] Review supports all field types in shipped schemas
- [ ] Audit API + UI backed by database events
- [ ] Postgres + 2+ workers + cancel/retry documented
- [ ] Auth + RBAC + tenant isolation tested
- [ ] Backups + restore tested
- [ ] Metrics/alerts for failures and queue depth
- [ ] Runbooks: weak PDF, provider down, disk, upgrade rollback

## KPIs

| KPI                                  | Team target |
| ------------------------------------ | ----------- |
| Required-field accuracy (golden set) | ≥ 95%       |
| Job failure rate (excl. cancel)      | &lt; 2%     |
| Time to first export (new install)   | &lt; 30 min |
| Mean time to recover failed job      | &lt; 1 min  |

## Tracking

Work is organized in GitHub milestones **P0–P4**:

| Milestone                 | GitHub                                                             |
| ------------------------- | ------------------------------------------------------------------ |
| P0 Extraction quality     | [Milestone #1](https://github.com/blakeox/extractflow/milestone/1) |
| P1 Operator trust         | [Milestone #2](https://github.com/blakeox/extractflow/milestone/2) |
| P2 Production operations  | [Milestone #3](https://github.com/blakeox/extractflow/milestone/3) |
| P3 Team self-host         | [Milestone #4](https://github.com/blakeox/extractflow/milestone/4) |
| P4 Hosted SaaS (optional) | [Milestone #5](https://github.com/blakeox/extractflow/milestone/5) |

- [All production-readiness issues](https://github.com/blakeox/extractflow/issues?q=label%3Aproduction-readiness)
- [Good first issues](https://github.com/blakeox/extractflow/issues?q=label%3Aproduction-readiness+label%3A%22good+first+issue%22)

### GitHub Project board

To track status (Todo / In progress / Done) across milestones:

```bash
gh auth refresh -s project,read:project
./scripts/setup-github-project.sh
```

Or create a project manually at [github.com/blakeox?tab=projects](https://github.com/blakeox?tab=projects), add issues `#57`–`#91`, and group by **Milestone**.

## Good first issues (starter tasks)

| Issue                                                   | Title                                          |
| ------------------------------------------------------- | ---------------------------------------------- |
| [#60](https://github.com/blakeox/extractflow/issues/60) | Warn when mock provider is active              |
| [#65](https://github.com/blakeox/extractflow/issues/65) | Block run when LangExtract examples incomplete |
| [#71](https://github.com/blakeox/extractflow/issues/71) | Cancel queued extraction jobs                  |
| [#73](https://github.com/blakeox/extractflow/issues/73) | Job list filters and deep links                |
| [#75](https://github.com/blakeox/extractflow/issues/75) | Alerting runbook                               |
| [#78](https://github.com/blakeox/extractflow/issues/78) | Release and upgrade gate documentation         |
| [#79](https://github.com/blakeox/extractflow/issues/79) | Capacity and performance baselines             |
| [#88](https://github.com/blakeox/extractflow/issues/88) | Company deployment guide                       |

Contributions: pick an unassigned issue in the earliest open milestone you can help close; comment before large PRs per [CONTRIBUTING.md](../CONTRIBUTING.md).
