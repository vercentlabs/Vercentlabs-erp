# ADR-0003: One PostgreSQL deployment, RLS for tenant isolation

## Status

Accepted (strategy); implementation deferred to the prompt that builds
SP001-SP003 and the first tenant-owned table.

## Context

The mandated architecture calls for "one PostgreSQL deployment initially,
with clear platform and tenant/module schema boundaries" and "tenant-owned
business records must eventually carry organization scope and use
PostgreSQL RLS." We need to decide the isolation mechanism now, even though
no tenant-owned tables exist yet, so later migrations are written against a
known strategy instead of retrofitted.

## Decision

- A single PostgreSQL 18 instance, split into a `platform` schema and a
  `tenant` schema (both bootstrapped as empty schemas in this prompt; see
  `database/migrations/platform/0000_bootstrap_platform_schema.sql` and
  `database/migrations/tenant/0000_bootstrap_tenant_schema.sql`).
- Every tenant-owned table will carry an `organization_id` column and a
  PostgreSQL Row-Level Security policy scoping access to it.
- The active `organization_id` is set per-transaction from a server-derived
  `TrustedScope` (`@vercentlabs/contracts`), never from client input (root
  governance rule 6), via a session-local `SET LOCAL`.
- Migrations are hand-authored, reviewed `.sql` files (not
  `drizzle-kit`-generated) applied by `packages/database`'s migration
  runner, tracked per-schema in a `_migrations` bookkeeping table. Drizzle
  ORM (`drizzle-orm`) is used for typed queries once schema/tables exist,
  per the mandated architecture; it is not used for migration generation
  here because there is no schema yet to generate from.
- No per-tenant physical database or schema is created. RLS is the
  isolation boundary, not physical separation.

## Consequences

- Full detail lives in
  [docs/architecture/tenant-data-strategy.md](../architecture/tenant-data-strategy.md).
- Every future migration that adds a tenant-owned table must add its RLS
  policy in the same migration, and `tests/security` must gain a
  cross-tenant-read-is-denied test alongside it - this is a standing
  requirement, not optional follow-up.
- No RLS policies are written yet, because there is nothing for them to
  protect; writing them now would be untestable and would risk giving false
  confidence.
