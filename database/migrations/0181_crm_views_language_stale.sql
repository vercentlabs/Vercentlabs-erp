-- CRM plan, step 5.5: saved personal views, lead language, per-stage stale days. (Company logos and contact photos are files of their
-- own kind, crm.party_logo and crm.contact_photo, in the shared file store: no column.)
--
-- Saved views: a person's own named filters on the lead list, the deal list or the pipeline, one of which can open by default.
CREATE TABLE IF NOT EXISTS tenant.crm_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  screen text NOT NULL CHECK (screen IN ('leads', 'opportunities', 'pipeline')),
  name text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 60),
  query text NOT NULL CHECK (char_length(query) <= 4000),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, screen, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_saved_views_default_idx ON tenant.crm_saved_views (organization_id, user_id, screen) WHERE is_default;
ALTER TABLE tenant.crm_saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_saved_views FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'crm_saved_views' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.crm_saved_views USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.crm_saved_views TO vercent_app, vercent_worker;

-- The language a lead speaks (ISO 639-1: en, hi, mr, ta, te, gu, bn, kn, ml, pa…); it goes to the contact's preferred language.
ALTER TABLE tenant.crm_leads ADD COLUMN IF NOT EXISTS language_code text CHECK (language_code IS NULL OR language_code ~ '^[a-z]{2}$');

-- How many days without activity make an open lead in this stage stale (NULL: the standard 7).
ALTER TABLE tenant.crm_lead_stages ADD COLUMN IF NOT EXISTS stale_after_days integer CHECK (stale_after_days IS NULL OR stale_after_days BETWEEN 1 AND 365);

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0181_crm_views_language_stale.sql', 'crm-views-language-stale') ON CONFLICT DO NOTHING;
