-- CRM plan, step 5.1: several pipelines, configurable stage rules, stage time limits.
--
-- Pipelines: an organization can run more than one (projects and AMC renewals, say, or one per sales team). A pipeline may belong to a
-- sales team: deals its members create start there. Each pipeline has its own stages and its own Won and Lost rows.
--
-- Stage rules: what a deal must have to enter a stage (refused without it) or should have (the mover is asked to confirm). NULL keeps
-- the standard rules of the five standard stages; an empty list means none.
--
-- Stage time limits: the existing crm_opportunity_stage_sla_policies (until now never written) holds each stage's maximum days. A deal
-- that stays longer is flagged to its owner, and to their team's manager when it stays twice as long.
ALTER TABLE tenant.crm_pipelines ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES tenant.crm_sales_teams(id) ON DELETE SET NULL;
ALTER TABLE tenant.crm_pipelines ADD COLUMN IF NOT EXISTS sequence integer NOT NULL DEFAULT 10;
CREATE UNIQUE INDEX IF NOT EXISTS crm_pipelines_team_idx ON tenant.crm_pipelines (organization_id, team_id) WHERE team_id IS NOT NULL AND status = 'active';

ALTER TABLE tenant.crm_pipeline_stages ADD COLUMN IF NOT EXISTS entry_rules jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_pipeline_stages_entry_rules_check') THEN
    ALTER TABLE tenant.crm_pipeline_stages ADD CONSTRAINT crm_pipeline_stages_entry_rules_check CHECK (entry_rules IS NULL OR jsonb_typeof(entry_rules) = 'array');
  END IF;
END $$;

ALTER TABLE tenant.crm_opportunities ADD COLUMN IF NOT EXISTS stage_overdue_alerted_at timestamptz;
ALTER TABLE tenant.crm_opportunities ADD COLUMN IF NOT EXISTS stage_overdue_escalated_at timestamptz;
CREATE INDEX IF NOT EXISTS crm_opportunities_stage_watch_idx ON tenant.crm_opportunities (organization_id, stage_id, stage_entered_at) WHERE status = 'open' AND archived_at IS NULL;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0178_crm_pipelines_rules.sql', 'crm-pipelines-rules') ON CONFLICT DO NOTHING;
