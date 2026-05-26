# Capacity and performance baselines

Rough expectations for **team self-host** on a single worker and SQLite. Treat these as planning numbers, not guarantees — LangExtract model size and PDF complexity dominate variance.

## Reference hardware profiles

| Profile | CPU / RAM          | Typical use                               |
| ------- | ------------------ | ----------------------------------------- |
| Small   | 4 vCPU, 8 GB RAM   | 1–5 operators, light PDF/text             |
| Medium  | 8 vCPU, 16 GB RAM  | 5–20 operators, mixed PDF + spreadsheets  |
| Large   | 16 vCPU, 32 GB RAM | 20–50 operators, heavier Docling OCR PDFs |

Local LLM runtime (Ollama/LM Studio) should be sized separately; the worker calls out to the configured provider.

## Throughput (indicative)

Assumptions: mock or small local model, mostly text invoices, single worker, `WORKER_POLL_SECONDS=5`.

| Profile | Sustainable jobs/hour | Notes                                     |
| ------- | --------------------- | ----------------------------------------- |
| Small   | 30–60                 | Queue may backlog during bursts           |
| Medium  | 60–120                | Comfortable for daily operator batches    |
| Large   | 120–200+              | Diminishing returns without second worker |

LangExtract + large PDF + OCR retry can drop any profile to **minutes per document**. Measure with your golden-set cases (`make eval-langextract`) on target hardware.

## Queue depth guidance

Use `GET /api/ops/metrics`:

| `queue_depth`  | Interpretation                                                               |
| -------------- | ---------------------------------------------------------------------------- |
| 0–2            | Healthy                                                                      |
| 3–10           | Busy; normal during batch uploads                                            |
| > 10 sustained | Under-provisioned — add worker host CPU, faster model, or second worker (P3) |

## Disk growth

Plan roughly:

- Uploads: original file size × retention policy (you manage retention today)
- Parsed text: ~same order as extracted text per document
- Exports: one or more formats per completed review
- SQLite: grows with jobs, audit events, and review edits

Monitor `DATA_DIR` filesystem free space; alert below 20% free on production hosts.

## CI vs production

Required PR CI uses deterministic tests and mock extraction. Nightly LangExtract eval on `qwen2.5:3b` is informational for small models. Capacity planning should use **your** production model and hardware, not CI runners alone.

## Related docs

- [OPERATOR_ALERTING.md](OPERATOR_ALERTING.md) — what to alert on
- [QUALITY_SLOS.md](QUALITY_SLOS.md) — accuracy gates
- [RELEASE_UPGRADE.md](RELEASE_UPGRADE.md) — safe upgrades
