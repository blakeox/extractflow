# Schema-Driven Document Extraction

Local-first document extraction and calculation platform for structured, schema-driven LLM workflows.

## Decision

This first version is a Dockerized local web application with a React frontend, FastAPI backend, SQLite-backed persistence, and a separate Python worker for parsing, extraction, validation, deterministic formulas, review, and export.

Why this path:

- It keeps the processing engine backend-first, which is the durable foundation for later Tauri wrapping, self-hosting, or SaaS deployment.
- It separates extracted fields from calculated fields so deterministic math and validation stay inside the application, not the LLM.
- It defaults to a local `mock` provider so the full workflow runs without cloud dependency, then allows migration to Ollama, OpenAI, DeepSeek, Kimi, LM Studio, or other OpenAI-compatible endpoints through one provider framework.

## Included MVP

- Extraction schema creation with versioned JSON schema definitions
- Document upload and queued extraction jobs
- Worker-driven parsing and extraction pipeline
- Deterministic formula engine with dependency validation and cycle detection
- Validation status, review flags, and manual review edits with recalculation
- Export to JSON, CSV, and Excel
- Optional Ollama sidecar profile in Docker Compose
- Provider catalog for local and remote LLM applications with one shared settings contract
- Hardened dev startup with healthchecks, preflight validation, seeded sample schema, and explicit env defaults

## Architecture

```text
Browser UI (:3000)
  -> FastAPI API (:8000)
  -> SQLite volume
  -> Local file storage volume
  -> Worker polling queue
  -> Optional local LLM endpoint (Ollama or host endpoint)
```

Services:

