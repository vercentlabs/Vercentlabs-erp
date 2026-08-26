BEGIN;

-- F009 Opportunities: harden the core record lifecycle without claiming
-- F010 pipeline, F011 forecasting or F012 sales-stage completion.

-- Repair only legacy-invalid blank names so the new invariant can be applied
-- without deleting or detaching any Opportunity.
UPDATE tenant.crm_opportunities
   SET name = COALESCE(NULLIF(btrim(code), ''), 'Opportunity'),
       updated_at = now()
 WHERE btrim(COALESCE(name, '')) = '';

ALTER TABLE tenant.crm_opportunities
  DROP CONSTRAINT IF EXISTS crm_opportunities_name_nonblank_f009;
ALTER TABLE tenant.crm_opportunities
  ADD CONSTRAINT crm_opportunities_name_nonblank_f009
  CHECK (btrim(name) <> '');

-- A stage already belongs to exactly one pipeline. The earlier integrity
-- migration proved org ownership independently but did not prevent a row from
-- pairing Pipeline A with a Stage from Pipeline B. Reconcile any historical
-- mismatch to the stage's authoritative pipeline, then make that relationship
-- impossible to violate at the database layer.
UPDATE tenant.crm_opportunities opportunity
   SET pipeline_id = stage.pipeline_id,
       updated_at = now()
  FROM tenant.crm_pipeline_stages stage
 WHERE stage.organization_id = opportunity.organization_id
   AND stage.id = opportunity.stage_id
   AND opportunity.pipeline_id IS DISTINCT FROM stage.pipeline_id;

CREATE UNIQUE INDEX IF NOT EXISTS crm_pipeline_stages_org_pipeline_id_f009_uidx
  ON tenant.crm_pipeline_stages(organization_id,pipeline_id,id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='tenant.crm_opportunities'::regclass
       AND conname='crm_opportunities_stage_pipeline_f009_fkey'
  ) THEN
    ALTER TABLE tenant.crm_opportunities
      ADD CONSTRAINT crm_opportunities_stage_pipeline_f009_fkey
      FOREIGN KEY (organization_id,pipeline_id,stage_id)
      REFERENCES tenant.crm_pipeline_stages(organization_id,pipeline_id,id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.crm_opportunities
  VALIDATE CONSTRAINT crm_opportunities_stage_pipeline_f009_fkey;

CREATE INDEX IF NOT EXISTS crm_opportunities_f009_scope_idx
  ON tenant.crm_opportunities(organization_id,company_id,branch_id,owner_user_id,status,updated_at DESC);

COMMIT;
