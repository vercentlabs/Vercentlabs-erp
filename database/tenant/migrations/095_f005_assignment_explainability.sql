BEGIN;

-- F005 Prompt 4: unlock territory/workload policy modes at the write layer
-- (schema already allowed them since migration 053; only the application
-- code rejected them — see lead-governance.js), add score-segment as an
-- allowed matching criterion (Assignment + Scoring integration, F027's
-- lead_grade), and persist a full eligibility explain-trace + override
-- evidence on every assignment event for audit/support reconstruction.

CREATE OR REPLACE FUNCTION tenant.crm_lead_assignment_criteria_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_typeof(value)='object'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each(value) item
      WHERE item.key NOT IN ('sourceId','countryCode','industry','productInterest','leadGrade')
         OR jsonb_typeof(item.value)<>'string'
         OR length(btrim(item.value #>> '{}'))=0
         OR length(item.value #>> '{}')>500
         OR (item.key='sourceId' AND (item.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
         OR (item.key='countryCode' AND (item.value #>> '{}') !~ '^[A-Za-z]{2}$')
         OR (item.key='leadGrade' AND (item.value #>> '{}') NOT IN ('cold','warm','hot','qualified'))
    );
$$;

ALTER TABLE tenant.crm_lead_assignment_events
  ADD COLUMN IF NOT EXISTS evaluation_trace jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_override boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tenant.crm_lead_assignment_events.evaluation_trace IS 'Eligible/excluded candidates with reasons, selected assignee and fallback path, as evaluated at assignment time — audit/support explainability (F005-CAP-001).';
COMMENT ON COLUMN tenant.crm_lead_assignment_events.is_override IS 'True when an authorized user assigned a candidate the eligibility evaluator would otherwise have excluded, with an explicit reason.';

COMMIT;
