# Tenant Transaction and RLS Standard

Status: `APPROVED_FOR_ARCHITECTURE_FREEZE`

## Invariant
Every tenant-scoped database operation MUST execute inside one request/job-scoped database transaction and one checked-out database client/connection.

Canonical sequence: `BEGIN -> set_config('app.current_organization_id', ..., true) / SET LOCAL tenant context -> all tenant queries on the same client -> COMMIT or ROLLBACK`.

A tenant context established on one pooled connection MUST NEVER be assumed to apply to another connection. No tenant query may escape the transaction after context is set. Database RLS is defense-in-depth in addition to server-side authorization, never a substitute for it.

## Required negative tests
- Org A cannot select/insert/update/delete Org B rows, including direct-ID/IDOR attempts.
- Context is absent after commit/rollback and cannot leak through the pool.
- Background jobs establish tenant context on their own leased client.
- Service-role/bypass credentials are unavailable to normal request paths.
- Company/branch/record scope is enforced above tenant RLS where applicable.

## Worker/service-role boundary
Workers use the same public module commands and authorization/system-policy layer. A service role may bypass RLS only in narrowly documented infrastructure tasks and MUST reapply explicit organization scope, audit identity, correlation ID and idempotency. Product business handlers must not issue private-table cross-module writes.
