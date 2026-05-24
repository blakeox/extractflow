# Parser and OCR failure runbook

Use this when extraction jobs fail during the **parsing** stage (`progress_stage: parsing`) or show parser-related `error_message` values.

## Quick triage

| Symptom                                                  | Likely cause                               | First action                                             |
| -------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `Docling parsing is disabled`                            | Worker has `EXTRACTFLOW_USE_DOCLING=false` | Enable Docling in worker env and restart worker          |
| `Docling PDF parsing produced no usable text`            | Scanned/low-contrast PDF                   | Re-scan, enable OCR retry, or upload text-native PDF     |
| `Docling image parsing produced no usable text`          | Photo/screenshot without readable text     | Higher resolution image or typed source                  |
| `Docling DOCX/PPTX/HTML parsing produced no usable text` | Empty or image-only office file            | Open file locally; export text or re-upload              |
| `Docling failed to parse`                                | Parser runtime/import failure              | Check worker logs and Docling prewarm status in Settings |

## Error messages (worker)

### Document parser disabled

**Message contains:** `Docling parsing is disabled`

The file type (PDF, DOCX, HTML, image, etc.) requires Docling. The worker is configured with parsing off.

**Fix**

1. Set `EXTRACTFLOW_USE_DOCLING=true` for the worker (see `.env.example`).
2. Restart the worker process or container.
3. Retry the job.

### PDF — no usable text

**Message contains:** `Docling PDF parsing produced no usable text`

The worker ran plain extraction and optional OCR retry but could not recover enough text.

**Fix**

1. Confirm the PDF is not password-protected or corrupt.
2. For scans, improve contrast and resolution; re-upload.
3. Ensure `DOCLING_PDF_OCR_RETRY=true` on the worker.
4. If the document is truly empty, replace the source file.

### Image — no usable text

**Message contains:** `Docling image parsing produced no usable text`

Image OCR did not return enough characters.

**Fix**

1. Ensure `DOCLING_IMAGE_OCR=true`.
2. Use a sharper, higher-resolution image with horizontal text.
3. Prefer PDF or text exports when available.

### Office / HTML — no usable content

**Message contains:** `Docling DOCX`, `Docling PPTX`, or `Docling HTML` parsing produced no usable text

**Fix**

1. Open the file locally and confirm it contains selectable text.
2. For slide decks, check speaker notes or export PDF.
3. Re-export from the source application and upload again.

### Parser runtime failure

**Message contains:** `Docling failed to parse`

An internal Docling error occurred (missing model, OOM, corrupt file).

**Fix**

1. Check worker logs around the job timestamp.
2. Confirm Docling prewarm completed (`DOCLING_PREWARM=true` on startup).
3. Retry once; if it persists, capture the file and open an issue with logs.

## Operator UI mapping

The extractions workspace maps the same strings via `getParserFailureGuidance()` in `frontend/src/App.tsx`. Failed jobs show a short title and remediation hint next to the error.

## Related configuration

| Variable                  | Purpose                                    |
| ------------------------- | ------------------------------------------ |
| `EXTRACTFLOW_USE_DOCLING` | Master switch for Docling-backed parsing   |
| `DOCLING_PREWARM`         | Warm converters at worker startup          |
| `DOCLING_PDF_OCR_RETRY`   | Second PDF pass with OCR when text is weak |
| `DOCLING_IMAGE_OCR`       | OCR for image uploads                      |

See [README.md](../README.md) for local development defaults.
