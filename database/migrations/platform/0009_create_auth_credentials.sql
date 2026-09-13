-- Prompt 002B: SP005 credential storage, SP007 MFA authenticator storage.
CREATE SCHEMA IF NOT EXISTS auth;

-- ---------------------------------------------------------------------
-- auth.password_credentials - Argon2id PHC-formatted hash strings
-- (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`), which already carry the
-- algorithm and every parameter needed to detect "policy has since
-- increased, rehash on next successful login" - no separate params column
-- needed. One row per user (a user has at most one password credential).
-- ---------------------------------------------------------------------
CREATE TABLE auth.password_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES identity.users (id),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT password_credentials_version_positive_check CHECK (version >= 1)
);

COMMENT ON TABLE auth.password_credentials IS
  'SP005 Argon2id password hash storage. password_hash is a full PHC-format string; never logged, never returned by any API.';

-- ---------------------------------------------------------------------
-- auth.webauthn_credentials - public key material only, never a private
-- key (the authenticator never releases its private key at all).
-- ---------------------------------------------------------------------
CREATE TABLE auth.webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users (id),
  credential_id TEXT NOT NULL,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  device_type TEXT,
  backed_up BOOLEAN NOT NULL DEFAULT false,
  transports TEXT[],
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT webauthn_credentials_credential_id_key UNIQUE (credential_id),
  CONSTRAINT webauthn_credentials_name_not_blank_check CHECK (btrim(name) <> '')
);

CREATE INDEX webauthn_credentials_user_id_idx ON auth.webauthn_credentials (user_id);

COMMENT ON TABLE auth.webauthn_credentials IS
  'SP007 WebAuthn/passkey public credential material. Soft-revoked (revoked_at), never physically deleted, so registration/use/removal audit history stays queryable against a real row.';

-- ---------------------------------------------------------------------
-- auth.totp_credentials - secret is encrypted at rest via a versioned
-- key-provider abstraction (key_version), never stored or logged in
-- plaintext once enrollment is confirmed.
-- ---------------------------------------------------------------------
CREATE TABLE auth.totp_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES identity.users (id),
  secret_ciphertext BYTEA NOT NULL,
  secret_iv BYTEA NOT NULL,
  secret_auth_tag BYTEA NOT NULL,
  key_version INTEGER NOT NULL,
  confirmed_at TIMESTAMPTZ,
  last_used_step BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

COMMENT ON TABLE auth.totp_credentials IS
  'SP007 TOTP secret, AES-256-GCM-encrypted at rest (key_version selects the encryption key from a versioned provider - see packages/database/src/totp-secret-cipher.ts). confirmed_at is NULL until the enrollment code is verified; last_used_step blocks replay of an already-accepted timestep.';

-- ---------------------------------------------------------------------
-- auth.recovery_codes - single-use, hashed (fast hash - these are
-- high-entropy random values, not human-chosen passwords, so Argon2id's
-- deliberate slowness is unnecessary; see docs/security/mfa-and-recovery.md).
-- ---------------------------------------------------------------------
CREATE TABLE auth.recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users (id),
  code_hash TEXT NOT NULL,
  generation_batch_id UUID NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recovery_codes_code_hash_key UNIQUE (code_hash)
);

CREATE INDEX recovery_codes_user_id_idx ON auth.recovery_codes (user_id);
CREATE INDEX recovery_codes_generation_batch_id_idx ON auth.recovery_codes (generation_batch_id);

COMMENT ON TABLE auth.recovery_codes IS
  'SP007 single-use MFA recovery codes, SHA-256 hashed. Regenerating a batch invalidates every unused code from every earlier batch (see platform/identity recovery-code commands), not just the immediately preceding one.';
