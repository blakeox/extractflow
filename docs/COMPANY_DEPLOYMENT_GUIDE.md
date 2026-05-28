# Company deployment guide

This guide is for self-hosted team deployments (single company, multiple internal users).

The target operating model is:

- PostgreSQL-backed metadata store
- one backend API service
- two or more workers
- reverse proxy with TLS termination
- persistent shared storage for `/data`
- documented backup and restore procedure

## 1) Required components

| Component                | Purpose                                                       | Minimum recommendation                    |
| ------------------------ | ------------------------------------------------------------- | ----------------------------------------- |
| PostgreSQL               | Source of truth for templates, jobs, results, audit, settings | Managed Postgres 14+ with daily snapshots |
| Backend (`backend`)      | API + control plane                                           | 1 replica, 1 vCPU / 1 GB RAM              |
| Worker (`worker`)        | Async parsing/extraction pipeline                             | 2+ replicas, 1 vCPU / 2 GB RAM each       |
| Shared storage (`/data`) | Uploads, parsed text, exports, worker heartbeat               | Durable volume or network filesystem      |
| Reverse proxy            | TLS + upstream routing                                        | Nginx, Caddy, Traefik, or cloud LB        |

## 2) Environment contract

Set the same `DATABASE_URL` and `DATA_DIR` family values for backend and workers.

### Shared core

| Variable             | Example                                                        | Notes                                                               |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`       | `postgresql+psycopg://extractflow:***@db.internal/extractflow` | Required for production; do not use SQLite                          |
| `DATA_DIR`           | `/data`                                                        | Must be persistent and mounted in backend + workers                 |
| `UPLOADS_DIR`        | `/data/uploads`                                                | Must stay under `DATA_DIR`                                          |
| `PARSED_DIR`         | `/data/parsed`                                                 | Must stay under `DATA_DIR`                                          |
| `EXPORTS_DIR`        | `/data/exports`                                                | Must stay under `DATA_DIR`                                          |
| `WORKER_STATUS_PATH` | `/data/worker-status.json`                                     | Must stay under `DATA_DIR`                                          |
| `DEPLOYMENT_MODE`    | `hosted_single_tenant`                                         | Use `saas_multi_tenant` only if auth + tenant controls are complete |

### Security and tenancy defaults

| Variable                 | Recommended                                       |
| ------------------------ | ------------------------------------------------- |
| `REQUIRE_AUTHENTICATION` | `true`                                            |
| `CURRENT_TENANT_ID`      | explicit org value (not a random default)         |
| `TRUST_TENANT_HEADER`    | `false` unless fronted by trusted auth middleware |

## 3) PostgreSQL compose profile

For a local company-style stack with Postgres:

```bash
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up --build
```

See [POSTGRES_PRODUCTION.md](POSTGRES_PRODUCTION.md) for DSN details and CI coverage.

## 4) Database migration flow

Before each release rollout:

1. Back up current state ([BACKUP_RESTORE.md](BACKUP_RESTORE.md)).
2. Apply schema migrations:

```bash
./scripts/db-migrate.sh
```

For existing pre-Alembic databases, stamp once first:

```bash
cd backend
export PYTHONPATH="../backend:../shared"
alembic stamp head
```

See [DATABASE_MIGRATIONS.md](DATABASE_MIGRATIONS.md) for details.

## 5) Service topology

Recommended minimum:

- backend replicas: `1`
- worker replicas: `2` (scale horizontally for throughput)

Workers now use PostgreSQL queue claims with `FOR UPDATE SKIP LOCKED`, which allows multiple workers to claim queued jobs without double-executing the same row.

## 6) Auth and access model

When `REQUIRE_AUTHENTICATION=true`, configure bearer tokens:

```bash
AUTH_BEARER_TOKENS_JSON='{"ops-token":{"actor":"ops-user","role":"operator"},"admin-token":{"actor":"admin","role":"admin"}}'
```

Roles: `admin`, `operator`, `reviewer`, `viewer`. Unauthenticated API calls receive `401`; forbidden actions receive `403`.

For OIDC/SAML, terminate auth at your reverse proxy and forward `Authorization: Bearer …` to the API (issue tokens out-of-band or via your IdP bridge).

Multi-tenant SaaS mode (`DEPLOYMENT_MODE=saas_multi_tenant`) additionally requires trusted `X-Tenant-ID` headers — see [TENANT_ISOLATION_AUDIT.md](TENANT_ISOLATION_AUDIT.md).

Minimum recommendation:

- restrict network access to trusted internal users
- require TLS and authenticated ingress at proxy/LB layer
- avoid public internet exposure without additional access controls

## 7) Reverse proxy and TLS

Terminate TLS at your reverse proxy or load balancer and forward to backend service.

Proxy requirements:

- HTTPS only (`TLS 1.2+`)
- request size limits compatible with your document sizes
- upstream timeout suitable for upload + job submit latency
- preserve `X-Request-ID` if your platform injects one

## 8) Backups and restore drills

- Use the backup process in [BACKUP_RESTORE.md](BACKUP_RESTORE.md).
- Run a restore drill at least quarterly.
- Validate post-restore with:
  - `GET /healthz`
  - `GET /readyz`
  - `GET /api/ops/metrics`
  - successful download of a known export artifact

## 9) Release and rollback

Use the documented release workflow:

- [RELEASE_UPGRADE.md](RELEASE_UPGRADE.md)
- [CI_AND_ACTIONS.md](CI_AND_ACTIONS.md)

Operational sequence:

1. Verify release candidate on `dev`.
2. Promote `dev` -> `master`.
3. Apply migrations.
4. Deploy backend, then workers.
5. Validate health/readiness/metrics.
6. Sync `master` -> `dev`.

If rollback is needed, follow forward-fix or revert on `master`, then resync `dev`.

## 10) Day-2 operations checklist

- [ ] Alerting configured from [OPERATOR_ALERTING.md](OPERATOR_ALERTING.md)
- [ ] Capacity baselines tracked from [CAPACITY_BASELINES.md](CAPACITY_BASELINES.md)
- [ ] Backup + restore drill completed
- [ ] At least 2 worker replicas running
- [ ] Release/sync scripts tested in your environment
