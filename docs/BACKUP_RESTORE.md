# Backup and restore procedure

ExtractFlow stores durable state under `DATA_DIR` (default `/data` in Docker). Back up the whole directory before upgrades, OS migrations, or destructive schema experiments. After restore, run [DATABASE_MIGRATIONS.md](DATABASE_MIGRATIONS.md) if the release added Alembic revisions.

## What to back up

| Path (under `DATA_DIR`)          | Contents                                         |
| -------------------------------- | ------------------------------------------------ |
| `app.db` (or configured DB file) | Templates, jobs, results, audit events, settings |
| `uploads/`                       | Original uploaded files                          |
| `parsed/`                        | Parsed text used for review citations            |
| `exports/`                       | Generated export files                           |
| `worker-status.json`             | Last worker heartbeat (optional but useful)      |

## Quick backup (tarball)

From the repo root with local data in `./data`:

```bash
DATA_DIR=./data ./scripts/backup-data.sh
```

The script writes `extractflow-data-backup-YYYYMMDD-HHMMSS.tar.gz` in the current directory.

For Docker Compose, copy from the volume instead:

```bash
docker compose exec backend tar -czf - -C /data . > extractflow-data-backup.tar.gz
```

## Restore drill (quarterly recommended)

1. Stop backend and worker (`docker compose down` or desktop stop).
2. Move the current data directory aside: `mv data data.bak.$(date +%s)`.
3. Extract the archive into a fresh `data/` directory (or mount restored volume at `/data`).
4. Start services and verify:
   - `GET /api/health` returns `ok`
   - `GET /api/ops/metrics` shows expected job/document counts
   - `GET /api/settings/parser-status` reaches `idle` or `running` after worker start
5. Open the workspace and confirm a known document can still download an existing export (if applicable).

## After a failed application upgrade

See [RELEASE_UPGRADE.md](RELEASE_UPGRADE.md). If the new version fails at startup, restore the pre-upgrade tarball before retrying the release.

## Postgres (future)

When migrating to PostgreSQL (P2/P3), switch to database-native backup (pg_dump / PITR) in addition to file storage for uploads and exports. Until then, SQLite and `/data` paths are captured by the tarball above.
