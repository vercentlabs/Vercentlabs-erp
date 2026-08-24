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

See `PROJECT_STRUCTURE.md` and `docs/architecture/ERP_STRUCTURE.md`.

## Company email

The primary B2B contact is `sales@vercentlabs.com`. Customer support, privacy,
security, billing, careers, authentication delivery, and infrastructure alerts
use dedicated `@vercentlabs.com` Workspace role addresses. See
`docs/operations/WORKSPACE_EMAIL_DIRECTORY.md` for the canonical ownership and
provisioning map.

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

## Development rule

Requirement IDs stay in `docs/erp-510`; code is organised by business capability, not by one folder per feature ID. New capability code belongs under the owning module's `features/` boundary. A module may call another module only through that module's public `index.js` contract. Larger multi-module workflows belong in `services/api/src/orchestration`.

Do not recreate `apps/web/src/lib`, `apps/web/src/components`, `database/control-plane`, or top-level API module directories.
