BEGIN;

CREATE TABLE IF NOT EXISTS tenant.crm_sales_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  parent_team_id uuid REFERENCES tenant.crm_sales_teams(id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  manager_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  default_pipeline_id uuid REFERENCES tenant.crm_pipelines(id) ON DELETE SET NULL,
  currency_code char(3),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.crm_sales_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES tenant.crm_sales_teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'seller' CHECK (member_role IN ('manager', 'seller', 'sales_ops', 'overlay', 'observer')),
  allocation_percent numeric(5,2) NOT NULL DEFAULT 100 CHECK (allocation_percent > 0 AND allocation_percent <= 100),
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_from <= effective_to),
  UNIQUE (organization_id, team_id, user_id, effective_from)
);

CREATE TABLE IF NOT EXISTS tenant.crm_territories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  parent_territory_id uuid REFERENCES tenant.crm_territories(id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  territory_type text NOT NULL DEFAULT 'geographic' CHECK (territory_type IN ('geographic', 'industry', 'account', 'product', 'channel', 'named', 'hybrid')),
  manager_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assignment_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'inactive', 'archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.crm_territory_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  territory_id uuid NOT NULL REFERENCES tenant.crm_territories(id) ON DELETE CASCADE,
  assignee_type text NOT NULL CHECK (assignee_type IN ('user', 'team', 'party', 'lead', 'opportunity')),
  assignee_id uuid NOT NULL,
  assignment_role text NOT NULL DEFAULT 'primary' CHECK (assignment_role IN ('primary', 'overlay', 'shared', 'manager')),
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'rule', 'import', 'integration')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_from <= effective_to),
  UNIQUE (organization_id, territory_id, assignee_type, assignee_id, effective_from)
);

