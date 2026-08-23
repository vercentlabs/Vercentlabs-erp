BEGIN;

ALTER TABLE tenant.crm_campaigns
  ADD COLUMN IF NOT EXISTS objective text,
  ADD COLUMN IF NOT EXISTS primary_segment_id uuid,
  ADD COLUMN IF NOT EXISTS channel_mix jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS frequency_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attribution_model text NOT NULL DEFAULT 'linear' CHECK (attribution_model IN ('first_touch','last_touch','linear','position_based','time_decay')),
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS launched_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE TABLE IF NOT EXISTS tenant.crm_marketing_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  subject_type text NOT NULL DEFAULT 'lead' CHECK (subject_type IN ('lead','contact','account')),
  segment_type text NOT NULL DEFAULT 'dynamic' CHECK (segment_type IN ('static','dynamic')),
  filter_definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  refresh_status text NOT NULL DEFAULT 'pending' CHECK (refresh_status IN ('pending','running','ready','failed')),
  refreshed_at timestamptz,
  member_count integer NOT NULL DEFAULT 0 CHECK (member_count >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_marketing_segment_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL REFERENCES tenant.crm_marketing_segments(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('lead','contact','account')),
  subject_id uuid NOT NULL,
  email text,
  mobile text,
  consent_email boolean NOT NULL DEFAULT false,
  consent_sms boolean NOT NULL DEFAULT false,
  suppression_reason text,
  source text NOT NULL DEFAULT 'dynamic' CHECK (source IN ('dynamic','manual','import','journey')),
  entered_at timestamptz NOT NULL DEFAULT now(),
  exited_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (organization_id, segment_id, subject_type, subject_id)
);

ALTER TABLE tenant.crm_campaigns
  DROP CONSTRAINT IF EXISTS crm_campaigns_primary_segment_id_fkey;
ALTER TABLE tenant.crm_campaigns
  ADD CONSTRAINT crm_campaigns_primary_segment_id_fkey
  FOREIGN KEY (primary_segment_id)
  REFERENCES tenant.crm_marketing_segments(id)
  ON DELETE SET NULL
  NOT VALID;
ALTER TABLE tenant.crm_campaigns VALIDATE CONSTRAINT crm_campaigns_primary_segment_id_fkey;

CREATE UNIQUE INDEX IF NOT EXISTS crm_marketing_segments_organization_id_id_uidx
  ON tenant.crm_marketing_segments(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_marketing_segment_members_organization_id_id_uidx
  ON tenant.crm_marketing_segment_members(organization_id, id);
CREATE INDEX IF NOT EXISTS crm_marketing_segment_members_segment_idx
  ON tenant.crm_marketing_segment_members(organization_id, segment_id, exited_at);

CREATE TABLE IF NOT EXISTS tenant.crm_marketing_campaign_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES tenant.crm_campaigns(id) ON DELETE CASCADE,
  segment_id uuid REFERENCES tenant.crm_marketing_segments(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms','mixed')),
  provider text NOT NULL DEFAULT 'mock',
  template_id uuid,
  experiment_id uuid,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','running','paused','completed','cancelled','failed')),
  total_recipients integer NOT NULL DEFAULT 0 CHECK (total_recipients >= 0),
  eligible_recipients integer NOT NULL DEFAULT 0 CHECK (eligible_recipients >= 0),
  sent_count integer NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  delivered_count integer NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
  response_count integer NOT NULL DEFAULT 0 CHECK (response_count >= 0),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.crm_marketing_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_run_id uuid NOT NULL REFERENCES tenant.crm_marketing_campaign_runs(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES tenant.crm_campaigns(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('lead','contact','account')),
  subject_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  destination text NOT NULL,
  variant_key text,
  provider_message_id text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','suppressed','sent','delivered','opened','clicked','responded','bounced','failed','unsubscribed')),
  suppression_reason text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  responded_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, campaign_run_id, subject_type, subject_id, channel)
);

CREATE INDEX IF NOT EXISTS crm_marketing_deliveries_status_idx
  ON tenant.crm_marketing_deliveries(organization_id, campaign_run_id, status, created_at);

CREATE TABLE IF NOT EXISTS tenant.crm_marketing_journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  entry_segment_id uuid REFERENCES tenant.crm_marketing_segments(id) ON DELETE SET NULL,
  entry_criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  exit_criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed','archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name, version)
);

