-- CRM plan, step 3.4: campaign and medium on leads and deals, and tags.
--
-- 1. Campaigns (CRM › Setup › Campaigns): what the business ran to bring leads in — a name, an optional code (matched to utm_campaign),
--    dates, a budget and the medium it usually ran on. A lead names its campaign and its medium (how it reached us: paid search, email,
--    a marketplace…), as Odoo's UTM fields do; a converted lead hands both on to its deal, so a campaign's leads, deals and won value
--    can be counted. A web form may name the campaign its leads belong to.
-- 2. Tags: free labels on leads and deals ("Export", "Govt tender", "Repeat buyer"), shared by the organization, many per record, kept
--    through conversion.
CREATE TABLE IF NOT EXISTS tenant.crm_campaigns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  code text CHECK (code IS NULL OR code ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  medium text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  starts_on date,
  ends_on date,
  budget numeric(18, 2) CHECK (budget IS NULL OR budget >= 0),
  currency_code character(3),
  description text,
  created_by uuid REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_campaigns_dates_check CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on)
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_campaigns_name_uidx ON tenant.crm_campaigns (organization_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS crm_campaigns_code_uidx ON tenant.crm_campaigns (organization_id, code) WHERE code IS NOT NULL;

ALTER TABLE tenant.crm_leads
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES tenant.crm_campaigns(id),
  ADD COLUMN IF NOT EXISTS medium text;
ALTER TABLE tenant.crm_opportunities
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES tenant.crm_campaigns(id),
  ADD COLUMN IF NOT EXISTS medium text;
ALTER TABLE tenant.crm_capture_forms ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES tenant.crm_campaigns(id);
CREATE INDEX IF NOT EXISTS crm_leads_campaign_idx ON tenant.crm_leads (organization_id, campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_opportunities_campaign_idx ON tenant.crm_opportunities (organization_id, campaign_id) WHERE campaign_id IS NOT NULL;

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['crm_leads', 'crm_opportunities', 'crm_campaigns'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I DROP CONSTRAINT IF EXISTS %I', name, name || '_medium_check');
    EXECUTE format($check$ALTER TABLE tenant.%I ADD CONSTRAINT %I CHECK (medium IS NULL OR medium IN ('organic_search', 'paid_search', 'social', 'paid_social',
      'email', 'referral', 'display', 'direct', 'event', 'marketplace', 'offline', 'other'))$check$, name, name || '_medium_check');
  END LOOP;
END $$;

-- The capture lookup now returns the form's campaign (it returned an empty one until campaigns existed, migration 0167).
CREATE OR REPLACE FUNCTION tenant.crm_public_capture_form(form_key text)
RETURNS TABLE(id uuid, organization_id uuid, source_id uuid, campaign_id uuid, owner_user_id uuid, allowed_origins text[], required_fields text[], success_message text, rate_limit_per_hour integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'tenant', 'public', 'pg_temp'
AS $$
  SELECT capture.id, capture.organization_id, capture.source_id, capture.campaign_id, capture.owner_user_id, capture.allowed_origins, capture.required_fields,
         capture.success_message, capture.rate_limit_per_hour
    FROM tenant.crm_capture_forms AS capture
   WHERE capture.public_key = form_key AND capture.status = 'active'
   LIMIT 1
$$;

CREATE TABLE IF NOT EXISTS tenant.crm_tags (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  color text NOT NULL DEFAULT 'neutral' CHECK (color IN ('neutral', 'blue', 'green', 'amber', 'red', 'purple', 'teal')),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_tags_name_uidx ON tenant.crm_tags (organization_id, lower(name));

CREATE TABLE IF NOT EXISTS tenant.crm_record_tags (
  organization_id uuid NOT NULL,
  tag_id uuid NOT NULL REFERENCES tenant.crm_tags(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'opportunity')),
  entity_id uuid NOT NULL,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tag_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS crm_record_tags_record_idx ON tenant.crm_record_tags (organization_id, entity_type, entity_id);

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['crm_campaigns', 'crm_tags', 'crm_record_tags'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.crm_campaigns TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.crm_tags, tenant.crm_record_tags TO vercent_app, vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0169_crm_campaigns_tags.sql', 'crm-campaigns-tags') ON CONFLICT DO NOTHING;
