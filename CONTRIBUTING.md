# Contributing to ExtractFlow

Thanks for contributing. Keep changes narrow, testable, and attributable to a clear runtime boundary.

## Company production roadmap

ExtractFlow is open source for **companies self-hosting** the stack. Planned work is tracked in [docs/PRODUCTION_ROADMAP.md](docs/PRODUCTION_ROADMAP.md) (milestones **P0–P4**, issues labeled `production-readiness`).

- Start with [good first issues](https://github.com/blakeox/extractflow/issues?q=label%3Aproduction-readiness+label%3A%22good+first+issue%22) if you are new to the repo.
- Do not skip **P0** (extraction quality) before claiming production deployment work.
- Regenerate issues after editing the roadmap script: `SKIP_MILESTONES=1 ./scripts/create-production-roadmap-issues.sh` (avoid duplicates).

## Branch workflow (`dev` → `master`)

Day-to-day work happens on **`dev`**. **`master`** is the release branch (what you ship / tag).

| Branch   | Role                                                              |
| -------- | ----------------------------------------------------------------- |
| `dev`    | Integration: features, fixes, dependency batches, docs            |
| `master` | Release line: merge from `dev` when you want a shippable snapshot |

### Daily work

```bash
git checkout dev
git pull origin dev
# edit, then:
npm run verify:pre-commit   # or verify:pre-push before push
git add … && git commit -m "…"
git push origin dev
```

Use a short-lived feature branch off `dev` if you prefer review before landing on `dev`:

```bash
git checkout -b feat/my-change dev
# … commit …
git push -u origin feat/my-change
gh pr create --base dev --head feat/my-change
```

Repository rules on `dev` require **linear history** (no merge commits on push). Rebase feature branches onto `dev` before merging.

### Promote `dev` to `master`

After `dev` is green locally and on CI:

```bash
./scripts/release-dev-to-master.sh
```

Review the GitHub PR into `master`, wait for required checks, then **squash merge**.

Then align `dev` with the release tip:

```bash
./scripts/sync-master-to-dev.sh
```

Merge that follow-up PR so both branches stay in sync.

### Tags and releases

Create version tags from **`master`** after the release PR merges (for example `v0.2.0`).

## Ground rules

- Open an issue or draft pull request before large feature work.
- Keep changes scoped to one concern when possible: `frontend`, `backend`, `worker`, `shared`, or desktop packaging.
- Do not commit secrets, local datasets, generated runtime state, or proprietary documents.
- Preserve the local-first and backend-owned control model unless a change explicitly revisits that architecture.

## Development setup

1. Start from the repo root.
2. Install dependencies:

```bash
PYTHON_BIN="$(./scripts/resolve-python.sh)"
"$PYTHON_BIN" -m pip install -r requirements-dev.txt
npm install
npm --prefix frontend install
```

3. Start the local stack:

```bash
make dev-up
```

4. Open `http://localhost:3000`.

## GitHub Actions

CI is defined under `.github/workflows/`. The repository must be **public** for standard open source Actions pricing (unlimited minutes on GitHub-hosted runners). While the repo is private, workflows can fail with **no steps run** when the account is out of Actions minutes.

See [docs/CI_AND_ACTIONS.md](docs/CI_AND_ACTIONS.md) for visibility, cost profile, and troubleshooting.

## Verification

Run the narrowest truthful slice for your change before opening a pull request.

- Full repo checks:

```bash
npm run verify:pre-commit
npm run verify:pre-push
```

- Common focused slices:

```bash
make test-python
make test-ui
make test-e2e
make eval-langextract
PYTHON_BIN="$(./scripts/resolve-python.sh)" && "$PYTHON_BIN" -m ruff check backend worker shared tests
npm --prefix frontend run lint
npm run format:check
```

## Pull requests

- Explain the decision, not just the code diff.
- Call out systems touched, data-flow changes, and any new operational burden.
- Include validation notes with exact commands run.
- Flag hard-to-reverse changes explicitly: storage contracts, tenancy behavior, auth boundaries, provider behavior, export formats, and desktop packaging.

## Security

Do not file public issues for vulnerabilities. Follow [SECURITY.md](SECURITY.md) and use GitHub Security Advisories for private reporting.
