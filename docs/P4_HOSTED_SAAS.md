# P4 — Hosted SaaS (optional / deferred)

ExtractFlow’s primary target is **team self-host**. P4 tracks a optional managed multi-tenant SaaS product.

## Status

These capabilities are **not required** for company production on a single org install. Implement only if pursuing hosted SaaS:

| Issue                                                   | Capability                     | Notes                                                                                                               |
| ------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| [#90](https://github.com/blakeox/extractflow/issues/90) | Object storage (S3-compatible) | `STORAGE_BACKEND=s3` for uploads/exports — see [OBJECT_STORAGE.md](OBJECT_STORAGE.md); parsed artifacts still local |
| [#91](https://github.com/blakeox/extractflow/issues/91) | Usage metering + admin console | Admin API + UI for per-tenant usage and suspension shipped; quotas/billing integration can be layered on top        |

## Prerequisites already on `dev`

- Tenant columns and scoped API queries — see [TENANT_ISOLATION_AUDIT.md](TENANT_ISOLATION_AUDIT.md)
- Bearer auth + RBAC middleware — `REQUIRE_AUTHENTICATION`, `AUTH_BEARER_TOKENS_JSON`
- `saas_multi_tenant` deployment mode with trusted `X-Tenant-ID`

## Suggested implementation order (when pursued)

1. ~~Storage abstraction over uploads/exports~~ (parsed artifacts still on disk)
2. Isolation audit sign-off + external pen-test
3. ~~Metering hooks on job completion and export~~
4. ~~Admin console for tenant lifecycle~~
