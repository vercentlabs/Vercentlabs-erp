BEGIN;

-- F005 canonicalizes Lead Assignment on crm_lead_assignment_policies. The
-- original crm_assignment_rules table remains readable for historical
-- compatibility, but application writes are retired in favor of this model.
INSERT INTO tenant.crm_lead_assignment_policies (
  organization_id,name,sequence,criteria,mode,assignee_user_id,
  member_user_ids,territory_id,status,created_by,updated_by,created_at,updated_at
)
SELECT
  legacy.organization_id,legacy.name,legacy.sequence,legacy.criteria,
  legacy.assignment_mode,legacy.assignee_user_id,legacy.round_robin_user_ids,
  NULL,legacy.status,legacy.created_by,legacy.updated_by,legacy.created_at,legacy.updated_at
FROM tenant.crm_assignment_rules legacy
WHERE legacy.assignment_mode IN ('fixed','round_robin')
  AND NOT EXISTS (
    SELECT 1
    FROM tenant.crm_lead_assignment_policies canonical
    WHERE canonical.organization_id=legacy.organization_id
      AND lower(canonical.name)=lower(legacy.name)
  );

CREATE OR REPLACE FUNCTION tenant.crm_lead_assignment_criteria_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_typeof(value)='object'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each(value) item
      WHERE item.key NOT IN ('sourceId','countryCode','industry','productInterest')
         OR jsonb_typeof(item.value)<>'string'
         OR length(btrim(item.value #>> '{}'))=0
         OR length(item.value #>> '{}')>500
         OR (item.key='sourceId' AND (item.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
         OR (item.key='countryCode' AND (item.value #>> '{}') !~ '^[A-Za-z]{2}$')
    );
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.crm_lead_assignment_policies'::regclass
      AND conname='crm_lead_assignment_policies_sequence_check'
  ) THEN
    ALTER TABLE tenant.crm_lead_assignment_policies
      ADD CONSTRAINT crm_lead_assignment_policies_sequence_check
      CHECK (sequence BETWEEN 0 AND 100000) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.crm_lead_assignment_policies'::regclass
      AND conname='crm_lead_assignment_policies_criteria_check'
  ) THEN
    ALTER TABLE tenant.crm_lead_assignment_policies
      ADD CONSTRAINT crm_lead_assignment_policies_criteria_check
      CHECK (
        mode NOT IN ('fixed','round_robin')
        OR tenant.crm_lead_assignment_criteria_valid(criteria)
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE tenant.crm_lead_assignment_policies
  VALIDATE CONSTRAINT crm_lead_assignment_policies_sequence_check;
ALTER TABLE tenant.crm_lead_assignment_policies
  VALIDATE CONSTRAINT crm_lead_assignment_policies_criteria_check;

CREATE INDEX IF NOT EXISTS crm_lead_assignment_policies_evaluation_idx
  ON tenant.crm_lead_assignment_policies(organization_id,status,sequence,id);
CREATE INDEX IF NOT EXISTS crm_lead_assignment_events_owner_idx
  ON tenant.crm_lead_assignment_events(organization_id,new_owner_user_id,created_at DESC);

COMMENT ON TABLE tenant.crm_lead_assignment_policies IS
  'Canonical F005 Lead Assignment rules. Active rules are evaluated by sequence then id.';
COMMENT ON TABLE tenant.crm_assignment_rules IS
  'Legacy pre-F005 assignment rules retained for historical compatibility; application writes are retired.';

COMMIT;
