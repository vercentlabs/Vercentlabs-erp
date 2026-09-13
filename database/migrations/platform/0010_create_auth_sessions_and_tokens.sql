-- Prompt 002B: SP006 session/device security, SP007 step-up evidence and
-- the short-lived capability tokens SP005/SP007 issue (email verification,
-- password reset, WebAuthn challenges).

-- ---------------------------------------------------------------------
-- auth.sessions - opaque server-side session. Only a hash of the raw
-- token is ever stored; the raw token is shown to the client exactly once
-- (at creation) and never persisted anywhere.
-- ---------------------------------------------------------------------
CREATE TABLE auth.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users (id),
  token_hash TEXT NOT NULL,
  -- The security_stamp captured from identity.users at session-creation
  -- time. A live comparison against the user's *current* stamp on every
  -- validation is what makes a password change/MFA reset/suspension
  -- implicitly invalidate every session derived from before that change,
  -- even one this code forgot to explicitly revoke - defense in depth
  -- alongside the explicit revoked_at column.
  security_stamp UUID NOT NULL,
  organization_id UUID,
  assurance_level TEXT NOT NULL DEFAULT 'AAL1',
  authenticated_at TIMESTAMPTZ NOT NULL,
  last_step_up_at TIMESTAMPTZ,
  last_step_up_purpose TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  inactivity_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  ip_address TEXT,
  user_agent TEXT,
  device_label TEXT,
  CONSTRAINT auth_sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT auth_sessions_assurance_level_check CHECK (assurance_level IN ('AAL1', 'AAL2'))
);

CREATE INDEX auth_sessions_user_id_idx ON auth.sessions (user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth.sessions (expires_at);

COMMENT ON TABLE auth.sessions IS
  'SP006 opaque server-side sessions. token_hash is SHA-256 of the raw cookie value; the raw value is never stored. device_label/ip_address/user_agent are conservative, non-unique-fingerprint device info only.';

-- ---------------------------------------------------------------------
-- auth.verification_tokens - email verification and email-change
-- confirmation. Same capability-token trust model as password reset.
-- ---------------------------------------------------------------------
CREATE TABLE auth.verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users (id),
  email_address_id UUID NOT NULL REFERENCES identity.user_email_addresses (id),
  purpose TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT verification_tokens_token_hash_key UNIQUE (token_hash),
  CONSTRAINT verification_tokens_purpose_check CHECK (purpose IN ('EMAIL_VERIFY', 'EMAIL_CHANGE'))
);

CREATE INDEX verification_tokens_user_id_idx ON auth.verification_tokens (user_id);

COMMENT ON TABLE auth.verification_tokens IS
  'SP004/SP005 email verification and email-change confirmation tokens. Hashed at rest, single-use (consumed_at), expiring.';

-- ---------------------------------------------------------------------
-- auth.password_reset_tokens
-- ---------------------------------------------------------------------
CREATE TABLE auth.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users (id),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX password_reset_tokens_user_id_idx ON auth.password_reset_tokens (user_id);

COMMENT ON TABLE auth.password_reset_tokens IS
  'SP005 password reset tokens, hashed, single-use, expiring. Requesting a new token invalidates every earlier unconsumed token for that user (invalidated_at) in the same transaction - only the newest request is ever valid.';

-- ---------------------------------------------------------------------
-- auth.webauthn_challenges - short-lived, single-use, bound to purpose.
-- user_id is nullable: an authentication ceremony may begin before the
-- user is identified (a discoverable-credential flow); registration and
-- step-up ceremonies always have a known user.
-- ---------------------------------------------------------------------
CREATE TABLE auth.webauthn_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES identity.users (id),
  session_id UUID REFERENCES auth.sessions (id),
  purpose TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT webauthn_challenges_purpose_check
    CHECK (purpose IN ('REGISTRATION', 'AUTHENTICATION', 'STEP_UP'))
);

CREATE INDEX webauthn_challenges_user_id_idx ON auth.webauthn_challenges (user_id);
CREATE INDEX webauthn_challenges_expires_at_idx ON auth.webauthn_challenges (expires_at);

COMMENT ON TABLE auth.webauthn_challenges IS
  'SP007 WebAuthn ceremony challenges. Bound to user/session/purpose where known; single-use (consumed_at); short expiry enforced at the application layer on every validation.';

-- ---------------------------------------------------------------------
-- auth.step_up_tokens - reusable within a short window for the SAME
-- session + purpose, revoked immediately if the user's security_stamp
-- changes (checked at use time, not persisted redundantly here).
-- ---------------------------------------------------------------------
CREATE TABLE auth.step_up_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES auth.sessions (id),
  user_id UUID NOT NULL REFERENCES identity.users (id),
  purpose TEXT NOT NULL,
  method TEXT NOT NULL,
  assurance_level TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT step_up_tokens_method_check
    CHECK (method IN ('PASSWORD_TOTP', 'WEBAUTHN', 'RECOVERY_CODE')),
  CONSTRAINT step_up_tokens_purpose_check CHECK (purpose IN (
    'tenant_lifecycle_change', 'company_closure', 'user_suspension_deactivation',
    'role_permission_change', 'mfa_removal_reset', 'password_change',
    'session_revocation_of_another_user', 'api_credential_management',
    'billing_change', 'payroll_approval', 'financial_close'
  ))
);

CREATE INDEX step_up_tokens_session_id_idx ON auth.step_up_tokens (session_id);
CREATE INDEX step_up_tokens_user_id_idx ON auth.step_up_tokens (user_id);

COMMENT ON TABLE auth.step_up_tokens IS
  'SP007 step-up authentication grants. Short-lived and bound to a session + action-category purpose; validity is also conditioned on identity.users.security_stamp still matching at use time. Authentication assurance only - never itself an authorization decision.';
