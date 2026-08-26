BEGIN;

ALTER TABLE tenant.business_parties
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'tenant.business_parties'::regclass
      AND conname = 'business_parties_website_scheme_check'
  ) THEN
    ALTER TABLE tenant.business_parties
      ADD CONSTRAINT business_parties_website_scheme_check
      CHECK (website IS NULL OR website ~* '^https?://') NOT VALID;
  END IF;
END $$;

ALTER TABLE tenant.business_parties
  VALIDATE CONSTRAINT business_parties_website_scheme_check;

CREATE INDEX IF NOT EXISTS business_parties_crm_account_list_idx
  ON tenant.business_parties (
    organization_id,
    company_id,
    status,
    updated_at DESC,
    id
  )
  WHERE party_type IN ('customer', 'both', 'prospect');

CREATE INDEX IF NOT EXISTS business_parties_crm_account_identity_search_idx
  ON tenant.business_parties USING gin (
    to_tsvector(
      'simple',
      coalesce(code, '') || ' ' ||
      coalesce(display_name, '') || ' ' ||
      coalesce(legal_name, '') || ' ' ||
      coalesce(industry, '') || ' ' ||
      coalesce(website, '') || ' ' ||
      coalesce(phone, '') || ' ' ||
      coalesce(email, '')
    )
  )
  WHERE party_type IN ('customer', 'both', 'prospect');

CREATE INDEX IF NOT EXISTS addresses_crm_account_location_search_idx
  ON tenant.addresses (
    organization_id,
    party_id,
    status,
    is_primary DESC,
    city,
    country_code
  );

COMMIT;
