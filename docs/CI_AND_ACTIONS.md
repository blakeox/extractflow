# GitHub Actions and open source CI

## Why CI was failing with zero steps

`extractflow` is currently a **private** repository. On private repos, GitHub Actions uses your account or organization **minutes quota** (typically 2,000 minutes/month on Free). When quota is exhausted or a spending limit blocks usage, jobs are **queued and then fail immediately** with **no runner assigned** and **0 workflow steps** executed.

That failure mode looks like a broken workflow but is usually **billing / visibility**, not a bad `test.yml`.

## Open source fix: make the repository public

For a **public** open source project, standard GitHub-hosted runners (`ubuntu-latest`, etc.) are **free and unlimited** for public repositories. You should not hit the same private-repo minutes wall for normal CI.

To switch visibility (repo owner only):

```bash
gh repo edit blakeox/extractflow --visibility public
```

Or: **GitHub → Settings → General → Danger zone → Change repository visibility → Public**.

After going public:

1. Re-run the latest failed workflows on `dev` (**Actions → workflow → Re-run all jobs**).
2. Confirm jobs show a runner name and non-zero steps.
3. CodeQL and dependency review work on public repos without GitHub Advanced Security on private.

Forks of public repos do not charge your minutes for their Actions runs (they use the fork owner's quota if enabled).

## What runs in CI (and cost profile)

| Workflow            | When                                                                | Relative cost                                                   |
| ------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `CI` (`test.yml`)   | PR + push to `main` / `dev` / `master` (non-doc paths)              | Medium — Python + frontend verify; E2E when frontend job passes |
| `Secret Scan`       | Same as CI (in-repo script, also in Python job)                     | Low                                                             |
| `LangExtract Eval`  | Path-filtered PR/push; **nightly Ollama eval only on public repos** | Low validate; **high** nightly (model pull + LLM)               |
| `CodeQL`            | PR to default branch, push `main`, weekly schedule                  | Medium (matrix: JS + Python)                                    |
| `Dependency Review` | Pull requests only                                                  | Low                                                             |
| `Release Gate`      | Version tags / manual                                               | Medium                                                          |

Expensive jobs are gated or path-filtered so doc-only changes and private-repo nightlies do not burn minutes unnecessarily.

## Local parity

Contributors should run the same scripts CI uses so failures are caught before push:

```bash
npm run verify:pre-commit
npm run verify:pre-push
```

Lefthook runs `verify-pre-commit` on commit; `verify-pre-push` mirrors the heavier pre-push gate.

## Optional: reduce Actions further

If you still want lighter automation on a public repo:

- Require E2E only on `main` / release branches (edit `e2e` job `if:` in `test.yml`).
- Run CodeQL only on schedule + `main` (already limited on push).
- Disable scheduled LangExtract nightly if you rely on manual `workflow_dispatch` eval runs.

## Monitoring usage (private repos only)

While the repo remains private: **Settings → Billing and plans → Plans and usage → Actions**.
