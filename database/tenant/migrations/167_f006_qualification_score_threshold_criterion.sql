BEGIN;

-- F006 gap-closure (benchmark: "Lead qualification in top ERPs" — every
-- rival ships some ML/rule-based lead score as an input organizations can
-- wire into their own qualification logic; Vercentlabs' score/qualification
-- relationship was one-directional, with no way to define a criterion like
-- "predictive score is at least N"). Adds a third check_type, generic over
-- any single numeric field (not score-specific), plus the threshold value
-- it compares against. NULL for every existing row/check_type — this
-- changes nothing about current qualification outcomes until an admin
-- actually creates a minimum_threshold criterion.
ALTER TABLE tenant.crm_lead_qualification_criteria
  ADD COLUMN IF NOT EXISTS threshold numeric;

ALTER TABLE tenant.crm_lead_qualification_criteria
  DROP CONSTRAINT IF EXISTS crm_lead_qualification_criteria_check_type_check;
ALTER TABLE tenant.crm_lead_qualification_criteria
  ADD CONSTRAINT crm_lead_qualification_criteria_check_type_check
    CHECK (check_type IN ('non_empty_any', 'positive_number', 'minimum_threshold'));

ALTER TABLE tenant.crm_lead_qualification_criteria
  DROP CONSTRAINT IF EXISTS crm_lead_qualification_criteria_threshold_check;
ALTER TABLE tenant.crm_lead_qualification_criteria
  ADD CONSTRAINT crm_lead_qualification_criteria_threshold_check
    CHECK (
      (check_type = 'minimum_threshold' AND threshold IS NOT NULL)
      OR (check_type <> 'minimum_threshold' AND threshold IS NULL)
    );

COMMENT ON COLUMN tenant.crm_lead_qualification_criteria.threshold IS
  'Only set when check_type=minimum_threshold: the criterion field''s value must be >= this number (e.g. a predictive lead score criterion set to 60).';

COMMIT;
