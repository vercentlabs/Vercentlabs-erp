BEGIN;

CREATE TABLE IF NOT EXISTS tenant.crm_success_plan_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  default_duration_days integer NOT NULL DEFAULT 90 CHECK (default_duration_days BETWEEN 1 AND 3650),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','inactive','archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_success_plan_template_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id uuid NOT NULL,
  milestone_key text NOT NULL,
  title text NOT NULL,
  description text,
  sequence integer NOT NULL CHECK (sequence > 0),
  default_due_offset_days integer NOT NULL DEFAULT 0 CHECK (default_due_offset_days BETWEEN 0 AND 3650),
  health_weight numeric(7,4) NOT NULL DEFAULT 1 CHECK (health_weight > 0 AND health_weight <= 100),
  dependency_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  customer_visible boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,template_id,milestone_key),
  UNIQUE (organization_id,template_id,sequence),
  FOREIGN KEY (organization_id,template_id)
    REFERENCES tenant.crm_success_plan_templates(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_customer_success_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  party_id uuid NOT NULL,
  account_plan_id uuid,
  template_id uuid,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  objectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  customer_participants jsonb NOT NULL DEFAULT '[]'::jsonb,
  start_date date NOT NULL DEFAULT current_date,
  target_date date NOT NULL,
  completed_at timestamptz,
  health_score numeric(5,2) NOT NULL DEFAULT 50 CHECK (health_score BETWEEN 0 AND 100),
  health_status text NOT NULL DEFAULT 'watch' CHECK (health_status IN ('healthy','watch','at_risk','critical','unknown')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','completed','paused','cancelled','archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,party_id)
    REFERENCES tenant.business_parties(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,account_plan_id)
    REFERENCES tenant.crm_account_plans(organization_id,id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id,template_id)
    REFERENCES tenant.crm_success_plan_templates(organization_id,id) ON DELETE SET NULL,
  CHECK (target_date >= start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_customer_success_one_active_plan_idx
  ON tenant.crm_customer_success_plans(organization_id,party_id)
  WHERE status IN ('draft','active','paused');

CREATE TABLE IF NOT EXISTS tenant.crm_customer_success_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  template_milestone_id uuid,
  milestone_key text NOT NULL,
  title text NOT NULL,
  description text,
  sequence integer NOT NULL CHECK (sequence > 0),
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  customer_contact_id uuid,
  due_date date NOT NULL,
  health_weight numeric(7,4) NOT NULL DEFAULT 1 CHECK (health_weight > 0 AND health_weight <= 100),
  dependency_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  customer_visible boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','blocked','completed','skipped','cancelled')),
  blocker_reason text,
  completed_at timestamptz,
  completion_notes text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,plan_id,milestone_key),
  FOREIGN KEY (organization_id,plan_id)
    REFERENCES tenant.crm_customer_success_plans(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,template_milestone_id)
    REFERENCES tenant.crm_success_plan_template_milestones(organization_id,id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id,customer_contact_id)
    REFERENCES tenant.contacts(organization_id,id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tenant.crm_product_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  party_id uuid NOT NULL,
  external_system text NOT NULL,
  external_event_id text NOT NULL,
  metric_name text NOT NULL,
  metric_value numeric(24,6) NOT NULL,
  metric_unit text,
  occurred_at timestamptz NOT NULL,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,external_system,external_event_id),
  FOREIGN KEY (organization_id,party_id)
    REFERENCES tenant.business_parties(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_customer_feedback_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  party_id uuid NOT NULL,
  contact_id uuid,
  survey_type text NOT NULL CHECK (survey_type IN ('nps','csat','ces')),
  score numeric(7,2) NOT NULL,
  normalized_score numeric(5,2) NOT NULL CHECK (normalized_score BETWEEN 0 AND 100),
  comment text,
  channel text NOT NULL DEFAULT 'manual',
  external_response_id text,
  responded_at timestamptz NOT NULL DEFAULT now(),
  follow_up_required boolean NOT NULL DEFAULT false,
  followed_up_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,channel,external_response_id),
  FOREIGN KEY (organization_id,party_id)
    REFERENCES tenant.business_parties(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,contact_id)
    REFERENCES tenant.contacts(organization_id,id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tenant.crm_customer_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  party_id uuid NOT NULL,
  plan_id uuid,
  health_score numeric(5,2) NOT NULL CHECK (health_score BETWEEN 0 AND 100),
  health_status text NOT NULL CHECK (health_status IN ('healthy','watch','at_risk','critical','unknown')),
  components jsonb NOT NULL DEFAULT '{}'::jsonb,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculation_version text NOT NULL DEFAULT 'crm03-v1',
  calculated_at timestamptz NOT NULL DEFAULT now(),
  content_hash text NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,party_id)
    REFERENCES tenant.business_parties(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,plan_id)
    REFERENCES tenant.crm_customer_success_plans(organization_id,id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tenant.crm_renewal_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  party_id uuid NOT NULL,
  plan_id uuid,
  opportunity_id uuid,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  renewal_date date NOT NULL,
  contract_value numeric(24,6) NOT NULL DEFAULT 0 CHECK (contract_value >= 0),
  currency_code char(3) NOT NULL,
  probability numeric(5,2) NOT NULL DEFAULT 50 CHECK (probability BETWEEN 0 AND 100),
  forecast_category text NOT NULL DEFAULT 'pipeline' CHECK (forecast_category IN ('pipeline','best_case','commit','closed','omitted')),
  risk_level text NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high','critical')),
  expansion_value numeric(24,6) NOT NULL DEFAULT 0 CHECK (expansion_value >= 0),
  next_action text,
  next_action_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','negotiating','renewed','churned','cancelled')),
  closed_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,party_id,renewal_date),
  FOREIGN KEY (organization_id,party_id)
    REFERENCES tenant.business_parties(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,plan_id)
    REFERENCES tenant.crm_customer_success_plans(organization_id,id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id,opportunity_id)
    REFERENCES tenant.crm_opportunities(organization_id,id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tenant.crm_churn_interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  party_id uuid NOT NULL,
  plan_id uuid,
  renewal_case_id uuid,
  trigger_type text NOT NULL CHECK (trigger_type IN ('health','usage','feedback','service','renewal','manual')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  title text NOT NULL,
  action_plan text NOT NULL,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','dismissed')),
  resolution text,
  resolved_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,party_id)
    REFERENCES tenant.business_parties(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,plan_id)
    REFERENCES tenant.crm_customer_success_plans(organization_id,id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id,renewal_case_id)
    REFERENCES tenant.crm_renewal_cases(organization_id,id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tenant.crm_customer_success_acceptance_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  capability_id text NOT NULL CHECK (capability_id IN ('CRM-031','CRM-032','CRM-033','CRM-034','CRM-047')),
  status text NOT NULL CHECK (status IN ('passed','failed')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  commit_sha text,
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_success_plan_party_idx ON tenant.crm_customer_success_plans(organization_id,party_id,status,target_date);
CREATE INDEX IF NOT EXISTS crm_success_milestone_due_idx ON tenant.crm_customer_success_milestones(organization_id,status,due_date);
CREATE INDEX IF NOT EXISTS crm_usage_party_time_idx ON tenant.crm_product_usage_events(organization_id,party_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_feedback_party_time_idx ON tenant.crm_customer_feedback_responses(organization_id,party_id,responded_at DESC);
CREATE INDEX IF NOT EXISTS crm_health_party_time_idx ON tenant.crm_customer_health_snapshots(organization_id,party_id,calculated_at DESC);
CREATE INDEX IF NOT EXISTS crm_renewal_due_idx ON tenant.crm_renewal_cases(organization_id,status,renewal_date);
CREATE INDEX IF NOT EXISTS crm_churn_open_idx ON tenant.crm_churn_interventions(organization_id,status,severity,due_at);
CREATE INDEX IF NOT EXISTS crm_customer_success_acceptance_latest_idx ON tenant.crm_customer_success_acceptance_runs(organization_id,capability_id,recorded_at DESC);

CREATE OR REPLACE FUNCTION tenant.crm_customer_success_immutable_row()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% records are immutable',TG_TABLE_NAME;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'crm_product_usage_events','crm_customer_health_snapshots','crm_customer_success_acceptance_runs'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON tenant.%I',table_name || '_immutable',table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.crm_customer_success_immutable_row()',table_name || '_immutable',table_name);
  END LOOP;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'crm_success_plan_templates','crm_success_plan_template_milestones','crm_customer_success_plans',
    'crm_customer_success_milestones','crm_product_usage_events','crm_customer_feedback_responses',
    'crm_customer_health_snapshots','crm_renewal_cases','crm_churn_interventions','crm_customer_success_acceptance_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS organization_isolation ON tenant.%I',table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I',table_name);
    EXECUTE format(
      'CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id=current_setting(''app.current_organization_id'',true)::uuid) WITH CHECK (organization_id=current_setting(''app.current_organization_id'',true)::uuid)',
      table_name
    );
  END LOOP;
END $$;

REVOKE UPDATE,DELETE ON tenant.crm_product_usage_events FROM PUBLIC;
REVOKE UPDATE,DELETE ON tenant.crm_customer_health_snapshots FROM PUBLIC;
REVOKE UPDATE,DELETE ON tenant.crm_customer_success_acceptance_runs FROM PUBLIC;

WITH template_insert AS (
  INSERT INTO tenant.crm_success_plan_templates(
    organization_id,name,description,default_duration_days,status,created_by,updated_by
  )
  SELECT organization.id,'Standard customer onboarding','Default onboarding and adoption plan.',90,'active',organization.created_by,organization.created_by
  FROM public.organizations organization
  ON CONFLICT (organization_id,name) DO UPDATE SET status='active',updated_at=now()
  RETURNING organization_id,id,created_by
)
INSERT INTO tenant.crm_success_plan_template_milestones(
  organization_id,template_id,milestone_key,title,description,sequence,default_due_offset_days,health_weight,dependency_keys,created_by
)
SELECT template.organization_id,template.id,seed.key,seed.title,seed.description,seed.sequence,seed.days,seed.weight,seed.dependencies,template.created_by
FROM template_insert template
CROSS JOIN (VALUES
  ('kickoff','Kick-off completed','Agree outcomes, owners and operating rhythm.',1,7,1.0,'[]'::jsonb),
  ('data_ready','Data and configuration ready','Complete data preparation and configuration.',2,30,1.5,'["kickoff"]'::jsonb),
  ('first_value','First value achieved','Customer reaches the first measurable outcome.',3,60,2.0,'["data_ready"]'::jsonb),
  ('adoption_review','Adoption review','Review adoption, feedback and remaining blockers.',4,90,1.5,'["first_value"]'::jsonb)
) AS seed(key,title,description,sequence,days,weight,dependencies)
ON CONFLICT (organization_id,template_id,milestone_key) DO NOTHING;

COMMIT;
