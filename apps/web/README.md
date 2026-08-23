# Vercentlabs ERP Web

The authenticated web application is the route/transport shell for the ERP modular monolith.

```text
src/
├── app/       # Next.js routes and route handlers
├── core/      # shared ERP platform capabilities
├── modules/   # 12 ERP business modules
└── shared/    # generic reusable UI/helpers
```

Core owns authentication, sessions, organisations, companies, branches, users, teams, departments, roles, permissions, module access, company/branch/record scope, billing, audit, approvals, notifications, master data, navigation and security. Business modules consume these capabilities instead of recreating them.

## Local development

From the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env.local
pnpm infra:up
```

Fresh database:

```bash
pnpm db:setup
```

Existing fully-migrated development database without migration history:

```bash
pnpm db:baseline
pnpm db:provision:runtime-role
```

Then:

```bash
pnpm dev:web
```

Open `http://localhost:3001`.
