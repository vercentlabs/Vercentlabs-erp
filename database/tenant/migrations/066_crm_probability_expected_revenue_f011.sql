BEGIN;

-- F011 Probability and Expected Revenue. Probability stays on the canonical
-- Opportunity row; expected revenue is generated so every write path (amount
-- edit, probability override, stage move) stays mathematically consistent.
ALTER TABLE tenant.crm_opportunities
  ADD COLUMN IF NOT EXISTS expected_revenue numeric(18,2)
    GENERATED ALWAYS AS (round((amount * probability / 100)::numeric, 2)) STORED;

CREATE INDEX IF NOT EXISTS crm_opportunities_f011_forecast_idx
  ON tenant.crm_opportunities(organization_id,company_id,branch_id,owner_user_id,status,expected_close_date,expected_revenue DESC);

CREATE TABLE IF NOT EXISTS tenant.crm_opportunity_probability_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  from_probability numeric(5,2) NOT NULL CHECK (from_probability BETWEEN 0 AND 100),
  to_probability numeric(5,2) NOT NULL CHECK (to_probability BETWEEN 0 AND 100),
  expected_revenue numeric(18,2) NOT NULL CHECK (expected_revenue >= 0),
  note text,
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,opportunity_id)
    REFERENCES tenant.crm_opportunities(organization_id,id) ON DELETE RESTRICT,
  CHECK (note IS NULL OR length(note) <= 1000)
);

CREATE INDEX IF NOT EXISTS crm_opportunity_probability_history_lookup_f011_idx
  ON tenant.crm_opportunity_probability_history(organization_id,opportunity_id,changed_at DESC);

CREATE OR REPLACE FUNCTION tenant.crm_probability_history_immutable_f011()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Opportunity probability history is immutable';
END;
$$;
DROP TRIGGER IF EXISTS crm_probability_history_immutable_f011
  ON tenant.crm_opportunity_probability_history;
CREATE TRIGGER crm_probability_history_immutable_f011
BEFORE UPDATE OR DELETE ON tenant.crm_opportunity_probability_history
FOR EACH ROW EXECUTE FUNCTION tenant.crm_probability_history_immutable_f011();

ALTER TABLE tenant.crm_opportunity_probability_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_opportunity_probability_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation
  ON tenant.crm_opportunity_probability_history;
CREATE POLICY tenant_organization_isolation
  ON tenant.crm_opportunity_probability_history
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

COMMENT ON COLUMN tenant.crm_opportunities.expected_revenue
  IS 'F011 canonical probability-weighted Opportunity revenue: round(amount * probability / 100, 2).';
COMMENT ON TABLE tenant.crm_opportunity_probability_history
  IS 'Immutable F011 ledger of governed Opportunity probability overrides.';

COMMIT;
