# Runtime database role

The application runtime must never connect as the PostgreSQL owner, bootstrap superuser, migration role or a role with `BYPASSRLS`.

Required variables:

- `MIGRATION_DATABASE_URL`: privileged migration connection.
- `DATABASE_URL`: restricted application connection.
- `APP_DATABASE_ROLE`: runtime role name.
- `APP_DATABASE_PASSWORD`: strong runtime password.

Provision or repair the role:

```bash
pnpm db:provision:runtime-role
```

The provisioning command verifies that the role is not a superuser, cannot bypass RLS and owns no application tables. Rotate the runtime password through the secret manager rather than committing it to an environment file.
