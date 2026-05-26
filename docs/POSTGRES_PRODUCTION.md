# PostgreSQL production database

ExtractFlow supports PostgreSQL as the production metadata store. SQLite remains the default for local development.

## Docker Compose (company profile)

Run with the Postgres overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up --build
```

This starts:

- `db` — PostgreSQL 16 (`extractflow` / `extractflow` / database `extractflow`)
- `backend` and `worker` — `DATABASE_URL=postgresql+psycopg://extractflow:extractflow@db:5432/extractflow`

Apply schema before first use (or after upgrades):

```bash
export DATABASE_URL="postgresql+psycopg://extractflow:extractflow@localhost:5432/extractflow"
./scripts/db-migrate.sh
```

## Environment contract

| Variable       | Example                                                |
| -------------- | ------------------------------------------------------ |
| `DATABASE_URL` | `postgresql+psycopg://user:pass@host:5432/extractflow` |

Backend and worker must share the same DSN. Use `postgresql+psycopg://` so SQLAlchemy uses the installed `psycopg` driver.

## Migrations

See [DATABASE_MIGRATIONS.md](DATABASE_MIGRATIONS.md). For greenfield Postgres databases, run `./scripts/db-migrate.sh` once before starting workers.

## Multi-worker claims

With PostgreSQL, workers claim queued jobs using `FOR UPDATE SKIP LOCKED` (see `worker/app/main.py`). Run at least two worker replicas for throughput.

## CI verification

The `Python Tests (PostgreSQL)` job in `.github/workflows/test.yml` runs the full Python test suites against a Postgres service container on every PR and push to `dev` / `master`.

## Backups

Use `pg_dump` / point-in-time recovery for the database, plus file backups for uploads and exports under `DATA_DIR` ([BACKUP_RESTORE.md](BACKUP_RESTORE.md)).
