-- SP005/SP007: the short-lived token that bridges a successful first
-- authentication factor (password) to a still-pending second factor
-- (TOTP/WebAuthn/recovery code). Deliberately its own table, not reused
-- from auth.webauthn_challenges (which is WebAuthn-ceremony-specific) or
-- auth.sessions (a real session must not exist until MFA actually
-- completes - see docs/architecture/authentication-flows.md).
CREATE TABLE auth.mfa_login_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users (id),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mfa_login_tokens_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX mfa_login_tokens_user_id_idx ON auth.mfa_login_tokens (user_id);

COMMENT ON TABLE auth.mfa_login_tokens IS
  'SP005/SP007 bridges first-factor success to second-factor completion. Hashed, single-use, short-lived (see session-policy.ts mfaTokenTimeoutMs). No session exists until this is consumed.';

ALTER TABLE auth.mfa_login_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.mfa_login_tokens FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON auth.mfa_login_tokens TO erp_auth_pipeline;
GRANT UPDATE (consumed_at) ON auth.mfa_login_tokens TO erp_auth_pipeline;
CREATE POLICY mfa_login_tokens_auth_pipeline_full_access ON auth.mfa_login_tokens
  TO erp_auth_pipeline USING (true) WITH CHECK (true);
