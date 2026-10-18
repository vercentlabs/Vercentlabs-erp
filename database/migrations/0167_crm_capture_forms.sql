-- CRM plan, step 3.2: web forms set up from CRM (a screen, a hosted page and an embed snippet), and the consent notice each person saw.
--
-- 1. Fix: tenant.crm_public_capture_form selected capture.campaign_id, a column crm_capture_forms never had, so every website-form
--    submission failed. The function keeps its signature (campaign_id is returned empty until campaigns exist, step 3.4).
-- 2. A form's consent notice is versioned: each change of its wording is kept as a new tenant.crm_capture_notices row, never edited, so
--    a lead records exactly which wording its person agreed to (crm_leads.capture_notice_id) and through which form it came
--    (crm_leads.capture_form_id).
-- 3. tenant.crm_public_capture_definition(form_key) gives the hosted form page what it shows — the organization's name, the fields, the
--    current notice, the thank-you message — before any organization context exists, as the lookup above does for a submission.
CREATE OR REPLACE FUNCTION tenant.crm_public_capture_form(form_key text)
RETURNS TABLE(id uuid, organization_id uuid, source_id uuid, campaign_id uuid, owner_user_id uuid, allowed_origins text[], required_fields text[], success_message text, rate_limit_per_hour integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'tenant', 'public', 'pg_temp'
AS $$
  SELECT capture.id, capture.organization_id, capture.source_id, NULL::uuid, capture.owner_user_id, capture.allowed_origins, capture.required_fields,
         capture.success_message, capture.rate_limit_per_hour
    FROM tenant.crm_capture_forms AS capture
   WHERE capture.public_key = form_key AND capture.status = 'active'
   LIMIT 1
$$;
GRANT ALL ON FUNCTION tenant.crm_public_capture_form(text) TO vercent_app;

CREATE TABLE IF NOT EXISTS tenant.crm_capture_notices (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  form_id uuid NOT NULL REFERENCES tenant.crm_capture_forms(id),
  version integer NOT NULL CHECK (version > 0),
  notice_text text NOT NULL CHECK (char_length(notice_text) BETWEEN 1 AND 4000),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT crm_capture_notices_version_uidx UNIQUE (form_id, version)
);
ALTER TABLE tenant.crm_capture_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_capture_notices FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'crm_capture_notices' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.crm_capture_notices USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
-- A notice once shown is evidence: kept, never changed.
GRANT SELECT, INSERT ON tenant.crm_capture_notices TO vercent_app, vercent_worker;

ALTER TABLE tenant.crm_capture_forms ADD COLUMN IF NOT EXISTS notice_id uuid REFERENCES tenant.crm_capture_notices(id);
ALTER TABLE tenant.crm_leads
  ADD COLUMN IF NOT EXISTS capture_form_id uuid REFERENCES tenant.crm_capture_forms(id),
  ADD COLUMN IF NOT EXISTS capture_notice_id uuid REFERENCES tenant.crm_capture_notices(id);

-- A form's existing consent wording becomes its first notice version.
INSERT INTO tenant.crm_capture_notices (organization_id, form_id, version, notice_text, created_by)
SELECT form.organization_id, form.id, 1, form.consent_text, form.created_by FROM tenant.crm_capture_forms form
 WHERE NULLIF(btrim(form.consent_text), '') IS NOT NULL AND form.notice_id IS NULL
ON CONFLICT DO NOTHING;
UPDATE tenant.crm_capture_forms form SET notice_id = notice.id
  FROM tenant.crm_capture_notices notice WHERE notice.form_id = form.id AND notice.version = 1 AND form.notice_id IS NULL;

CREATE OR REPLACE FUNCTION tenant.crm_public_capture_definition(form_key text)
RETURNS TABLE(organization_name text, form_name text, form_schema jsonb, required_fields text[], notice_text text, notice_version integer,
              success_message text, thank_you_url text, landing_page jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'tenant', 'public', 'pg_temp'
AS $$
  SELECT organization.name, capture.name, capture.form_schema, capture.required_fields, notice.notice_text, notice.version,
         capture.success_message, capture.thank_you_url, capture.landing_page
    FROM tenant.crm_capture_forms AS capture
    JOIN public.organizations organization ON organization.id = capture.organization_id
    LEFT JOIN tenant.crm_capture_notices notice ON notice.id = capture.notice_id
   WHERE capture.public_key = form_key AND capture.status = 'active'
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION tenant.crm_public_capture_definition(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant.crm_public_capture_definition(text) TO vercent_app;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0167_crm_capture_forms.sql', 'crm-capture-forms') ON CONFLICT DO NOTHING;
