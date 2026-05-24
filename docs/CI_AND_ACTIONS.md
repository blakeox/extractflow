# GitHub Actions and CI

## Repository visibility

`extractflow` is a **public** repository. GitHub-hosted runners are free for public repos, and CodeQL plus dependency review run without Advanced Security on private.

If the repo is ever switched back to private, Actions consume account minutes and some security features may require Advanced Security. See [GitHub billing for Actions](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions).

## What runs in CI

| Workflow            | When                                                                  | Purpose                                                                                                                    |
| ------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `CI` (`test.yml`)   | PR + push to `main` / `dev` / `master` (non-doc paths)                | Tests, secret scan, dependency audits, E2E                                                                                 |
| `Secret Scan`       | Same branches as CI (standalone job for branch protection check name) | `scripts/scan-secrets.py`                                                                                                  |
| `CodeQL`            | PR + push to `main` / `dev` / `master`; weekly schedule               | Static analysis (JS/TS + Python)                                                                                           |
| `Dependency Review` | Pull requests only                                                    | Block vulnerable dependency changes                                                                                        |
| `LangExtract Eval`  | Path-filtered; nightly Ollama eval on public repos only               | Golden-set validate; nightly smoke gate (`receipt-basic`, `statement-basic` on `qwen2.5:3b`) plus informational full suite |
| `Release Gate`      | Version tags / manual                                                 | Release verification                                                                                                       |

Expensive jobs are path-filtered or gated so doc-only changes and private-repo nightlies do not burn minutes unnecessarily.

## Security scans (local parity)

Run the same checks CI uses before pushing:

```bash
npm run verify:secrets          # tracked files
npm run verify:dependencies     # npm audit + pip-audit
npm run verify:pre-push         # full gate (includes both)
```

Lefthook runs `verify-pre-commit` on commit; `verify-pre-push` mirrors the heavier pre-push gate.

`pip-audit` is installed via `requirements-dev.txt`. `npm audit` uses the frontend lockfile.

## Optional: reduce Actions further

- Require E2E only on `master` (edit `e2e` job `if:` in `test.yml`).
- Run CodeQL only on schedule + `master` / `dev` (already limited on push).
- Disable scheduled LangExtract nightly if you rely on manual `workflow_dispatch` eval runs.

Nightly live eval uses `qwen2.5:3b` for CI cost/latency. The **smoke** cases must pass; the **full** golden set (invoice/lease included) runs afterward with `continue-on-error` because small models often miss SLOs authored for larger local models (`qwen3.5:27b` in fixtures). Inspect `langextract-eval-summary` artifacts when the full run fails.
