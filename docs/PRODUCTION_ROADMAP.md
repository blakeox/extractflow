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
- Per-schema quality SLOs and benchmark reporting — see [QUALITY_SLOS.md](QUALITY_SLOS.md)
- Onboarding off `mock`; production warning when mock is active
- Parser/OCR failure taxonomy + operator runbook — see [PARSER_FAILURE_RUNBOOK.md](PARSER_FAILURE_RUNBOOK.md)
- Parsed text available for debug and citation review
- Schema dry-run, version diff, LangExtract readiness gates

**Gate:** Golden-set stable; new installs complete a real extraction in &lt;30 minutes.

**Status:** P0 issues [#58](https://github.com/blakeox/extractflow/issues/58)–[#65](https://github.com/blakeox/extractflow/issues/65) closed on `master` (docs, dry-run, diff, parsed text, LangExtract gates, mock warning).

### P1 — Operator trust

Humans can defend exports; audit is real—not mock UI.

Implementation plan: [P1_OPERATOR_TRUST_PLAN.md](P1_OPERATOR_TRUST_PLAN.md) (**completed** on `master` via [#109](https://github.com/blakeox/extractflow/pull/109)).

- Structured review for `table`, `json_object`, `structured_object`
- Citation highlight in parsed document text
- Audit API + live Audit page (`ReviewEdit`, jobs, exports)
- Export manifest (hash, timestamp, reviewer)
- Job cancel, filters, deep links (extend retry/progress work)
- Optional policy: block export while review backlog exists

**Gate:** Playbook: PDF → review → export → audit chain visible end-to-end.

**Status:** P1 issues [#66](https://github.com/blakeox/extractflow/issues/66)–[#73](https://github.com/blakeox/extractflow/issues/73) closed on `master` ([#109](https://github.com/blakeox/extractflow/pull/109)).

### P2 — Production operations

Run like a service: observe, backup, release safely.

- Metrics and alerts — `GET /api/ops/metrics`; [OPERATOR_ALERTING.md](OPERATOR_ALERTING.md)
- Backup/restore — [BACKUP_RESTORE.md](BACKUP_RESTORE.md), `scripts/backup-data.sh`
- Formal DB migrations (Alembic) — [DATABASE_MIGRATIONS.md](DATABASE_MIGRATIONS.md), `scripts/db-migrate.sh` ([#77](https://github.com/blakeox/extractflow/issues/77) baseline landed; Postgres cutover tracked in [#81](https://github.com/blakeox/extractflow/issues/81))
- Release gate — [RELEASE_UPGRADE.md](RELEASE_UPGRADE.md)
- Capacity — [CAPACITY_BASELINES.md](CAPACITY_BASELINES.md)

**Gate:** 72-hour soak; quarterly restore drill passes.

**Status:** P2 ops docs, metrics API, Alembic baseline, Postgres compose/CI, and multi-worker claiming landed on `master` ([#121](https://github.com/blakeox/extractflow/pull/121); issues [#74](https://github.com/blakeox/extractflow/issues/74)–[#81](https://github.com/blakeox/extractflow/issues/81), [#88](https://github.com/blakeox/extractflow/issues/88)).

### P3 — Team self-host (company production)

What most companies need from the open-source edition.

- PostgreSQL as recommended production database — [POSTGRES_PRODUCTION.md](POSTGRES_PRODUCTION.md), `docker-compose.postgres.yml`, CI `python-postgres` job ([#80](https://github.com/blakeox/extractflow/issues/80))
- Job queue: `FOR UPDATE SKIP LOCKED` or Redis/SQS ([#81](https://github.com/blakeox/extractflow/issues/81))
- Multiple workers, no double-processing ([#81](https://github.com/blakeox/extractflow/issues/81))
- Authentication — bearer tokens via `AUTH_BEARER_TOKENS_JSON` when `REQUIRE_AUTHENTICATION=true` ([#82](https://github.com/blakeox/extractflow/issues/82))
- RBAC: admin, operator, reviewer, viewer ([#83](https://github.com/blakeox/extractflow/issues/83))
- Org-scoped templates, providers, settings via `tenant_id` ([#84](https://github.com/blakeox/extractflow/issues/84))
- Tenant isolation integration tests ([#85](https://github.com/blakeox/extractflow/issues/85))
- Spreadsheet + external LLM redaction policy (fail closed) ([#86](https://github.com/blakeox/extractflow/issues/86))
- Frontend API client module — `frontend/src/lib/api.ts` ([#87](https://github.com/blakeox/extractflow/issues/87))
- Company deployment guide — [COMPANY_DEPLOYMENT_GUIDE.md](COMPANY_DEPLOYMENT_GUIDE.md) ([#88](https://github.com/blakeox/extractflow/issues/88))

**Gate:** 30-day pilot; internal 99% job completion SLA (excluding provider outages).

**Status:** P3 team self-host items [#82](https://github.com/blakeox/extractflow/issues/82)–[#88](https://github.com/blakeox/extractflow/issues/88) closed on `dev`. OIDC/SAML reverse-proxy integration remains an operator concern documented in [COMPANY_DEPLOYMENT_GUIDE.md](COMPANY_DEPLOYMENT_GUIDE.md).

### P4 — Hosted SaaS (optional)

Only if the project pursues a managed product: multi-tenant hardening, object storage, metering, admin console. See [P4_HOSTED_SAAS.md](P4_HOSTED_SAAS.md) — issues [#89](https://github.com/blakeox/extractflow/issues/89)–[#91](https://github.com/blakeox/extractflow/issues/91) remain open until SaaS is pursued.

## Minimum company production checklist

- [ ] Real default provider in prod (not `mock`) — mock warning shipped; default still bootstrap-friendly
- [ ] Golden-set eval green on release tag
- [x] Review supports all field types in shipped schemas (P1)
- [x] Audit API + UI backed by database events (P1)
- [ ] Postgres + 2+ workers + cancel/retry documented — Postgres/multi-worker on `master`; see [POSTGRES_PRODUCTION.md](POSTGRES_PRODUCTION.md)
- [x] Auth + RBAC + tenant isolation tested — bearer auth, RBAC middleware, `tests/backend/test_tenant_isolation.py`
- [ ] Backups + restore tested
- [ ] Metrics/alerts for failures and queue depth
- [x] Runbooks: weak PDF ([PARSER_FAILURE_RUNBOOK.md](PARSER_FAILURE_RUNBOOK.md)); provider/disk/upgrade rollback still P2

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

Completed: P0 [#57](https://github.com/blakeox/extractflow/issues/57)–[#65](https://github.com/blakeox/extractflow/issues/65), P1 [#66](https://github.com/blakeox/extractflow/issues/66)–[#73](https://github.com/blakeox/extractflow/issues/73), P2 [#74](https://github.com/blakeox/extractflow/issues/74)–[#81](https://github.com/blakeox/extractflow/issues/81), P3 [#82](https://github.com/blakeox/extractflow/issues/82)–[#88](https://github.com/blakeox/extractflow/issues/88).

| Issue                                                   | Title                                                                                                     |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [#89](https://github.com/blakeox/extractflow/issues/89) | Multi-tenant isolation audit checklist (P4 prep) — [TENANT_ISOLATION_AUDIT.md](TENANT_ISOLATION_AUDIT.md) |
| [#90](https://github.com/blakeox/extractflow/issues/90) | Object storage (P4, optional) — [P4_HOSTED_SAAS.md](P4_HOSTED_SAAS.md)                                    |
| [#91](https://github.com/blakeox/extractflow/issues/91) | Usage metering + admin console (P4, optional)                                                             |

Contributions: pick an unassigned issue in the earliest open milestone you can help close; comment before large PRs per [CONTRIBUTING.md](../CONTRIBUTING.md).
