-- CRM plan, step 4.6: followers and @mentions.
--
-- Anyone who can see a lead, deal, company or contact may follow it; the owner follows it on their own. Followers hear when a note is
-- added, when an email or WhatsApp message arrives on it, and whatever an automation tells them. Mentioning someone in a note
-- (@Name) tells them and makes them a follower.
CREATE TABLE IF NOT EXISTS tenant.crm_followers (
  organization_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'opportunity', 'party', 'contact')),
  entity_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id),
  reason text NOT NULL DEFAULT 'followed' CHECK (reason IN ('followed', 'mentioned', 'automation')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, entity_type, entity_id, user_id)
);
CREATE INDEX IF NOT EXISTS crm_followers_user_idx ON tenant.crm_followers (organization_id, user_id);
ALTER TABLE tenant.crm_followers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_followers FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'crm_followers' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.crm_followers USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.crm_followers TO vercent_app, vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0177_crm_followers.sql', 'crm-followers') ON CONFLICT DO NOTHING;
