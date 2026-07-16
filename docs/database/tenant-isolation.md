# Tenant Isolation

## Transaction context

Application business-data work must use `tenantTransaction`:

```ts
await tenantTransaction(organizationId, async (client) => {
  // tenant queries
});
```

The helper begins a database transaction and executes:

```sql
SELECT set_config(
  'app.current_organization_id',
  $1,
  true
);
```

The third argument makes the value transaction-local, preventing tenant context
from leaking through the PostgreSQL connection pool.

## Row Level Security

Every table in the `tenant` schema enables and forces Row Level Security. The
policy requires:

```sql
organization_id = tenant.current_organization_id()
```

for both reading and writing.

## Service-layer scopes

RLS protects the organisation boundary. The business service additionally
enforces the active company and branch context for users without
organisation-wide access.

## Operational requirements

- Never query tenant tables through the unrestricted `query` helper.
- Never accept `organization_id` from a browser payload.
- Obtain organisation, company and branch context from the authenticated session.
- Use parameterized SQL only.
- Preserve explicit organisation predicates even when RLS is enabled.
- Run production traffic through a non-superuser role without `BYPASSRLS`.
- Keep migrations immutable after they have been applied.
- Test cross-tenant reads and writes before every production release.
