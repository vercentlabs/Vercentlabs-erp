BEGIN;

-- F008 comparison text keeps international letters and punctuation intact;
-- only case and whitespace are normalized. Display values remain unchanged.
CREATE OR REPLACE FUNCTION tenant.crm_normalize_comparison_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(lower(regexp_replace(btrim(COALESCE(value, '')), '[[:space:]]+', ' ', 'g')), '')
$$;

ALTER TABLE tenant.crm_leads
  ADD COLUMN IF NOT EXISTS normalized_mobile text
    GENERATED ALWAYS AS (tenant.crm_normalize_phone(mobile)) STORED,
  ADD COLUMN IF NOT EXISTS normalized_business_phone text
    GENERATED ALWAYS AS (tenant.crm_normalize_phone(phone)) STORED,
  ADD COLUMN IF NOT EXISTS normalized_name text
    GENERATED ALWAYS AS (
      tenant.crm_normalize_comparison_text(
        btrim(first_name || ' ' || COALESCE(last_name, ''))
      )
    ) STORED,
  ADD COLUMN IF NOT EXISTS normalized_company_name text
    GENERATED ALWAYS AS (tenant.crm_normalize_comparison_text(company_name)) STORED;

-- These indexes cover every deterministic F008 predicate. They deliberately
-- include archived and converted Leads: retention state is useful evidence,
-- not a reason for identity to disappear.
CREATE INDEX IF NOT EXISTS crm_leads_f008_email_idx
  ON tenant.crm_leads(organization_id, normalized_email, record_status)
  WHERE normalized_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_leads_f008_mobile_idx
  ON tenant.crm_leads(organization_id, normalized_mobile, record_status)
  WHERE normalized_mobile IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_leads_f008_business_phone_idx
  ON tenant.crm_leads(organization_id, normalized_business_phone, record_status)
  WHERE normalized_business_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_leads_f008_name_company_idx
  ON tenant.crm_leads(
    organization_id, normalized_name, normalized_company_name, record_status
  )
  WHERE normalized_name IS NOT NULL AND normalized_company_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.crm_lead_duplicate_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  matched_lead_ids uuid[] NOT NULL,
  reason text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('create','update')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, lead_id)
    REFERENCES tenant.crm_leads(organization_id, id) ON DELETE RESTRICT,
  CHECK (cardinality(matched_lead_ids) > 0),
  CHECK (length(btrim(reason)) BETWEEN 10 AND 1000)
);

CREATE INDEX IF NOT EXISTS crm_lead_duplicate_overrides_lead_idx
  ON tenant.crm_lead_duplicate_overrides(organization_id, lead_id, created_at DESC);

CREATE OR REPLACE FUNCTION tenant.crm_lead_duplicate_override_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Lead duplicate override history is immutable';
END;
$$;
DROP TRIGGER IF EXISTS crm_lead_duplicate_overrides_immutable
  ON tenant.crm_lead_duplicate_overrides;
CREATE TRIGGER crm_lead_duplicate_overrides_immutable
BEFORE UPDATE OR DELETE ON tenant.crm_lead_duplicate_overrides
FOR EACH ROW EXECUTE FUNCTION tenant.crm_lead_duplicate_override_immutable();

ALTER TABLE tenant.crm_lead_duplicate_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_duplicate_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation
  ON tenant.crm_lead_duplicate_overrides;
CREATE POLICY tenant_organization_isolation
  ON tenant.crm_lead_duplicate_overrides
  USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
  )
  WITH CHECK (
    organization_id = current_setting('app.current_organization_id', true)::uuid
  );

COMMENT ON FUNCTION tenant.crm_normalize_comparison_text(text)
  IS 'Canonical F008 case/whitespace comparison normalization; preserves international identity characters.';
COMMENT ON TABLE tenant.crm_lead_duplicate_overrides
  IS 'Immutable F008 audit ledger for explicitly authorized exact-duplicate Lead overrides.';

COMMIT;
