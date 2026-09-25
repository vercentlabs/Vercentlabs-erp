BEGIN;

-- F027 Lead scoring — adds a second, statistical scoring model type
-- ("predictive") alongside the existing deterministic rule engine
-- ("rule_based", the default for every existing row). A predictive model
-- trains a transparent Naive Bayes classifier on the org's own
-- crm_leads.qualification_state history (qualified vs unqualified — the
-- same terminal decision F006 already governs) and stores the resulting
-- per-feature conditional probabilities in crm_lead_scoring_model_priors.
-- This mirrors Odoo's Predictive Lead Scoring (explainable, no external ML
-- infra) rather than a black-box vendor model, and needs no change to any
-- existing caller of recalculateLeadScoreInternal: both model types return
-- the same {score, grade, contributions, thresholds, calculatedAt} shape.
ALTER TABLE tenant.crm_lead_scoring_models
  ADD COLUMN IF NOT EXISTS model_type text NOT NULL DEFAULT 'rule_based'
    CHECK (model_type IN ('rule_based', 'predictive')),
  ADD COLUMN IF NOT EXISTS training_variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS minimum_class_size integer NOT NULL DEFAULT 40
    CHECK (minimum_class_size BETWEEN 10 AND 5000),
  ADD COLUMN IF NOT EXISTS trained_at timestamptz,
  ADD COLUMN IF NOT EXISTS training_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS class_priors jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS tenant.crm_lead_scoring_model_priors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES tenant.crm_lead_scoring_models(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  feature_value text NOT NULL,
  class text NOT NULL CHECK (class IN ('qualified', 'unqualified')),
  probability numeric(9,6) NOT NULL CHECK (probability > 0 AND probability <= 1),
  sample_count integer NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, model_id, feature_key, feature_value, class)
);
CREATE INDEX IF NOT EXISTS crm_lead_scoring_model_priors_model_idx
  ON tenant.crm_lead_scoring_model_priors(organization_id, model_id);

CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_scoring_model_priors_organization_id_id_uidx
  ON tenant.crm_lead_scoring_model_priors(organization_id, id);

ALTER TABLE tenant.crm_lead_scoring_model_priors
  DROP CONSTRAINT IF EXISTS crm_lead_scoring_model_priors_model_id_fkey;
ALTER TABLE tenant.crm_lead_scoring_model_priors
  ADD CONSTRAINT crm_lead_scoring_model_priors_model_organization_fkey
  FOREIGN KEY (organization_id, model_id)
  REFERENCES tenant.crm_lead_scoring_models(organization_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE tenant.crm_lead_scoring_model_priors
  VALIDATE CONSTRAINT crm_lead_scoring_model_priors_model_organization_fkey;

ALTER TABLE tenant.crm_lead_scoring_model_priors ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_scoring_model_priors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.crm_lead_scoring_model_priors;
CREATE POLICY organization_isolation ON tenant.crm_lead_scoring_model_priors
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());

COMMIT;
