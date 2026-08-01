BEGIN;
CREATE TABLE IF NOT EXISTS tenant.crm_lead_saved_views (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 user_id uuid REFERENCES public.users(id) ON DELETE CASCADE, name text NOT NULL, filters jsonb NOT NULL DEFAULT '{}'::jsonb,
 columns jsonb NOT NULL DEFAULT '[]'::jsonb, sort jsonb NOT NULL DEFAULT '[]'::jsonb, is_shared boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,user_id,name), UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS tenant.crm_lead_assignment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 lead_id uuid NOT NULL, previous_owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL, new_owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
 policy_id uuid, reason text NOT NULL DEFAULT 'manual', created_by uuid REFERENCES public.users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,lead_id) REFERENCES tenant.crm_leads(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(organization_id,policy_id) REFERENCES tenant.crm_lead_assignment_policies(organization_id,id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS crm_lead_assignment_events_lead_idx ON tenant.crm_lead_assignment_events(organization_id,lead_id,created_at DESC);
CREATE TABLE IF NOT EXISTS tenant.crm_lead_sla_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 name text NOT NULL, criteria jsonb NOT NULL DEFAULT '{}'::jsonb, first_response_minutes integer NOT NULL DEFAULT 1440 CHECK(first_response_minutes>0),
 follow_up_minutes integer NOT NULL DEFAULT 4320 CHECK(follow_up_minutes>0), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 created_by uuid REFERENCES public.users(id) ON DELETE SET NULL, updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,name), UNIQUE(organization_id,id)
);
INSERT INTO tenant.crm_lead_sla_policies(organization_id,name,criteria,first_response_minutes,follow_up_minutes,created_by,updated_by)
SELECT id,'Standard lead SLA','{}'::jsonb,1440,4320,created_by,created_by FROM public.organizations ON CONFLICT(organization_id,name) DO NOTHING;
ALTER TABLE tenant.crm_lead_saved_views ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant.crm_lead_saved_views FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_assignment_events ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant.crm_lead_assignment_events FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_sla_policies ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant.crm_lead_sla_policies FORCE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['crm_lead_saved_views','crm_lead_assignment_events','crm_lead_sla_policies'] LOOP
 EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I',t);
 EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id=current_setting(''app.current_organization_id'',true)::uuid) WITH CHECK (organization_id=current_setting(''app.current_organization_id'',true)::uuid)',t);
END LOOP; END $$;
COMMIT;
