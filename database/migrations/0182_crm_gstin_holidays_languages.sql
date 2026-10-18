-- CRM plan, step 5.6: GSTIN status check and company lookup; Hindi and regional languages; holidays in working hours.
--
-- GSTIN checks: what the GST register says about a GSTIN — active, cancelled, suspended — with its legal and trade name, registration
-- date and principal address, as returned by the organization's GST data provider. Kept per GSTIN, newest first, so a company page shows
-- when it was last verified and a lookup within a week is not asked again.
CREATE TABLE IF NOT EXISTS tenant.crm_gstin_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  gstin text NOT NULL CHECK (gstin ~ '^[0-9A-Z]{15}$'),
  status text NOT NULL CHECK (status IN ('active', 'cancelled', 'suspended', 'inactive', 'not_found', 'unknown')),
  legal_name text,
  trade_name text,
  registered_on date,
  cancelled_on date,
  taxpayer_type text,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text NOT NULL,
  checked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_gstin_checks_lookup_idx ON tenant.crm_gstin_checks (organization_id, gstin, checked_at DESC);

-- Holidays: days with no working hours. Reminders that would fall on one move to the next working day, and a follow-up planned on one
-- says so.
CREATE TABLE IF NOT EXISTS tenant.crm_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 80),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, holiday_date)
);

-- An email template in other languages: { "hi": { "subject": …, "body": … }, … }. A record's email uses the one in the person's language.
ALTER TABLE tenant.crm_email_templates ADD COLUMN IF NOT EXISTS translations jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['crm_gstin_checks', 'crm_holidays'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app, vercent_worker', name);
  END LOOP;
END $$;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0182_crm_gstin_holidays_languages.sql', 'crm-gstin-holidays-languages') ON CONFLICT DO NOTHING;
