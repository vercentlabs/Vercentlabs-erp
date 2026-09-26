BEGIN;

-- OAuth connections (Prompt 5): Authorization Code + PKCE (S256) against
-- registered connection profiles, with a server-owned callback URI.
--   oauth_states.encrypted_code_verifier  the PKCE verifier, AES-256-GCM
--       encrypted (token redemption needs the verifier itself, so it cannot be
--       a hash); cleared when the attempt is consumed.
--   oauth_states.return_path  an internal relative path to land on afterwards.
-- Attempts started before this migration have no verifier and cannot finish
-- (they expire within 10 minutes anyway).
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS profile_key text;
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS encrypted_code_verifier jsonb;
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS return_path text;

-- Connections record which registered profile they were made for. Rows from
-- before profiles existed are marked 'legacy' (their stored scopes stay as
-- they were) and the UI asks for a reconnect; they are never reinterpreted.
ALTER TABLE oauth_connections ADD COLUMN IF NOT EXISTS profile_key text;
UPDATE oauth_connections SET profile_key = 'legacy' WHERE profile_key IS NULL;
ALTER TABLE oauth_connections ALTER COLUMN profile_key SET NOT NULL;
ALTER TABLE oauth_connections ADD COLUMN IF NOT EXISTS last_refreshed_at timestamptz;
ALTER TABLE oauth_connections ADD COLUMN IF NOT EXISTS last_error_at timestamptz;

ALTER TABLE oauth_connections DROP CONSTRAINT IF EXISTS oauth_connections_status_check;
ALTER TABLE oauth_connections ADD CONSTRAINT oauth_connections_status_check
  CHECK (status IN ('active', 'expired', 'revoked', 'error', 'reconnect_required'));

COMMIT;