CREATE TABLE IF NOT EXISTS tenant.crm_marketing_journey_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  journey_id uuid NOT NULL REFERENCES tenant.crm_marketing_journeys(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  step_type text NOT NULL CHECK (step_type IN ('email','sms','wait','condition','update_member','create_activity','exit')),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_step_key text,
  true_step_key text,
  false_step_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, journey_id, step_key),
  UNIQUE (organization_id, journey_id, sequence)
);

CREATE TABLE IF NOT EXISTS tenant.crm_marketing_journey_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  journey_id uuid NOT NULL REFERENCES tenant.crm_marketing_journeys(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('lead','contact','account')),
  subject_id uuid NOT NULL,
  current_step_key text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','waiting','completed','exited','failed','cancelled')),
  next_action_at timestamptz,
  exit_reason text,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, journey_id, subject_type, subject_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_marketing_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES tenant.crm_campaigns(id) ON DELETE CASCADE,
  name text NOT NULL,
  experiment_type text NOT NULL DEFAULT 'ab' CHECK (experiment_type IN ('ab','multivariate')),
  allocation_strategy text NOT NULL DEFAULT 'deterministic' CHECK (allocation_strategy IN ('deterministic','random')),
  winning_metric text NOT NULL DEFAULT 'response_rate' CHECK (winning_metric IN ('delivery_rate','open_rate','click_rate','response_rate','conversion_rate','revenue')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','completed','cancelled')),
  started_at timestamptz,
  ended_at timestamptz,
  winner_variant_key text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_marketing_experiment_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  experiment_id uuid NOT NULL REFERENCES tenant.crm_marketing_experiments(id) ON DELETE CASCADE,
  variant_key text NOT NULL,
  weight integer NOT NULL CHECK (weight BETWEEN 1 AND 100),
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  impressions integer NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  conversions integer NOT NULL DEFAULT 0 CHECK (conversions >= 0),
  revenue numeric(18,2) NOT NULL DEFAULT 0 CHECK (revenue >= 0),
  UNIQUE (organization_id, experiment_id, variant_key)
);

CREATE TABLE IF NOT EXISTS tenant.crm_marketing_touchpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('lead','contact','account','opportunity')),
  subject_id uuid NOT NULL,
  campaign_id uuid REFERENCES tenant.crm_campaigns(id) ON DELETE SET NULL,
  campaign_run_id uuid REFERENCES tenant.crm_marketing_campaign_runs(id) ON DELETE SET NULL,
  channel text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('impression','sent','delivered','opened','clicked','responded','registered','attended','surveyed','converted','revenue')),
  event_at timestamptz NOT NULL DEFAULT now(),
  revenue numeric(18,2) NOT NULL DEFAULT 0 CHECK (revenue >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_marketing_touchpoints_subject_idx
  ON tenant.crm_marketing_touchpoints(organization_id, subject_type, subject_id, event_at);

CREATE TABLE IF NOT EXISTS tenant.crm_marketing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES tenant.crm_campaigns(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('event','webinar')),
  name text NOT NULL,
  description text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  registration_token text NOT NULL DEFAULT encode(gen_random_bytes(24),'hex'),
  provider text NOT NULL DEFAULT 'native',
  provider_event_id text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','live','completed','cancelled')),
  follow_up_configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (registration_token)
);

CREATE TABLE IF NOT EXISTS tenant.crm_marketing_event_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES tenant.crm_marketing_events(id) ON DELETE CASCADE,
  subject_type text NOT NULL DEFAULT 'lead' CHECK (subject_type IN ('lead','contact','external')),
  subject_id uuid,
  name text NOT NULL,
  email text NOT NULL,
  mobile text,
  consent_email boolean NOT NULL DEFAULT false,
  registration_status text NOT NULL DEFAULT 'registered' CHECK (registration_status IN ('registered','confirmed','waitlisted','cancelled','attended','no_show')),
  registered_at timestamptz NOT NULL DEFAULT now(),
  attended_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organization_id, event_id, email)
);

