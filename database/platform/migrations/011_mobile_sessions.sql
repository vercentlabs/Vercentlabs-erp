BEGIN;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS session_type text NOT NULL DEFAULT 'browser',
  ADD COLUMN IF NOT EXISTS refresh_token_hash text,
  ADD COLUMN IF NOT EXISTS refresh_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS refresh_family_id uuid,
  ADD COLUMN IF NOT EXISTS device_id uuid,
  ADD COLUMN IF NOT EXISTS device_platform text,
  ADD COLUMN IF NOT EXISTS app_version text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'sessions'::regclass
      AND conname = 'sessions_session_type_check'
  ) THEN
    ALTER TABLE sessions
      ADD CONSTRAINT sessions_session_type_check
      CHECK (session_type IN ('browser', 'mobile')) NOT VALID;
  END IF;
END $$;
ALTER TABLE sessions VALIDATE CONSTRAINT sessions_session_type_check;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_refresh_token_hash_uidx
  ON sessions(refresh_token_hash)
  WHERE refresh_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS sessions_mobile_user_idx
  ON sessions(user_id, last_seen_at DESC)
  WHERE session_type = 'mobile' AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_mobile_refresh_expiry_idx
  ON sessions(refresh_expires_at)
  WHERE session_type = 'mobile' AND revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_mobile_device_uidx
  ON sessions(user_id, device_id)
  WHERE session_type = 'mobile' AND revoked_at IS NULL AND device_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS mobile_refresh_token_history (
  token_hash text PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS mobile_refresh_history_expiry_idx
  ON mobile_refresh_token_history(expires_at);

CREATE TABLE IF NOT EXISTS mobile_idempotency_keys (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_method text NOT NULL,
  request_path text NOT NULL,
  request_hash text NOT NULL,
  response_status integer,
  response_body jsonb,
  locked_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS mobile_idempotency_expiry_idx
  ON mobile_idempotency_keys(expires_at);

-- Membership and scope changes already call this function. Redefining it keeps
-- native sessions under the same immediate revocation guarantee as web sessions.
CREATE OR REPLACE FUNCTION revoke_sessions_after_access_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected_user_id uuid;
BEGIN
  affected_user_id := COALESCE(NEW.user_id, OLD.user_id);
  UPDATE sessions
  SET revoked_at = COALESCE(revoked_at, now()),
      revoked_reason = COALESCE(revoked_reason, 'access_changed')
  WHERE user_id = affected_user_id
    AND revoked_at IS NULL;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION revoke_sessions_after_access_change() FROM PUBLIC;

COMMIT;
