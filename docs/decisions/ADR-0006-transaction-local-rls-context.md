# ADR-0006: Transaction-local (`SET LOCAL`) RLS context, never session-level

## Status

Accepted and implemented.

## Context

ADR-0003 committed to PostgreSQL RLS as the tenant-isolation mechanism, keyed
on a session/connection variable, but deferred exactly how that variable
gets set until real tenant-owned tables existed. `apps/api` and
`apps/worker` use a pooled `pg.Pool` - a single physical connection is
reused across many logically unrelated requests over its lifetime. Any
mechanism that sets tenant context on a connection must guarantee that
context cannot survive past the request that set it.

## Decision

`app.current_organization_id` is set via `SET LOCAL`, always inside the same
transaction as the query it scopes, via `withOrganizationScope`
(`packages/database/src/organization-scope.ts`):

```ts
return db.transaction(async (tx) => {
  await tx.execute(sql.raw(`SET LOCAL app.current_organization_id = '${organizationId}'`));
  return fn(tx);
});
```

Every domain command's `runIdempotentCommand` helper
(`platform/tenancy/src/command-helpers.ts`,
`platform/organization/src/command-helpers.ts`) and every read query goes
through this helper - there is no code path that queries a tenant-owned
table without it.

We explicitly rejected session-level `SET` (or setting it once per pooled
connection at checkout time): `SET LOCAL`'s value is automatically discarded
at `COMMIT`/`ROLLBACK`, before the connection can be returned to the pool.
A session-level `SET` would persist on the physical connection after the
transaction ends, and the next unrelated request to reuse that connection
would silently inherit the previous request's organization scope - a
cross-tenant data leak that would not show up in any single-request test,
only under connection reuse.

`organizationId` is validated as a strict UUID
(`packages/database/src/uuid.ts`) before string interpolation into the raw
`SET LOCAL` statement, since PostgreSQL has no bound-parameter form for
`SET`/`SET LOCAL`.

## Consequences

- Every domain read/write must go through `withOrganizationScope` (or the
  `runIdempotentCommand` helpers that call it) - a query issued directly
  against `db` without it would run under no organization context and see
  nothing (fail closed) or, if run as a non-RLS-bound role, everything (why
  `apps/api`/`apps/worker` must never use the admin role - see
  [tenant-isolation.md](../security/tenant-isolation.md)).
- `tests/integration/tenant-isolation-rls.integration.test.ts`'s
  pool-reuse-no-leak test exists specifically to catch a regression back
  toward session-level state - it runs two organizations' transactions
  back-to-back against the same pool and asserts zero cross-contamination.
- Platform-operator (cross-tenant) commands pass `organizationId: null`,
  which sets the variable to an empty string - RLS policies then only match
  `NULL`-scoped rows on the shared audit/outbox/idempotency tables, and
  no rows on tenant-owned tables, rather than defaulting to "all rows".
