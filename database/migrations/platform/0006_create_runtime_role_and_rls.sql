-- Least-privilege runtime role. apps/api and apps/worker connect as this
-- role for all domain queries - never as the migration/admin role. The
-- fixed password below is a local-development placeholder only (same
-- pattern as POSTGRES_PASSWORD in infrastructure/docker-compose.yml);
-- production must supply its own via a secrets manager and never reuse
-- this value - see docs/security/tenant-isolation.md.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_runtime') THEN
    CREATE ROLE erp_runtime LOGIN PASSWORD 'erp_runtime_dev_password'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO erp_runtime', current_database());
END $$;

GRANT USAGE ON SCHEMA platform TO erp_runtime;
GRANT USAGE ON SCHEMA audit TO erp_runtime;
GRANT USAGE ON SCHEMA integration TO erp_runtime;

-- Organizations: no per-row tenant column to scope by (the row IS the
-- tenant), so no RLS policy here. Authorization that only a
-- platform-operator actor may call organization lifecycle commands is
-- enforced at the application layer (see docs/security/platform-operator-boundary.md)
-- and tested there. tenant_key/created_at/created_by are excluded from the
-- UPDATE grant so immutability is enforced by the database, not only by
-- application code that could have a bug.
GRANT SELECT, INSERT ON platform.organizations TO erp_runtime;
GRANT UPDATE (
  display_name, legal_metadata, status, status_reason, version, updated_at, updated_by,
  activated_at, suspended_at, recovered_at, closed_at
) ON platform.organizations TO erp_runtime;

GRANT SELECT, INSERT ON platform.companies TO erp_runtime;
GRANT UPDATE (
  legal_name, display_name, time_zone, tax_registrations, status, status_reason,
  version, updated_at, updated_by
) ON platform.companies TO erp_runtime;

GRANT SELECT, INSERT ON platform.operating_units TO erp_runtime;
GRANT UPDATE (
  name, time_zone, address, status, status_reason, version, updated_at, updated_by
) ON platform.operating_units TO erp_runtime;

GRANT SELECT, INSERT, UPDATE ON platform.idempotency_records TO erp_runtime;

-- Audit is append-only for the runtime role: SELECT/INSERT only, no UPDATE/DELETE.
GRANT SELECT, INSERT ON audit.audit_events TO erp_runtime;

-- No dispatcher exists yet, so no UPDATE grant either (nothing should move
-- delivery_state until SP015 is implemented).
GRANT SELECT, INSERT ON integration.outbox_events TO erp_runtime;

-- Tenant isolation. The session variable is set with `SET LOCAL` inside each
-- transaction (packages/database's withOrganizationScope) so it can never
-- outlive the transaction or leak across pooled-connection reuse. When no
-- context is set, current_setting(..., true) returns NULL and every policy
-- below resolves to "no rows" for tenant-scoped tables, or "only
-- platform-operator (NULL organization_id) rows" for the shared audit/
-- outbox/idempotency tables - fail closed, never fail open.
ALTER TABLE platform.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.companies FORCE ROW LEVEL SECURITY;
CREATE POLICY companies_tenant_isolation ON platform.companies
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

ALTER TABLE platform.operating_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.operating_units FORCE ROW LEVEL SECURITY;
CREATE POLICY operating_units_tenant_isolation ON platform.operating_units
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

ALTER TABLE platform.idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.idempotency_records FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_records_scope_isolation ON platform.idempotency_records
  USING (
    CASE
      WHEN NULLIF(current_setting('app.current_organization_id', true), '') IS NULL THEN organization_id IS NULL
      ELSE organization_id = current_setting('app.current_organization_id', true)::uuid
    END
  )
  WITH CHECK (
    CASE
      WHEN NULLIF(current_setting('app.current_organization_id', true), '') IS NULL THEN organization_id IS NULL
      ELSE organization_id = current_setting('app.current_organization_id', true)::uuid
    END
  );

ALTER TABLE audit.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_events_scope_isolation ON audit.audit_events
  USING (
    CASE
      WHEN NULLIF(current_setting('app.current_organization_id', true), '') IS NULL THEN organization_id IS NULL
      ELSE organization_id = current_setting('app.current_organization_id', true)::uuid
    END
  )
  WITH CHECK (
    CASE
      WHEN NULLIF(current_setting('app.current_organization_id', true), '') IS NULL THEN organization_id IS NULL
      ELSE organization_id = current_setting('app.current_organization_id', true)::uuid
    END
  );

ALTER TABLE integration.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration.outbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_events_scope_isolation ON integration.outbox_events
  USING (
    CASE
      WHEN NULLIF(current_setting('app.current_organization_id', true), '') IS NULL THEN organization_id IS NULL
      ELSE organization_id = current_setting('app.current_organization_id', true)::uuid
    END
  )
  WITH CHECK (
    CASE
      WHEN NULLIF(current_setting('app.current_organization_id', true), '') IS NULL THEN organization_id IS NULL
      ELSE organization_id = current_setting('app.current_organization_id', true)::uuid
    END
  );
