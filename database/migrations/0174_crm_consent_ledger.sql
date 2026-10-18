-- CRM plan, step 4.3: one consent model with evidence, a global opt-out list, the 90-day lock, and a lookup of what is held on a person.
--
-- 1. tenant.crm_consent_events, insert-only: every change of a lead's or contact's consent or refusal, per channel (email, SMS,
--    WhatsApp, calls, or all), when, how it came (a web form and its notice, an import, a conversion, a WhatsApp message, a member of
--    staff…) and its evidence. Written by triggers on crm_leads and contacts, so no path — form, import, conversion, connector or edit —
--    can change consent without a record of it. The source and evidence are the transaction's app.consent_source / app.consent_evidence
--    when the code that changed it says so; otherwise "manual" by the person who saved it.
-- 2. tenant.crm_opt_outs: the organization's opt-out list by email address and phone number. A refusal on any record adds its address;
--    every email, SMS and WhatsApp sent from CRM checks the list, so a person who opted out on one record is not reached through another.
-- 3. The 90-day lock (TRAI): after someone opts out, staff cannot record their consent again for 90 days unless the person themselves
--    asks (a form they send, a message they write) — checked by the API before it saves.
CREATE TABLE IF NOT EXISTS tenant.crm_consent_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('lead', 'contact')),
  subject_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'call', 'all')),
  action text NOT NULL CHECK (action IN ('opt_in', 'opt_out', 'consent_withdrawn', 'opt_out_lifted')),
  source text NOT NULL DEFAULT 'manual',
  evidence text,
  email text,
  phone text,
  recorded_by uuid,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS crm_consent_events_subject_idx ON tenant.crm_consent_events (organization_id, subject_type, subject_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS crm_consent_events_email_idx ON tenant.crm_consent_events (organization_id, email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_consent_events_phone_idx ON tenant.crm_consent_events (organization_id, phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.crm_opt_outs (
  organization_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('email', 'phone')),
  value text NOT NULL,
  channels text[] NOT NULL DEFAULT ARRAY['all'],
  source text NOT NULL DEFAULT 'manual',
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, kind, value)
);

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['crm_consent_events', 'crm_opt_outs'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
-- The ledger is evidence: added to, never changed. The opt-out list is changed only by its own operations.
GRANT SELECT, INSERT ON tenant.crm_consent_events TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.crm_opt_outs TO vercent_app, vercent_worker;

-- The last ten digits of an Indian number, every digit of another (as tenant.crm_normalize_phone and the API's normalizePhone).
CREATE OR REPLACE FUNCTION tenant.crm_consent_phone(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN value IS NULL OR length(regexp_replace(value, '\D', '', 'g')) < 7 THEN NULL
    WHEN btrim(value) LIKE '+%' AND regexp_replace(value, '\D', '', 'g') NOT LIKE '91%' THEN regexp_replace(value, '\D', '', 'g')
    ELSE right(regexp_replace(value, '\D', '', 'g'), 10) END
$$;

CREATE OR REPLACE FUNCTION tenant.crm_record_consent_event(org uuid, subject_type text, subject_id uuid, channel text, action text, email text, phone text, actor uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  source text := COALESCE(NULLIF(current_setting('app.consent_source', true), ''), 'manual');
  evidence text := NULLIF(current_setting('app.consent_evidence', true), '');
  normalized_email text := NULLIF(lower(btrim(email)), '');
  normalized_phone text := tenant.crm_consent_phone(phone);
BEGIN
  INSERT INTO tenant.crm_consent_events (organization_id, subject_type, subject_id, channel, action, source, evidence, email, phone, recorded_by)
  VALUES (org, subject_type, subject_id, channel, action, source, evidence, normalized_email, normalized_phone, actor);
  IF action = 'opt_out' THEN
    IF normalized_email IS NOT NULL AND channel IN ('email', 'all') THEN
      INSERT INTO tenant.crm_opt_outs (organization_id, kind, value, channels, source, reason, created_by)
      VALUES (org, 'email', normalized_email, ARRAY[channel], source, evidence, actor)
      ON CONFLICT (organization_id, kind, value) DO UPDATE SET channels = (SELECT array_agg(DISTINCT entry) FROM unnest(tenant.crm_opt_outs.channels || EXCLUDED.channels) AS entry);
    END IF;
    IF normalized_phone IS NOT NULL AND channel IN ('sms', 'whatsapp', 'call', 'all') THEN
      INSERT INTO tenant.crm_opt_outs (organization_id, kind, value, channels, source, reason, created_by)
      VALUES (org, 'phone', normalized_phone, ARRAY[channel], source, evidence, actor)
      ON CONFLICT (organization_id, kind, value) DO UPDATE SET channels = (SELECT array_agg(DISTINCT entry) FROM unnest(tenant.crm_opt_outs.channels || EXCLUDED.channels) AS entry);
    END IF;
  ELSIF action = 'opt_out_lifted' THEN
    -- Lifted on the record: the channel leaves the list (the whole entry when nothing is left).
    UPDATE tenant.crm_opt_outs SET channels = array_remove(channels, channel)
     WHERE organization_id = org AND ((kind = 'email' AND value = normalized_email AND channel IN ('email', 'all'))
                                   OR (kind = 'phone' AND value = normalized_phone AND channel IN ('sms', 'whatsapp', 'call', 'all')));
    DELETE FROM tenant.crm_opt_outs WHERE organization_id = org AND cardinality(channels) = 0;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION tenant.crm_lead_consent_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actor uuid := COALESCE(NEW.updated_by, NEW.created_by);
  phone text := COALESCE(NEW.mobile, NEW.phone);
BEGIN
  IF NEW.do_not_contact IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN false ELSE OLD.do_not_contact END) THEN
    PERFORM tenant.crm_record_consent_event(NEW.organization_id, 'lead', NEW.id, 'all', CASE WHEN NEW.do_not_contact THEN 'opt_out' ELSE 'opt_out_lifted' END, NEW.email, phone, actor);
  END IF;
  IF NEW.consent_email IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN false ELSE OLD.consent_email END) AND NOT (NEW.do_not_contact AND NOT NEW.consent_email) THEN
    PERFORM tenant.crm_record_consent_event(NEW.organization_id, 'lead', NEW.id, 'email', CASE WHEN NEW.consent_email THEN 'opt_in' ELSE 'consent_withdrawn' END, NEW.email, phone, actor);
  END IF;
  IF NEW.consent_sms IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN false ELSE OLD.consent_sms END) AND NOT (NEW.do_not_contact AND NOT NEW.consent_sms) THEN
    PERFORM tenant.crm_record_consent_event(NEW.organization_id, 'lead', NEW.id, 'sms', CASE WHEN NEW.consent_sms THEN 'opt_in' ELSE 'consent_withdrawn' END, NEW.email, phone, actor);
  END IF;
  IF NEW.consent_whatsapp IS DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN false ELSE OLD.consent_whatsapp END) AND NOT (NEW.do_not_contact AND NOT NEW.consent_whatsapp) THEN
    PERFORM tenant.crm_record_consent_event(NEW.organization_id, 'lead', NEW.id, 'whatsapp', CASE WHEN NEW.consent_whatsapp THEN 'opt_in' ELSE 'consent_withdrawn' END, NEW.email, phone, actor);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS crm_leads_consent_ledger ON tenant.crm_leads;
CREATE TRIGGER crm_leads_consent_ledger AFTER INSERT OR UPDATE OF consent_email, consent_sms, consent_whatsapp, do_not_contact ON tenant.crm_leads
  FOR EACH ROW EXECUTE FUNCTION tenant.crm_lead_consent_ledger();

CREATE OR REPLACE FUNCTION tenant.crm_contact_consent_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actor uuid := COALESCE(NEW.updated_by, NEW.created_by);
  phone text := COALESCE(NEW.mobile, NEW.phone);
  pair record;
  before_refused boolean;
  before_consented boolean;
BEGIN
  FOR pair IN SELECT * FROM (VALUES
      ('email', NEW.do_not_email, NEW.consent_email, CASE WHEN TG_OP = 'INSERT' THEN false ELSE OLD.do_not_email END, CASE WHEN TG_OP = 'INSERT' THEN false ELSE OLD.consent_email END),
      ('sms', NEW.do_not_sms, NEW.consent_sms, CASE WHEN TG_OP = 'INSERT' THEN false ELSE OLD.do_not_sms END, CASE WHEN TG_OP = 'INSERT' THEN false ELSE OLD.consent_sms END),
      ('whatsapp', NEW.do_not_whatsapp, NEW.consent_whatsapp, CASE WHEN TG_OP = 'INSERT' THEN false ELSE OLD.do_not_whatsapp END, CASE WHEN TG_OP = 'INSERT' THEN false ELSE OLD.consent_whatsapp END),
      ('call', NEW.do_not_call, false, CASE WHEN TG_OP = 'INSERT' THEN false ELSE OLD.do_not_call END, false)
    ) AS entry(channel, refused, consented, was_refused, was_consented) LOOP
    IF pair.refused IS DISTINCT FROM pair.was_refused THEN
      PERFORM tenant.crm_record_consent_event(NEW.organization_id, 'contact', NEW.id, pair.channel, CASE WHEN pair.refused THEN 'opt_out' ELSE 'opt_out_lifted' END, NEW.email, phone, actor);
    ELSIF pair.consented IS DISTINCT FROM pair.was_consented THEN
      PERFORM tenant.crm_record_consent_event(NEW.organization_id, 'contact', NEW.id, pair.channel, CASE WHEN pair.consented THEN 'opt_in' ELSE 'consent_withdrawn' END, NEW.email, phone, actor);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS crm_contacts_consent_ledger ON tenant.contacts;
CREATE TRIGGER crm_contacts_consent_ledger AFTER INSERT OR UPDATE OF do_not_email, do_not_sms, do_not_whatsapp, do_not_call, consent_email, consent_sms, consent_whatsapp ON tenant.contacts
  FOR EACH ROW EXECUTE FUNCTION tenant.crm_contact_consent_ledger();

-- What is already held: today's refusals become the opt-out list, and today's state the ledger's first entry ("existing").
INSERT INTO tenant.crm_opt_outs (organization_id, kind, value, channels, source, reason)
SELECT organization_id, 'email', lower(btrim(email)), ARRAY['all'], 'existing', 'Recorded before the consent ledger'
  FROM tenant.crm_leads WHERE do_not_contact AND NULLIF(btrim(email), '') IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO tenant.crm_opt_outs (organization_id, kind, value, channels, source, reason)
SELECT organization_id, 'email', lower(btrim(email)), ARRAY['email'], 'existing', 'Recorded before the consent ledger'
  FROM tenant.contacts WHERE do_not_email AND NULLIF(btrim(email), '') IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO tenant.crm_consent_events (organization_id, subject_type, subject_id, channel, action, source, evidence, email, phone)
SELECT organization_id, 'lead', id, 'all', 'opt_out', 'existing', 'Recorded before the consent ledger', lower(email), tenant.crm_consent_phone(COALESCE(mobile, phone))
  FROM tenant.crm_leads WHERE do_not_contact;
INSERT INTO tenant.crm_consent_events (organization_id, subject_type, subject_id, channel, action, source, evidence, email, phone)
SELECT organization_id, 'lead', id, channel, 'opt_in', 'existing', 'Recorded before the consent ledger', lower(email), tenant.crm_consent_phone(COALESCE(mobile, phone))
  FROM tenant.crm_leads, LATERAL (VALUES ('email', consent_email), ('sms', consent_sms), ('whatsapp', consent_whatsapp)) AS given(channel, yes)
 WHERE given.yes AND NOT do_not_contact;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0174_crm_consent_ledger.sql', 'crm-consent-ledger') ON CONFLICT DO NOTHING;
