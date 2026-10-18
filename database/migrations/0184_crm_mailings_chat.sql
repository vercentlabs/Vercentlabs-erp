-- CRM plan, step 5.8: email campaigns; website chat that opens a lead.
--
-- Email campaigns (mailings): one email to many leads or contacts, chosen by the list's own filters, sent in batches by the worker.
-- Only people who agreed to email and are not on the opt-out list receive it; every email carries an unsubscribe link (which adds the
-- address to the opt-out list) and is counted when opened and when a link in it is followed. Each recipient's token is a random
-- secret: the public unsubscribe, open and click addresses carry only it.
CREATE TABLE IF NOT EXISTS tenant.crm_mailings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  audience text NOT NULL CHECK (audience IN ('leads', 'contacts')),
  audience_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  subject text NOT NULL CHECK (char_length(subject) <= 300),
  body text NOT NULL CHECK (char_length(body) <= 50000),
  campaign_id uuid REFERENCES tenant.crm_campaigns(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_mailings_due_idx ON tenant.crm_mailings (organization_id, status, scheduled_at) WHERE status IN ('scheduled', 'sending');

CREATE TABLE IF NOT EXISTS tenant.crm_mailing_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mailing_id uuid NOT NULL REFERENCES tenant.crm_mailings(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'contact')),
  entity_id uuid NOT NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  skip_reason text,
  token_hash text NOT NULL UNIQUE,
  message_id text,
  sent_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  unsubscribed_at timestamptz,
  error text,
  UNIQUE (mailing_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS crm_mailing_recipients_queue_idx ON tenant.crm_mailing_recipients (organization_id, mailing_id, status);

-- Website chat: a chat box on the organization's website. A visitor gives a name and an email or mobile, and the conversation opens a
-- lead (source Website chat) — or joins the lead of the same person — and is answered from CRM's chat inbox.
CREATE TABLE IF NOT EXISTS tenant.crm_chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 80),
  public_key text NOT NULL UNIQUE CHECK (public_key ~ '^[0-9a-f]{32}$'),
  welcome_message text NOT NULL DEFAULT 'Hello! How can we help you?' CHECK (char_length(welcome_message) <= 500),
  allowed_origins text[] NOT NULL DEFAULT ARRAY[]::text[],
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant.crm_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES tenant.crm_chat_channels(id) ON DELETE CASCADE,
  visitor_token_hash text NOT NULL UNIQUE,
  visitor_name text,
  visitor_email text,
  visitor_mobile text,
  page_url text,
  lead_id uuid REFERENCES tenant.crm_leads(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  unread_by_team integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_chat_sessions_inbox_idx ON tenant.crm_chat_sessions (organization_id, status, last_message_at DESC);
CREATE TABLE IF NOT EXISTS tenant.crm_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES tenant.crm_chat_sessions(id) ON DELETE CASCADE,
  sender text NOT NULL CHECK (sender IN ('visitor', 'agent', 'system')),
  author_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (btrim(body) <> '' AND char_length(body) <= 4000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS crm_chat_messages_session_idx ON tenant.crm_chat_messages (organization_id, session_id, created_at);

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['crm_mailings', 'crm_mailing_recipients', 'crm_chat_channels', 'crm_chat_sessions', 'crm_chat_messages'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app, vercent_worker', name);
  END LOOP;
END $$;

-- The public addresses carry only a token: these find its organization before any organization is set.
CREATE OR REPLACE FUNCTION tenant.crm_resolve_mailing_token(token_hash_in text)
RETURNS TABLE(organization_id uuid, recipient_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'tenant', 'public', 'pg_temp'
AS $$
  SELECT recipient.organization_id, recipient.id FROM tenant.crm_mailing_recipients recipient WHERE recipient.token_hash = token_hash_in LIMIT 1
$$;
REVOKE ALL ON FUNCTION tenant.crm_resolve_mailing_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant.crm_resolve_mailing_token(text) TO vercent_app, vercent_worker;

CREATE OR REPLACE FUNCTION tenant.crm_resolve_chat_channel(public_key_in text)
RETURNS TABLE(organization_id uuid, channel_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'tenant', 'public', 'pg_temp'
AS $$
  SELECT channel.organization_id, channel.id FROM tenant.crm_chat_channels channel WHERE channel.public_key = public_key_in AND channel.status = 'active' LIMIT 1
$$;
REVOKE ALL ON FUNCTION tenant.crm_resolve_chat_channel(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant.crm_resolve_chat_channel(text) TO vercent_app, vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0184_crm_mailings_chat.sql', 'crm-mailings-chat') ON CONFLICT DO NOTHING;
