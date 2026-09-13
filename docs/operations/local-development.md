# Local development

## Prerequisites

- Node.js 24 LTS (pinned in `.nvmrc`/`.node-version`; `engines.node` in
  `package.json` requires `>=24.0.0 <25.0.0`)
- pnpm 11.21.0 (pinned via `packageManager` in `package.json`)
- Docker + Docker Compose (for PostgreSQL and Redis)

## First-time setup

```sh
pnpm install
cp .env.example .env
cp apps/web/.env.example apps/web/.env
```

`apps/web`'s `.env` is separate from the root one: Next.js only loads env files
from the app's own directory, and `NEXT_PUBLIC_*` values must be present
before `next build` (they're inlined into the client bundle at build time,
not read at runtime).

## Start local infrastructure (PostgreSQL 18, Redis)

```sh
pnpm infra:up      # docker compose -f infrastructure/docker-compose.yml up -d
```

This also creates a second `vercentlabs_erp_test` database on first start
(see `infrastructure/postgres-init/001-create-test-database.sql`), used by
`tests/integration` and `packages/database`'s safe test-database helper.

Shut it down with:

```sh
pnpm infra:down    # docker compose -f infrastructure/docker-compose.yml down
```

## Run migrations

```sh
pnpm db:migrate             # both platform and tenant schemas
pnpm db:migrate:platform    # platform schema only
pnpm db:migrate:tenant      # tenant schema only
```

Migrations are plain reviewed `.sql` files under
`database/migrations/{platform,tenant}`, applied by
`packages/database`'s migration runner and tracked in a per-schema
`_migrations` bookkeeping table.

## Run the applications

```sh
pnpm dev   # turbo run dev --parallel: apps/web on :3000, apps/api on :3001, apps/worker's health server on :3002
```

Or individually: `pnpm --filter @vercentlabs/web dev`,
`pnpm --filter @vercentlabs/api dev`, `pnpm --filter @vercentlabs/worker dev`.

Check health:

```sh
curl http://localhost:3001/api/v1/health/live
curl http://localhost:3001/api/v1/health/ready   # requires infra:up
curl http://localhost:3002/health/ready           # worker, requires infra:up
```

Open `http://localhost:3000` for the web foundation page.

## Tests

```sh
pnpm test               # unit tests for every package/app + tests/contracts + tests/security
pnpm test:architecture  # tests/architecture only
pnpm test:integration   # requires infra:up; includes tests/integration and each app's *.integration.test.ts
pnpm test:e2e           # Playwright journeys; starts apps/web itself via webServer config
```

## Verification

```sh
pnpm verify
```

Runs, in order: frozen-lockfile install, formatting check, lint, typecheck,
unit tests, architecture tests, register validation, and a full build. It
does not start Docker services or run `test:integration`/`test:e2e` - run
those separately, and only report them as passing if they actually ran.
