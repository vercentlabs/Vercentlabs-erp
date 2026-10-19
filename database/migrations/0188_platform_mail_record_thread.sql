-- Shared Platform plan, step 4: sending email as the company, a mail queue with a delivery log, and the shared record thread.
--
-- 1. How the company's email is sent (Settings › Email): the platform's server (default), the company's own domain (DKIM key
--    generated here, published by the company in DNS and verified), or the company's own SMTP server. Secrets are envelope-encrypted.
CREATE TABLE IF NOT EXISTS tenant.company_mail_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'platform' CHECK (mode IN ('platform', 'domain', 'smtp')),
  from_name text,
  from_address text,
  reply_to text,
  domain text,
  dkim_selector text,
  dkim_public_key text,
  encrypted_dkim_private_key jsonb,
  domain_verified_at timestamptz,
  smtp_host text,
  smtp_port integer CHECK (smtp_port IS NULL OR smtp_port BETWEEN 1 AND 65535),
  smtp_secure boolean NOT NULL DEFAULT true,
  smtp_username text,
  encrypted_smtp_password jsonb,
  smtp_verified_at timestamptz,
  last_error text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant.company_mail_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.company_mail_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.company_mail_settings;
CREATE POLICY organization_isolation ON tenant.company_mail_settings USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.company_mail_settings TO vercent_app, vercent_worker;

-- 2. Every email the platform sends, and the queue for the ones sent later with retries (sign-up, password, invitation and other
--    security mail). A queued message's content is envelope-encrypted (it can hold a one-time link) and erased once sent.
--    OPERATOR_RUNTIME: written for messages before any company is known; read per company by core/platform/mail only.
CREATE TABLE IF NOT EXISTS public.mail_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('security', 'business')),
  template text,
  recipients text[] NOT NULL,
  subject text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'bounced', 'not_configured')),
  sent_via text,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  lease_expires_at timestamptz,
  last_error text,
  message_id text,
  encrypted_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mail_log_queue_idx ON public.mail_log (next_attempt_at) WHERE status IN ('queued', 'sending');
CREATE INDEX IF NOT EXISTS mail_log_org_idx ON public.mail_log (organization_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mail_log TO vercent_app, vercent_worker;

-- 3. The shared record thread on any main document (orders, invoices, POs, bills, items, assets, …): comments and internal notes
--    with @mentions (public.comments, unused until now), followers, and scheduled activities (call, meeting, to-do) with reminders.
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'note'));
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS mentions uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS comments_record_idx ON public.comments (organization_id, entity_type, entity_id, created_at);
DROP POLICY IF EXISTS organization_isolation ON public.comments;
CREATE POLICY organization_isolation ON public.comments USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.comments TO vercent_app, vercent_worker;

CREATE TABLE IF NOT EXISTS public.record_followers (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, entity_type, entity_id, user_id)
);
ALTER TABLE public.record_followers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.record_followers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.record_followers;
CREATE POLICY organization_isolation ON public.record_followers USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());
GRANT SELECT, INSERT, DELETE ON public.record_followers TO vercent_app, vercent_worker;

CREATE TABLE IF NOT EXISTS public.record_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  activity_type text NOT NULL CHECK (activity_type IN ('to_do', 'call', 'meeting', 'email')),
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 200),
  note text,
  due_date date NOT NULL,
  assigned_to uuid NOT NULL REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  done_at timestamptz,
  done_note text,
  reminded_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS record_activities_record_idx ON public.record_activities (organization_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS record_activities_due_idx ON public.record_activities (organization_id, assigned_to, due_date) WHERE status = 'open';
ALTER TABLE public.record_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.record_activities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON public.record_activities;
CREATE POLICY organization_isolation ON public.record_activities USING (organization_id = public.current_organization_id()) WITH CHECK (organization_id = public.current_organization_id());
GRANT SELECT, INSERT, UPDATE ON public.record_activities TO vercent_app, vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0188_platform_mail_record_thread.sql', 'platform-mail-record-thread') ON CONFLICT DO NOTHING;
