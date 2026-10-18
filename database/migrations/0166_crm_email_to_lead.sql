-- CRM plan, step 3.1: email to lead, with replies threaded onto the record.
--
-- An inbound-mail address (Settings → Integrations → Inbound email) can now feed CRM: a new email opens a lead (or, from someone the CRM
-- already has an open lead for, lands on that lead), and a reply — matched by its In-Reply-To / References message ids, or by the
-- record's number in the subject such as [LEAD-000012] — joins the lead, deal, company or contact it belongs to. Each email is kept with
-- its message id, sender, recipients and text, appears on the record's timeline as an email activity, and keeps its attachments as the
-- record's files. Outgoing email from CRM (step 4.1) is kept in the same table, so a reply to it threads the same way.
CREATE TABLE IF NOT EXISTS tenant.crm_email_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'opportunity', 'party', 'contact')),
  entity_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'queued', 'sent', 'failed')),
  message_id text NOT NULL,
  in_reply_to text,
  reference_ids text[] NOT NULL DEFAULT '{}',
  from_address text,
  from_name text,
  to_addresses text[] NOT NULL DEFAULT '{}',
  cc_addresses text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL,
  body_text text,
  activity_id uuid,
  inbound_event_id uuid,
  sent_by uuid REFERENCES public.users(id),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT crm_email_messages_message_uidx UNIQUE (organization_id, message_id)
);
CREATE INDEX IF NOT EXISTS crm_email_messages_record_idx ON tenant.crm_email_messages (organization_id, entity_type, entity_id, created_at DESC);

ALTER TABLE tenant.crm_email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_email_messages FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'crm_email_messages' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.crm_email_messages USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.crm_email_messages TO vercent_app, vercent_worker;

-- The inbound address may feed CRM, and each received email records which CRM record it landed on.
ALTER TABLE public.inbound_mail_routes DROP CONSTRAINT IF EXISTS inbound_mail_routes_target_check;
ALTER TABLE public.inbound_mail_routes ADD CONSTRAINT inbound_mail_routes_target_check CHECK (target IN ('support.email_to_ticket', 'crm.email_to_lead'));
ALTER TABLE public.inbound_mail_events
  ADD COLUMN IF NOT EXISTS record_type text,
  ADD COLUMN IF NOT EXISTS record_id uuid;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0166_crm_email_to_lead.sql', 'crm-email-to-lead') ON CONFLICT DO NOTHING;
