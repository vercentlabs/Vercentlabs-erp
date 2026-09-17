# Vercentlabs ERP

Vercentlabs is a pnpm modular-monolith workspace. The authenticated ERP uses one shared platform core and twelve business modules: CRM, Sales, Procurement, Stock, Manufacturing, Quality, Projects, Assets, Point of Sale, Support, HR & Payroll, and Accounting.

The public landing application and mobile application are separate surfaces. ERP architecture work must not couple their implementation into the authenticated web application.

## Permanent ERP structure

```text
apps/web/src/
├── app/       # Next.js route/transport boundary
├── core/      # auth, tenancy, access, billing, audit, approvals, navigation, shared platform
├── modules/   # the 12 ERP business modules
└── shared/    # generic web primitives

services/api/src/
├── core/          # shared backend primitives
├── modules/       # business-domain services
└── orchestration/ # workflows that coordinate multiple module public contracts

database/
├── platform/  # identity, organisation, access and SaaS/platform state
└── tenant/    # operational ERP state protected by tenant context/RLS
```

See `docs/01-standards/PROJECT_STRUCTURE_CONSTITUTION.md`.

## Company email

The primary B2B contact is `sales@vercentlabs.com`. Customer support, privacy,
security, billing, careers, authentication delivery, and infrastructure alerts
use dedicated `@vercentlabs.com` Workspace role addresses.

## Toolchain

- Node.js 24 (`.nvmrc` and `.node-version`)
- pnpm 11.21.0
- Docker with Compose
- Corepack

```bash
corepack enable
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env.local
```

## Database

Start local PostgreSQL:

```bash
pnpm infra:up
```

For a fresh database:

```bash
pnpm db:setup
```

For an existing development database that already has every repository migration applied but predates `schema_migrations`, baseline it once, then provision the restricted runtime role:

```bash
pnpm db:baseline
pnpm db:provision:runtime-role
```

Never baseline an unknown or partially migrated database.

## Run

```bash
pnpm dev:web
pnpm dev:worker
```

ERP web runs on `http://localhost:3001` by default.

## Build commands

The root `pnpm build` is a Hostinger deployment compatibility alias — it
only builds `apps/landing` (the public marketing site `server.js` serves).
It is **not** an ERP build; do not treat a green `pnpm build` as evidence
the ERP product builds. Use the explicit names instead:

- `pnpm build:landing` — landing site only
- `pnpm build:erp` (= `pnpm build:web`) — the authenticated ERP web app
- `pnpm build:all` — landing + ERP web

## Hostinger landing deploy

Hostinger deploys the landing site from the repository root. If dependency
installation fails with a missing Corepack cache path like
`~/.cache/node/corepack/v1/pnpm/.../bin/pnpm.cjs`, open **Settings & Redeploy**
and configure the app as follows:

```bash
# Package manager
npm

# Build command
sh scripts/deploy/hostinger-build.sh

# Entry file / start command
node server.js
```

Use Node.js 24 for this project. Selecting npm prevents Hostinger from invoking
its stale Corepack pnpm cache during its automatic dependency step. The build
script then runs the repository-pinned `pnpm@11.21.0` through npm's `npx`,
installs the full workspace, and builds the landing application.

The root `package.json` and `package-lock.json` intentionally advertise npm for
Hostinger's automatic bootstrap step. The monorepo itself remains managed by
pnpm, with its exact version enforced by `engines.pnpm`, the pnpm lockfile, and
the repository toolchain checks.

## ERP verification

```bash
pnpm verify:architecture
pnpm verify:db
pnpm typecheck:web
pnpm lint:web
pnpm test:web
pnpm test:api
pnpm test:sdk
pnpm test:worker
pnpm test:integration
pnpm test:security
pnpm build:web
```

`pnpm verify:erp` runs the full ERP gate (toolchain, architecture, docs,
database, web typecheck/lint/tests, API/SDK/worker/package/integration/
security/enterprise-RBAC tests, and the ERP web production build) in one
command. `pnpm verify:release` additionally includes the landing site's
own lint/typecheck/build/tests and a dependency audit.

## Development rule

Requirement IDs stay in the canonical `docs/02-register/FEATURE_REGISTER.csv` and `docs/03-modules/*/features/` specifications; code is organised by business capability, not by one folder per feature ID. New capability code belongs under the owning module's `features/` boundary. A module may call another module only through that module's public `index.js` contract. Larger multi-module workflows belong in `services/api/src/orchestration`.

Do not recreate `apps/web/src/lib`, `apps/web/src/components`, `database/control-plane`, or top-level API module directories.

<!-- AI_CONTINUATION_ENTRY_POINT:START -->
## AI continuation entry point

When continuing ERP implementation in a new chat, read `docs/README.md` and `docs/PRODUCTION_TRACKER.md` for the current module-by-module status, then audit the relevant module's existing code in `apps/web/src/modules/*` and `services/api/src/modules/*` against its dossiers in `docs/03-modules/*/features/` before writing anything new.
<!-- AI_CONTINUATION_ENTRY_POINT:END -->