CREATE TABLE IF NOT EXISTS tenant.crm_quota_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  team_id uuid REFERENCES tenant.crm_sales_teams(id) ON DELETE CASCADE,
  territory_id uuid REFERENCES tenant.crm_territories(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  quota_type text NOT NULL DEFAULT 'revenue' CHECK (quota_type IN ('revenue', 'bookings', 'margin', 'quantity', 'new_logo', 'activity')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  currency_code char(3),
  target_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (target_amount >= 0),
  stretch_amount numeric(18,2) CHECK (stretch_amount IS NULL OR stretch_amount >= target_amount),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed', 'cancelled')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_start <= period_end),
  CHECK (num_nonnulls(team_id, territory_id, user_id) >= 1),
  UNIQUE (organization_id, name, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS tenant.crm_forecast_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  period_type text NOT NULL DEFAULT 'month' CHECK (period_type IN ('week', 'month', 'quarter', 'year', 'custom')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  currency_code char(3),
  freeze_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('planned', 'open', 'frozen', 'closed')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_start <= period_end),
  UNIQUE (organization_id, company_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS tenant.crm_forecast_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES tenant.crm_forecast_periods(id) ON DELETE CASCADE,
  team_id uuid REFERENCES tenant.crm_sales_teams(id) ON DELETE SET NULL,
  territory_id uuid REFERENCES tenant.crm_territories(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  submitted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  pipeline_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (pipeline_amount >= 0),
  best_case_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (best_case_amount >= 0),
  commit_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (commit_amount >= 0),
  closed_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (closed_amount >= 0),
  manager_adjustment numeric(18,2) NOT NULL DEFAULT 0,
  currency_code char(3),
  confidence_percent numeric(5,2) CHECK (confidence_percent BETWEEN 0 AND 100),
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'superseded')),
  submitted_at timestamptz,
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, period_id, company_id, owner_user_id, team_id, territory_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_forecast_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES tenant.crm_forecast_periods(id) ON DELETE CASCADE,
  submission_id uuid REFERENCES tenant.crm_forecast_submissions(id) ON DELETE SET NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  snapshot_type text NOT NULL DEFAULT 'scheduled' CHECK (snapshot_type IN ('scheduled', 'submission', 'approval', 'close', 'manual')),
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  opportunity_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.crm_account_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES tenant.business_parties(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  executive_sponsor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  account_tier text NOT NULL DEFAULT 'standard' CHECK (account_tier IN ('strategic', 'enterprise', 'growth', 'standard', 'long_tail')),
  lifecycle_stage text NOT NULL DEFAULT 'prospect' CHECK (lifecycle_stage IN ('prospect', 'onboarding', 'active', 'at_risk', 'renewal', 'churned')),
  objectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  white_space jsonb NOT NULL DEFAULT '[]'::jsonb,
  success_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  renewal_date date,
  annual_revenue numeric(18,2) NOT NULL DEFAULT 0 CHECK (annual_revenue >= 0),
  potential_revenue numeric(18,2) NOT NULL DEFAULT 0 CHECK (potential_revenue >= 0),
  health_score numeric(5,2) CHECK (health_score BETWEEN 0 AND 100),
  health_status text NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('healthy', 'watch', 'at_risk', 'critical', 'unknown')),
  last_reviewed_at timestamptz,
  next_review_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, party_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_account_stakeholders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  account_plan_id uuid NOT NULL REFERENCES tenant.crm_account_plans(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES tenant.contacts(id) ON DELETE SET NULL,
  name text NOT NULL,
  title text,
  stakeholder_role text NOT NULL DEFAULT 'influencer' CHECK (stakeholder_role IN ('economic_buyer', 'decision_maker', 'champion', 'influencer', 'user', 'blocker', 'procurement', 'legal', 'technical')),
  influence_level text NOT NULL DEFAULT 'medium' CHECK (influence_level IN ('low', 'medium', 'high', 'critical')),
  sentiment text NOT NULL DEFAULT 'neutral' CHECK (sentiment IN ('strong_supporter', 'supporter', 'neutral', 'detractor', 'strong_detractor', 'unknown')),
  relationship_owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  engagement_score numeric(5,2) CHECK (engagement_score BETWEEN 0 AND 100),
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.crm_playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  pipeline_id uuid REFERENCES tenant.crm_pipelines(id) ON DELETE SET NULL,
  name text NOT NULL,
  framework text NOT NULL DEFAULT 'custom' CHECK (framework IN ('bant', 'meddic', 'meddpicc', 'spin', 'challenger', 'custom')),
  description text,
  guidance text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'inactive', 'archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_playbook_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  playbook_id uuid NOT NULL REFERENCES tenant.crm_playbooks(id) ON DELETE CASCADE,
  stage_id uuid REFERENCES tenant.crm_pipeline_stages(id) ON DELETE SET NULL,
  question_key text NOT NULL,
  prompt text NOT NULL,
  response_type text NOT NULL DEFAULT 'text' CHECK (response_type IN ('text', 'number', 'date', 'boolean', 'select', 'multi_select')),
  response_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  required boolean NOT NULL DEFAULT false,
  blocks_stage_exit boolean NOT NULL DEFAULT false,
  sequence integer NOT NULL DEFAULT 100,
  scoring_weight numeric(8,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, playbook_id, question_key)
);

CREATE TABLE IF NOT EXISTS tenant.crm_playbook_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  playbook_id uuid NOT NULL REFERENCES tenant.crm_playbooks(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES tenant.crm_playbook_questions(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES tenant.crm_opportunities(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES tenant.crm_leads(id) ON DELETE CASCADE,
  response jsonb NOT NULL DEFAULT 'null'::jsonb,
  responded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  responded_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'integration', 'ai_suggestion')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(opportunity_id, lead_id) = 1),
  UNIQUE (organization_id, question_id, opportunity_id, lead_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES tenant.crm_leads(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES tenant.contacts(id) ON DELETE CASCADE,
  party_id uuid REFERENCES tenant.business_parties(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'call', 'postal', 'all')),
  purpose text NOT NULL DEFAULT 'sales' CHECK (purpose IN ('sales', 'marketing', 'service', 'transactional', 'research', 'other')),
  action text NOT NULL CHECK (action IN ('granted', 'withdrawn', 'suppressed', 'resubscribed', 'expired')),
  lawful_basis text CHECK (lawful_basis IN ('consent', 'contract', 'legal_obligation', 'legitimate_interest', 'vital_interest', 'public_task')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('form', 'manual', 'import', 'integration', 'preference_center', 'system')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(lead_id, contact_id, party_id) >= 1)
);

CREATE TABLE IF NOT EXISTS tenant.crm_privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('access', 'export', 'correction', 'deletion', 'restriction', 'objection', 'consent_withdrawal')),
  subject_type text NOT NULL CHECK (subject_type IN ('lead', 'contact', 'party')),
  subject_id uuid NOT NULL,
  requester_name text,
  requester_email text,
  identity_verified_at timestamptz,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'verification_pending', 'in_progress', 'completed', 'rejected', 'cancelled')),
  resolution_notes text,
  completed_at timestamptz,
  assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.crm_data_quality_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'opportunity', 'party', 'contact')),
  entity_id uuid NOT NULL,
  completeness_score numeric(5,2) NOT NULL CHECK (completeness_score BETWEEN 0 AND 100),
  validity_score numeric(5,2) NOT NULL CHECK (validity_score BETWEEN 0 AND 100),
  freshness_score numeric(5,2) NOT NULL CHECK (freshness_score BETWEEN 0 AND 100),
  duplicate_risk_score numeric(5,2) NOT NULL CHECK (duplicate_risk_score BETWEEN 0 AND 100),
  overall_score numeric(5,2) NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  calculation_version text NOT NULL DEFAULT 'v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS crm_sales_team_members_user_idx
  ON tenant.crm_sales_team_members(organization_id, user_id, status);