CREATE TABLE IF NOT EXISTS tenant.crm_marketing_surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES tenant.crm_campaigns(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  public_token text NOT NULL DEFAULT encode(gen_random_bytes(24),'hex'),
  survey_schema jsonb NOT NULL DEFAULT '{"questions":[]}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed','archived')),
  anonymous_allowed boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  closes_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (public_token)
);

CREATE TABLE IF NOT EXISTS tenant.crm_marketing_survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  survey_id uuid NOT NULL REFERENCES tenant.crm_marketing_surveys(id) ON DELETE CASCADE,
  response_key text NOT NULL,
  subject_type text CHECK (subject_type IN ('lead','contact','account','external')),
  subject_id uuid,
  respondent_email text,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  score numeric(9,2),
  sentiment text CHECK (sentiment IS NULL OR sentiment IN ('positive','neutral','negative')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  content_hash text NOT NULL,
  UNIQUE (organization_id, survey_id, response_key)
);

CREATE TABLE IF NOT EXISTS tenant.crm_marketing_frequency_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms','all')),
  maximum_messages integer NOT NULL CHECK (maximum_messages > 0),
  window_hours integer NOT NULL CHECK (window_hours BETWEEN 1 AND 8760),
  quiet_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS tenant.crm_marketing_acceptance_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  capability_id text NOT NULL CHECK (capability_id IN ('CRM-064','CRM-065','CRM-066','CRM-067','CRM-068','CRM-069','CRM-070','CRM-071')),
  commit_sha text NOT NULL,
  status text NOT NULL CHECK (status IN ('passed','failed','blocked')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_hash text NOT NULL,
  provider_acceptance text NOT NULL DEFAULT 'sandbox' CHECK (provider_acceptance IN ('sandbox','production','not_required')),
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, capability_id, commit_sha)
);

CREATE OR REPLACE FUNCTION tenant.crm_public_marketing_survey(token text)
RETURNS TABLE (organization_id uuid, survey_id uuid, survey_schema jsonb, anonymous_allowed boolean, closes_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = tenant, public
AS $$
  SELECT survey.organization_id,survey.id,survey.survey_schema,survey.anonymous_allowed,survey.closes_at
    FROM tenant.crm_marketing_surveys survey
   WHERE survey.public_token=token
     AND survey.status='published'
     AND (survey.closes_at IS NULL OR survey.closes_at > now())
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION tenant.crm_public_marketing_event(token text)
RETURNS TABLE (organization_id uuid, event_id uuid, name text, starts_at timestamptz, ends_at timestamptz, capacity integer, status text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = tenant, public
AS $$
  SELECT event.organization_id,event.id,event.name,event.starts_at,event.ends_at,event.capacity,event.status
    FROM tenant.crm_marketing_events event
   WHERE event.registration_token=token
     AND event.status IN ('published','live')
   LIMIT 1
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'crm_marketing_segments','crm_marketing_segment_members','crm_marketing_campaign_runs',
    'crm_marketing_deliveries','crm_marketing_journeys','crm_marketing_journey_steps',
    'crm_marketing_journey_enrollments','crm_marketing_experiments','crm_marketing_experiment_variants',
    'crm_marketing_touchpoints','crm_marketing_events','crm_marketing_event_registrations',
    'crm_marketing_surveys','crm_marketing_survey_responses','crm_marketing_frequency_policies',
    'crm_marketing_acceptance_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS organization_isolation ON tenant.%I',table_name);
    EXECUTE format(
      'CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())',
      table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION tenant.crm_marketing_acceptance_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRM marketing acceptance evidence is immutable';
END $$;
DROP TRIGGER IF EXISTS crm_marketing_acceptance_immutable ON tenant.crm_marketing_acceptance_runs;
CREATE TRIGGER crm_marketing_acceptance_immutable
BEFORE UPDATE OR DELETE ON tenant.crm_marketing_acceptance_runs
FOR EACH ROW EXECUTE FUNCTION tenant.crm_marketing_acceptance_immutable();
COMMIT;
