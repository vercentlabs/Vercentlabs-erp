# Database migrations

Migration runners use a PostgreSQL advisory lock and SHA-256 checksums. A previously recorded migration whose file changes is rejected.

For local development, copy `apps/web/.env.example` to
`apps/web/.env.local` and configure the runtime password as described in the
root README. Start the Compose database before applying migrations:

```bash
pnpm infra:up
pnpm db:migrate:control
pnpm db:migrate:tenant
pnpm db:provision:runtime-role
```

The two migration commands use the privileged `MIGRATION_DATABASE_URL`. Role
provisioning must run after both schemas exist and configures the restricted
role used by `DATABASE_URL`. Application processes must not use the migration
connection.

Transactional migrations execute the SQL and migration-ledger insertion in one transaction. A rare non-transactional migration must include the explicit marker:

```sql
-- vercentlabs:migration nontransactional
```

Before production migration, create a verified backup and rehearse restoration in a separate environment. Do not edit an already deployed migration; add a new forward migration.
