BEGIN;

ALTER TABLE tenant.crm_capture_forms
  ADD COLUMN IF NOT EXISTS form_schema jsonb NOT NULL DEFAULT '{"fields":[{"name":"firstName","type":"text","required":true}]}'::jsonb,
  ADD COLUMN IF NOT EXISTS landing_page jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS unpublished_at timestamptz,
  ADD COLUMN IF NOT EXISTS thank_you_url text,
  ADD COLUMN IF NOT EXISTS consent_text text,
  ADD COLUMN IF NOT EXISTS duplicate_strategy text NOT NULL DEFAULT 'warn' CHECK (duplicate_strategy IN ('allow','warn','block','update')),
  ADD COLUMN IF NOT EXISTS captcha_mode text NOT NULL DEFAULT 'honeypot' CHECK (captcha_mode IN ('none','honeypot','turnstile','recaptcha'));

CREATE TABLE IF NOT EXISTS tenant.crm_lead_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  source_format text NOT NULL DEFAULT 'csv' CHECK (source_format IN ('csv','xlsx','json','api')),
  field_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  duplicate_strategy text NOT NULL DEFAULT 'skip' CHECK (duplicate_strategy IN ('skip','block','update','create')),
  status text NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed','committing','completed','completed_with_errors','failed','rolled_back')),
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  valid_rows integer NOT NULL DEFAULT 0 CHECK (valid_rows >= 0),
  invalid_rows integer NOT NULL DEFAULT 0 CHECK (invalid_rows >= 0),
  created_rows integer NOT NULL DEFAULT 0 CHECK (created_rows >= 0),
  updated_rows integer NOT NULL DEFAULT 0 CHECK (updated_rows >= 0),
  skipped_rows integer NOT NULL DEFAULT 0 CHECK (skipped_rows >= 0),
  content_hash text NOT NULL,
  committed_at timestamptz,
  rolled_back_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, content_hash)
);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES tenant.crm_lead_import_batches(id) ON DELETE CASCADE,
  row_number integer NOT NULL CHECK (row_number > 0),
  raw_data jsonb NOT NULL,
  normalized_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  duplicate_lead_id uuid REFERENCES tenant.crm_leads(id) ON DELETE SET NULL,
  action text NOT NULL DEFAULT 'pending' CHECK (action IN ('pending','create','update','skip','error')),
  result_lead_id uuid REFERENCES tenant.crm_leads(id) ON DELETE SET NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, batch_id, row_number)
);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_acquisition_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google_ads','meta','linkedin','instagram','facebook','whatsapp','website_chat','custom','mock')),
  display_name text NOT NULL,
  webhook_key text NOT NULL DEFAULT encode(gen_random_bytes(24),'hex'),
  credential_reference text,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'sandbox' CHECK (status IN ('sandbox','connected','paused','error','revoked')),
  last_event_at timestamptz,
  last_error text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider, display_name),
  UNIQUE (webhook_key)
);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_acquisition_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES tenant.crm_lead_acquisition_connections(id) ON DELETE SET NULL,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  source_channel text NOT NULL CHECK (source_channel IN ('advertising','social','chat','form','import','enrichment','other')),
  raw_payload jsonb NOT NULL,
  normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','duplicate','rejected','failed')),
  lead_id uuid REFERENCES tenant.crm_leads(id) ON DELETE SET NULL,
  error_message text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (organization_id, provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES tenant.crm_lead_acquisition_connections(id) ON DELETE SET NULL,
  public_token text NOT NULL DEFAULT encode(gen_random_bytes(24),'hex'),
  visitor_key text NOT NULL,
  visitor_name text,
  visitor_email text,
  visitor_phone text,
  page_url text,
  consent_granted boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','qualified','converted','closed','blocked')),
  assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES tenant.crm_leads(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE (public_token)
);

CREATE TABLE IF NOT EXISTS tenant.crm_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES tenant.crm_chat_sessions(id) ON DELETE CASCADE,
  provider_message_id text,
  sender_type text NOT NULL CHECK (sender_type IN ('visitor','agent','bot','system')),
  sender_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','choice','file','event')),
  body text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, session_id, provider_message_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES tenant.crm_leads(id) ON DELETE CASCADE,
  source_channel text NOT NULL,
  source_record_id uuid,
  provider text,
  external_id text,
  original_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_channel, provider, external_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_enrichment_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enrichment_job_id uuid NOT NULL REFERENCES tenant.crm_enrichment_jobs(id) ON DELETE CASCADE,
  proposed_changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  accepted_changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  rejected_changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5,2) CHECK (confidence BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','partially_accepted','rejected')),
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, enrichment_job_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_acquisition_acceptance_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  capability_id text NOT NULL CHECK (capability_id IN ('CRM-054','CRM-056','CRM-057','CRM-058','CRM-059','CRM-063')),
  commit_sha text NOT NULL,
  status text NOT NULL CHECK (status IN ('passed','failed','blocked')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_hash text NOT NULL,
  provider_acceptance text NOT NULL DEFAULT 'sandbox' CHECK (provider_acceptance IN ('sandbox','production','not_required')),
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, capability_id, commit_sha)
);

