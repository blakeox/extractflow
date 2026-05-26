# Operator alerting runbook

Signals operators can use today without a hosted metrics stack, plus suggested alert thresholds when you add Prometheus or similar later.

## Built-in signals

| Signal          | Source                                                      | What it tells you                                         |
| --------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| Job queue depth | `GET /api/ops/metrics` → `queue_depth`                      | Count of `queued` + `running` jobs for the tenant         |
| Failed jobs     | `GET /api/ops/metrics` → `failed_jobs`                      | Jobs in `failed` status                                   |
| Worker state    | `GET /api/ops/metrics` or `GET /api/settings/parser-status` | `idle`, `running`, `failed`, `starting`, etc.             |
| Active job      | `ops/metrics.worker_active_job_id`                          | Job id from worker status details while running           |
| Audit trail     | `GET /api/audit/events`                                     | Upload, review, export, cancel, worker completion/failure |
| Provider health | `GET /api/settings/providers/health`                        | Whether configured providers are reachable                |
| API liveness    | `GET /api/health`                                           | Backend process responding                                |
| Parser prewarm  | `parser-status.prewarm_status`                              | Docling prewarm completed or errored on startup           |

## Suggested alert thresholds (self-host)

Tune for your team size and hardware; these are starting points for a 5–50 user deployment.

| Condition                                                      | Severity | Action                                                                                                    |
| -------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `queue_depth` ≥ 10 for 15 minutes                              | Warning  | Add worker capacity or reduce upload rate; check worker container logs                                    |
| `failed_jobs` increases by ≥ 3 in 1 hour                       | Warning  | Inspect latest `error_message` on failed jobs; see [PARSER_FAILURE_RUNBOOK.md](PARSER_FAILURE_RUNBOOK.md) |
| `worker_state` = `failed` for 5 minutes                        | Critical | Restart worker; verify `WORKER_STATUS_PATH` and Docling/Ollama runtime                                    |
| `worker_state` = `idle` while `queue_depth` > 0 for 10 minutes | Critical | Worker not claiming jobs — check DB URL, worker logs, poll interval                                       |
| Provider health `ready: false` for default provider            | Warning  | Run provider probe in Settings; fix API key or local Ollama                                               |
| `/api/health` non-200                                          | Critical | Restart backend; check disk space under `DATA_DIR`                                                        |

## Wiring external monitoring

1. Poll `GET /api/ops/metrics` every 60s from your observability agent (no auth in local mode; add auth before exposing publicly).
2. Export the same JSON to logs if you prefer log-based alerts.
3. Correlate spikes with `GET /api/audit/events?action=job.failed` and job `error_message` in the UI.

## Related docs

- [CAPACITY_BASELINES.md](CAPACITY_BASELINES.md) — rough throughput expectations
- [BACKUP_RESTORE.md](BACKUP_RESTORE.md) — data volume recovery
- [PARSER_FAILURE_RUNBOOK.md](PARSER_FAILURE_RUNBOOK.md) — parse/OCR failures
