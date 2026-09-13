# System overview

Vercentlabs ERP V2 is a TypeScript modular monolith built as a pnpm/Turborepo
workspace. This document describes the engineering foundation established by
Prompt 1. No business modules exist yet; see
[`product/registers/shared-platform.yaml`](../../product/registers/shared-platform.yaml)
for the 36 shared-platform capabilities that must exist before business
modules are built, all currently `NOT_STARTED`.

## Applications (`apps/`)

- **`apps/web`** - Next.js App Router frontend. Strict TypeScript, a root
  layout with a skip link, an error boundary, a not-found page, and a
  foundation/health page that checks `apps/api` liveness. It never talks to
  PostgreSQL/Redis directly and never implements ERP domain mutations; all
  writes go through `apps/api` (see
  [module-boundaries.md](./module-boundaries.md)).
- **`apps/api`** - NestJS application on the Fastify adapter, serving a
  versioned `/api/v1` prefix with OpenAPI generation
  (`/api/v1/docs`, `/api/v1/docs-json`), `GET /api/v1/health/live` and
  `GET /api/v1/health/ready` (checking PostgreSQL and Redis), a global
  exception filter that returns a typed `ApiErrorEnvelope` for every
  non-2xx response, correlation-id propagation, structured logging, and
  graceful shutdown on `SIGTERM`/`SIGINT`.
- **`apps/worker`** - A plain Node.js process (no framework) connected to
  PostgreSQL and Redis/BullMQ. It runs a non-business "heartbeat" queue only
  to prove the BullMQ/Redis connection is live, exposes a minimal HTTP
  health-reporting endpoint (`/health/live`, `/health/ready`), and shuts down
  gracefully.

## Shared packages (`packages/`)

| Package | Purpose |
| --- | --- |
| `contracts` | Framework- and database-free API primitives: pagination, sort/filter, the typed error envelope, correlation metadata, idempotency keys, actor/trusted-scope types, decimal-string and BigInt-JSON helpers, date/time primitives. |
| `database` | PostgreSQL connection management (`drizzle-orm` + `pg`), a transaction helper, a lexical `.sql` migration runner split into platform/tenant scopes, and a safe test-database helper that refuses to run against a database whose name doesn't contain "test". |
| `observability` | A structured logger interface (pino-backed), an `AsyncLocalStorage`-based correlation context, field-name-based secret redaction (proven by tests), and an OpenTelemetry-shaped tracer abstraction currently backed by a no-op implementation. |
| `configuration` | Typed, fail-fast environment parsing with separate schemas for `web`, `api` and `worker`, applying safe defaults only outside `production`. |
| `api-client` | A thin typed `fetch` wrapper apps/web uses to call the versioned API contract. |
| `auth`, `permissions` | Type-only scaffolding for SP004-SP010 - no credential handling or enforcement logic exists yet. |
| `ui`, `design-tokens` | Minimal, framework-neutral UI primitives and placeholder design tokens. Not the final brand system. |
| `testing` | Cross-package test helpers: a source-file walker, a TypeScript-compiler-API import extractor (used by the architecture tests), and fixture builders. |
| `eslint-config`, `typescript-config` | Shared lint and compiler configuration consumed by every workspace package. |

## Shared-platform modules (`platform/`)

Fifteen packages, one per bounded shared-platform concern (identity,
tenancy, organization, authorization, audit, approvals, automation,
notifications, files, search, reporting, integrations, outbox, jobs,
feature-flags). Each currently contains only a package boundary and a README
mapping it to its SP ids - no implementation. See
[module-boundaries.md](./module-boundaries.md) for the rules these packages
must follow once implementation begins.

## Data (`database/`)

Reviewed, hand-authored SQL migrations (not `drizzle-kit`-generated, since no
schema exists yet) split into `database/migrations/platform` and
`database/migrations/tenant`. Each currently contains a single bootstrap
migration that only creates its schema - no tables. See
[tenant-data-strategy.md](./tenant-data-strategy.md).

## Verification pipeline

`pnpm verify` runs, in order: frozen-lockfile install, formatting check,
lint, typecheck, unit tests (including `tests/contracts` and
`tests/security`), architecture tests (`tests/architecture`), shared-platform
register validation, and a full build. Docker-dependent integration tests
(`pnpm test:integration`) and Playwright journeys (`pnpm test:e2e`) are
separate commands, run only when PostgreSQL/Redis or a browser are actually
available - see [docs/operations/local-development.md](../operations/local-development.md).
