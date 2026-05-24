# Per-schema quality SLOs

ExtractFlow measures extraction quality per **schema** (template) using the LangExtract golden set under `evals/langextract/cases/`. Each case binds a `template_definition`, sample `document_text`, and expected field behavior.

## Default SLO targets (starter schemas)

| Schema family | Golden case(s)                     | Field accuracy                | Citation coverage                               | Review rate                     |
| ------------- | ---------------------------------- | ----------------------------- | ----------------------------------------------- | ------------------------------- |
| Invoice       | `invoice-basic`, `invoice-variant` | ≥ 95% required fields correct | ≥ 90% citation-required fields have source text | ≤ 25% fields flagged for review |
| Receipt       | `receipt-basic`                    | ≥ 93%                         | ≥ 85%                                           | ≤ 30%                           |
| Lease         | `lease-basic`                      | ≥ 92%                         | ≥ 88%                                           | ≤ 30%                           |
| Statement     | `statement-basic`                  | ≥ 90%                         | ≥ 85%                                           | ≤ 35%                           |

**Field accuracy** — normalized value matches the eval fixture expectation (or passes schema validation when the fixture only asserts presence).

**Citation coverage** — share of `citation_required` fields with non-empty `source_text` after extraction.

**Review rate** — share of extracted + calculated fields with `requires_review=true` on the golden document.

## How to run checks locally

```bash
make verify-langextract-upgrade
```

Nightly CI should run the same gate before provider or Docling upgrades ship to production tenants.

## When a schema fails its SLO

1. Run **schema dry-run** in the Schema builder with representative sample text (mock extract + validation, no job queue).
2. Compare the failing saved version with the draft using **version diff** before publishing a new template version.
3. Add or tighten LangExtract grounded examples; re-run the golden case.
4. If parser/OCR noise is suspected, inspect parsed text (`GET /api/documents/{id}/parsed-text`) and follow [PARSER_FAILURE_RUNBOOK.md](PARSER_FAILURE_RUNBOOK.md).

## Custom schemas

When you fork a starter schema:

1. Copy the closest golden case into `evals/langextract/cases/<your-schema>.json`.
2. Set explicit SLO thresholds in the case README comment or your internal runbook (defaults above are a starting point).
3. Block release of a new template version until the case passes in CI.

## Related issues

- Golden-set CI gate — production roadmap P0
- Schema dry-run — validates field rules before save
- Version diff — surfaces breaking schema changes between versions
