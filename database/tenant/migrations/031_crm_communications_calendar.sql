BEGIN;

ALTER TABLE tenant.crm_sync_accounts
  ADD COLUMN IF NOT EXISTS email_address text,
  ADD COLUMN IF NOT EXISTS calendar_cursor text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS webhook_subscription_id text,
  ADD COLUMN IF NOT EXISTS webhook_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_lock_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE tenant.crm_meeting_links
  ADD COLUMN IF NOT EXISTS public_token text,
  ADD COLUMN IF NOT EXISTS minimum_notice_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS maximum_days_ahead integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS confirmation_template_id uuid,
  ADD COLUMN IF NOT EXISTS cancellation_template_id uuid;

UPDATE tenant.crm_meeting_links
SET public_token = encode(gen_random_bytes(18), 'hex')
WHERE public_token IS NULL;

ALTER TABLE tenant.crm_meeting_links
  ALTER COLUMN public_token SET DEFAULT encode(gen_random_bytes(18), 'hex'),
  ALTER COLUMN public_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS crm_meeting_links_public_token_uidx
  ON tenant.crm_meeting_links(public_token);

CREATE TABLE IF NOT EXISTS tenant.crm_provider_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('gmail','microsoft365')),
  state_hash text NOT NULL,
  code_verifier_hash text NOT NULL,
  redirect_uri text NOT NULL,
  requested_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, state_hash)
);

