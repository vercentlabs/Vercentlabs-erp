-- Prompt 002A-H hardening. Supersedes the "no RLS needed on organizations"
-- reasoning in 0006_create_runtime_role_and_rls.sql, which relied entirely
-- on application-layer authorization (isPlatformOperatorScope checks) with
-- no database-layer defense-in-depth. Verified vulnerable via executable
-- probes before this migration was written (see
-- product/evidence/PROMPT-002A-H-TENANT-BOUNDARY.md): erp_runtime could
-- list every organization with no scope set, read/update another
-- organization's row while scoped to a different one, and insert a new
-- organization directly - all without any application code path being
-- exercised.
--
-- Fix: platform.organizations now has Row-Level Security, and organization
-- control-plane writes (create/activate/suspend/recover/close/update-
-- metadata) move to a *separate* least-privilege database role,
-- `erp_platform_admin`, distinct from the tenant-runtime role `erp_runtime`.
-- This is a database-level distinction, never selected by client-supplied
-- data - apps/api wires exactly one controller (OrganizationsController) to
-- the admin connection, at startup, in code.

-- ---------------------------------------------------------------------
-- erp_platform_admin: control-plane role for platform.organizations only.
-- NOSUPERUSER, NOBYPASSRLS - it is granted explicit RLS policies below
-- rather than exempted from RLS altogether, so its privileges over this one
-- table stay auditable in the same policy system as every other role.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_platform_admin') THEN
    CREATE ROLE erp_platform_admin LOGIN PASSWORD 'erp_platform_admin_dev_password'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO erp_platform_admin', current_database());
END $$;

GRANT USAGE ON SCHEMA platform TO erp_platform_admin;
GRANT USAGE ON SCHEMA audit TO erp_platform_admin;
GRANT USAGE ON SCHEMA integration TO erp_platform_admin;

-- Organization control-plane writes still go through the same audit/outbox/
-- idempotency machinery as every other command (runIdempotentCommand,
-- recordAuditEvent, recordOutboxEvent) - all in the same transaction, all
-- under this same connection/role, so erp_platform_admin needs the same
-- grants erp_runtime has on those three shared tables.
GRANT SELECT, INSERT, UPDATE ON platform.idempotency_records TO erp_platform_admin;
GRANT SELECT, INSERT ON audit.audit_events TO erp_platform_admin;
GRANT SELECT, INSERT ON integration.outbox_events TO erp_platform_admin;

-- erp_platform_admin never touches platform.companies or
-- platform.operating_units - no grant is given on either table. A leaked
-- erp_platform_admin credential controls organization lifecycle only, not
-- tenant business data underneath it.

-- ---------------------------------------------------------------------
-- platform.organizations: enable RLS, revoke erp_runtime's write access,
-- restrict its read access to its own scoped organization row only.
-- ---------------------------------------------------------------------
ALTER TABLE platform.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.organizations FORCE ROW LEVEL SECURITY;

-- erp_runtime may no longer create or mutate organizations at all - that is
-- now exclusively erp_platform_admin's job. Column-level UPDATE grants
-- previously given to erp_runtime are revoked outright (not narrowed),
-- since erp_runtime has no legitimate reason left to write this table.
REVOKE INSERT ON platform.organizations FROM erp_runtime;
REVOKE UPDATE ON platform.organizations FROM erp_runtime;

-- erp_runtime keeps SELECT only so `loadOrganizationAcceptingNewCompanies`
-- (platform/organization/src/organization-guard.ts) can read the parent
-- organization's current status before creating a company/operating unit -
-- but only for the organization the caller's trusted scope is already
-- bound to, never any other. That call now runs inside
-- `withOrganizationScope(db, organizationId, ...)`, matching every other
-- tenant-scoped query.
CREATE POLICY organizations_tenant_runtime_read_own ON platform.organizations
  FOR SELECT
  TO erp_runtime
  USING (id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- erp_platform_admin's policy intentionally grants full access rather than
-- BYPASSRLS: it is the one role whose entire purpose is cross-tenant
-- organization administration, and an explicit, auditable policy scoped to
-- this role is preferred over exempting it from RLS altogether.
CREATE POLICY organizations_platform_admin_full_access ON platform.organizations
  TO erp_platform_admin
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT ON platform.organizations TO erp_platform_admin;
GRANT UPDATE (
  display_name, legal_metadata, status, status_reason, version, updated_at, updated_by,
  activated_at, suspended_at, recovered_at, closed_at
) ON platform.organizations TO erp_platform_admin;
