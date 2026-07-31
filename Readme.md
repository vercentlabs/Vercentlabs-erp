# Vercentlabs ERP

Vercentlabs ERP is a pnpm monorepo containing the public landing site, the authenticated ERP web application, shared packages, API services, database migrations and deployment infrastructure.

## Current release scope

The current release is the governed platform foundation plus four business modules: CRM, Sales, Accounting and Procurement. It includes authentication, onboarding, organisation administration, permissions, governed master data, billing controls, approvals, auditability, web workflows and the native CRM mobile client. Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support and HR & Payroll remain roadmap items and cannot be activated in this release.

## Getting started

### Prerequisites

- Node.js 24 (the version is also declared in `.nvmrc`).
- Docker with the Compose plugin.
- Corepack, included with supported Node.js installations.

From the repository root, enable the package manager declared in the root
manifest and install the locked dependencies:

```sh
corepack enable
pnpm install --frozen-lockfile
```

On Windows PowerShell, use `corepack.cmd` if script execution policy blocks the
`corepack.ps1` shim. For example:

```powershell
corepack.cmd enable
corepack.cmd pnpm install --frozen-lockfile
```

Create the ignored web environment file:

```sh
cp apps/web/.env.example apps/web/.env.local
```

PowerShell equivalent:

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
```

In `apps/web/.env.local`, replace `APP_DATABASE_PASSWORD` with a local password
of at least 24 characters and put the same URL-encoded password in
`DATABASE_URL`. Do not change `MIGRATION_DATABASE_URL` for the supplied local
Compose database.

Start PostgreSQL, apply both schemas, and create the restricted application
role:

```sh
pnpm infra:up
pnpm db:migrate:control
pnpm db:migrate:tenant
pnpm db:provision:runtime-role
```

`infra:up` waits for PostgreSQL's health check before returning. Start both web
applications:

```sh
pnpm dev
```

The public website runs on `http://localhost:3000` and the authenticated application on `http://localhost:3001`.

## Release and testing

Run the complete automated local gate independently of initial setup:

```sh
pnpm test:all
pnpm verify:release
pnpm typecheck:landing
pnpm typecheck:web
pnpm lint:mobile
pnpm typecheck:mobile
pnpm verify:mobile
```

- [Project boundaries](PROJECT_STRUCTURE.md)
- [Enterprise module completion boundary](docs/architecture/enterprise-module-completion.md)
- [Manual real-user CRM acceptance](docs/testing/manual-crm-acceptance.md)
- [CRM production runbook](docs/deployment/crm-production-runbook.md)
- [Migration operations](docs/operations/migrations.md)
- [Runtime database role](docs/security/runtime-database-role.md)

Production promotion requires the locked install, complete test/release gate, database verification, production builds, staging acceptance, backup restoration rehearsal and deployment smoke checks. No script creates a demo user, demo company or sample CRM records.
