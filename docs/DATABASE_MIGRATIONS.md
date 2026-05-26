# Database migrations (Alembic)

ExtractFlow uses [Alembic](https://alembic.sqlalchemy.org/) for versioned schema changes. SQLAlchemy models in `backend/app/models/` remain the source of truth; new revisions should reflect model updates (autogenerate or hand-written).

## Layout

| Path                        | Purpose                                       |
| --------------------------- | --------------------------------------------- |
| `backend/alembic.ini`       | Alembic config (run commands from `backend/`) |
| `backend/alembic/env.py`    | Engine URL from `DATABASE_URL` / app settings |
| `backend/alembic/versions/` | Revision scripts                              |
| `scripts/db-migrate.sh`     | Apply all pending revisions (`upgrade head`)  |

## Fresh database

```bash
export DATABASE_URL="sqlite:////data/extractflow.db"   # or your Postgres URL
./scripts/db-migrate.sh
```

Revision `0001_baseline` creates all tables from `Base.metadata`.

## Existing SQLite database (pre-Alembic)

If the DB was created by `Base.metadata.create_all` at backend startup and already has the current tables, **stamp** instead of running `upgrade` (which would fail on existing objects):

```bash
cd backend
export PYTHONPATH="../backend:../shared"
export DATABASE_URL="sqlite:////data/extractflow.db"
alembic stamp head
```

After stamping, use `alembic upgrade head` only for **new** revisions.

## New revisions

From `backend/` with `PYTHONPATH` set as in `db-migrate.sh`:

```bash
alembic revision --autogenerate -m "describe change"
# Review the generated script, then:
alembic upgrade head
```

Commit the new file under `backend/alembic/versions/`.

## Startup behavior (transition)

The backend still calls `create_all` and `ensure_extraction_job_runtime_columns` on startup so local dev and tests work without a separate migrate step. Production cutovers should prefer explicit migrations via `scripts/db-migrate.sh` before rolling out a release that depends on new columns.

## Postgres cutover

When moving to Postgres ([#81](https://github.com/blakeox/extractflow/issues/81)):

1. Set `DATABASE_URL` to the Postgres DSN.
2. Run `./scripts/db-migrate.sh` on an empty database, or restore from backup then `alembic upgrade head` if revisions were added after restore.
3. Retire reliance on runtime `ALTER TABLE` helpers once all environments are stamped and migrated.

See [BACKUP_RESTORE.md](BACKUP_RESTORE.md) before destructive changes.
