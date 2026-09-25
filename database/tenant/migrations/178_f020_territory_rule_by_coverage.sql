BEGIN;

-- F020: a territory assignment rule without a territory now means "route each
-- lead to its own territory, matched from territory coverage"
-- (territory-coverage.js). The shape check from migration 053 still required a
-- territory on every territory rule, so saving a by-coverage rule failed with
-- a constraint error. Fixed and pooled rules keep their requirements.
ALTER TABLE tenant.crm_lead_assignment_policies
  DROP CONSTRAINT IF EXISTS crm_lead_assignment_policies_strategy_shape_check;
ALTER TABLE tenant.crm_lead_assignment_policies
  ADD CONSTRAINT crm_lead_assignment_policies_strategy_shape_check
  CHECK (
    (mode = 'fixed' AND assignee_user_id IS NOT NULL)
    OR (mode IN ('round_robin', 'workload') AND cardinality(member_user_ids) > 0)
    OR mode = 'territory'
  );

COMMIT;
