# Contributing to ExtractFlow

Thanks for contributing. Keep changes narrow, testable, and attributable to a clear runtime boundary.

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
