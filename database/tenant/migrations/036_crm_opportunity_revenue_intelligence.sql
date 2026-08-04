BEGIN;

CREATE TABLE IF NOT EXISTS tenant.crm_opportunity_revenue_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  opportunity_item_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  schedule_date date NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  currency_code char(3),
  recurrence_interval text NOT NULL CHECK (recurrence_interval IN ('week','month','quarter','year')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, opportunity_item_id, sequence),
  FOREIGN KEY (organization_id, opportunity_id) REFERENCES tenant.crm_opportunities(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, opportunity_item_id) REFERENCES tenant.crm_opportunity_items(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_opportunity_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  team_role text NOT NULL DEFAULT 'contributor',
  access_level text NOT NULL DEFAULT 'view' CHECK (access_level IN ('view','edit','manager')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, opportunity_id, user_id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, opportunity_id) REFERENCES tenant.crm_opportunities(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_opportunity_revenue_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  team_member_id uuid NOT NULL,
  split_type text NOT NULL DEFAULT 'revenue' CHECK (split_type IN ('revenue','overlay','partner','manager')),
  split_percent numeric(7,4) NOT NULL CHECK (split_percent > 0 AND split_percent <= 100),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, opportunity_id, team_member_id, split_type),
  FOREIGN KEY (organization_id, opportunity_id) REFERENCES tenant.crm_opportunities(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, team_member_id) REFERENCES tenant.crm_opportunity_team_members(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_mutual_action_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  name text NOT NULL,
  customer_visible boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','completed','cancelled')),
  target_close_date date,
  public_token_hash text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, opportunity_id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, opportunity_id) REFERENCES tenant.crm_opportunities(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_mutual_action_plan_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  title text NOT NULL,
  due_date date,
  internal_owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  customer_owner_name text,
  required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','blocked','completed','cancelled')),
  completion_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, plan_id, sequence),
  FOREIGN KEY (organization_id, plan_id) REFERENCES tenant.crm_mutual_action_plans(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_opportunity_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  pipeline_id uuid NOT NULL REFERENCES tenant.crm_pipelines(id) ON DELETE RESTRICT,
  stage_id uuid NOT NULL REFERENCES tenant.crm_pipeline_stages(id) ON DELETE RESTRICT,
  defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  copy_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_opportunity_clone_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_opportunity_id uuid NOT NULL,
  cloned_opportunity_id uuid NOT NULL,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_hash text NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, source_opportunity_id) REFERENCES tenant.crm_opportunities(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, cloned_opportunity_id) REFERENCES tenant.crm_opportunities(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_win_loss_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('won','lost')),
  primary_reason text NOT NULL,
  competitor_name text,
  sales_cycle_days integer NOT NULL DEFAULT 0 CHECK (sales_cycle_days >= 0),
  interview_notes text,
  lessons jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, opportunity_id),
  FOREIGN KEY (organization_id, opportunity_id) REFERENCES tenant.crm_opportunities(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_predictive_forecast_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  forecast_period_id uuid REFERENCES tenant.crm_forecast_periods(id) ON DELETE SET NULL,
  model_version text NOT NULL,
  pipeline_amount numeric(18,2) NOT NULL DEFAULT 0,
  predicted_amount numeric(18,2) NOT NULL DEFAULT 0,
  confidence_percent numeric(5,2) NOT NULL CHECK (confidence_percent BETWEEN 0 AND 100),
  explanation jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  captured_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.crm_quota_seasonality_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quota_plan_id uuid NOT NULL,
  period_key text NOT NULL,
  weight numeric(12,6) NOT NULL CHECK (weight >= 0),
  target_amount numeric(18,2) NOT NULL CHECK (target_amount >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, quota_plan_id, period_key),
  FOREIGN KEY (organization_id, quota_plan_id) REFERENCES tenant.crm_quota_plans(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_opportunity_revenue_acceptance_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  capability_id text NOT NULL,
  commit_sha text NOT NULL,
  status text NOT NULL CHECK (status IN ('passed','failed','blocked')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_hash text NOT NULL,
  verified_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, capability_id, commit_sha)
);

CREATE INDEX IF NOT EXISTS crm_opportunity_revenue_schedule_date_idx ON tenant.crm_opportunity_revenue_schedules(organization_id,schedule_date,opportunity_id);
CREATE INDEX IF NOT EXISTS crm_mutual_action_plan_status_idx ON tenant.crm_mutual_action_plans(organization_id,status,target_close_date);
CREATE INDEX IF NOT EXISTS crm_predictive_forecast_latest_idx ON tenant.crm_predictive_forecast_snapshots(organization_id,captured_at DESC);
CREATE INDEX IF NOT EXISTS crm_win_loss_reviewed_idx ON tenant.crm_win_loss_reviews(organization_id,reviewed_at DESC);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'crm_opportunity_revenue_schedules','crm_opportunity_team_members','crm_opportunity_revenue_splits',
    'crm_mutual_action_plans','crm_mutual_action_plan_milestones','crm_opportunity_templates',
    'crm_opportunity_clone_events','crm_win_loss_reviews','crm_predictive_forecast_snapshots',
    'crm_quota_seasonality_allocations','crm_opportunity_revenue_acceptance_evidence'
  ]
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I',table_name);
    EXECUTE format(
      'CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id=current_setting(''app.current_organization_id'',true)::uuid) WITH CHECK (organization_id=current_setting(''app.current_organization_id'',true)::uuid)',
      table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION tenant.crm_opportunity_revenue_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRM opportunity revenue evidence is immutable';
END $$;

DROP TRIGGER IF EXISTS crm_opportunity_clone_events_immutable ON tenant.crm_opportunity_clone_events;
CREATE TRIGGER crm_opportunity_clone_events_immutable
BEFORE UPDATE OR DELETE ON tenant.crm_opportunity_clone_events
FOR EACH ROW EXECUTE FUNCTION tenant.crm_opportunity_revenue_immutable();

DROP TRIGGER IF EXISTS crm_predictive_forecast_snapshots_immutable ON tenant.crm_predictive_forecast_snapshots;
CREATE TRIGGER crm_predictive_forecast_snapshots_immutable
BEFORE UPDATE OR DELETE ON tenant.crm_predictive_forecast_snapshots
FOR EACH ROW EXECUTE FUNCTION tenant.crm_opportunity_revenue_immutable();

DROP TRIGGER IF EXISTS crm_opportunity_revenue_acceptance_immutable ON tenant.crm_opportunity_revenue_acceptance_evidence;
CREATE TRIGGER crm_opportunity_revenue_acceptance_immutable
BEFORE UPDATE OR DELETE ON tenant.crm_opportunity_revenue_acceptance_evidence
FOR EACH ROW EXECUTE FUNCTION tenant.crm_opportunity_revenue_immutable();

GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_opportunity_revenue_schedules TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_opportunity_team_members TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_opportunity_revenue_splits TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_mutual_action_plans TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_mutual_action_plan_milestones TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_opportunity_templates TO vercent_app;
GRANT SELECT,INSERT ON tenant.crm_opportunity_clone_events TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_win_loss_reviews TO vercent_app;
GRANT SELECT,INSERT ON tenant.crm_predictive_forecast_snapshots TO vercent_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant.crm_quota_seasonality_allocations TO vercent_app;
GRANT SELECT,INSERT ON tenant.crm_opportunity_revenue_acceptance_evidence TO vercent_app;

COMMIT;
