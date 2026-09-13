-- Prompt 002B: SP005 credential-stuffing/rate-limit bookkeeping.
--
-- Deliberately separate from audit.audit_events: this table exists to
-- answer one narrow, latency-sensitive question fast ("how many failed
-- attempts for this identity/IP in the last N minutes") and is written on
-- EVERY attempt, including against an unknown email address - it must
-- never require knowing whether the account exists, so it cannot live
-- inside identity.users or reference it with a NOT NULL foreign key.
CREATE TABLE auth.authentication_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identity_key TEXT NOT NULL,
  ip_address TEXT,
  outcome TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT authentication_attempts_outcome_check CHECK (outcome IN (
    'SUCCESS', 'INVALID_CREDENTIALS', 'UNKNOWN_ACCOUNT', 'SUSPENDED',
    'DEACTIVATED', 'UNVERIFIED_EMAIL', 'RATE_LIMITED', 'MFA_REQUIRED', 'MFA_FAILED'
  ))
);

-- Supports "count recent attempts for this identity" and "...for this IP"
-- as fast range scans rather than full-table scans.
CREATE INDEX authentication_attempts_identity_key_occurred_at_idx
  ON auth.authentication_attempts (identity_key, occurred_at DESC);
CREATE INDEX authentication_attempts_ip_address_occurred_at_idx
  ON auth.authentication_attempts (ip_address, occurred_at DESC);

COMMENT ON TABLE auth.authentication_attempts IS
  'SP005 rate-limit/lockout bookkeeping, append-only, written on every login attempt regardless of whether the account exists. identity_key is the normalized email attempted, never a password or token. Lockout is a computed, time-windowed read over this table, never a persisted lifecycle status on identity.users.';
