# Database migrations

Migration runners use a PostgreSQL advisory lock and SHA-256 checksums. A previously recorded migration whose file changes is rejected.

Use the privileged migration connection:

```bash
pnpm db:migrate:control
pnpm db:migrate:tenant
```

Transactional migrations execute the SQL and migration-ledger insertion in one transaction. A rare non-transactional migration must include the explicit marker:

```sql
-- vercent:migration nontransactional
```

Before production migration, create a verified backup and rehearse restoration in a separate environment. Do not edit an already deployed migration; add a new forward migration.