CREATE TABLE IF NOT EXISTS tenant.crm_shared_inboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  sync_account_id uuid,
  name text NOT NULL,
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','whatsapp','chat','other')),
  address text,
  sla_minutes integer NOT NULL DEFAULT 240 CHECK (sla_minutes BETWEEN 1 AND 10080),
  collision_timeout_minutes integer NOT NULL DEFAULT 15 CHECK (collision_timeout_minutes BETWEEN 1 AND 240),
  business_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, name),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, sync_account_id) REFERENCES tenant.crm_sync_accounts(organization_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tenant.crm_shared_inbox_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  inbox_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'agent' CHECK (member_role IN ('manager','agent','observer')),
  routing_weight integer NOT NULL DEFAULT 100 CHECK (routing_weight BETWEEN 1 AND 1000),
  is_available boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, inbox_id, user_id),
  FOREIGN KEY (organization_id, inbox_id) REFERENCES tenant.crm_shared_inboxes(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  inbox_id uuid,
  sync_account_id uuid,
  provider text NOT NULL,
  external_thread_id text NOT NULL,
  subject text,
  preview text,
  participant_addresses text[] NOT NULL DEFAULT ARRAY[]::text[],
  lead_id uuid,
  opportunity_id uuid,
  party_id uuid,
  contact_id uuid,
  assigned_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  first_response_due_at timestamptz,
  first_responded_at timestamptz,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','closed','spam','archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, provider, external_thread_id),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, inbox_id) REFERENCES tenant.crm_shared_inboxes(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, sync_account_id) REFERENCES tenant.crm_sync_accounts(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, opportunity_id) REFERENCES tenant.crm_opportunities(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, party_id) REFERENCES tenant.business_parties(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, contact_id) REFERENCES tenant.contacts(organization_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS crm_email_threads_queue_idx
  ON tenant.crm_email_threads(organization_id, status, priority, first_response_due_at, last_message_at DESC);

CREATE TABLE IF NOT EXISTS tenant.crm_email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL,
  communication_id uuid,
  sync_account_id uuid,
  provider text NOT NULL,
  provider_message_id text NOT NULL,
  internet_message_id text,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  from_address text NOT NULL,
  to_addresses text[] NOT NULL DEFAULT ARRAY[]::text[],
  cc_addresses text[] NOT NULL DEFAULT ARRAY[]::text[],
  bcc_addresses text[] NOT NULL DEFAULT ARRAY[]::text[],
  reply_to_addresses text[] NOT NULL DEFAULT ARRAY[]::text[],
  subject text,
  body_text text,
  body_html text,
  sent_at timestamptz,
  received_at timestamptz,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('draft','queued','sent','delivered','opened','clicked','bounced','complained','unsubscribed','failed','received')),
  provider_payload_hash text NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, provider, provider_message_id),
  FOREIGN KEY (organization_id, thread_id) REFERENCES tenant.crm_email_threads(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, communication_id) REFERENCES tenant.crm_communications(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, sync_account_id) REFERENCES tenant.crm_sync_accounts(organization_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS crm_email_messages_thread_idx
  ON tenant.crm_email_messages(organization_id, thread_id, COALESCE(received_at, sent_at, created_at));

CREATE TABLE IF NOT EXISTS tenant.crm_email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('delivered','open','click','soft_bounce','hard_bounce','complaint','unsubscribe')),
  occurred_at timestamptz NOT NULL,
  url text,
  reason text,
  recipient text,
  payload_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, provider, provider_event_id),
  FOREIGN KEY (organization_id, message_id) REFERENCES tenant.crm_email_messages(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email_address text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('unsubscribe','hard_bounce','complaint','manual','privacy')),
  source_event_id uuid,
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  suppressed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (organization_id, email_address),
  FOREIGN KEY (organization_id, source_event_id) REFERENCES tenant.crm_email_events(organization_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tenant.crm_email_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  body_html text NOT NULL,
  body_text text,
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, name),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  sync_account_id uuid,
  provider text NOT NULL,
  external_event_id text NOT NULL,
  etag text,
  title text NOT NULL,
  description text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  all_day boolean NOT NULL DEFAULT false,
  location text,
  organizer_email text,
  online_meeting_url text,
  visibility text NOT NULL DEFAULT 'default' CHECK (visibility IN ('default','public','private','confidential')),
  provider_status text NOT NULL DEFAULT 'confirmed',
  lead_id uuid,
  opportunity_id uuid,
  party_id uuid,
  contact_id uuid,
  meeting_booking_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, provider, external_event_id),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, sync_account_id) REFERENCES tenant.crm_sync_accounts(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, lead_id) REFERENCES tenant.crm_leads(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, opportunity_id) REFERENCES tenant.crm_opportunities(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, party_id) REFERENCES tenant.business_parties(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, contact_id) REFERENCES tenant.contacts(organization_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS crm_calendar_events_time_idx
  ON tenant.crm_calendar_events(organization_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS tenant.crm_calendar_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  calendar_event_id uuid NOT NULL,
  email_address text NOT NULL,
  display_name text,
  attendee_type text NOT NULL DEFAULT 'required' CHECK (attendee_type IN ('required','optional','resource')),
  response_status text NOT NULL DEFAULT 'needs_action' CHECK (response_status IN ('needs_action','accepted','declined','tentative')),
  is_organizer boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, calendar_event_id, email_address),
  FOREIGN KEY (organization_id, calendar_event_id) REFERENCES tenant.crm_calendar_events(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_meeting_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid,
  meeting_link_id uuid NOT NULL,
  calendar_event_id uuid,
  host_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  guest_name text NOT NULL,
  guest_email text NOT NULL,
  guest_timezone text NOT NULL DEFAULT 'UTC',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  cancellation_token text NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),
  reschedule_token text NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','completed','no_show')),
  notes text,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (organization_id, id),
  UNIQUE (cancellation_token),
  UNIQUE (reschedule_token),
  FOREIGN KEY (organization_id, company_id) REFERENCES public.companies(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, meeting_link_id) REFERENCES tenant.crm_meeting_links(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, calendar_event_id) REFERENCES tenant.crm_calendar_events(organization_id, id) ON DELETE SET NULL
);

ALTER TABLE tenant.crm_calendar_events
  ADD CONSTRAINT crm_calendar_events_meeting_booking_fkey
  FOREIGN KEY (organization_id, meeting_booking_id)
  REFERENCES tenant.crm_meeting_bookings(organization_id, id)
  ON DELETE SET NULL
  NOT VALID;
ALTER TABLE tenant.crm_calendar_events VALIDATE CONSTRAINT crm_calendar_events_meeting_booking_fkey;

