# Runtime database role

The application runtime must never connect as the PostgreSQL owner, bootstrap superuser, migration role or a role with `BYPASSRLS`.

Required variables:

- `MIGRATION_DATABASE_URL`: privileged migration connection.
- `DATABASE_URL`: restricted application connection.
- `APP_DATABASE_ROLE`: runtime role name.
- `APP_DATABASE_PASSWORD`: strong runtime password.

For local development, define these variables in the ignored
`apps/web/.env.local` file. The password embedded in `DATABASE_URL` must be the
URL-encoded form of `APP_DATABASE_PASSWORD`.

Apply both schemas before provisioning or repairing the role:

```bash
pnpm db:migrate:control
pnpm db:migrate:tenant
pnpm db:provision:runtime-role
```

The provisioning command verifies that the role is not a superuser, cannot bypass RLS and owns no application tables. Rotate the runtime password through the secret manager rather than committing it to an environment file.
