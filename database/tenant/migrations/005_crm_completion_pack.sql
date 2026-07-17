BEGIN;

CREATE TABLE IF NOT EXISTS tenant.crm_engagement_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  template_type text NOT NULL CHECK (template_type IN ('email', 'sms', 'whatsapp', 'call_script', 'snippet')),
  name text NOT NULL,
  subject_template text,
  body_template text NOT NULL,
  language_code text NOT NULL DEFAULT 'en-IN',
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  is_shared boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'inactive', 'archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, company_id, template_type, name, version),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_meeting_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  buffer_before_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_before_minutes BETWEEN 0 AND 240),
  buffer_after_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_after_minutes BETWEEN 0 AND 240),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  availability jsonb NOT NULL DEFAULT '{}'::jsonb,
  meeting_provider text NOT NULL DEFAULT 'manual' CHECK (meeting_provider IN ('manual', 'google_meet', 'microsoft_teams', 'zoom', 'other')),
  location_template text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, slug),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_sync_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('gmail', 'microsoft365', 'imap', 'calendar', 'telephony', 'whatsapp', 'other')),
  external_account_id text,
  display_name text NOT NULL,
  credential_reference text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  sync_direction text NOT NULL DEFAULT 'two_way' CHECK (sync_direction IN ('inbound', 'outbound', 'two_way')),
  sync_cursor text,
  last_synced_at timestamptz,
  last_error text,
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connected', 'syncing', 'error', 'disabled')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, provider, user_id, external_account_id),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  lead_id uuid,
  opportunity_id uuid,
  party_id uuid,
  contact_id uuid,
  communication_id uuid,
  channel text NOT NULL CHECK (channel IN ('call', 'meeting', 'video', 'email_thread', 'chat', 'other')),
  provider text,
  external_id text,
  title text,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  recording_reference text,
  transcript_status text NOT NULL DEFAULT 'not_requested' CHECK (transcript_status IN ('not_requested', 'queued', 'processing', 'ready', 'failed', 'redacted')),
  consent_status text NOT NULL DEFAULT 'unknown' CHECK (consent_status IN ('granted', 'not_required', 'denied', 'unknown')),
  retention_until timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'failed', 'archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, provider, external_id),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, opportunity_id) REFERENCES tenant.crm_opportunities(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, party_id) REFERENCES tenant.business_parties(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, contact_id) REFERENCES tenant.contacts(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, communication_id) REFERENCES tenant.crm_communications(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_conversation_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  conversation_id uuid NOT NULL,
  insight_type text NOT NULL CHECK (insight_type IN ('summary', 'sentiment', 'topic', 'objection', 'commitment', 'next_action', 'risk', 'coaching')),
  title text NOT NULL,
  content text NOT NULL,
  score numeric(6,3),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_provider text,
  model_name text,
  requires_review boolean NOT NULL DEFAULT true,
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected', 'superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, conversation_id) REFERENCES tenant.crm_conversations(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_pipeline_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  opportunity_id uuid NOT NULL,
  inspected_at timestamptz NOT NULL DEFAULT now(),
  stage_age_days integer NOT NULL DEFAULT 0 CHECK (stage_age_days >= 0),
  days_since_activity integer NOT NULL DEFAULT 0 CHECK (days_since_activity >= 0),
  close_date_slip_days integer NOT NULL DEFAULT 0,
  amount_change numeric(18,2) NOT NULL DEFAULT 0,
  probability_change numeric(7,2) NOT NULL DEFAULT 0,
  health_score numeric(5,2) NOT NULL CHECK (health_score BETWEEN 0 AND 100),
  health_status text NOT NULL CHECK (health_status IN ('healthy', 'watch', 'at_risk', 'critical')),
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculation_version text NOT NULL DEFAULT 'v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, opportunity_id, inspected_at),
  FOREIGN KEY (organization_id, opportunity_id) REFERENCES tenant.crm_opportunities(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_deal_risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  opportunity_id uuid NOT NULL,
  risk_type text NOT NULL CHECK (risk_type IN ('stale_activity', 'close_date_slip', 'missing_stakeholder', 'missing_next_step', 'low_engagement', 'competitor', 'pricing', 'qualification', 'forecast', 'custom')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title text NOT NULL,
  description text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution_notes text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, opportunity_id) REFERENCES tenant.crm_opportunities(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'opportunity', 'party', 'contact', 'conversation')),
  entity_id uuid NOT NULL,
  recommendation_type text NOT NULL CHECK (recommendation_type IN ('next_best_action', 'follow_up', 'stakeholder', 'content', 'risk_mitigation', 'cross_sell', 'upsell', 'renewal', 'data_quality')),
  title text NOT NULL,
  rationale text NOT NULL,
  action_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  confidence numeric(5,2) CHECK (confidence BETWEEN 0 AND 100),
  source text NOT NULL DEFAULT 'rules' CHECK (source IN ('rules', 'ai', 'manual')),
  model_provider text,
  model_name text,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'completed', 'rejected', 'expired', 'superseded')),
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_buying_committees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  party_id uuid NOT NULL,
  opportunity_id uuid,
  name text NOT NULL,
  decision_process text,
  decision_date date,
  coverage_score numeric(5,2) NOT NULL DEFAULT 0 CHECK (coverage_score BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'complete', 'inactive', 'archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, party_id) REFERENCES tenant.business_parties(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, opportunity_id) REFERENCES tenant.crm_opportunities(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_buying_committee_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  committee_id uuid NOT NULL,
  contact_id uuid,
  name text NOT NULL,
  member_role text NOT NULL DEFAULT 'influencer' CHECK (member_role IN ('economic_buyer', 'decision_maker', 'champion', 'influencer', 'user', 'blocker', 'procurement', 'legal', 'technical')),
  influence_level text NOT NULL DEFAULT 'medium' CHECK (influence_level IN ('low', 'medium', 'high', 'critical')),
  sentiment text NOT NULL DEFAULT 'unknown' CHECK (sentiment IN ('strong_supporter', 'supporter', 'neutral', 'detractor', 'strong_detractor', 'unknown')),
  engagement_score numeric(5,2) NOT NULL DEFAULT 0 CHECK (engagement_score BETWEEN 0 AND 100),
  authority_confirmed boolean NOT NULL DEFAULT false,
  relationship_owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  gaps text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, committee_id) REFERENCES tenant.crm_buying_committees(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, contact_id) REFERENCES tenant.contacts(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_relationship_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  from_entity_type text NOT NULL CHECK (from_entity_type IN ('user', 'party', 'contact', 'lead', 'opportunity', 'partner')),
  from_entity_id uuid NOT NULL,
  to_entity_type text NOT NULL CHECK (to_entity_type IN ('user', 'party', 'contact', 'lead', 'opportunity', 'partner')),
  to_entity_id uuid NOT NULL,
  relationship_type text NOT NULL CHECK (relationship_type IN ('reports_to', 'knows', 'introduced_by', 'influences', 'champions', 'blocks', 'partner_of', 'subsidiary_of', 'custom')),
  strength numeric(5,2) NOT NULL DEFAULT 50 CHECK (strength BETWEEN 0 AND 100),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'integration', 'ai')),
  valid_from date,
  valid_to date,
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'expired')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CHECK (from_entity_type <> to_entity_type OR from_entity_id <> to_entity_id),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_account_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  party_id uuid NOT NULL,
  opportunity_id uuid,
  signal_type text NOT NULL CHECK (signal_type IN ('intent', 'engagement', 'product_usage', 'financial', 'service', 'renewal', 'competitive', 'news', 'manual')),
  title text NOT NULL,
  description text,
  signal_value text,
  score numeric(6,2),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  source text NOT NULL DEFAULT 'manual',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, party_id) REFERENCES tenant.business_parties(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, opportunity_id) REFERENCES tenant.crm_opportunities(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_partner_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  party_id uuid NOT NULL,
  name text NOT NULL,
  partner_type text NOT NULL CHECK (partner_type IN ('referral', 'reseller', 'distributor', 'system_integrator', 'technology', 'affiliate', 'other')),
  tier text NOT NULL DEFAULT 'registered' CHECK (tier IN ('registered', 'silver', 'gold', 'platinum', 'strategic')),
  region text,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  agreement_start date,
  agreement_end date,
  referral_percent numeric(7,4) NOT NULL DEFAULT 0 CHECK (referral_percent BETWEEN 0 AND 100),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('prospect', 'active', 'suspended', 'inactive', 'archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, party_id),
  FOREIGN KEY (organization_id, party_id) REFERENCES tenant.business_parties(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_partner_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  partner_account_id uuid NOT NULL,
  opportunity_id uuid,
  lead_id uuid,
  deal_registration_code text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  partner_owner_name text,
  internal_owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  expected_value numeric(18,2) NOT NULL DEFAULT 0,
  currency_code text NOT NULL DEFAULT 'INR',
  contribution_percent numeric(7,2) NOT NULL DEFAULT 0 CHECK (contribution_percent BETWEEN 0 AND 100),
  notes text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected', 'active', 'won', 'lost', 'expired', 'cancelled')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, deal_registration_code),
  FOREIGN KEY (organization_id, partner_account_id) REFERENCES tenant.crm_partner_accounts(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, opportunity_id) REFERENCES tenant.crm_opportunities(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE SET NULL,
  CHECK (num_nonnulls(opportunity_id, lead_id) >= 1),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_report_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  name text NOT NULL,
  resource text NOT NULL,
  description text,
  dimensions jsonb NOT NULL DEFAULT '[]'::jsonb,
  measures jsonb NOT NULL DEFAULT '[]'::jsonb,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  visualization text NOT NULL DEFAULT 'table' CHECK (visualization IN ('table', 'metric', 'bar', 'line', 'area', 'funnel', 'pie')),
  is_shared boolean NOT NULL DEFAULT false,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'inactive', 'archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, company_id, name),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  name text NOT NULL,
  description text,
  audience text NOT NULL DEFAULT 'private' CHECK (audience IN ('private', 'team', 'company', 'organization')),
  is_default boolean NOT NULL DEFAULT false,
  layout jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, company_id, name),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_dashboard_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  dashboard_id uuid NOT NULL,
  report_definition_id uuid,
  title text NOT NULL,
  widget_type text NOT NULL CHECK (widget_type IN ('metric', 'table', 'bar', 'line', 'area', 'funnel', 'pie', 'activity_feed')),
  position jsonb NOT NULL DEFAULT '{}'::jsonb,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  sequence integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, dashboard_id) REFERENCES tenant.crm_dashboards(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, report_definition_id) REFERENCES tenant.crm_report_definitions(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_custom_object_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  singular_label text NOT NULL,
  plural_label text NOT NULL,
  description text,
  primary_name_field text NOT NULL DEFAULT 'name',
  company_scoped boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'inactive', 'archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, object_key)
);

CREATE TABLE IF NOT EXISTS tenant.crm_custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  object_definition_id uuid NOT NULL,
  field_key text NOT NULL,
  label text NOT NULL,
  data_type text NOT NULL CHECK (data_type IN ('text', 'textarea', 'number', 'currency', 'boolean', 'date', 'datetime', 'email', 'phone', 'url', 'select', 'multi_select', 'json')),
  required boolean NOT NULL DEFAULT false,
  unique_value boolean NOT NULL DEFAULT false,
  indexed boolean NOT NULL DEFAULT false,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_value jsonb NOT NULL DEFAULT 'null'::jsonb,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  sequence integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, object_definition_id, field_key),
  FOREIGN KEY (organization_id, object_definition_id) REFERENCES tenant.crm_custom_object_definitions(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_custom_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  object_definition_id uuid NOT NULL,
  record_name text NOT NULL,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, object_definition_id) REFERENCES tenant.crm_custom_object_definitions(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_field_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  party_id uuid,
  contact_id uuid,
  opportunity_id uuid,
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  visit_type text NOT NULL DEFAULT 'customer_visit' CHECK (visit_type IN ('customer_visit', 'prospecting', 'site_survey', 'demo', 'review', 'collection', 'other')),
  planned_start_at timestamptz NOT NULL,
  planned_end_at timestamptz,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  latitude numeric(9,6),
  longitude numeric(9,6),
  address text,
  objective text,
  outcome text,
  route_sequence integer,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'confirmed', 'in_progress', 'completed', 'cancelled', 'missed')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, party_id) REFERENCES tenant.business_parties(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, contact_id) REFERENCES tenant.contacts(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, opportunity_id) REFERENCES tenant.crm_opportunities(organization_id, id) ON DELETE SET NULL,
  CHECK (planned_end_at IS NULL OR planned_end_at >= planned_start_at),
  CHECK (actual_end_at IS NULL OR actual_start_at IS NOT NULL),
  CHECK (actual_end_at IS NULL OR actual_end_at >= actual_start_at),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_enrichment_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'party', 'contact')),
  entity_id uuid NOT NULL,
  provider text NOT NULL,
  requested_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  result_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5,2) CHECK (confidence BETWEEN 0 AND 100),
  error_message text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_ai_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'opportunity', 'party', 'forecast', 'conversation')),
  entity_id uuid NOT NULL,
  prediction_type text NOT NULL CHECK (prediction_type IN ('lead_conversion', 'opportunity_win', 'account_growth', 'forecast', 'churn_risk', 'sentiment', 'next_best_action')),
  score numeric(7,4),
  label text,
  explanation jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_provider text NOT NULL,
  model_name text NOT NULL,
  model_version text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'superseded', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_ai_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  prediction_id uuid,
  recommendation_id uuid,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'modified', 'correct', 'incorrect', 'not_actionable')),
  feedback text,
  corrected_value jsonb NOT NULL DEFAULT 'null'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, prediction_id) REFERENCES tenant.crm_ai_predictions(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, recommendation_id) REFERENCES tenant.crm_recommendations(organization_id, id) ON DELETE CASCADE,
  CHECK (num_nonnulls(prediction_id, recommendation_id) = 1),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS crm_conversations_subject_idx ON tenant.crm_conversations(organization_id, opportunity_id, party_id, started_at DESC);
