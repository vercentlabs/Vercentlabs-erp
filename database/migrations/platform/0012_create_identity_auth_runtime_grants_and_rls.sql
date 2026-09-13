-- Prompt 002B: least-privilege database roles and Row-Level Security for
-- the identity/auth schemas, applying the same defense-in-depth pattern
-- established in database/migrations/platform/0006 and 0007 (a table's
-- real isolation boundary must not depend solely on application code
-- remembering a WHERE clause).
--
-- Two roles, not one, because two genuinely different trust boundaries
-- exist here (see docs/architecture/identity-model.md and
-- docs/decisions/ADR-0008-global-identity-and-membership.md):
--
--   erp_auth_pipeline   - the login/recovery/verification/invitation
--                         pipeline. These operations are inherently
--                         "who is this?" lookups (by email, or by a
--                         possessed token/credential-id) that happen
--                         BEFORE any user context can be scoped to - the
--                         same structural reason platform.organizations
--                         needed erp_platform_admin instead of erp_runtime.
--                         Also carries the (currently HTTP-unreachable)
--                         admin lifecycle commands - suspend/deactivate/
--                         reactivate/invite - for the same "acts on a
--                         user who isn't 'the current user'" reason.
--
--   erp_identity_runtime - authenticated self-service only, once a user is
--                         already known from a validated session. RLS-
--                         scoped to `app.current_user_id`, set the same way
--                         `app.current_organization_id` is: via `SET LOCAL`
--                         inside the request's transaction, discarded at
--                         COMMIT/ROLLBACK, never surviving pooled-connection
--                         reuse.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_auth_pipeline') THEN
    CREATE ROLE erp_auth_pipeline LOGIN PASSWORD 'erp_auth_pipeline_dev_password'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_identity_runtime') THEN
    CREATE ROLE erp_identity_runtime LOGIN PASSWORD 'erp_identity_runtime_dev_password'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO erp_auth_pipeline', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO erp_identity_runtime', current_database());
END $$;

GRANT USAGE ON SCHEMA identity TO erp_auth_pipeline, erp_identity_runtime;
GRANT USAGE ON SCHEMA auth TO erp_auth_pipeline, erp_identity_runtime;
GRANT USAGE ON SCHEMA audit TO erp_auth_pipeline, erp_identity_runtime;
GRANT USAGE ON SCHEMA integration TO erp_auth_pipeline, erp_identity_runtime;
GRANT SELECT, INSERT ON audit.audit_events TO erp_auth_pipeline, erp_identity_runtime;
GRANT SELECT, INSERT ON integration.outbox_events TO erp_auth_pipeline, erp_identity_runtime;

-- Identity/auth commands reuse the SAME generic idempotency infrastructure
-- SP001-SP003 commands use (packages/database/src/idempotency.ts,
-- platform.idempotency_records) rather than duplicating another table -
-- exactly like audit.audit_events/integration.outbox_events are already
-- shared cross-module infrastructure. Its uniqueness key is
-- (actor_id, operation_name, idempotency_key), not organization_id, and its
-- existing RLS policy's "organization_id IS NULL" branch (see 0006) already
-- covers rows written with organizationId: null - which is how every
-- identity/auth command calls it, since these operations use
-- `app.current_user_id`, not `app.current_organization_id`, for scoping.
GRANT USAGE ON SCHEMA platform TO erp_auth_pipeline, erp_identity_runtime;
GRANT SELECT, INSERT, UPDATE ON platform.idempotency_records TO erp_auth_pipeline, erp_identity_runtime;

-- =======================================================================
-- identity.users
-- =======================================================================
ALTER TABLE identity.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.users FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON identity.users TO erp_auth_pipeline;
GRANT UPDATE (
  status, status_reason, display_name, security_stamp, version, updated_at, updated_by,
  invited_at, activated_at, suspended_at, reactivated_at, deactivated_at
) ON identity.users TO erp_auth_pipeline;
CREATE POLICY users_auth_pipeline_full_access ON identity.users
  TO erp_auth_pipeline USING (true) WITH CHECK (true);

