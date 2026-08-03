BEGIN;

CREATE TABLE IF NOT EXISTS tenant.release_governance_policies (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  required_check_keys jsonb NOT NULL DEFAULT '["unit_tests","lint","typecheck","control_database","tenant_database","crm_live","sales_live","accounting_live","procurement_live","security","backup","restore","deployment_smoke","mobile"]'::jsonb,
  minimum_pass_percent numeric(5,2) NOT NULL DEFAULT 100 CHECK (minimum_pass_percent > 0 AND minimum_pass_percent <= 100),
  backup_maximum_age_hours integer NOT NULL DEFAULT 24 CHECK (backup_maximum_age_hours > 0),
  maximum_open_critical_incidents integer NOT NULL DEFAULT 0 CHECK (maximum_open_critical_incidents >= 0),
  maximum_open_high_incidents integer NOT NULL DEFAULT 0 CHECK (maximum_open_high_incidents >= 0),
  require_restore_evidence boolean NOT NULL DEFAULT true,
  require_deployment_smoke boolean NOT NULL DEFAULT true,
  require_restricted_runtime_role boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(required_check_keys) = 'array')
);

CREATE TABLE IF NOT EXISTS tenant.release_governance_check_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  check_key text NOT NULL CHECK (check_key IN (
    'unit_tests','lint','typecheck','control_database','tenant_database',
    'crm_live','sales_live','accounting_live','procurement_live','security',
    'backup','restore','deployment_smoke','mobile'
  )),
  status text NOT NULL CHECK (status IN ('running','passed','warning','failed','skipped')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('local','ci','deployment','manual')),
  environment text NOT NULL DEFAULT 'development' CHECK (environment IN ('development','staging','production')),
  commit_sha text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE TABLE IF NOT EXISTS tenant.release_governance_incident_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  service text NOT NULL DEFAULT 'platform',
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','monitoring','resolved','closed')),
  title text NOT NULL,
  details text,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  next_action_at timestamptz,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  CHECK (resolved_at IS NULL OR resolved_at >= detected_at)
);

CREATE TABLE IF NOT EXISTS tenant.release_governance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  environment text NOT NULL DEFAULT 'development' CHECK (environment IN ('development','staging','production')),
  commit_sha text,
  readiness_status text NOT NULL CHECK (readiness_status IN ('ready','attention','blocked')),
  risk_band text NOT NULL CHECK (risk_band IN ('low','medium','high')),
  release_score numeric(5,2) NOT NULL CHECK (release_score >= 0 AND release_score <= 100),
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  captured_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  CHECK (jsonb_typeof(blockers) = 'array'),
  CHECK (jsonb_typeof(warnings) = 'array')
);

CREATE INDEX IF NOT EXISTS release_governance_check_latest_idx
  ON tenant.release_governance_check_runs(organization_id,check_key,completed_at DESC,created_at DESC);
CREATE INDEX IF NOT EXISTS release_governance_incident_queue_idx
  ON tenant.release_governance_incident_cases(organization_id,severity,status,next_action_at)
  WHERE status NOT IN ('resolved','closed');
CREATE INDEX IF NOT EXISTS release_governance_snapshot_history_idx
  ON tenant.release_governance_snapshots(organization_id,captured_at DESC);

INSERT INTO tenant.release_governance_policies(organization_id,created_by,updated_by)
SELECT organization.id,organization.created_by,organization.created_by
FROM public.organizations organization
ON CONFLICT (organization_id) DO NOTHING;

ALTER TABLE tenant.release_governance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.release_governance_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.release_governance_check_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.release_governance_check_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.release_governance_incident_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.release_governance_incident_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.release_governance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.release_governance_snapshots FORCE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'release_governance_policies',
    'release_governance_check_runs',
    'release_governance_incident_cases',
    'release_governance_snapshots'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I',table_name);
    EXECUTE format(
      'CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id=current_setting(''app.current_organization_id'',true)::uuid) WITH CHECK (organization_id=current_setting(''app.current_organization_id'',true)::uuid)',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
