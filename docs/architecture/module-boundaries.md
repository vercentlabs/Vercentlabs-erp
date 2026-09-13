# Module boundaries

This is a modular monolith, not a microservice system (ADR-0001). Boundaries
are enforced by package structure and checked mechanically by
`tests/architecture` (part of `pnpm verify`), not by convention alone.

## Rules

1. **Core domain writes go through `apps/api` only.** `apps/web` Server
   Actions and Route Handlers must never implement ERP domain mutations;
   they call the versioned `/api/v1` contract via `@vercentlabs/api-client`.
2. **`apps/web` never imports server/database internals.** It must not
   import `@vercentlabs/database`, any `@vercentlabs/platform-*` package,
   `pg`, `ioredis` or `drizzle-orm`. Enforced by
   `tests/architecture/no-frontend-database-imports.test.ts`.
3. **Platform packages never depend on an application.** No
   `platform/*/package.json` may declare a dependency on `@vercentlabs/web`,
   `@vercentlabs/api` or `@vercentlabs/worker`. Enforced by
   `tests/architecture/platform-boundaries.test.ts`.
4. **`platform/` contains only the 15 approved shared-platform modules**
   (identity, tenancy, organization, authorization, audit, approvals,
   automation, notifications, files, search, reporting, integrations,
   outbox, jobs, feature-flags). No business-module directory may be added
   under `platform/`, `apps/`, or a new top-level `modules/`/`business/`
   tree without updating this document and the architecture tests that
   enforce it.
5. **Cross-module interaction uses public commands, queries and events
   only.** A platform (or, later, business) module must never import
   another module's `src/` files by relative path, and must never write to
   another module's private database tables. It may only depend on another
   module's published package entry point (its `index.ts` exports).
6. **`packages/contracts` stays framework- and database-free.** No
   dependency on `next`, `react`, `@nestjs/*`, `fastify`, `express`, `pg`,
   `drizzle-orm` or `ioredis`, in `package.json` or in source imports.
   Enforced by `tests/architecture/contracts-framework-free.test.ts`.
7. **No SP or F identifier is implemented without evidence.** The register
   (`product/registers/shared-platform.yaml`) is validated on every
   `pnpm verify` run, and any capability marked `IMPLEMENTED` without at
   least one evidence path fails validation. See
   [ADR-0004](../decisions/ADR-0004-evidence-based-feature-status.md).

## Why this matters now, before any business module exists

Prompt 1 intentionally implements zero business logic. These boundaries are
established first, with executable tests, specifically so that the first
business module (built in a later prompt) has no path to violate them by
accident - the tests will fail immediately if it tries to.