- `frontend`: Vite/React UI at [http://localhost:3000](http://localhost:3000)
- `backend`: FastAPI API at [http://localhost:8000/api](http://localhost:8000/api)
- `worker`: Background processor for parsing, extraction, validation, formulas, and exports
- `ollama`: Optional local model runtime, enabled with `--profile ollama`

Provider framework:

- Built-in catalog entries currently include `mock`, `ollama`, `lm_studio`, `openai`, `azure_openai`, `deepseek`, and `kimi`
- Remote providers use environment-backed API keys rather than storing secrets in app settings
- Additional providers can be injected with `PROVIDER_CATALOG_JSON` as long as they expose an OpenAI-compatible `/chat/completions` endpoint
- Azure OpenAI is handled separately because it is deployment-scoped and uses Azure `api-key` plus `api-version` routing

## Run

```bash
make dev-up
```

Open [http://localhost:3000](http://localhost:3000).

What `make dev-up` hardens:

- Verifies Docker and Compose are actually available
- Creates `.env` from [.env.example](/Users/blakepowell/Documents/GitHub/document-extraction-best-practice-llm/.env.example) on first run
- Automatically chooses free host ports when the defaults are already occupied
- Starts services with container healthchecks and readiness-based dependencies
- Seeds a generalized sample schema on backend startup unless disabled

Optional Ollama sidecar:

```bash
docker compose --profile ollama up --build
```

Useful commands:

```bash
make doctor
make ps
make logs
make dev-down
```

## Testing

The test framework is intentionally split by runtime boundary so failures stay attributable:

- `tests/shared`: pure extraction-core unit tests
- `tests/backend`: FastAPI contract and service tests against an isolated SQLite test database
- `tests/worker`: worker-side parsing, validation, and execution tests
- `frontend/src/*.test.tsx`: jsdom-based UI smoke tests with mocked API and Tauri calls
- `frontend/e2e/*.spec.ts`: Playwright browser flows with intercepted API responses for stable end-to-end UI coverage

Install test dependencies:

```bash
PYTHON_BIN="$(./scripts/resolve-python.sh)"
"$PYTHON_BIN" -m pip install -r requirements-dev.txt
npm install
npm --prefix frontend install
```

Run everything:

```bash
make test
```

Local guardrails:

```bash
npm run verify:pre-commit
npm run verify:pre-push
```

- `npm install` at the repo root installs Lefthook and activates the repository's `pre-commit` and `pre-push` hooks.
- `./scripts/resolve-python.sh` prefers the repo's `.venv/bin/python` when available, then falls back to Python 3.13, 3.12, and 3.11 so local verification stays on a supported interpreter and does not stop on a broken candidate binary.
- `pre-commit` runs a staged secret scan, Prettier check, a Python syntax smoke check, plus frontend lint/tests/build.
- `pre-push` runs a full tracked-file secret scan plus Ruff, Prettier, frontend lint, Python tests, and frontend tests/build before the push leaves your machine.

Run individual slices:

```bash
make test-python
make test-ui
make test-e2e
make eval-langextract
PYTHON_BIN="$(./scripts/resolve-python.sh)" && "$PYTHON_BIN" -m ruff check backend worker shared tests
npm --prefix frontend run lint
npm run format:check
PYTHONPATH=backend:shared python3 -m pytest tests/backend -k templates
```

- `make eval-langextract` runs the committed LangExtract golden-set cases in `evals/langextract/cases/`; it is intentionally opt-in because it evaluates live extraction quality against a local LangExtract/Ollama runtime instead of deterministic unit behavior.

Continuous enforcement:

- GitHub Actions runs Python tests and frontend verification on every push, pull request, and manual dispatch
- Local Lefthook hooks run the same verification scripts used by CI so contributor machines and GitHub Actions enforce the same contract
- A separate browser E2E job runs Playwright against the Vite app and covers upload -> run -> review with mocked API traffic
- Secret scanning also runs in-repo through `scripts/scan-secrets.py` locally and in `.github/workflows/secret-scan.yml`, which is the fallback because GitHub native secret scanning is unavailable on this private repository
- Ruff now standardizes the Python surfaces, ESLint covers the React/TypeScript frontend, and Prettier keeps repo formatting consistent across supported files
- Frontend CI uses `npm ci` against the checked-in lockfile for deterministic installs
- PRs also run dependency review, CodeQL scans the Python and TypeScript surfaces, and Dependabot tracks npm, pip, cargo, and GitHub Actions updates
- Workflow actions are pinned to exact commit SHAs, and `.github/CODEOWNERS` plus PR/issue templates keep review and change hygiene explicit
- Vulnerability reports should go through GitHub Security Advisories as documented in [`SECURITY.md`](SECURITY.md)

## Runtime Environment Contract

The Python services now fail fast on invalid configuration instead of starting with ambiguous runtime state.

- `DATABASE_URL` must use `sqlite:///...` because the current runtime and SQLAlchemy setup are SQLite-only
- `UPLOADS_DIR`, `EXPORTS_DIR`, and `PARSED_DIR` must remain under `DATA_DIR`
- `WORKER_STATUS_PATH` must remain under `DATA_DIR` so the worker health signal stays inside the shared app data volume
- `PROVIDER_CATALOG_JSON`, when set, must be a JSON array
- Provider base URLs must be explicit `http://` or `https://` URLs

Backend readiness surfaces:

- `/healthz`: liveness for the backend process
- `/readyz`: backend readiness with explicit database and storage checks, used by container healthchecks
- `/api/health`: API liveness used by the frontend bootstrap flow

Observability surfaces:

- backend responses include `X-Request-ID`; inbound request IDs are propagated when present, otherwise the API generates one
- backend logs emit structured request events with method, path, status, duration, and request ID
- worker logs emit structured lifecycle events for startup and non-idle job status transitions with job identifiers when available
- LangExtract feedback generation now emits structured diagnostics with reviewed-result counts, generated suggestion counts, and skip reasons
- LangExtract worker runs now emit structured extraction outcome summaries plus explicit oversized-document rejection events

Failure-path expectations:

- provider probes surface transport failures as `status: error` with the timeout or connection detail preserved
- worker provider adapters retry up to `retry_count + 1` total attempts before failing the extraction
- worker jobs move to `failed` with `error_message` populated when the document/template is missing or extraction raises at runtime
- LangExtract uses `chunk_size` as its internal grounded window size, but `langextract_max_document_chars` is the separate safety ceiling for total document length; runs over that limit fail fast with an explicit error instead of truncating grounded evidence

## LangExtract Eval Harness

The repository now includes a small LangExtract golden-set harness under `evals/langextract/cases/`.

- Each case stores parsed `document_text`, a full template definition, and expected extracted/calculated outputs plus review flags and note substrings.
- Matching is tolerant for common LLM variance: strings are whitespace/case normalized, numeric values allow a small tolerance, and expected dict keys are matched without failing on extra actual keys.
- The harness evaluates the extraction and reconciliation pipeline on parsed text, not parser fidelity for PDFs or DOCX files.
- The committed starter set now covers invoice, invoice-variant, lease, receipt, and statement-style grounded extraction flows so regressions are easier to spot across document families and label variants.

Run it with:

```bash
make eval-langextract
```

or point it at a specific case or directory:

```bash
PYTHON_BIN="$(./scripts/resolve-python.sh)"
"$PYTHON_BIN" ./scripts/evaluate-langextract.py evals/langextract/cases
```

## LangExtract Observability Summary

If you are collecting structured backend/worker logs locally, you can turn the committed LangExtract events into a quick JSON summary with:

```bash
python3 ./scripts/summarize-langextract-observability.py /path/to/logfile.jsonl
```

The summary rolls up:

- `langextract_document_rejected` counts and rejection reasons
- `langextract_extraction_completed` totals for review-required fields, note counts, and review-signal categories
- `langextract_feedback_suggestions_built` totals for generated/dismissed suggestions and skip reasons

## Provider Configuration

The app now separates three concerns:

- Provider family: `openai`, `deepseek`, `kimi`, `ollama`, `lm_studio`, `langextract`, `mock`, or your own registered type
- Runtime endpoint: the `base_url` and any environment-backed API key
- Selected model: the deployment or model string used for extraction

Environment variables:

```bash
OPENAI_API_KEY=
AZURE_OPENAI_API_KEY=
DEEPSEEK_API_KEY=
KIMI_API_KEY=
DEFAULT_LOCAL_PROVIDER_BASE_URL=http://host.docker.internal:11434/v1
DEFAULT_LM_STUDIO_BASE_URL=http://localhost:1234/v1
DEFAULT_OPENAI_BASE_URL=https://api.openai.com/v1
DEFAULT_AZURE_OPENAI_BASE_URL=https://example.openai.azure.com
DEFAULT_AZURE_OPENAI_API_VERSION=2024-10-21
DEFAULT_AZURE_OPENAI_DEPLOYMENT=gpt-4.1-mini
DEFAULT_DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEFAULT_KIMI_BASE_URL=https://api.moonshot.ai/v1
CUSTOM_PROVIDER_PROBE_MAX_AGE_HOURS=24
PROVIDER_CATALOG_JSON=
```

Readiness and control surfaces:

- `/api/settings/providers` returns catalog entries and default settings
- `/api/settings/providers/health` reports whether each provider is actually ready based on required endpoint and env configuration
- `/api/settings/providers/controls` returns app-level provider controls including the custom-profile reverification threshold
- the Settings page now includes a custom provider form for private OpenAI-compatible and Azure endpoints, with save and probe actions
- extraction jobs use the selected schema version by default, but when a provider has been explicitly saved in Settings it is sent as a per-job provider override so the active default matches the queued run
- saved custom provider profiles move between `Saved`, `Verified`, and `Stale` based on the configured `CUSTOM_PROVIDER_PROBE_MAX_AGE_HOURS` window
- Azure readiness requires `base_url`, `deployment`, `api_version`, and `AZURE_OPENAI_API_KEY`
- `LangExtract (Ollama)` is an experimental local-only option that uses stored template prompt/examples, now authored through a guided schema editor with a live saved-payload preview instead of raw example JSON, and verifies Ollama by issuing a minimal `/api/generate` request for the configured model before queueing
- LangExtract preserves global grounded offsets by using its own internal windowing with `chunk_size`; this repo separately caps total LangExtract input with `langextract_max_document_chars` so very large documents fail explicitly instead of silently truncating or running unbounded
- LangExtract examples must reference real extracted field keys from the schema; unknown example field names are rejected in both the UI and API so supervised examples cannot drift away from the extraction contract
- LangExtract examples must also cover every field the schema marks as required, and the schema editor now shows required-field example coverage before save
- Reviewed LangExtract runs now surface grounded candidate examples back into the schema editor; operators must explicitly add them to the draft and save a new schema version before they affect future runs
- The LangExtract schema editor now explains when reviewed runs were skipped for feedback reuse, including missing parsed text and drifted grounded spans, instead of collapsing those cases into a silent empty state

Example custom provider catalog entry:

```json
[
  {
    "key": "secure-gateway",
    "label": "Secure Gateway",
    "description": "Private OpenAI-compatible routing layer.",
    "mode": "cloud",
    "provider_type": "secure_gateway",
    "api_style": "openai_compatible",
    "base_url": "https://llm.company.internal/v1",
    "model": "document-extractor-prod",
    "enabled": true,
    "recommended": false,
    "api_key_env_var": "SECURE_GATEWAY_API_KEY",
    "tags": ["private", "gateway"],
    "capabilities": {
      "supports_chat_completions": true,
      "supports_json_mode": true,
      "supports_streaming": false,
      "supports_remote_processing": true,
      "requires_api_key": true,
      "supports_local_runtime": false
    },
    "settings": {
      "mode": "cloud",
      "provider_type": "secure_gateway",
      "provider_label": "Secure Gateway",
      "api_style": "openai_compatible",
      "base_url": "https://llm.company.internal/v1",
      "api_key_env_var": "SECURE_GATEWAY_API_KEY",
      "api_key_required": true,
      "model": "document-extractor-prod",
      "temperature": 0.1,
      "max_tokens": 6000,
      "supports_json_mode": true,
      "allow_external_processing": true,
      "timeout_seconds": 120,
      "retry_count": 2,
      "chunk_size": 16000
    }
  }
]
```

## Desktop Shell

Tauri is implemented as a thin desktop wrapper around the existing frontend and local backend workflow.

Use:

```bash
npm run tauri:dev
```

This will:

- start the backend and worker containers in the background
- choose an available Tauri UI port dynamically
- start the frontend dev server locally
- open the desktop shell against that live UI

Build a desktop app bundle with:

```bash
npm run tauri:build
```

Validate desktop distribution readiness with:

```bash
npm run tauri:check-dist
```

Current desktop model:

- the Tauri shell is the distribution wrapper, not the extraction engine
- packaged desktop builds now bundle a desktop runtime payload under Tauri resources
- the desktop shell manages backend and worker services through Docker Compose using an app-local data directory
- notarization and trusted macOS distribution still require a real Developer ID signing identity and notary credentials

## Release and Rollback

Release gate:

- `.github/workflows/release.yml` runs on manual dispatch and `v*` tags
- the workflow runs the full `verify:pre-push` contract before packaging anything
- release artifacts currently include a source tarball, a desktop runtime bundle, and a `SHA256SUMS` manifest
- you can build the same artifacts locally with `npm run release:package -- <version>` or `make release-package`

Rollback checklist:

1. Stop the running stack or desktop-managed containers.
2. Revert to the last known-good tag or commit before redeploying artifacts.
3. Restore the `/data` volume or app-local data snapshot if the failed release mutated runtime state.
4. Restart services and verify `/healthz`, `/readyz`, and the worker status file under `/data/worker-status.json`.
5. Confirm a known document can still complete upload -> extraction -> review -> export before resuming normal use.

## Workflow

1. On first startup, the backend seeds a sample "General Document Extraction Schema" unless `SEED_SAMPLES_ON_STARTUP=false`.
2. Save a schema in the Schema Builder or use the seeded schema. A generalized starter example lives in [samples/general-template.json](/Users/blakepowell/Documents/GitHub/document-extraction-best-practice-llm/samples/general-template.json), and a lease-specific example remains available in [samples/lease-template.json](/Users/blakepowell/Documents/GitHub/document-extraction-best-practice-llm/samples/lease-template.json).
3. Upload a document. A generalized sample input lives in [samples/general-sample.txt](/Users/blakepowell/Documents/GitHub/document-extraction-best-practice-llm/samples/general-sample.txt), and a lease sample remains available in [samples/lease-sample.txt](/Users/blakepowell/Documents/GitHub/document-extraction-best-practice-llm/samples/lease-sample.txt).
4. Select a schema version and document, then queue extraction.
5. Wait for the worker to complete the job, open the result, review flagged fields, save edits, and export.

## Control Boundaries

- Local-only processing is enforced by schema/provider settings rather than hidden behavior.
- Calculated fields are evaluated after extraction with a deterministic formula engine.
- Exports and uploaded documents are stored on the shared local Docker volume under `/data`.
- Sensitive document text is not intentionally logged by default.

## Current Constraints

- The default `mock` extractor is a bootstrap path, not production-grade extraction quality.
- OCR is installed but only lightly integrated.
- The review UI is functional but still coarse; it edits normalized JSON directly rather than using field-specific widgets.
- Authentication, RBAC, audit-grade logging, and team library controls are intentionally deferred to keep the local-first MVP contained.
- The current queue is SQLite polling, which is acceptable for local/dev but not yet the right control plane for higher-concurrency team workloads.
- The seeded sample schema is for developer onboarding only; it is not a migration system or production fixture strategy.
- The starter UI is now domain-agnostic, but the review experience still needs stronger field-type-specific controls to feel equally native across every domain.

## Future Path

- Tauri wrapper: treat Tauri as a launcher/shell around the existing web stack.
- Team self-hosted mode: swap SQLite for Postgres, add auth/RBAC, and promote schemas/settings to organization scope.
- Hosted SaaS mode: replace local storage and job plumbing with managed equivalents while preserving the shared schema, formula, validation, and review contracts.
