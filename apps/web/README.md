# Vercent ERP Web Application

The authenticated platform foundation includes secure account lifecycle management, organisation onboarding, multi-company and branch context, departments, teams, cost centres, role-based permissions, user access administration, sessions, notifications, approvals, audit logs, numbering series and a registry for the 12 ERP modules.

## Local development

```bash
pnpm infra:up
pnpm db:migrate:control
pnpm dev:web
```

Open `http://localhost:3001`.

Development verification, password-reset and invitation URLs are displayed only when `AUTH_EMAIL_WEBHOOK_URL` is empty. Configure a real delivery webhook before production deployment.

## Web experience system

The authenticated workspace follows the permanent design guidance in `docs/design/web-experience-system.md`. Run `pnpm verify:web-experience` to validate its core contracts.
