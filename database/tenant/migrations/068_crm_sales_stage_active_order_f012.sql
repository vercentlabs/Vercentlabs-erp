BEGIN;

-- F012 follow-up hardening: the original CRM schema required sequence values to
-- be unique even for inactive historical stages. F012 retains inactive stages,
-- so only active catalogue positions need uniqueness.
ALTER TABLE tenant.crm_pipeline_stages
  DROP CONSTRAINT IF EXISTS crm_pipeline_stages_organization_id_pipeline_id_sequence_key;

CREATE UNIQUE INDEX IF NOT EXISTS crm_pipeline_stages_active_sequence_f012_uidx
  ON tenant.crm_pipeline_stages(organization_id,pipeline_id,sequence)
  WHERE status='active';

COMMENT ON INDEX tenant.crm_pipeline_stages_active_sequence_f012_uidx
  IS 'F012 active-only sales-stage ordering; inactive historical stages may retain prior sequence values.';

COMMIT;
