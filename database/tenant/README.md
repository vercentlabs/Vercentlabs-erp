# Tenant Business Database

This directory owns ERP business records. Identity, organisations, roles,
sessions and platform administration remain in `database/platform`.

## Structure

- `migrations/` — immutable tenant-schema migrations
- `seeds/` — optional controlled reference-data seeds
- `policies/` — tenant and business access policy documentation
- `views/` — governed reporting views
- `functions/` — tenant database functions

The first business migration establishes trusted partners, product masters,
warehouse structure and finance setup. All runtime access must use an
authenticated tenant transaction.
