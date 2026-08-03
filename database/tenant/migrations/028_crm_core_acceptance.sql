BEGIN;

CREATE TABLE IF NOT EXISTS tenant.crm_core_acceptance_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  check_key text NOT NULL CHECK (length(trim(check_key)) BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('running','passed','warning','failed','skipped')),
  source text NOT NULL DEFAULT 'acceptance' CHECK (source IN ('local','ci','acceptance','manual')),
  environment text NOT NULL DEFAULT 'development' CHECK (environment IN ('development','staging','production')),
  commit_sha text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  CHECK (completed_at IS NULL OR completed_at >= started_at),
  CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE IF NOT EXISTS tenant.crm_core_acceptance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  environment text NOT NULL DEFAULT 'development' CHECK (environment IN ('development','staging','production')),
  commit_sha text,
  readiness_status text NOT NULL CHECK (readiness_status IN ('ready','attention','blocked')),
  risk_band text NOT NULL CHECK (risk_band IN ('low','medium','high')),
  acceptance_score numeric(5,2) NOT NULL CHECK (acceptance_score >= 0 AND acceptance_score <= 100),
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  capability_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  captured_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  CHECK (jsonb_typeof(blockers) = 'array'),
  CHECK (jsonb_typeof(warnings) = 'array'),
  CHECK (jsonb_typeof(metrics) = 'object'),
  CHECK (jsonb_typeof(capability_results) = 'array'),
  CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE INDEX IF NOT EXISTS crm_core_acceptance_run_latest_idx
  ON tenant.crm_core_acceptance_runs(organization_id,check_key,completed_at DESC,created_at DESC);
CREATE INDEX IF NOT EXISTS crm_core_acceptance_snapshot_history_idx
  ON tenant.crm_core_acceptance_snapshots(organization_id,captured_at DESC);

ALTER TABLE tenant.crm_core_acceptance_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_core_acceptance_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_core_acceptance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_core_acceptance_snapshots FORCE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'crm_core_acceptance_runs',
    'crm_core_acceptance_snapshots'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I',table_name);
    EXECUTE format(
      'CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id=current_setting(''app.current_organization_id'',true)::uuid) WITH CHECK (organization_id=current_setting(''app.current_organization_id'',true)::uuid)',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
