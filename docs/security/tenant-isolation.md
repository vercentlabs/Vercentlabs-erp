# Tenant isolation: RLS, least-privilege role, and transaction-local scoping

This is the concrete implementation ADR-0003 deferred: real RLS policies
over real tenant-owned tables (`platform.organizations`,
`platform.companies`, `platform.operating_units`), added in
`database/migrations/platform/0006_create_runtime_role_and_rls.sql`.

## The `erp_runtime` role

`apps/api` and `apps/worker` connect as `erp_runtime`
(`NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`) for every
domain query - never as the migration/admin role, which can bypass RLS
entirely. `packages/database/src/runtime-connection.ts`
(`toRuntimeConnectionString`) derives this connection string from the admin
one; `apps/api`'s `PLATFORM_DATABASE_SCHEMA`... concretely,
`PlatformDatabaseService` (`apps/api/src/platform/database/platform-database.service.ts`)
constructs its pool from `RUNTIME_DATABASE_URL` if set, else derives it.
Production must set `RUNTIME_DATABASE_URL` explicitly via a secrets
manager - the derived dev password is a local-development placeholder only,
documented at its definition site.

### Column-level immutability, enforced by the database

`erp_runtime` is granted `UPDATE` only on the columns each table's own
commands actually change - **never** on `tenant_key` (organizations),
`company_code` (companies), or `unit_code` (operating units). This makes
"these codes are immutable after creation" a database-enforced guarantee,
not just an omission from application code that a future bug could
reintroduce. See the `GRANT UPDATE (...)` column lists in
`0006_create_runtime_role_and_rls.sql`.

## Row-Level Security policies

`platform.companies`, `platform.operating_units`,
`platform.idempotency_records`, `audit.audit_events` and
`integration.outbox_events` all have `ENABLE ROW LEVEL SECURITY` **and**
`FORCE ROW LEVEL SECURITY` (the latter matters because `erp_runtime` owns
none of these tables, but `FORCE` also applies RLS to any future table owner
that isn't a superuser). Policies key on
`current_setting('app.current_organization_id', true)`:

```sql
CREATE POLICY companies_tenant_isolation ON platform.companies
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
```

`operating_units_tenant_isolation` is identical in shape. The shared
audit/outbox/idempotency tables use a `CASE` form instead, because they also
carry platform-operator (cross-tenant) rows with `organization_id IS NULL`:
when no organization context is set, the policy matches only `NULL`-scoped
rows; when one is set, it matches only that organization's rows. Either way
the row set is always determined by what `SET LOCAL` actually put in place -
never "everything" as a fallback.

**`platform.organizations` intentionally has no RLS policy.** It has no
`organization_id` column to scope by - an organization *is* the tenant
boundary, not a member of one - and it is only ever read/written through
platform-operator-scoped commands and queries (`isPlatformOperatorScope`
checks in `platform/tenancy`), which is an application-layer authorization
decision, not a row-filtering one. `erp_runtime`'s `GRANT SELECT, INSERT`
(and column-restricted `UPDATE`) on this table has no RLS layered under it.

## `SET LOCAL`, not session-level `SET` - why this matters under pooling

`withOrganizationScope` (`packages/database/src/organization-scope.ts`) sets
`app.current_organization_id` via `SET LOCAL` inside the same transaction as
every domain read/write:

```ts
return db.transaction(async (tx) => {
  await tx.execute(sql.raw(`SET LOCAL app.current_organization_id = '${organizationId}'`));
  return fn(tx);
});
```

`SET LOCAL` is transaction-scoped and is **automatically discarded at
COMMIT or ROLLBACK** - before the underlying connection can be returned to
the pool and picked up by an unrelated request. A session-level `SET` would
leak: under `pg`'s connection pooling, the next request to reuse that
physical connection could silently inherit the previous request's
organization scope. This is not a theoretical concern - it is exactly the
kind of bug `tests/integration/tenant-isolation-rls.integration.test.ts`'s
"pool-reuse-no-leak" test exists to catch, by deliberately running two
different organizations' transactions back-to-back on the same pool and
asserting no cross-contamination.

`organizationId` is validated as a strict UUID
(`packages/database/src/uuid.ts`) before being interpolated into the raw
`SET LOCAL` statement - PostgreSQL does not support a bound parameter for
`SET`/`SET LOCAL`, so this validation is the injection guard for that
interpolation, not optional input hygiene.

A platform-operator (cross-tenant) command passes `organizationId: null`,
which sets `app.current_organization_id = ''` - the RLS policies then only
match rows whose organization scope is itself empty/null, which is none of
the tenant-owned rows. Platform-operator commands (organization
create/activate/suspend/recover/close, and the list/get organization
queries) therefore read via `platform.organizations` directly rather than
relying on this setting to expose anything.

## What is verified, concretely

`tests/integration/tenant-isolation-rls.integration.test.ts` (9 tests,
real PostgreSQL) covers: two organizations' rows are mutually invisible to
each other under `erp_runtime` + RLS; missing/malformed
`app.current_organization_id` exposes nothing; direct SQL attempts to
update an immutable column (`tenant_key`, `company_code`, `unit_code`) as
`erp_runtime` are rejected by the column-level `GRANT`; append-only
enforcement on `audit.audit_events`/`integration.outbox_events` (no
`UPDATE`/`DELETE` grant exists at all); and the pool-reuse-no-leak case
above.
