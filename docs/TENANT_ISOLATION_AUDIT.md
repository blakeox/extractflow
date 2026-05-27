# Tenant isolation audit

Security review checklist for row-level isolation in team and SaaS deployments. Use this when closing [#89](https://github.com/blakeox/extractflow/issues/89) or before enabling `DEPLOYMENT_MODE=saas_multi_tenant`.

## Scope

Every durable object carries `tenant_id`:

- `Template`, `TemplateVersion`, `Document`, `ExtractionJob`, `ExtractionResult`, `ExportRecord`, `AuditEvent`
- Tenant-scoped settings keys: `tenant:{tenant_id}:…`

## API query paths (verified)

| Area              | Filter pattern                                         | Route module                                  |
| ----------------- | ------------------------------------------------------ | --------------------------------------------- |
| Templates         | `Template.tenant_id == tenant_id`                      | `backend/app/api/routes.py`                   |
| Template versions | `TemplateVersion.tenant_id == tenant_id`               | same                                          |
| Documents         | `Document.tenant_id == tenant_id`                      | same                                          |
| Jobs              | `ExtractionJob.tenant_id == tenant_id`                 | same                                          |
| Results / exports | `ExtractionResult.tenant_id`, `ExportRecord.tenant_id` | same                                          |
| Audit events      | `AuditEvent.tenant_id`                                 | `backend/app/services/audit_service.py`       |
| Ops metrics       | per-tenant counts                                      | `backend/app/services/ops_metrics_service.py` |
| Provider settings | `tenant:{id}:default_provider`                         | settings routes                               |

## Worker chain

Worker rejects cross-tenant job/document/template_version combinations before processing (`worker/app/main.py`).

## Trust modes

| Mode                            | Tenant source                                        |
| ------------------------------- | ---------------------------------------------------- |
| `local`, `hosted_single_tenant` | `CURRENT_TENANT_ID`                                  |
| `saas_multi_tenant` + auth      | `X-Tenant-ID` header when `TRUST_TENANT_HEADER=true` |

Requires `REQUIRE_AUTHENTICATION=true` and bearer tokens (`AUTH_BEARER_TOKENS_JSON`).

## Automated coverage

- `tests/backend/test_api_routes.py::test_tenant_scoping_hides_other_tenant_records`
- `tests/backend/test_tenant_isolation.py` — SaaS header + auth mode
- `tests/backend/test_auth_rbac.py` — auth and RBAC middleware

## Manual sign-off

- [ ] Pen-test or internal review of any new route touching tenant-scoped models
- [ ] Confirm backup/restore docs preserve tenant boundaries
- [ ] Re-run isolation tests after schema changes
