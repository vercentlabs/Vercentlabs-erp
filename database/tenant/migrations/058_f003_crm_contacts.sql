BEGIN;

-- tenant.contacts is the shared Contact entity used by CRM, Sales and master
-- data. F003 extends it in place instead of introducing a parallel CRM table.
ALTER TABLE tenant.contacts
  ALTER COLUMN party_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'tenant.contacts'::regclass
      AND conname = 'contacts_reachability_check'
  ) THEN
    ALTER TABLE tenant.contacts
      ADD CONSTRAINT contacts_reachability_check CHECK (
        NULLIF(btrim(email), '') IS NOT NULL
        OR NULLIF(btrim(mobile), '') IS NOT NULL
        OR NULLIF(btrim(phone), '') IS NOT NULL
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'tenant.contacts'::regclass
      AND conname = 'contacts_standalone_not_primary_check'
  ) THEN
    ALTER TABLE tenant.contacts
      ADD CONSTRAINT contacts_standalone_not_primary_check
      CHECK (party_id IS NOT NULL OR is_primary = false) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS contacts_lifecycle_idx
  ON tenant.contacts(organization_id, status, updated_at DESC, id);

CREATE INDEX IF NOT EXISTS contacts_account_lifecycle_idx
  ON tenant.contacts(organization_id, party_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS contacts_identity_search_idx
  ON tenant.contacts USING gin (
    to_tsvector(
      'simple',
      coalesce(first_name, '') || ' ' ||
      coalesce(last_name, '') || ' ' ||
      coalesce(designation, '') || ' ' ||
      coalesce(email, '') || ' ' ||
      coalesce(mobile, '') || ' ' ||
      coalesce(phone, '')
    )
  );

COMMIT;
