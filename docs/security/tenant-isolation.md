# Tenant isolation: RLS, least-privilege roles, and transaction-local scoping

This is the concrete implementation ADR-0003 deferred: real RLS policies
over real tenant-owned tables (`platform.organizations`,
`platform.companies`, `platform.operating_units`), added in
`database/migrations/platform/0006_create_runtime_role_and_rls.sql` and
hardened in
`database/migrations/platform/0007_harden_organizations_tenant_boundary.sql`.

**Update (Prompt 002A-H):** `platform.organizations` was originally shipped
with no RLS at all, relying entirely on application-layer authorization
(`isPlatformOperatorScope` checks). That was verified as a real,
exploitable gap - see
[product/evidence/PROMPT-002A-H-TENANT-BOUNDARY.md](../../product/evidence/PROMPT-002A-H-TENANT-BOUNDARY.md)
for the executable proof - and fixed with the second database role and RLS
policy described below.

## Two database roles, two connection pools

| Role | Used by | Tables | Purpose |
|---|---|---|---|
| `erp_runtime` (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`) | `apps/api`'s `PlatformDatabaseService` (`PLATFORM_DB`), `apps/worker` | `platform.companies`, `platform.operating_units`, `platform.idempotency_records`, `audit.audit_events`, `integration.outbox_events`, and a read-only, own-row-only view of `platform.organizations` | Ordinary tenant-scoped domain queries |
| `erp_platform_admin` (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`) | `apps/api`'s `PlatformAdminDatabaseService` (`PLATFORM_ADMIN_DB`), injected only by `OrganizationsController` | `platform.organizations` (full, cross-tenant), plus the same shared `audit`/`outbox`/`idempotency` tables organization commands also write to | Organization control-plane writes: create/activate/suspend/recover/close/update-metadata |

Which token a controller injects is a compile-time choice
(`@Inject(PLATFORM_DB)` vs `@Inject(PLATFORM_ADMIN_DB)`), never derived from
a client-supplied header, cookie, query parameter or body field -
`tests/architecture/platform-api-boundaries.test.ts` enforces that only
`OrganizationsController` may reference `PLATFORM_ADMIN_DB` at all. Both
services derive their connection string from `env.DATABASE_URL` via
`packages/database/src/runtime-connection.ts`'s `toRuntimeConnectionString`
(overridable per-role via `RUNTIME_DATABASE_URL` /
`PLATFORM_ADMIN_DATABASE_URL`). Production must set both explicitly via a
secrets manager - the derived dev passwords are local-development
placeholders only, documented at their definition sites.

An `erp_platform_admin` credential leak controls organization lifecycle
only: it has **no grant at all** on `platform.companies` or
`platform.operating_units` (verified in
`tests/integration/tenant-isolation-rls.integration.test.ts`'s "tenant/
platform pools cannot be confused" test) - it cannot reach tenant business
data underneath the organizations it administers.

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

**`platform.organizations` now has RLS too (Prompt 002A-H), with two
different policies for its two roles:**

```sql
-- erp_runtime: read-only, and only its own scoped organization row -
-- needed for loadOrganizationAcceptingNewCompanies, never for anything else.
CREATE POLICY organizations_tenant_runtime_read_own ON platform.organizations
  FOR SELECT TO erp_runtime
  USING (id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- erp_platform_admin: explicit full access - preferred over BYPASSRLS so
-- this role's privileges stay inside the same auditable policy system as
-- every other role, per the Prompt 002A-H threat model.
CREATE POLICY organizations_platform_admin_full_access ON platform.organizations
  TO erp_platform_admin
  USING (true) WITH CHECK (true);
```

`erp_runtime`'s `INSERT`/`UPDATE` grants on `platform.organizations` were
revoked outright (not narrowed) - it has no legitimate reason left to write
this table at all, now that organization control-plane writes go through
`erp_platform_admin` instead. `id = current_setting(...)` (not an
`organization_id` column - an organization *is* the tenant boundary, not a
member of one) is why `erp_runtime`'s one remaining read needs the
organization's *own id* as the scope value, which is exactly what
`loadOrganizationAcceptingNewCompanies`
(`platform/organization/src/organization-guard.ts`) now sets via
`withOrganizationScope(db, organizationId, ...)` before reading.

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

A platform-operator (cross-tenant) command still passes `organizationId:
null` when it calls `withOrganizationScope`/`runIdempotentCommand`, which
sets `app.current_organization_id = ''` - but since these commands now run
via `erp_platform_admin` (whose policy is `USING (true)`, unconditional),
that setting has no effect on what the query can see. It is preserved
purely so the shared audit/outbox/idempotency tables' `organization_id IS
NULL` branch still matches correctly for these cross-tenant writes.

## What is verified, concretely

`tests/integration/tenant-isolation-rls.integration.test.ts` (19 tests
across two `describe` blocks, real PostgreSQL) covers: two organizations'
company rows are mutually invisible to each other under `erp_runtime` +
RLS; missing/malformed `app.current_organization_id` exposes nothing;
direct SQL attempts to update an immutable column (`tenant_key`,
`company_code`, `unit_code`) as `erp_runtime` **or** `erp_platform_admin`
are rejected by the column-level `GRANT`; append-only enforcement on
`audit.audit_events`/`integration.outbox_events`; the pool-reuse-no-leak
case; and, added in Prompt 002A-H: `erp_runtime` sees zero organizations
with no scope set, cannot read or write a different organization's row,
cannot insert an organization at all (direct-table attack fails);
`erp_platform_admin` can read/update across tenants but not `tenant_key`,
and has no grant whatsoever on `platform.companies`/`platform.operating_units`
(the tenant and platform connection pools cannot be confused with each
other).
