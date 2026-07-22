# VercentLabs ERP

VercentLabs ERP is a pnpm monorepo containing the public landing site, the authenticated ERP web application, shared packages, API services, database migrations and deployment infrastructure.

## Current release scope

The current release is the platform foundation plus CRM: authentication, onboarding, organisation administration, permissions, governed master data, billing controls, CRM workflows and a native CRM mobile client. Eleven additional ERP modules remain roadmap items and cannot be activated in this release.

## Getting started

Use the package manager declared in the root manifest:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:migrate:control
pnpm db:migrate:tenant
pnpm test:all
pnpm verify:release
pnpm typecheck:landing
pnpm typecheck:web
pnpm lint:mobile
pnpm typecheck:mobile
pnpm verify:mobile
```

Start both applications:

```sh
pnpm dev
```

The public website runs on `http://localhost:3000` and the authenticated application on `http://localhost:3001`.

## Release and testing

- [Project boundaries](PROJECT_STRUCTURE.md)
- [Manual real-user CRM acceptance](docs/testing/manual-crm-acceptance.md)
- [CRM production runbook](docs/deployment/crm-production-runbook.md)
- [Migration operations](docs/operations/migrations.md)
- [Runtime database role](docs/security/runtime-database-role.md)

Production promotion requires the locked install, complete test/release gate, database verification, production builds, staging acceptance, backup restoration rehearsal and deployment smoke checks. No script creates a demo user, demo company or sample CRM records.
