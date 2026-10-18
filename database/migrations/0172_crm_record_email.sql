-- CRM plan, step 4.1: email from a lead, deal, company or contact, with templates.
--
-- 1. Templates (CRM › Setup › Email templates): a name, a subject and a body with placeholders such as {{first_name}} or
--    {{deal_name}}, for any record or one kind of record. Kept when switched off, so an email sent from one still names it.
-- 2. CRM email settings: the address replies should go to (the organization's email-to-lead address, step 3.1, so a reply lands back on
--    the record) and a signature added to every email. Each email sent is kept in tenant.crm_email_messages (direction outbound) with its
--    own message id, so a reply threads onto the record it came from.
CREATE TABLE IF NOT EXISTS tenant.crm_email_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  applies_to text NOT NULL DEFAULT 'any' CHECK (applies_to IN ('any', 'lead', 'opportunity', 'party', 'contact')),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 300),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  use_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_email_templates_name_uidx ON tenant.crm_email_templates (organization_id, lower(name));

CREATE TABLE IF NOT EXISTS tenant.crm_email_settings (
  organization_id uuid PRIMARY KEY,
  reply_to_address text CHECK (reply_to_address IS NULL OR reply_to_address ~ '^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$'),
  signature text CHECK (signature IS NULL OR char_length(signature) <= 2000),
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant.crm_email_messages ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES tenant.crm_email_templates(id);

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['crm_email_templates', 'crm_email_settings'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.crm_email_templates, tenant.crm_email_settings TO vercent_app, vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0172_crm_record_email.sql', 'crm-record-email') ON CONFLICT DO NOTHING;
