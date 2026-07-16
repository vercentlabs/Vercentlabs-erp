BEGIN;

CREATE SCHEMA IF NOT EXISTS tenant;

CREATE OR REPLACE FUNCTION tenant.crm_normalize_email(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(lower(btrim(COALESCE(value, ''))), '')
$$;

CREATE OR REPLACE FUNCTION tenant.crm_normalize_phone(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(COALESCE(value, ''), '[^0-9]+', '', 'g'), '')
$$;

CREATE TABLE IF NOT EXISTS tenant.crm_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  default_pipeline_id uuid,
  default_currency_code char(3),
  inactivity_days integer NOT NULL DEFAULT 14 CHECK (inactivity_days BETWEEN 1 AND 365),
  duplicate_policy text NOT NULL DEFAULT 'warn' CHECK (duplicate_policy IN ('allow', 'warn', 'block')),
  auto_create_follow_up boolean NOT NULL DEFAULT true,
  lead_response_target_minutes integer NOT NULL DEFAULT 60 CHECK (lead_response_target_minutes BETWEEN 1 AND 10080),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.crm_pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  description text,
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_pipelines_default_idx
  ON tenant.crm_pipelines(organization_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_default = true AND status = 'active';

CREATE TABLE IF NOT EXISTS tenant.crm_pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES tenant.crm_pipelines(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  probability numeric(5,2) NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  forecast_category text NOT NULL DEFAULT 'pipeline' CHECK (
    forecast_category IN ('omitted', 'pipeline', 'best_case', 'committed', 'closed')
  ),
  is_won boolean NOT NULL DEFAULT false,
  is_lost boolean NOT NULL DEFAULT false,
  stale_after_days integer CHECK (stale_after_days BETWEEN 1 AND 365),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (is_won AND is_lost)),
  UNIQUE (organization_id, pipeline_id, code),
  UNIQUE (organization_id, pipeline_id, sequence)
);

ALTER TABLE tenant.crm_settings
  DROP CONSTRAINT IF EXISTS crm_settings_default_pipeline_id_fkey;
ALTER TABLE tenant.crm_settings
  ADD CONSTRAINT crm_settings_default_pipeline_id_fkey
  FOREIGN KEY (default_pipeline_id) REFERENCES tenant.crm_pipelines(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS tenant.crm_lead_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  channel text NOT NULL DEFAULT 'other' CHECK (
    channel IN ('website', 'referral', 'partner', 'event', 'advertising', 'social', 'email', 'phone', 'walk_in', 'import', 'other')
  ),
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.crm_lost_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  category text NOT NULL DEFAULT 'other' CHECK (
    category IN ('price', 'competition', 'timing', 'budget', 'fit', 'no_response', 'duplicate', 'other')
  ),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.crm_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#475569',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  campaign_type text NOT NULL DEFAULT 'other' CHECK (
    campaign_type IN ('email', 'event', 'webinar', 'advertising', 'social', 'partner', 'referral', 'outbound', 'other')
  ),
  status text NOT NULL DEFAULT 'planned' CHECK (
    status IN ('planned', 'active', 'paused', 'completed', 'cancelled')
  ),
  start_date date,
  end_date date,
  budget numeric(18,2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
  expected_revenue numeric(18,2) NOT NULL DEFAULT 0 CHECK (expected_revenue >= 0),
  actual_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (actual_cost >= 0),
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  description text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.crm_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  code text NOT NULL,
  first_name text NOT NULL,
  last_name text,
  full_name text GENERATED ALWAYS AS (btrim(first_name || ' ' || COALESCE(last_name, ''))) STORED,
  email text,
  normalized_email text GENERATED ALWAYS AS (tenant.crm_normalize_email(email)) STORED,
  phone text,
  mobile text,
  normalized_phone text GENERATED ALWAYS AS (tenant.crm_normalize_phone(COALESCE(mobile, phone))) STORED,
  company_name text,
  job_title text,
  website text,
  industry text,
  source_id uuid REFERENCES tenant.crm_lead_sources(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES tenant.crm_campaigns(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'new' CHECK (
    status IN ('new', 'contacted', 'working', 'qualified', 'unqualified', 'converted', 'archived')
  ),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  rating text NOT NULL DEFAULT 'warm' CHECK (rating IN ('cold', 'warm', 'hot')),
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  score integer NOT NULL DEFAULT 0 CHECK (score BETWEEN -10000 AND 10000),
  estimated_value numeric(18,2) NOT NULL DEFAULT 0 CHECK (estimated_value >= 0),
  currency_code char(3),
  city text,
  state text,
  country_code char(2),
  product_interest text,
  next_follow_up_at timestamptz,
  first_responded_at timestamptz,
  last_contacted_at timestamptz,
  consent_email boolean NOT NULL DEFAULT false,
  consent_sms boolean NOT NULL DEFAULT false,
  consent_whatsapp boolean NOT NULL DEFAULT false,
  do_not_contact boolean NOT NULL DEFAULT false,
  unqualified_reason text,
  converted_at timestamptz,
  converted_party_id uuid REFERENCES tenant.business_parties(id) ON DELETE SET NULL,
  converted_contact_id uuid REFERENCES tenant.contacts(id) ON DELETE SET NULL,
  converted_opportunity_id uuid,
  custom_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS crm_leads_owner_status_idx
  ON tenant.crm_leads(organization_id, owner_user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS crm_leads_company_branch_idx
  ON tenant.crm_leads(organization_id, company_id, branch_id, status);
CREATE INDEX IF NOT EXISTS crm_leads_email_idx
  ON tenant.crm_leads(organization_id, normalized_email)
  WHERE normalized_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_leads_phone_idx
  ON tenant.crm_leads(organization_id, normalized_phone)
  WHERE normalized_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_leads_search_idx
  ON tenant.crm_leads USING gin (
    to_tsvector('simple', COALESCE(full_name, '') || ' ' || COALESCE(company_name, '') || ' ' || COALESCE(email, '') || ' ' || COALESCE(mobile, ''))
  );

CREATE TABLE IF NOT EXISTS tenant.crm_lead_tags (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES tenant.crm_leads(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tenant.crm_tags(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, lead_id, tag_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_scoring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  sequence integer NOT NULL DEFAULT 100,
  field_name text NOT NULL,
  operator text NOT NULL CHECK (
    operator IN ('equals', 'not_equals', 'contains', 'not_empty', 'empty', 'greater_than', 'less_than', 'in')
  ),
  comparison_value jsonb,
  points integer NOT NULL CHECK (points BETWEEN -1000 AND 1000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_score_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES tenant.crm_leads(id) ON DELETE CASCADE,
  previous_score integer NOT NULL,
  new_score integer NOT NULL,
  reason text NOT NULL,
  rule_id uuid REFERENCES tenant.crm_scoring_rules(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.crm_assignment_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  sequence integer NOT NULL DEFAULT 100,
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  assignment_mode text NOT NULL DEFAULT 'fixed' CHECK (assignment_mode IN ('fixed', 'round_robin')),
  assignee_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  round_robin_user_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (assignment_mode = 'fixed' AND assignee_user_id IS NOT NULL)
    OR (assignment_mode = 'round_robin' AND cardinality(round_robin_user_ids) > 0)
  ),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_round_robin_state (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assignment_rule_id uuid NOT NULL REFERENCES tenant.crm_assignment_rules(id) ON DELETE CASCADE,
  next_index integer NOT NULL DEFAULT 0 CHECK (next_index >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, assignment_rule_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  code text NOT NULL,
  pipeline_id uuid NOT NULL REFERENCES tenant.crm_pipelines(id) ON DELETE RESTRICT,
  stage_id uuid NOT NULL REFERENCES tenant.crm_pipeline_stages(id) ON DELETE RESTRICT,
  lead_id uuid REFERENCES tenant.crm_leads(id) ON DELETE SET NULL,
  party_id uuid REFERENCES tenant.business_parties(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES tenant.contacts(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES tenant.crm_campaigns(id) ON DELETE SET NULL,
  source_id uuid REFERENCES tenant.crm_lead_sources(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency_code char(3),
  probability numeric(5,2) NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  expected_close_date date,
  actual_close_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'abandoned', 'archived')),
  forecast_category text NOT NULL DEFAULT 'pipeline' CHECK (
    forecast_category IN ('omitted', 'pipeline', 'best_case', 'committed', 'closed')
  ),
  next_step text,
  lost_reason_id uuid REFERENCES tenant.crm_lost_reasons(id) ON DELETE SET NULL,
  loss_notes text,
  last_activity_at timestamptz,
  custom_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

ALTER TABLE tenant.crm_leads
  DROP CONSTRAINT IF EXISTS crm_leads_converted_opportunity_id_fkey;
ALTER TABLE tenant.crm_leads
  ADD CONSTRAINT crm_leads_converted_opportunity_id_fkey
  FOREIGN KEY (converted_opportunity_id) REFERENCES tenant.crm_opportunities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS crm_opportunities_pipeline_idx
  ON tenant.crm_opportunities(organization_id, pipeline_id, stage_id, status, expected_close_date);
CREATE INDEX IF NOT EXISTS crm_opportunities_owner_idx
  ON tenant.crm_opportunities(organization_id, owner_user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS tenant.crm_opportunity_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES tenant.crm_opportunities(id) ON DELETE CASCADE,
  from_stage_id uuid REFERENCES tenant.crm_pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id uuid NOT NULL REFERENCES tenant.crm_pipeline_stages(id) ON DELETE RESTRICT,
  probability numeric(5,2) NOT NULL,
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  note text
);

CREATE TABLE IF NOT EXISTS tenant.crm_opportunity_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES tenant.crm_opportunities(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES tenant.items(id) ON DELETE RESTRICT,
  price_list_id uuid REFERENCES tenant.price_lists(id) ON DELETE SET NULL,
  description text,
  quantity numeric(18,6) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(18,6) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  discount_percent numeric(9,4) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  tax_percent numeric(9,4) NOT NULL DEFAULT 0 CHECK (tax_percent BETWEEN 0 AND 100),
  line_subtotal numeric(18,2) GENERATED ALWAYS AS (round((quantity * unit_price * (1 - discount_percent / 100))::numeric, 2)) STORED,
  line_total numeric(18,2) GENERATED ALWAYS AS (round((quantity * unit_price * (1 - discount_percent / 100) * (1 + tax_percent / 100))::numeric, 2)) STORED,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.crm_competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  website text,
  strengths text,
  weaknesses text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_opportunity_competitors (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES tenant.crm_opportunities(id) ON DELETE CASCADE,
  competitor_id uuid NOT NULL REFERENCES tenant.crm_competitors(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, opportunity_id, competitor_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'opportunity', 'party', 'contact', 'campaign', 'general')),
  entity_id uuid,
  activity_type text NOT NULL CHECK (
    activity_type IN ('task', 'call', 'meeting', 'email', 'whatsapp', 'sms', 'note')
  ),
  subject text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'planned' CHECK (
    status IN ('planned', 'in_progress', 'completed', 'cancelled', 'overdue')
  ),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  start_at timestamptz,
  due_at timestamptz,
  end_at timestamptz,
  reminder_at timestamptz,
  completed_at timestamptz,
  outcome text,
  location text,
  external_id text,
  recurring_rule text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_at IS NULL OR end_at IS NULL OR start_at <= end_at)
);

CREATE INDEX IF NOT EXISTS crm_activities_due_idx
  ON tenant.crm_activities(organization_id, assigned_to, status, due_at);
CREATE INDEX IF NOT EXISTS crm_activities_entity_idx
  ON tenant.crm_activities(organization_id, entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant.crm_activity_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES tenant.crm_activities(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES tenant.contacts(id) ON DELETE SET NULL,
  name text,
  email text,
  response_status text NOT NULL DEFAULT 'needs_action' CHECK (
    response_status IN ('needs_action', 'accepted', 'declined', 'tentative')
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.crm_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'opportunity', 'party', 'contact', 'campaign')),
  entity_id uuid NOT NULL,
  body text NOT NULL,
  is_pinned boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.crm_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp', 'sms', 'call', 'chat', 'other')),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  lead_id uuid REFERENCES tenant.crm_leads(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES tenant.crm_opportunities(id) ON DELETE SET NULL,
  party_id uuid REFERENCES tenant.business_parties(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES tenant.contacts(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'manual',
  provider_message_id text,
  subject text,
  body text,
  from_address text,
  to_addresses text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'logged' CHECK (
    status IN ('draft', 'queued', 'sent', 'delivered', 'read', 'failed', 'received', 'logged')
  ),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider, provider_message_id)
);

CREATE INDEX IF NOT EXISTS crm_communications_timeline_idx
  ON tenant.crm_communications(organization_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS tenant.crm_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sequence_id uuid NOT NULL REFERENCES tenant.crm_sequences(id) ON DELETE CASCADE,
  step_order integer NOT NULL CHECK (step_order > 0),
  delay_minutes integer NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0),
  action_type text NOT NULL CHECK (action_type IN ('task', 'call', 'email', 'whatsapp', 'sms')),
  subject_template text,
  body_template text,
  assigned_to_owner boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sequence_id, step_order)
);

CREATE TABLE IF NOT EXISTS tenant.crm_sequence_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sequence_id uuid NOT NULL REFERENCES tenant.crm_sequences(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES tenant.crm_leads(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES tenant.contacts(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES tenant.crm_opportunities(id) ON DELETE CASCADE,
  current_step integer NOT NULL DEFAULT 0 CHECK (current_step >= 0),
  next_run_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  enrolled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (num_nonnulls(lead_id, contact_id, opportunity_id) = 1)
);

CREATE TABLE IF NOT EXISTS tenant.crm_capture_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  name text NOT NULL,
  public_key text NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),
  source_id uuid REFERENCES tenant.crm_lead_sources(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES tenant.crm_campaigns(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  allowed_origins text[] NOT NULL DEFAULT ARRAY[]::text[],
  required_fields text[] NOT NULL DEFAULT ARRAY['firstName']::text[],
  success_message text NOT NULL DEFAULT 'Thank you. Our team will contact you shortly.',
  rate_limit_per_hour integer NOT NULL DEFAULT 60 CHECK (rate_limit_per_hour BETWEEN 1 AND 10000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (public_key),
  UNIQUE (organization_id, name)
);

CREATE OR REPLACE FUNCTION tenant.crm_public_capture_form(form_key text)
RETURNS SETOF tenant.crm_capture_forms
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = tenant, public
AS $$
  SELECT form.*
  FROM tenant.crm_capture_forms form
  WHERE form.public_key = form_key
    AND form.status = 'active'
  LIMIT 1
$$;

CREATE TABLE IF NOT EXISTS tenant.crm_capture_rate_limits (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES tenant.crm_capture_forms(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  PRIMARY KEY (organization_id, form_id, fingerprint, window_started_at)
);

CREATE TABLE IF NOT EXISTS tenant.crm_campaign_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES tenant.crm_campaigns(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES tenant.crm_leads(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES tenant.contacts(id) ON DELETE CASCADE,
  party_id uuid REFERENCES tenant.business_parties(id) ON DELETE CASCADE,
  member_status text NOT NULL DEFAULT 'sent' CHECK (
    member_status IN ('planned', 'sent', 'responded', 'attended', 'converted', 'unsubscribed')
  ),
  responded_at timestamptz,
  converted_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(lead_id, contact_id, party_id) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_campaign_members_lead_idx
  ON tenant.crm_campaign_members(organization_id, campaign_id, lead_id)
  WHERE lead_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS crm_campaign_members_contact_idx
  ON tenant.crm_campaign_members(organization_id, campaign_id, contact_id)
  WHERE contact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS crm_campaign_members_party_idx
  ON tenant.crm_campaign_members(organization_id, campaign_id, party_id)
  WHERE party_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.crm_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  resource text NOT NULL CHECK (resource IN ('leads', 'opportunities', 'activities', 'campaigns', 'communications')),
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort jsonb NOT NULL DEFAULT '{}'::jsonb,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, resource, name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  event_type text NOT NULL CHECK (
    event_type IN ('lead.created', 'lead.updated', 'lead.qualified', 'opportunity.created', 'opportunity.stage_changed', 'activity.overdue', 'campaign.member_responded')
  ),
  sequence integer NOT NULL DEFAULT 100,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES tenant.crm_automation_rules(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded', 'failed', 'skipped')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS tenant.crm_conversion_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES tenant.crm_leads(id) ON DELETE RESTRICT,
  party_id uuid NOT NULL REFERENCES tenant.business_parties(id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES tenant.contacts(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES tenant.crm_opportunities(id) ON DELETE SET NULL,
  converted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  converted_at timestamptz NOT NULL DEFAULT now(),
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organization_id, lead_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_merge_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('lead')),
  source_id uuid NOT NULL,
  target_id uuid NOT NULL,
  merged_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (source_id <> target_id),
  UNIQUE (organization_id, entity_type, source_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_forecast_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  currency_code char(3),
  target_amount numeric(18,2) NOT NULL CHECK (target_amount >= 0),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_start <= period_end),
  UNIQUE (organization_id, company_id, user_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS tenant.crm_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('gmail', 'microsoft365', 'whatsapp', 'twilio', 'zoom', 'webhook', 'other')),
  display_name text NOT NULL,
  credential_reference text,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connected', 'error', 'disabled')),
  last_synced_at timestamptz,
  last_error text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider, display_name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_webhook_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  endpoint_url text NOT NULL,
  event_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  secret_reference text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'failed', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_outbox_pending_idx
  ON tenant.crm_outbox_events(organization_id, status, next_attempt_at)
  WHERE status IN ('pending', 'failed');

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

WITH pipeline_seed AS (
  INSERT INTO tenant.crm_pipelines (
    organization_id, name, code, description, is_default, created_by, updated_by
  )
  SELECT
    o.id,
    'Standard sales pipeline',
    'STANDARD',
    'Default lead-to-customer opportunity pipeline.',
    true,
    o.created_by,
    o.created_by
  FROM public.organizations o
  ON CONFLICT (organization_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_default = true,
    updated_by = EXCLUDED.updated_by
  RETURNING id, organization_id
)
INSERT INTO tenant.crm_pipeline_stages (
  organization_id, pipeline_id, name, code, sequence, probability,
  forecast_category, is_won, is_lost, stale_after_days
)
SELECT p.organization_id, p.id, stage.name, stage.code, stage.sequence,
       stage.probability, stage.forecast_category, stage.is_won,
       stage.is_lost, stage.stale_after_days
FROM pipeline_seed p
CROSS JOIN (
  VALUES
    ('Qualification', 'QUALIFICATION', 10, 10::numeric, 'pipeline', false, false, 7),
    ('Needs analysis', 'NEEDS_ANALYSIS', 20, 25::numeric, 'pipeline', false, false, 10),
    ('Value proposition', 'VALUE_PROPOSITION', 30, 40::numeric, 'best_case', false, false, 14),
    ('Proposal', 'PROPOSAL', 40, 60::numeric, 'best_case', false, false, 14),
    ('Negotiation', 'NEGOTIATION', 50, 80::numeric, 'committed', false, false, 10),
    ('Closed won', 'CLOSED_WON', 60, 100::numeric, 'closed', true, false, NULL::integer),
    ('Closed lost', 'CLOSED_LOST', 70, 0::numeric, 'closed', false, true, NULL::integer)
) AS stage(name, code, sequence, probability, forecast_category, is_won, is_lost, stale_after_days)
ON CONFLICT (organization_id, pipeline_id, code) DO NOTHING;

INSERT INTO tenant.crm_settings (
  organization_id, default_pipeline_id, default_currency_code, created_by, updated_by
)
SELECT
  o.id,
  p.id,
  c.base_currency,
  o.created_by,
  o.created_by
FROM public.organizations o
JOIN tenant.crm_pipelines p
  ON p.organization_id = o.id AND p.code = 'STANDARD'
LEFT JOIN public.companies c
  ON c.organization_id = o.id AND c.is_primary = true
ON CONFLICT (organization_id) DO UPDATE SET
  default_pipeline_id = COALESCE(tenant.crm_settings.default_pipeline_id, EXCLUDED.default_pipeline_id),
  default_currency_code = COALESCE(tenant.crm_settings.default_currency_code, EXCLUDED.default_currency_code),
  updated_by = EXCLUDED.updated_by;

INSERT INTO tenant.crm_lead_sources (
  organization_id, name, code, channel, is_default, created_by, updated_by
)
SELECT o.id, source.name, source.code, source.channel, source.is_default, o.created_by, o.created_by
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('Website', 'WEBSITE', 'website', true),
    ('Referral', 'REFERRAL', 'referral', false),
    ('Partner', 'PARTNER', 'partner', false),
    ('Event', 'EVENT', 'event', false),
    ('Phone enquiry', 'PHONE', 'phone', false),
    ('Walk-in', 'WALK_IN', 'walk_in', false),
    ('Import', 'IMPORT', 'import', false),
    ('Other', 'OTHER', 'other', false)
) AS source(name, code, channel, is_default)
ON CONFLICT (organization_id, code) DO NOTHING;

INSERT INTO tenant.crm_lost_reasons (
  organization_id, name, code, category, created_by, updated_by
)
SELECT o.id, reason.name, reason.code, reason.category, o.created_by, o.created_by
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('Price too high', 'PRICE', 'price'),
    ('Lost to competitor', 'COMPETITION', 'competition'),
    ('No budget', 'NO_BUDGET', 'budget'),
    ('Timing not right', 'TIMING', 'timing'),
    ('Not a fit', 'NOT_FIT', 'fit'),
    ('No response', 'NO_RESPONSE', 'no_response'),
    ('Duplicate', 'DUPLICATE', 'duplicate'),
    ('Other', 'OTHER', 'other')
) AS reason(name, code, category)
ON CONFLICT (organization_id, code) DO NOTHING;

INSERT INTO tenant.crm_tags (
  organization_id, name, color, created_by, updated_by
)
SELECT o.id, tag.name, tag.color, o.created_by, o.created_by
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('High intent', '#b91c1c'),
    ('Follow up', '#0369a1'),
    ('Enterprise', '#6d28d9'),
    ('SME', '#047857')
) AS tag(name, color)
ON CONFLICT (organization_id, name) DO NOTHING;

COMMIT;
