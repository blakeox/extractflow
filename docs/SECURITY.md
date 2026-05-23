# Security

## Reporting

Open a [private security advisory](https://github.com/blakeox/extractflow/security/advisories/new) or email the maintainers for sensitive issues.

## Automated checks

| Check             | Where                                     |
| ----------------- | ----------------------------------------- |
| Secret scan       | `scripts/scan-secrets.py` (CI + pre-push) |
| npm audit         | CI + `npm run verify:dependencies`        |
| pip-audit         | CI + `npm run verify:dependencies`        |
| CodeQL            | `.github/workflows/codeql.yml`            |
| Dependency Review | PRs (`.github/workflows/security.yml`)    |

## Known transitive advisories

### `glib` (Rust / Tauri desktop, Linux)

Dependabot may report [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) (`glib` 0.15–0.19) via `src-tauri/Cargo.lock`. Tauri 2.x on Linux pulls `gtk` 0.18 → `glib` 0.18.x; upgrading to `glib` 0.20 requires a gtk-rs major bump tracked upstream ([tauri#12048](https://github.com/tauri-apps/tauri/issues/12048), [tauri#15035](https://github.com/tauri-apps/tauri/issues/15035)).

- **Scope:** Linux desktop builds using GTK/WebKit; not used on macOS/Windows app paths in this repo.
- **Mitigation:** Stay on current Tauri releases; re-check when Tauri ships gtk-rs/glib 0.20+.
- **Local audit:** `cd src-tauri && cargo audit` (optional; install with `cargo install cargo-audit`).
