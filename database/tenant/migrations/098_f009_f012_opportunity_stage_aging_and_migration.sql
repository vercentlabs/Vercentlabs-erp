BEGIN;

-- F010/F012 stage aging: a real "time in current stage" projection, written
-- only by the governed moveOpportunityStage command in the SAME UPDATE
-- statement as stage_id/status — never derived from mutable updated_at,
-- mirroring the crm_leads.stage_entered_at pattern established for F007
-- (CRM vNext Prompt 4, migration 093).
ALTER TABLE tenant.crm_opportunities
  ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz NOT NULL DEFAULT now();

-- Backfill: the most recent stage_history row for each opportunity gives its
-- real stage-entry time; opportunities with no history row yet (created
-- before any transition) fall back to created_at.
UPDATE tenant.crm_opportunities record
SET stage_entered_at = COALESCE(
  (SELECT max(history.changed_at) FROM tenant.crm_opportunity_stage_history history
    WHERE history.organization_id = record.organization_id AND history.opportunity_id = record.id),
  record.created_at
);

CREATE INDEX IF NOT EXISTS crm_opportunities_stage_age_idx
  ON tenant.crm_opportunities(organization_id, stage_id, stage_entered_at)
  WHERE status = 'open';

-- Write guard: a direct UPDATE of the governed lifecycle columns (bypassing
-- moveOpportunityStage/updateOpportunityProbability) fails closed at the
-- database layer — defense in depth alongside the existing application-level
-- guard in updateCrmRecord (CRM_OPPORTUNITY_LIFECYCLE_GOVERNED), mirroring
-- crm_leads_stage_write_guard (migration 093).
CREATE OR REPLACE FUNCTION tenant.crm_opportunity_lifecycle_write_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.stage_id IS DISTINCT FROM OLD.stage_id
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.stage_entered_at IS DISTINCT FROM OLD.stage_entered_at
      OR NEW.probability IS DISTINCT FROM OLD.probability)
     AND current_setting('app.crm_opportunity_lifecycle_transition',true)<>'allowed' THEN
    RAISE EXCEPTION 'Use the governed Opportunity stage/probability service'
      USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS crm_opportunities_lifecycle_write_guard ON tenant.crm_opportunities;
CREATE TRIGGER crm_opportunities_lifecycle_write_guard
BEFORE UPDATE OF stage_id, status, stage_entered_at, probability ON tenant.crm_opportunities
FOR EACH ROW EXECUTE FUNCTION tenant.crm_opportunity_lifecycle_write_guard();

-- F012 safe stage deactivation + migration workflow. Reuses
-- tenant.background_jobs (job_type='crm.opportunities.stage_migration') for
-- the job row itself, mirroring crm_lead_stage_migration_items exactly for
-- the per-opportunity item ledger — F012 previously only offered a hard
-- block ("move open Opportunities out of this stage before deactivating
-- it") with no bulk remediation path.
CREATE TABLE IF NOT EXISTS tenant.crm_opportunity_stage_migration_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES tenant.background_jobs(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES tenant.crm_opportunities(id) ON DELETE CASCADE,
  from_stage_id uuid NOT NULL,
  to_stage_id uuid NOT NULL,
  expected_updated_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','applied','conflict','skipped','failed')),
  error_code text,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, job_id, opportunity_id)
);
CREATE INDEX IF NOT EXISTS crm_opportunity_stage_migration_items_pending_idx
  ON tenant.crm_opportunity_stage_migration_items(organization_id, job_id, status, opportunity_id)
  WHERE status='pending';
CREATE INDEX IF NOT EXISTS crm_opportunity_stage_migration_items_opp_idx
  ON tenant.crm_opportunity_stage_migration_items(organization_id, opportunity_id, created_at DESC);

ALTER TABLE tenant.crm_opportunity_stage_migration_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_opportunity_stage_migration_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_opportunity_stage_migration_items;
CREATE POLICY tenant_organization_isolation ON tenant.crm_opportunity_stage_migration_items
  USING (organization_id=current_setting('app.current_organization_id',true)::uuid)
  WITH CHECK (organization_id=current_setting('app.current_organization_id',true)::uuid);

-- F026 governed reason ordering (mirrors the same admin-visible ordering
-- already used by crm_pipeline_stages/crm_lead_stages/crm_lead_stage_
-- transition_reasons) — crm_lost_reasons had no explicit order column.
ALTER TABLE tenant.crm_lost_reasons
  ADD COLUMN IF NOT EXISTS sequence integer NOT NULL DEFAULT 100;
ALTER TABLE tenant.crm_lost_reasons
  DROP CONSTRAINT IF EXISTS crm_lost_reasons_sequence_check,
  ADD CONSTRAINT crm_lost_reasons_sequence_check CHECK (sequence BETWEEN 0 AND 100000);
CREATE INDEX IF NOT EXISTS crm_lost_reasons_catalogue_idx
  ON tenant.crm_lost_reasons(organization_id, status, sequence, id);

COMMENT ON COLUMN tenant.crm_opportunities.stage_entered_at IS 'Timestamp of the opportunity''s most recent governed stage transition; O(1) stage-age projection of the immutable crm_opportunity_stage_history log, written only by moveOpportunityStage.';
COMMENT ON TABLE tenant.crm_opportunity_stage_migration_items IS 'F012 safe stage-deactivation migration job items — per-opportunity ledger for a crm.opportunities.stage_migration background job.';

COMMIT;
