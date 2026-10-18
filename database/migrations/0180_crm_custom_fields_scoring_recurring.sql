-- CRM plan, step 5.3: custom fields, lead scoring, recurring revenue.
--
-- Custom fields: the organization's own fields on leads and deals (a GST category, a machine model, a tender number). Their values
-- live in the existing custom_data column, keyed by the field's key; a switched-off field keeps its values.
--
-- Lead scoring: points from the organization's rules (source, campaign, region, industry, contact details, qualification…), blended
-- with what history says — how often leads like this one (same source, campaign, medium, state) converted — once there is enough of it.
-- Each lead keeps its score and the reasons for it.
--
-- Recurring revenue: plans (monthly, quarterly, yearly…) and, on a deal, the recurring amount per period.
CREATE TABLE IF NOT EXISTS tenant.crm_custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'opportunity')),
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text NOT NULL CHECK (btrim(label) <> '' AND char_length(label) <= 80),
  field_type text NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'select', 'checkbox')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
  is_required boolean NOT NULL DEFAULT false,
  help_text text CHECK (help_text IS NULL OR char_length(help_text) <= 200),
  sequence integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entity_type, key)
);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_scoring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  field text NOT NULL CHECK (char_length(field) <= 60),
  operator text NOT NULL CHECK (operator IN ('equals', 'contains', 'is_set', 'at_least')),
  value text CHECK (value IS NULL OR char_length(value) <= 200),
  points integer NOT NULL CHECK (points BETWEEN -100 AND 100),
  label text CHECK (label IS NULL OR char_length(label) <= 120),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant.crm_lead_scoring_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  use_history boolean NOT NULL DEFAULT true,
  minimum_history integer NOT NULL DEFAULT 20 CHECK (minimum_history BETWEEN 5 AND 10000),
  hot_threshold integer NOT NULL DEFAULT 70 CHECK (hot_threshold BETWEEN 1 AND 100),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant.crm_leads ADD COLUMN IF NOT EXISTS lead_score integer CHECK (lead_score IS NULL OR lead_score BETWEEN 0 AND 100);
ALTER TABLE tenant.crm_leads ADD COLUMN IF NOT EXISTS lead_score_details jsonb;
ALTER TABLE tenant.crm_leads ADD COLUMN IF NOT EXISTS lead_scored_at timestamptz;
CREATE INDEX IF NOT EXISTS crm_leads_score_idx ON tenant.crm_leads (organization_id, lead_score DESC NULLS LAST) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS tenant.crm_recurring_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 80),
  months integer NOT NULL CHECK (months BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant.crm_opportunities ADD COLUMN IF NOT EXISTS recurring_plan_id uuid REFERENCES tenant.crm_recurring_plans(id);
ALTER TABLE tenant.crm_opportunities ADD COLUMN IF NOT EXISTS recurring_revenue numeric(18, 2) CHECK (recurring_revenue IS NULL OR recurring_revenue >= 0);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_opportunities_recurring_check') THEN
    ALTER TABLE tenant.crm_opportunities ADD CONSTRAINT crm_opportunities_recurring_check CHECK (recurring_revenue IS NULL OR recurring_plan_id IS NOT NULL);
  END IF;
END $$;

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['crm_custom_fields', 'crm_lead_scoring_rules', 'crm_lead_scoring_settings', 'crm_recurring_plans'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app, vercent_worker', name);
  END LOOP;
END $$;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0180_crm_custom_fields_scoring_recurring.sql', 'crm-custom-fields-scoring-recurring') ON CONFLICT DO NOTHING;
