BEGIN;

-- Developer API (Prompt 5): a developer app is the external integration; its
-- API keys are credentials. One app holds several keys (rotation), revoking
-- the app revokes every key, and nothing is ever hard-deleted.
ALTER TABLE developer_apps ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE developer_apps ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE developer_apps ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Every key belongs to an app (each older key without one gets its own).
WITH orphan AS (
  SELECT id, organization_id, name, created_by, created_at, gen_random_uuid() AS app_id
    FROM api_keys WHERE developer_app_id IS NULL
), created AS (
  INSERT INTO developer_apps (id, organization_id, name, description, status, created_by, created_at)
  SELECT app_id, organization_id, name, 'Created for an API key issued before developer apps.', 'active', created_by, created_at FROM orphan
  RETURNING id
)
UPDATE api_keys key SET developer_app_id = orphan.app_id FROM orphan WHERE key.id = orphan.id;
ALTER TABLE api_keys ALTER COLUMN developer_app_id SET NOT NULL;

-- Scopes come from the platform API scope catalogue. "*" used to grant every
-- scope that would ever exist; a wildcard key is converted to an explicit
-- snapshot of the scopes registered today, so it keeps its current access but
-- gains nothing in future. (Unknown old scope strings stay for history and
-- grant nothing.) New wildcard keys are impossible.
UPDATE api_keys
   SET scopes = ARRAY(SELECT DISTINCT scope FROM unnest(array_remove(scopes, '*') || ARRAY['platform.context.read']) AS scope ORDER BY scope)
 WHERE '*' = ANY(scopes);
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_no_wildcard_scope;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_no_wildcard_scope CHECK (NOT ('*' = ANY(scopes)));

-- Authentication looks a key up by its hash alone.
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_uidx ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS api_keys_app_idx ON api_keys (organization_id, developer_app_id, created_at DESC);

COMMIT;
