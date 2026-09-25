BEGIN;

-- F027 Basic lead scoring: the deterministic rule score and the ML propensity
-- must stay separate. Until now only one scoring model could be active per
-- organization, and a predictive model wrote its probability into the same
-- crm_leads.score / lead_grade columns — activating it retired the rule model
-- and silently replaced every transparent, points-based score with a
-- probability. Now one rule-based AND one predictive model may be active at
-- once; the rule model owns score/lead_grade, the predictive model owns the
-- new propensity_* columns, each with its own explanation.
DROP INDEX IF EXISTS tenant.crm_lead_scoring_models_one_active_idx;
CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_scoring_models_one_active_per_type_idx
  ON tenant.crm_lead_scoring_models(organization_id, model_type)
  WHERE status='active';

ALTER TABLE tenant.crm_leads
  ADD COLUMN IF NOT EXISTS propensity_score smallint,
  ADD COLUMN IF NOT EXISTS propensity_grade text,
  ADD COLUMN IF NOT EXISTS propensity_model_id uuid,
  ADD COLUMN IF NOT EXISTS propensity_calculated_at timestamptz,
  ADD COLUMN IF NOT EXISTS propensity_explanation jsonb;

ALTER TABLE tenant.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_propensity_score_check;
ALTER TABLE tenant.crm_leads
  ADD CONSTRAINT crm_leads_propensity_score_check
  CHECK (propensity_score IS NULL OR propensity_score BETWEEN 0 AND 100);
ALTER TABLE tenant.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_propensity_grade_check;
ALTER TABLE tenant.crm_leads
  ADD CONSTRAINT crm_leads_propensity_grade_check
  CHECK (propensity_grade IS NULL OR propensity_grade IN ('cold','warm','hot','qualified'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant.crm_leads'::regclass AND conname = 'crm_leads_propensity_model_fkey'
  ) THEN
    ALTER TABLE tenant.crm_leads
      ADD CONSTRAINT crm_leads_propensity_model_fkey
      FOREIGN KEY (propensity_model_id) REFERENCES tenant.crm_lead_scoring_models(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Any lead previously scored by a predictive model carried a probability in
-- score/lead_grade: move it to the propensity columns. The rule score is
-- recomputed by the next recalculation (score reset to 0 and grade to cold, with no model).
UPDATE tenant.crm_leads lead
   SET propensity_score = LEAST(GREATEST(lead.score, 0), 100),
       propensity_grade = lead.lead_grade,
       propensity_model_id = lead.score_model_id,
       propensity_calculated_at = lead.score_calculated_at,
       propensity_explanation = lead.score_explanation,
       score = 0, lead_grade = 'cold', score_model_id = NULL, score_calculated_at = NULL, score_explanation = '{}'::jsonb
  FROM tenant.crm_lead_scoring_models model
 WHERE model.id = lead.score_model_id AND model.model_type = 'predictive';

COMMIT;
