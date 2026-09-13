-- Bootstrap migration for the tenant schema boundary.
-- This creates only the schema itself. Tenant-owned business tables will be
-- added by future prompts, together with PostgreSQL RLS policies scoped by
-- organization_id, per docs/architecture/tenant-data-strategy.md.
CREATE SCHEMA IF NOT EXISTS tenant;
