# Database

Shared database helpers for tenant context and repository boundaries.

`setTenantContext` must be called inside a database transaction before reading or
writing tables in the `tenant` schema. Application queries must also keep explicit
`organization_id` predicates as defence in depth.