CREATE TABLE IF NOT EXISTS tenant.crm_provider_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sync_account_id uuid NOT NULL,
  sync_type text NOT NULL CHECK (sync_type IN ('mailbox','calendar','webhook_renewal','outbound')),
  cursor_before text,
  cursor_after text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','completed_with_errors','failed','dead_letter')),
  attempted_count integer NOT NULL DEFAULT 0 CHECK (attempted_count >= 0),
  processed_count integer NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, sync_account_id) REFERENCES tenant.crm_sync_accounts(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS crm_provider_sync_jobs_queue_idx
  ON tenant.crm_provider_sync_jobs(organization_id, status, next_attempt_at)
  WHERE status IN ('queued','failed');

CREATE TABLE IF NOT EXISTS tenant.crm_communication_acceptance_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  capability_id text NOT NULL CHECK (capability_id IN ('CRM-001','CRM-002','CRM-004','CRM-005','CRM-036','CRM-038','CRM-040','CRM-045','CRM-081')),
  status text NOT NULL CHECK (status IN ('passed','failed','blocked')),
  commit_sha text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_hash text NOT NULL,
  provider_acceptance text NOT NULL DEFAULT 'sandbox' CHECK (provider_acceptance IN ('sandbox','production','not_required')),
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, capability_id, commit_sha)
);

CREATE OR REPLACE FUNCTION tenant.crm_public_meeting_link(token text)
RETURNS TABLE (
  organization_id uuid,
  meeting_link_id uuid,
  owner_user_id uuid,
  name text,
  duration_minutes integer,
  buffer_before_minutes integer,
  buffer_after_minutes integer,
  timezone text,
  availability jsonb,
  meeting_provider text,
  location_template text,
  minimum_notice_minutes integer,
  maximum_days_ahead integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = tenant, public
AS $$
  SELECT link.organization_id,link.id,link.owner_user_id,link.name,link.duration_minutes,
    link.buffer_before_minutes,link.buffer_after_minutes,link.timezone,link.availability,
    link.meeting_provider,link.location_template,link.minimum_notice_minutes,link.maximum_days_ahead
  FROM tenant.crm_meeting_links link
  WHERE link.public_token=token AND link.status='active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION tenant.crm_public_meeting_booking(token text)
RETURNS TABLE (
  organization_id uuid,
  booking_id uuid,
  host_user_id uuid,
  token_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = tenant, public
AS $$
  SELECT booking.organization_id,booking.id,booking.host_user_id,
    CASE WHEN booking.cancellation_token=token THEN 'cancel' ELSE 'reschedule' END
  FROM tenant.crm_meeting_bookings booking
  WHERE booking.status='confirmed'
    AND (booking.cancellation_token=token OR booking.reschedule_token=token)
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION tenant.crm_public_sync_account(subscription_id text)
RETURNS TABLE (organization_id uuid, sync_account_id uuid, provider text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = tenant, public
AS $$
  SELECT account.organization_id,account.id,account.provider
  FROM tenant.crm_sync_accounts account
  WHERE account.webhook_subscription_id=subscription_id
    AND account.status IN ('connected','syncing','error')
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION tenant.crm_communication_immutable_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CRM communication evidence is immutable';
END;
$$;

DROP TRIGGER IF EXISTS crm_email_events_immutable ON tenant.crm_email_events;
CREATE TRIGGER crm_email_events_immutable
BEFORE UPDATE OR DELETE ON tenant.crm_email_events
FOR EACH ROW EXECUTE FUNCTION tenant.crm_communication_immutable_row();

DROP TRIGGER IF EXISTS crm_communication_acceptance_immutable ON tenant.crm_communication_acceptance_runs;
CREATE TRIGGER crm_communication_acceptance_immutable
BEFORE UPDATE OR DELETE ON tenant.crm_communication_acceptance_runs
FOR EACH ROW EXECUTE FUNCTION tenant.crm_communication_immutable_row();

DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'crm_provider_oauth_states','crm_shared_inboxes','crm_shared_inbox_members','crm_email_threads',
    'crm_email_messages','crm_email_events','crm_email_suppressions','crm_email_signatures',
    'crm_calendar_events','crm_calendar_attendees','crm_meeting_bookings','crm_provider_sync_jobs',
    'crm_communication_acceptance_runs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('DROP POLICY IF EXISTS organization_isolation ON tenant.%I', relation_name);
    EXECUTE format(
      'CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())',
      relation_name
    );
  END LOOP;
END $$;

COMMIT;
