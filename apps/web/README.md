# Vercentlabs ERP Web Application

The authenticated platform foundation includes secure account lifecycle management, organisation onboarding, multi-company and branch context, departments, teams, cost centres, role-based permissions, user access administration, sessions, notifications, approvals, audit logs, numbering series and a registry for the 12 ERP modules.

## Local development

Use Node.js 24 and run these commands from the repository root. First create the
ignored environment file:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Set `APP_DATABASE_PASSWORD` to a local password of at least 24 characters and
put the same URL-encoded password in `DATABASE_URL`. The supplied
`MIGRATION_DATABASE_URL` matches the local Compose database.

```bash
pnpm infra:up
pnpm db:migrate:control
pnpm db:migrate:tenant
pnpm db:provision:runtime-role
pnpm dev:web
```

Open `http://localhost:3001`.

Development verification, password-reset and invitation URLs are displayed only when `AUTH_EMAIL_WEBHOOK_URL` is empty. Configure a real delivery webhook before production deployment.

## Web experience system

The authenticated workspace follows the permanent design guidance in `docs/design/web-experience-system.md`. Run `pnpm verify:web-experience` to validate its core contracts.

## CRM

The authenticated CRM workspace is available at `/crm`. Run `pnpm verify:crm` and `pnpm db:verify:crm` after CRM changes.

## Billing and Razorpay

- `pnpm billing:sync-plans` validates plan economics and creates missing Razorpay plans.
- `pnpm billing:reconcile` refreshes provider subscription status.
- `pnpm db:verify:billing` verifies the commercial schema.
- `pnpm verify:billing` verifies billing source, API, SDK and margin contracts.
- Keep Test Mode and observe mode enabled until public HTTPS webhook and recovery tests pass.
