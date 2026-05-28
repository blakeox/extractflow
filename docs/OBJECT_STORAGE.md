# Object storage (S3-compatible)

ExtractFlow stores uploads and export artifacts under `DATA_DIR` by default (`STORAGE_BACKEND=local`). For multi-node or hosted deployments, enable an S3-compatible backend.

## Configuration

| Variable                                      | Default       | Description                                |
| --------------------------------------------- | ------------- | ------------------------------------------ |
| `STORAGE_BACKEND`                             | `local`       | `local` or `s3`                            |
| `S3_BUCKET`                                   | —             | Required when `STORAGE_BACKEND=s3`         |
| `S3_PREFIX`                                   | `extractflow` | Key prefix for all objects                 |
| `S3_ENDPOINT_URL`                             | —             | Optional custom endpoint (MinIO, R2, etc.) |
| `AWS_REGION` / `S3_REGION`                    | —             | AWS region for the S3 client               |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | —             | Standard boto3 credential chain            |

Backend and worker must share the same storage settings. The worker materializes objects into `DATA_DIR/.cache/s3` before Docling runs.

## Object keys

References stored in the database stay the same (`uploads/...`, `result-<id>-<timestamp>.json`, etc.). S3 keys are:

```
{S3_PREFIX}/{path-relative-to-data-dir}/{reference}
```

Example: `extractflow/exports/result-42-20260101T120000.json`.

## Local development with MinIO

```bash
STORAGE_BACKEND=s3
S3_BUCKET=extractflow-dev
S3_ENDPOINT_URL=http://minio:9000
AWS_ACCESS_KEY_ID=minio
AWS_SECRET_ACCESS_KEY=minio123
```

Parsed text and worker status files remain on the local volume under `DATA_DIR` in this release.
