BEGIN;

-- F006 gap: evaluateLeadQualificationReadiness's readiness checklist (which
-- fields are required/recommended before a Lead can be marked qualified)
-- was hardcoded in JS, with no admin-configurable criteria/playbook system,
-- despite the dossier explicitly requiring one. This table lets an
-- organization add, reorder, retire or add new criteria without a code
-- change. check_type is deliberately small (two shapes cover every
-- existing rule): 'non_empty_any' passes if at least one of field_keys is
-- non-empty (covers the single-field cases like "Company", and the
-- OR-combination "Contact method" = email/mobile/phone); 'positive_number'
-- passes if field_keys[0] is a number greater than zero (covers "Estimated
-- value"). New check types can be added later without touching this shape.
CREATE TABLE IF NOT EXISTS tenant.crm_lead_qualification_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  criterion_key text NOT NULL,
  label text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('required', 'recommended')),
  check_type text NOT NULL CHECK (check_type IN ('non_empty_any', 'positive_number')),
  field_keys text[] NOT NULL CHECK (cardinality(field_keys) > 0),
  sequence integer NOT NULL DEFAULT 100 CHECK (sequence > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, criterion_key)
);

CREATE INDEX IF NOT EXISTS crm_lead_qualification_criteria_active_idx
  ON tenant.crm_lead_qualification_criteria(organization_id, status, sequence);

ALTER TABLE tenant.crm_lead_qualification_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_qualification_criteria FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_lead_qualification_criteria;
CREATE POLICY tenant_organization_isolation ON tenant.crm_lead_qualification_criteria
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());

-- Backfill: every existing organization gets exactly the criteria the
-- hardcoded checklist already enforced, so this migration changes nothing
-- about current behavior until an admin actually edits the configuration.
INSERT INTO tenant.crm_lead_qualification_criteria
  (organization_id, criterion_key, label, tier, check_type, field_keys, sequence)
SELECT id, 'identity', 'Lead identity', 'required', 'non_empty_any', ARRAY['firstName'], 10 FROM public.organizations
UNION ALL
SELECT id, 'contact', 'Contact method', 'required', 'non_empty_any', ARRAY['email', 'mobile', 'phone'], 20 FROM public.organizations
UNION ALL
SELECT id, 'company', 'Company', 'recommended', 'non_empty_any', ARRAY['companyName'], 30 FROM public.organizations
UNION ALL
SELECT id, 'job_title', 'Job title', 'recommended', 'non_empty_any', ARRAY['jobTitle'], 40 FROM public.organizations
UNION ALL
SELECT id, 'product_interest', 'Product interest', 'recommended', 'non_empty_any', ARRAY['productInterest'], 50 FROM public.organizations
UNION ALL
SELECT id, 'estimated_value', 'Estimated value', 'recommended', 'positive_number', ARRAY['estimatedValue'], 60 FROM public.organizations
UNION ALL
SELECT id, 'source', 'Lead source', 'recommended', 'non_empty_any', ARRAY['sourceId'], 70 FROM public.organizations
ON CONFLICT (organization_id, criterion_key) DO NOTHING;

-- Same defaults for every organization created after this migration.
CREATE OR REPLACE FUNCTION tenant.crm_seed_lead_qualification_criteria_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = tenant, public
AS $$
BEGIN
  INSERT INTO tenant.crm_lead_qualification_criteria
    (organization_id, criterion_key, label, tier, check_type, field_keys, sequence, created_by, updated_by)
  VALUES
    (NEW.id, 'identity', 'Lead identity', 'required', 'non_empty_any', ARRAY['firstName'], 10, NEW.created_by, NEW.created_by),
    (NEW.id, 'contact', 'Contact method', 'required', 'non_empty_any', ARRAY['email', 'mobile', 'phone'], 20, NEW.created_by, NEW.created_by),
    (NEW.id, 'company', 'Company', 'recommended', 'non_empty_any', ARRAY['companyName'], 30, NEW.created_by, NEW.created_by),
    (NEW.id, 'job_title', 'Job title', 'recommended', 'non_empty_any', ARRAY['jobTitle'], 40, NEW.created_by, NEW.created_by),
    (NEW.id, 'product_interest', 'Product interest', 'recommended', 'non_empty_any', ARRAY['productInterest'], 50, NEW.created_by, NEW.created_by),
    (NEW.id, 'estimated_value', 'Estimated value', 'recommended', 'positive_number', ARRAY['estimatedValue'], 60, NEW.created_by, NEW.created_by),
    (NEW.id, 'source', 'Lead source', 'recommended', 'non_empty_any', ARRAY['sourceId'], 70, NEW.created_by, NEW.created_by);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_seed_lead_qualification_criteria_defaults ON public.organizations;
CREATE TRIGGER crm_seed_lead_qualification_criteria_defaults AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION tenant.crm_seed_lead_qualification_criteria_defaults();

COMMIT;
