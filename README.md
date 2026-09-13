# Vercentlabs ERP

A TypeScript modular-monolith ERP, built as a pnpm/Turborepo workspace.

**Current state: engineering and shared-platform foundation only (Prompt
1).** No business modules are implemented. See
[`product/registers/shared-platform.yaml`](product/registers/shared-platform.yaml)
for the status of the 36 shared-platform capabilities that must exist before
business modules are built - all `NOT_STARTED`.

Root governance rules that apply to every change in this repository live in
[`CLAUDE.md`](CLAUDE.md). Read it before contributing.

## Stack

Node.js 24 LTS · pnpm workspaces · Turborepo · TypeScript (strict) ·
Next.js App Router (`apps/web`) · NestJS on Fastify (`apps/api`) · a plain
Node.js worker (`apps/worker`) · PostgreSQL 18 · Drizzle ORM · reviewed SQL
migrations · Redis · BullMQ · REST + OpenAPI · Vitest · Playwright ·
ESLint + Prettier · Docker Compose (local PostgreSQL/Redis only).

## Layout

```
apps/        web, api, worker
packages/    shared libraries (contracts, database, observability, ...)
platform/    15 shared-platform capability modules (SP001-SP036 boundary)
product/     capability register, requirements, acceptance, evidence
database/    reviewed SQL migrations (platform/tenant), seeds, fixtures
tests/       architecture, contracts, integration, security, performance, journeys
docs/        architecture references, ADRs, operations, security
infrastructure/  Docker Compose for local PostgreSQL + Redis
```

Full detail: [docs/architecture/system-overview.md](docs/architecture/system-overview.md).

## Getting started

```sh
pnpm install
cp .env.example .env
pnpm infra:up
pnpm db:migrate
pnpm dev
```

Then open `http://localhost:3000` (web) and
`http://localhost:3001/api/v1/health/live` (api). Full instructions,
including tests and verification: [docs/operations/local-development.md](docs/operations/local-development.md).

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run web, api and worker in watch mode |
| `pnpm build` | Build every app and package |
| `pnpm lint` / `pnpm typecheck` | Static checks |
| `pnpm test` | Unit tests (every package/app, plus `tests/contracts`, `tests/security`) |
| `pnpm test:architecture` | Module-boundary and register-integrity tests |
| `pnpm test:integration` | Requires `pnpm infra:up` first |
| `pnpm test:e2e` | Playwright journeys (`tests/journeys`) |
| `pnpm db:migrate` | Apply platform + tenant SQL migrations |
| `pnpm register:validate` | Validate `product/registers/shared-platform.yaml` |
| `pnpm verify` | Full pre-merge gate; see below |

`pnpm verify` runs frozen-lockfile install, formatting check, lint,
typecheck, unit tests, architecture tests, register validation, and a full
build, in that order, reporting exact pass/fail counts.

## Architecture decisions

- [ADR-0001: Modular monolith, not microservices](docs/decisions/ADR-0001-modular-monolith.md)
- [ADR-0002: REST + OpenAPI contracts, versioned at `/api/v1`](docs/decisions/ADR-0002-rest-openapi-contracts.md)
- [ADR-0003: One PostgreSQL deployment, RLS for tenant isolation](docs/decisions/ADR-0003-postgresql-tenancy-and-rls.md)
- [ADR-0004: Registers and documentation cannot self-certify implementation status](docs/decisions/ADR-0004-evidence-based-feature-status.md)