CREATE INDEX IF NOT EXISTS crm_territory_assignments_assignee_idx
  ON tenant.crm_territory_assignments(organization_id, assignee_type, assignee_id, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS crm_quota_period_idx
  ON tenant.crm_quota_plans(organization_id, period_start, period_end, status);
CREATE INDEX IF NOT EXISTS crm_forecast_submission_period_idx
  ON tenant.crm_forecast_submissions(organization_id, period_id, status, owner_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_forecast_submission_identity_idx
  ON tenant.crm_forecast_submissions(
    organization_id,
    period_id,
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(territory_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE UNIQUE INDEX IF NOT EXISTS crm_playbook_response_opportunity_idx
  ON tenant.crm_playbook_responses(organization_id, question_id, opportunity_id)
  WHERE opportunity_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS crm_playbook_response_lead_idx
  ON tenant.crm_playbook_responses(organization_id, question_id, lead_id)
  WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_account_plan_health_idx
  ON tenant.crm_account_plans(organization_id, health_status, next_review_at);
CREATE INDEX IF NOT EXISTS crm_consent_subject_idx
  ON tenant.crm_consent_events(organization_id, lead_id, contact_id, party_id, channel, occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_privacy_due_idx
  ON tenant.crm_privacy_requests(organization_id, status, due_at);
CREATE INDEX IF NOT EXISTS crm_data_quality_entity_idx
  ON tenant.crm_data_quality_scores(organization_id, entity_type, overall_score);

DO $$
DECLARE
  relation_name text;
BEGIN
  FOR relation_name IN
    SELECT tables.table_name
    FROM information_schema.tables AS tables
    WHERE tables.table_schema = 'tenant'
      AND tables.table_name LIKE 'crm_%'
      AND tables.table_type = 'BASE TABLE'
    ORDER BY tables.table_name
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('DROP POLICY IF EXISTS organization_isolation ON tenant.%I', relation_name);
    EXECUTE format(
      'CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())',
      relation_name
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  relation_name text;
BEGIN
  FOR relation_name IN
    SELECT columns_catalog.table_name
    FROM information_schema.columns AS columns_catalog
    WHERE columns_catalog.table_schema = 'tenant'
      AND columns_catalog.table_name LIKE 'crm_%'
      AND columns_catalog.column_name = 'updated_at'
    ORDER BY columns_catalog.table_name
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS touch_updated_at ON tenant.%I', relation_name);
    EXECUTE format(
      'CREATE TRIGGER touch_updated_at BEFORE UPDATE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at()',
      relation_name
    );
  END LOOP;
END;
$$;

INSERT INTO tenant.crm_sales_teams (
  organization_id, company_id, code, name, manager_user_id,
  default_pipeline_id, currency_code, created_by, updated_by
)
SELECT
  organization.id,
  company.id,
  'PRIMARY',
  'Primary sales team',
  organization.created_by,
  pipeline.id,
  company.base_currency,
  organization.created_by,
  organization.created_by
FROM public.organizations organization
LEFT JOIN public.companies company
  ON company.organization_id = organization.id AND company.is_primary = true
LEFT JOIN tenant.crm_pipelines pipeline
  ON pipeline.organization_id = organization.id AND pipeline.code = 'STANDARD'
ON CONFLICT (organization_id, code) DO NOTHING;

COMMIT;
