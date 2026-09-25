# Database

Shared database helpers for tenant context and repository boundaries.

- `runTenantTransaction(client, organizationId, work)` — the one tenant
  transaction sequence: `BEGIN` → transaction-local, parameterized
  `app.current_organization_id` → `work(client)` → `COMMIT`, or `ROLLBACK` on
  any failure. Used by the web (`apps/web/src/core/db.ts`:
  `tenantTransaction`/`workspaceTransaction`) and the worker
  (`withTenantClient`). The caller checks out and releases the client.
- `setTenantContext(client, organizationId)` — the primitive underneath; only
  valid inside a transaction.

Rules: any `tenant.*` operation runs inside a tenant transaction whose
`organizationId` comes from authenticated server context (session principal
or durable job record), never from request input. Application queries keep
explicit `organization_id` predicates as defence in depth; FORCE RLS is the
final isolation layer. Setting `app.current_organization_id` anywhere else is
rejected by `pnpm verify:access`.