CREATE INDEX IF NOT EXISTS crm_conversation_insights_review_idx ON tenant.crm_conversation_insights(organization_id, review_status, insight_type, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_pipeline_inspections_health_idx ON tenant.crm_pipeline_inspections(organization_id, health_status, inspected_at DESC);
CREATE INDEX IF NOT EXISTS crm_deal_risks_open_idx ON tenant.crm_deal_risks(organization_id, status, severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS crm_recommendations_open_idx ON tenant.crm_recommendations(organization_id, status, priority, due_at);
CREATE INDEX IF NOT EXISTS crm_buying_committee_party_idx ON tenant.crm_buying_committees(organization_id, party_id, opportunity_id, status);
CREATE INDEX IF NOT EXISTS crm_account_signals_party_idx ON tenant.crm_account_signals(organization_id, party_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_partner_deals_status_idx ON tenant.crm_partner_deals(organization_id, status, registered_at DESC);
CREATE INDEX IF NOT EXISTS crm_custom_records_object_idx ON tenant.crm_custom_records(organization_id, object_definition_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS crm_field_visits_owner_idx ON tenant.crm_field_visits(organization_id, owner_user_id, planned_start_at, status);
CREATE INDEX IF NOT EXISTS crm_enrichment_jobs_status_idx ON tenant.crm_enrichment_jobs(organization_id, status, requested_at);
CREATE INDEX IF NOT EXISTS crm_ai_predictions_entity_idx ON tenant.crm_ai_predictions(organization_id, entity_type, entity_id, prediction_type, generated_at DESC);

DO $$
DECLARE
  relation_name text;
BEGIN
  FOR relation_name IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'tenant'
      AND table_name IN (
        'crm_engagement_templates', 'crm_meeting_links', 'crm_sync_accounts',
        'crm_conversations', 'crm_conversation_insights', 'crm_pipeline_inspections',
        'crm_deal_risks', 'crm_recommendations', 'crm_buying_committees',
        'crm_buying_committee_members', 'crm_relationship_edges', 'crm_account_signals',
        'crm_partner_accounts', 'crm_partner_deals', 'crm_report_definitions',
        'crm_dashboards', 'crm_dashboard_widgets', 'crm_custom_object_definitions',
        'crm_custom_field_definitions', 'crm_custom_records', 'crm_field_visits',
        'crm_enrichment_jobs', 'crm_ai_predictions', 'crm_ai_feedback'
      )
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', relation_name);
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
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'tenant'
      AND column_name = 'updated_at'
      AND table_name IN (
        'crm_engagement_templates', 'crm_meeting_links', 'crm_sync_accounts',
        'crm_conversations', 'crm_conversation_insights', 'crm_deal_risks',
        'crm_recommendations', 'crm_buying_committees', 'crm_buying_committee_members',
        'crm_relationship_edges', 'crm_account_signals', 'crm_partner_accounts',
        'crm_partner_deals', 'crm_report_definitions', 'crm_dashboards',
        'crm_dashboard_widgets', 'crm_custom_object_definitions',
        'crm_custom_field_definitions', 'crm_custom_records', 'crm_field_visits',
        'crm_enrichment_jobs'
      )
  LOOP
    EXECUTE format(
      'CREATE TRIGGER touch_updated_at BEFORE UPDATE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at()',
      relation_name
    );
  END LOOP;
END;
$$;

COMMIT;
