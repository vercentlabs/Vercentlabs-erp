BEGIN;

-- SP007 (MFA, account recovery and step-up authentication). users.mfa_required
-- and users.mfa_enrolled_at have existed since migration 002 as pure state
-- flags -- no secret storage, no verification, no recovery path, and no
-- code anywhere reads or writes them (confirmed by repository search before
-- writing this migration). This migration adds the actual TOTP (RFC 6238)
-- enrollment/verification/recovery schema; services/api/src/core/mfa.js
-- is the real behavior on top of it.

-- Active secret (set once enrollment is confirmed) and a separate pending
-- secret (set during enrollment, before the user proves they can generate
-- a valid code with it) -- kept apart so an abandoned enrollment attempt
-- can never silently become the active factor, and so a pending attempt
-- has its own short expiry independent of the active secret's lifetime.
-- Both are AES-256-GCM envelopes (services/api/src/core/oauth.js's existing
-- encryptIntegrationCredentials/decryptIntegrationCredentials shape,
-- reused rather than inventing a second encryption scheme for the same
-- INTEGRATION_TOKEN_ENCRYPTION_KEY-derived key), never plaintext.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_secret_encrypted jsonb,
  ADD COLUMN IF NOT EXISTS mfa_pending_secret_encrypted jsonb,
  ADD COLUMN IF NOT EXISTS mfa_pending_secret_expires_at timestamptz;

-- Organization-enforced MFA (SP007's "Organization-enforced MFA"): when
-- true, every member of this organization is treated as mfa_required
-- regardless of their own users.mfa_required flag -- see
-- resolveSessionContext's mfa_required_effective computation in
-- services/api/src/core/session.js.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS mfa_enforced boolean NOT NULL DEFAULT false;

-- Per-session step-up state. A session is created at login exactly as
-- before (this migration does not touch that flow); mfa_verified_at stays
-- NULL until the MFA step completes for THIS session, the same "session
-- exists but has an unmet follow-up requirement" pattern
-- email_verified_at/requireVerifiedUser already uses -- not a separate
-- pre-session challenge-token system, so every existing session
-- capability (listing, revocation, device naming, idle/absolute expiry)
-- keeps working unchanged for MFA'd users too.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS mfa_verified_at timestamptz;

-- Single-use recovery codes, hashed the same way password_reset_tokens/
-- email_verification_tokens already hash their tokens (sha256 via
-- session.js's tokenHash -- fast hash is correct here: these are
-- high-entropy random codes, not low-entropy human-chosen passwords, so
-- scrypt's memory-hardness buys nothing and only slows down the hot path).
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);
CREATE INDEX IF NOT EXISTS mfa_recovery_codes_active_idx
  ON mfa_recovery_codes(user_id) WHERE used_at IS NULL;

INSERT INTO permissions (key, name, category, description) VALUES
  ('platform.security.manage', 'Manage organization security policy', 'Platform', 'Enforce organization-wide MFA and other shared security policy.')
ON CONFLICT (key) DO UPDATE SET
  name=EXCLUDED.name, category=EXCLUDED.category, description=EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_key)
SELECT role.id, 'platform.security.manage'
FROM roles role
WHERE role.slug IN ('organization_owner','system_administrator')
ON CONFLICT DO NOTHING;

-- Same convention migration 035 established: company_administrator gets
-- every other platform.*.manage permission EXCEPT organisation/system-level
-- governance ones -- keep this one out too, consistent with
-- packages/permissions/src/roles.js's own exclusion list for that role.
DELETE FROM role_permissions rp
USING roles role
WHERE rp.role_id=role.id
  AND role.slug='company_administrator'
  AND rp.permission_key = 'platform.security.manage';

COMMIT;