GRANT SELECT ON identity.users TO erp_identity_runtime;
-- security_stamp is included here (not admin-only): self-service
-- changePassword must be able to bump its own row's stamp to invalidate
-- other sessions - RLS still restricts this to the caller's own row only.
GRANT UPDATE (display_name, updated_at, updated_by, version, security_stamp) ON identity.users TO erp_identity_runtime;
CREATE POLICY users_self_service_own_row ON identity.users
  FOR SELECT TO erp_identity_runtime
  USING (id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY users_self_service_update_own_row ON identity.users
  FOR UPDATE TO erp_identity_runtime
  USING (id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- =======================================================================
-- identity.user_email_addresses - unscoped for erp_auth_pipeline (login
-- must look a user up BY email, before any user_id is known); RLS-scoped
-- for erp_identity_runtime (an authenticated user manages only their own).
-- =======================================================================
ALTER TABLE identity.user_email_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.user_email_addresses FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON identity.user_email_addresses TO erp_auth_pipeline;
GRANT UPDATE (verified_at, updated_at) ON identity.user_email_addresses TO erp_auth_pipeline;
CREATE POLICY user_email_addresses_auth_pipeline_full_access ON identity.user_email_addresses
  TO erp_auth_pipeline USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON identity.user_email_addresses TO erp_identity_runtime;
GRANT UPDATE (is_primary, updated_at) ON identity.user_email_addresses TO erp_identity_runtime;
CREATE POLICY user_email_addresses_self_service ON identity.user_email_addresses
  TO erp_identity_runtime
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- =======================================================================
-- identity.organization_memberships
-- =======================================================================
ALTER TABLE identity.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.organization_memberships FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON identity.organization_memberships TO erp_auth_pipeline;
GRANT UPDATE (status, removed_at, updated_at, updated_by, version) ON identity.organization_memberships TO erp_auth_pipeline;
CREATE POLICY organization_memberships_auth_pipeline_full_access ON identity.organization_memberships
  TO erp_auth_pipeline USING (true) WITH CHECK (true);

GRANT SELECT ON identity.organization_memberships TO erp_identity_runtime;
CREATE POLICY organization_memberships_self_service_read ON identity.organization_memberships
  FOR SELECT TO erp_identity_runtime
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- =======================================================================
-- identity.user_invitations - capability-token table (looked up by hash,
-- never listed); access control is token entropy + expiry, not row
-- visibility, so only erp_auth_pipeline needs any grant at all here.
-- =======================================================================
ALTER TABLE identity.user_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.user_invitations FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON identity.user_invitations TO erp_auth_pipeline;
GRANT UPDATE (status, accepted_at, accepted_user_id, revoked_at, updated_at, version) ON identity.user_invitations TO erp_auth_pipeline;
CREATE POLICY user_invitations_auth_pipeline_full_access ON identity.user_invitations
  TO erp_auth_pipeline USING (true) WITH CHECK (true);

-- =======================================================================
-- identity.user_lifecycle_history - append-only.
-- =======================================================================
ALTER TABLE identity.user_lifecycle_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.user_lifecycle_history FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON identity.user_lifecycle_history TO erp_auth_pipeline;
CREATE POLICY user_lifecycle_history_auth_pipeline_full_access ON identity.user_lifecycle_history
  TO erp_auth_pipeline USING (true) WITH CHECK (true);

GRANT SELECT ON identity.user_lifecycle_history TO erp_identity_runtime;
CREATE POLICY user_lifecycle_history_self_service_read ON identity.user_lifecycle_history
  FOR SELECT TO erp_identity_runtime
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- =======================================================================
-- auth.password_credentials
-- =======================================================================
ALTER TABLE auth.password_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.password_credentials FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON auth.password_credentials TO erp_auth_pipeline;
GRANT UPDATE (password_hash, updated_at, version) ON auth.password_credentials TO erp_auth_pipeline;
CREATE POLICY password_credentials_auth_pipeline_full_access ON auth.password_credentials
  TO erp_auth_pipeline USING (true) WITH CHECK (true);

GRANT SELECT ON auth.password_credentials TO erp_identity_runtime;
GRANT UPDATE (password_hash, updated_at, version) ON auth.password_credentials TO erp_identity_runtime;
CREATE POLICY password_credentials_self_service ON auth.password_credentials
  TO erp_identity_runtime
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- =======================================================================
-- auth.webauthn_credentials - erp_auth_pipeline needs unscoped SELECT to
-- resolve an authentication ceremony's asserted credential_id back to a
-- user before any scope can be set; erp_identity_runtime manages its own
-- once authenticated.
-- =======================================================================
ALTER TABLE auth.webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.webauthn_credentials FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON auth.webauthn_credentials TO erp_auth_pipeline;
GRANT UPDATE (counter, last_used_at) ON auth.webauthn_credentials TO erp_auth_pipeline;
CREATE POLICY webauthn_credentials_auth_pipeline_full_access ON auth.webauthn_credentials
  TO erp_auth_pipeline USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON auth.webauthn_credentials TO erp_identity_runtime;
-- counter/last_used_at are included even though this role does not run
-- authentication ceremonies directly: verifyWebAuthnAuthenticationAssertion
-- is shared code, also called by completeStepUp's WEBAUTHN method, which
-- runs under erp_identity_runtime (step-up happens inside an already-
-- authenticated session).
GRANT UPDATE (name, revoked_at, counter, last_used_at) ON auth.webauthn_credentials TO erp_identity_runtime;
CREATE POLICY webauthn_credentials_self_service ON auth.webauthn_credentials
  TO erp_identity_runtime
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- =======================================================================
-- auth.totp_credentials
-- =======================================================================
ALTER TABLE auth.totp_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.totp_credentials FORCE ROW LEVEL SECURITY;

GRANT SELECT ON auth.totp_credentials TO erp_auth_pipeline;
GRANT UPDATE (last_used_step, updated_at) ON auth.totp_credentials TO erp_auth_pipeline;
CREATE POLICY totp_credentials_auth_pipeline_full_access ON auth.totp_credentials
  TO erp_auth_pipeline USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON auth.totp_credentials TO erp_identity_runtime;
-- last_used_step is included for the same reason as webauthn's
-- counter/last_used_at above: verifyTotpCode is shared code also called by
-- completeStepUp's PASSWORD_TOTP method under erp_identity_runtime.
GRANT UPDATE (confirmed_at, revoked_at, updated_at, last_used_step) ON auth.totp_credentials TO erp_identity_runtime;
CREATE POLICY totp_credentials_self_service ON auth.totp_credentials
  TO erp_identity_runtime
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- =======================================================================
-- auth.recovery_codes
-- =======================================================================
ALTER TABLE auth.recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.recovery_codes FORCE ROW LEVEL SECURITY;

GRANT SELECT ON auth.recovery_codes TO erp_auth_pipeline;
GRANT UPDATE (used_at) ON auth.recovery_codes TO erp_auth_pipeline;
CREATE POLICY recovery_codes_auth_pipeline_full_access ON auth.recovery_codes
  TO erp_auth_pipeline USING (true) WITH CHECK (true);

-- UPDATE (used_at) is included for the same reason: consumeRecoveryCodeIfValid
-- is shared code also called by completeStepUp's RECOVERY_CODE method under
-- erp_identity_runtime.
GRANT SELECT, INSERT, UPDATE (used_at) ON auth.recovery_codes TO erp_identity_runtime;
CREATE POLICY recovery_codes_self_service ON auth.recovery_codes
  TO erp_identity_runtime
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- =======================================================================
-- auth.sessions - creation/rotation during login is erp_auth_pipeline
-- (session doesn't exist yet to scope by); self-service list/revoke of an
-- ALREADY-established session is erp_identity_runtime, scoped by owner.
-- =======================================================================
ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.sessions FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON auth.sessions TO erp_auth_pipeline;
GRANT UPDATE (
  token_hash, security_stamp, assurance_level, authenticated_at, last_step_up_at,
  last_step_up_purpose, last_seen_at, expires_at, inactivity_expires_at, revoked_at, revocation_reason
) ON auth.sessions TO erp_auth_pipeline;
CREATE POLICY sessions_auth_pipeline_full_access ON auth.sessions
  TO erp_auth_pipeline USING (true) WITH CHECK (true);

GRANT SELECT ON auth.sessions TO erp_identity_runtime;
-- assurance_level/last_step_up_at/last_step_up_purpose are included because
-- completeStepUp (an authenticated self-service action) upgrades the
-- CALLER's own current session's assurance in place via upgradeSessionAssurance.
GRANT UPDATE (revoked_at, revocation_reason, last_seen_at, assurance_level, last_step_up_at, last_step_up_purpose) ON auth.sessions TO erp_identity_runtime;
CREATE POLICY sessions_self_service ON auth.sessions
  TO erp_identity_runtime
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- =======================================================================
-- auth.verification_tokens / auth.password_reset_tokens /
-- auth.webauthn_challenges - capability-token tables, erp_auth_pipeline
-- only (same reasoning as user_invitations).
-- =======================================================================
ALTER TABLE auth.verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.verification_tokens FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON auth.verification_tokens TO erp_auth_pipeline;
GRANT UPDATE (consumed_at) ON auth.verification_tokens TO erp_auth_pipeline;
CREATE POLICY verification_tokens_auth_pipeline_full_access ON auth.verification_tokens
  TO erp_auth_pipeline USING (true) WITH CHECK (true);

ALTER TABLE auth.password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.password_reset_tokens FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON auth.password_reset_tokens TO erp_auth_pipeline;
GRANT UPDATE (consumed_at, invalidated_at) ON auth.password_reset_tokens TO erp_auth_pipeline;
CREATE POLICY password_reset_tokens_auth_pipeline_full_access ON auth.password_reset_tokens
  TO erp_auth_pipeline USING (true) WITH CHECK (true);

ALTER TABLE auth.webauthn_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.webauthn_challenges FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON auth.webauthn_challenges TO erp_auth_pipeline;
GRANT UPDATE (consumed_at) ON auth.webauthn_challenges TO erp_auth_pipeline;
CREATE POLICY webauthn_challenges_auth_pipeline_full_access ON auth.webauthn_challenges
  TO erp_auth_pipeline USING (true) WITH CHECK (true);
-- erp_identity_runtime also needs webauthn_challenges for a REGISTRATION
-- ceremony (adding a new passkey) started from an already-authenticated
-- session - scoped to the known user.
GRANT SELECT, INSERT ON auth.webauthn_challenges TO erp_identity_runtime;
GRANT UPDATE (consumed_at) ON auth.webauthn_challenges TO erp_identity_runtime;
CREATE POLICY webauthn_challenges_self_service ON auth.webauthn_challenges
  TO erp_identity_runtime
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- =======================================================================
-- auth.step_up_tokens - always issued/consumed inside an authenticated
-- session, so this is purely erp_identity_runtime's, scoped by owner.
-- =======================================================================
ALTER TABLE auth.step_up_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.step_up_tokens FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON auth.step_up_tokens TO erp_identity_runtime;
GRANT UPDATE (revoked_at) ON auth.step_up_tokens TO erp_identity_runtime;
CREATE POLICY step_up_tokens_self_service ON auth.step_up_tokens
  TO erp_identity_runtime
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- =======================================================================
-- auth.authentication_attempts - append-only rate-limit bookkeeping,
-- written before any account is known to exist; no RLS makes sense here.
-- =======================================================================
GRANT SELECT, INSERT ON auth.authentication_attempts TO erp_auth_pipeline;
