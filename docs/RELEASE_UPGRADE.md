# Release and upgrade gates

How to promote `dev` to `master` and validate dependency upgrades before production cutovers.

## Application release (`dev` → `master`)

1. Ensure CI is green on `dev` (`./scripts/verify-pre-push.sh` locally).
2. Run `./scripts/release-dev-to-master.sh` (opens a PR; uses a release branch when histories diverged).
3. Squash-merge the release PR into `master`.
4. Run `./scripts/sync-master-to-dev.sh` and squash-merge the sync PR so `dev` and `master` share the same tree.

See [CI_AND_ACTIONS.md](CI_AND_ACTIONS.md) for required vs nightly workflows.

## LangExtract / provider upgrade gate

Before bumping LangExtract, Docling, or default local model pins:

```bash
make verify-langextract-upgrade
```

That runs Python verification plus the committed golden-set harness (`evals/langextract/`). Nightly CI runs smoke cases on every PR; the full golden set is informational on smaller models (see [QUALITY_SLOS.md](QUALITY_SLOS.md)).

## Rollback

- **Application:** revert or forward-fix on `master`, then sync `dev` with `./scripts/sync-master-to-dev.sh`.
- **Data:** Back up with [BACKUP_RESTORE.md](BACKUP_RESTORE.md). Apply schema changes with [DATABASE_MIGRATIONS.md](DATABASE_MIGRATIONS.md) (`./scripts/db-migrate.sh` or `alembic stamp head` for existing DBs).

## Pre-release checklist

- [ ] `./scripts/verify-pre-push.sh` green
- [ ] Playwright E2E green (CI `Browser E2E`)
- [ ] LangExtract smoke eval green (or full eval reviewed if changing extraction stack)
- [ ] Release PR + sync PR merged; `dev` and `master` trees match
