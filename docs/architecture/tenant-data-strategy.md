# Tenant data strategy

## Current state (Prompt 1)

One PostgreSQL 18 deployment, with two schema boundaries already
established: `platform` and `tenant` (see
`database/migrations/platform/0000_bootstrap_platform_schema.sql` and
`database/migrations/tenant/0000_bootstrap_tenant_schema.sql`). Neither
schema contains any tables yet - only the schema objects themselves and each
scope's `_migrations` bookkeeping table, created by
`packages/database`'s migration runner
(`packages/database/src/migration-runner.ts`).

- **`platform` schema**: cross-tenant platform concerns (future home for
  organization/tenant records themselves, once SP001 is implemented).
- **`tenant` schema**: tenant-owned business data, once business modules
  exist.

## Planned strategy (for the prompts that implement SP001-SP003 and the
first business module)

1. Every tenant-owned table carries an `organization_id` column.
2. PostgreSQL Row-Level Security (RLS) policies scope every read and write
   to the requesting connection's `organization_id`, set via a
   session-local `SET LOCAL app.organization_id = ...` at the start of each
   request-scoped transaction.
3. `app.organization_id` is set from the server-derived `TrustedScope`
   (`@vercentlabs/contracts`) - constructed from authenticated session
   state in `apps/api`, never from a client-supplied request field. See
   root governance rule 6.
4. `apps/worker` jobs that touch tenant data must carry a persisted
   `organization_id`/`TrustedScope` on the job payload and set the same
   session-local variable before querying, per root governance rule 10.
5. A single PostgreSQL deployment is used initially (per the mandated
   architecture); per-tenant physical database/schema isolation is not
   planned, RLS is the isolation mechanism.

## Why not implemented yet

SP001 (Organization and tenant lifecycle) and SP003 (branch/site/operating
unit context) are `NOT_STARTED` in
[`product/registers/shared-platform.yaml`](../../product/registers/shared-platform.yaml).
RLS policies without real organization-scoped tables to protect would be
untestable theater; they will be added together with the first tenant-owned
tables, with an accompanying `tests/security` suite that attempts
cross-tenant reads and asserts they are denied.