CREATE INDEX IF NOT EXISTS crm_lead_import_batches_status_idx ON tenant.crm_lead_import_batches(organization_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS crm_lead_acquisition_events_status_idx ON tenant.crm_lead_acquisition_events(organization_id,status,received_at DESC);
CREATE INDEX IF NOT EXISTS crm_chat_sessions_status_idx ON tenant.crm_chat_sessions(organization_id,status,last_message_at DESC);
CREATE INDEX IF NOT EXISTS crm_lead_provenance_lead_idx ON tenant.crm_lead_provenance(organization_id,lead_id,created_at DESC);
CREATE INDEX IF NOT EXISTS crm_enrichment_reviews_status_idx ON tenant.crm_enrichment_reviews(organization_id,status,created_at DESC);

CREATE OR REPLACE FUNCTION tenant.crm_public_acquisition_connection(key text)
RETURNS TABLE (organization_id uuid, connection_id uuid, provider text, created_by uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = tenant, public
AS $$
  SELECT connection.organization_id,connection.id,connection.provider,connection.created_by
  FROM tenant.crm_lead_acquisition_connections connection
  WHERE connection.webhook_key=key AND connection.status IN ('sandbox','connected')
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION tenant.crm_public_capture_form_v2(key text)
RETURNS TABLE (
  organization_id uuid, form_id uuid, company_id uuid, branch_id uuid,
  source_id uuid, campaign_id uuid, owner_user_id uuid, form_schema jsonb,
  allowed_origins text[], success_message text, thank_you_url text,
  consent_text text, duplicate_strategy text, captcha_mode text, rate_limit_per_hour integer, created_by uuid
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = tenant, public
AS $$
  SELECT form.organization_id,form.id,form.company_id,form.branch_id,
         form.source_id,form.campaign_id,form.owner_user_id,form.form_schema,
         form.allowed_origins,form.success_message,form.thank_you_url,
         form.consent_text,form.duplicate_strategy,form.captcha_mode,form.rate_limit_per_hour,form.created_by
  FROM tenant.crm_capture_forms form
  WHERE form.public_key=key AND form.status='active' AND form.published_at IS NOT NULL
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION tenant.crm_public_chat_session(token text)
RETURNS TABLE (organization_id uuid, session_id uuid, connection_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = tenant, public
AS $$
  SELECT session.organization_id,session.id,session.connection_id
  FROM tenant.crm_chat_sessions session
  WHERE session.public_token=token AND session.status IN ('open','qualified')
  LIMIT 1
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'crm_lead_import_batches','crm_lead_import_rows','crm_lead_acquisition_connections',
    'crm_lead_acquisition_events','crm_chat_sessions','crm_chat_messages','crm_lead_provenance',
    'crm_enrichment_reviews','crm_lead_acquisition_acceptance_runs'
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

CREATE OR REPLACE FUNCTION tenant.crm_lead_acquisition_evidence_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRM lead-acquisition acceptance evidence is immutable';
END $$;
DROP TRIGGER IF EXISTS crm_lead_acquisition_evidence_immutable ON tenant.crm_lead_acquisition_acceptance_runs;
CREATE TRIGGER crm_lead_acquisition_evidence_immutable
BEFORE UPDATE OR DELETE ON tenant.crm_lead_acquisition_acceptance_runs
FOR EACH ROW EXECUTE FUNCTION tenant.crm_lead_acquisition_evidence_immutable();
COMMIT;
