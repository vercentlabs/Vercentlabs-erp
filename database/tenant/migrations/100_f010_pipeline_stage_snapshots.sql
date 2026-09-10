BEGIN;

-- F010 integrity closeout (Prompts 1-5): the dossier (F010-CAP-002,
-- DEC-CRM-P1-F010) requires historical pipeline snapshots as a REQUIRED
-- enterprise-scope item, not a manual-only convenience. The prior F010
-- audit's "PASS (inherited from crm_opportunity_forecast_snapshots /
-- crm_opportunity_stage_history)" claim did not hold up on re-inspection:
-- both of those are per-Opportunity records, not a pipeline-level stage
-- aggregate (count/amount/weighted-amount per stage per currency, at a
-- point in time) — there was no table that actually modeled what the
-- dossier asks for. This is that table: a durable, per-day baseline
-- (worker-captured) plus optional explicit manager captures.
CREATE TABLE IF NOT EXISTS tenant.crm_pipeline_stage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES tenant.crm_pipelines(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES tenant.crm_pipeline_stages(id) ON DELETE CASCADE,
  currency_code text NOT NULL,
  snapshot_date date NOT NULL,
  opportunity_count integer NOT NULL DEFAULT 0,
  amount numeric(18,2) NOT NULL DEFAULT 0,
  weighted_amount numeric(18,2) NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'scheduled' CHECK (source IN ('scheduled', 'manual')),
  captured_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotency key for the daily scheduled baseline: one row per
-- (org, pipeline, company, stage, currency, day). coalesce() is required
-- because Postgres unique indexes treat NULL company_id (org-wide /
-- unassigned Opportunities) as distinct from itself, which would otherwise
-- let a retried tick insert duplicate NULL-company rows for the same day.
-- Deliberately scoped to source='scheduled' only — explicit manager
-- captures (source='manual') are not deduplicated by day, since a manager
-- may legitimately want more than one point-in-time capture (e.g. before
-- and after a pipeline review).
CREATE UNIQUE INDEX IF NOT EXISTS crm_pipeline_stage_snapshots_scheduled_daily_idx
  ON tenant.crm_pipeline_stage_snapshots(
    organization_id, pipeline_id,
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    stage_id, currency_code, snapshot_date
  )
  WHERE source = 'scheduled';

CREATE INDEX IF NOT EXISTS crm_pipeline_stage_snapshots_lookup_idx
  ON tenant.crm_pipeline_stage_snapshots(organization_id, pipeline_id, snapshot_date DESC);

ALTER TABLE tenant.crm_pipeline_stage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_pipeline_stage_snapshots FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_pipeline_stage_snapshots;
CREATE POLICY tenant_organization_isolation ON tenant.crm_pipeline_stage_snapshots
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

COMMIT;
