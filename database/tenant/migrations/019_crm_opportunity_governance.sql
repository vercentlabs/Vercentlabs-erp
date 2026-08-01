BEGIN;
CREATE TABLE IF NOT EXISTS tenant.crm_opportunity_stage_sla_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 pipeline_id uuid NOT NULL REFERENCES tenant.crm_pipelines(id) ON DELETE CASCADE, stage_id uuid NOT NULL REFERENCES tenant.crm_pipeline_stages(id) ON DELETE CASCADE,
 maximum_days integer NOT NULL DEFAULT 14 CHECK(maximum_days BETWEEN 1 AND 3650), status text NOT NULL DEFAULT 'active' CHECK(status IN('active','inactive')),
 created_by uuid REFERENCES public.users(id) ON DELETE SET NULL, updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,pipeline_id,stage_id));
CREATE TABLE IF NOT EXISTS tenant.crm_opportunity_forecast_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 opportunity_id uuid NOT NULL REFERENCES tenant.crm_opportunities(id) ON DELETE CASCADE, forecast_category text NOT NULL, probability numeric(5,2) NOT NULL,
 amount numeric(18,2) NOT NULL, expected_close_date date, captured_by uuid REFERENCES public.users(id) ON DELETE SET NULL, captured_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS crm_opportunity_forecast_snapshots_idx ON tenant.crm_opportunity_forecast_snapshots(organization_id,opportunity_id,captured_at DESC);
CREATE TABLE IF NOT EXISTS tenant.crm_opportunity_saved_views (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 owner_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE, name text NOT NULL, filters jsonb NOT NULL DEFAULT '{}'::jsonb, columns jsonb NOT NULL DEFAULT '[]'::jsonb,
 is_shared boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,owner_user_id,name));
ALTER TABLE tenant.crm_opportunity_stage_sla_policies ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant.crm_opportunity_stage_sla_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_opportunity_forecast_snapshots ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant.crm_opportunity_forecast_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_opportunity_saved_views ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant.crm_opportunity_saved_views FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_opportunity_stage_sla_policies; CREATE POLICY tenant_organization_isolation ON tenant.crm_opportunity_stage_sla_policies USING (organization_id=current_setting('app.current_organization_id',true)::uuid) WITH CHECK (organization_id=current_setting('app.current_organization_id',true)::uuid);
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_opportunity_forecast_snapshots; CREATE POLICY tenant_organization_isolation ON tenant.crm_opportunity_forecast_snapshots USING (organization_id=current_setting('app.current_organization_id',true)::uuid) WITH CHECK (organization_id=current_setting('app.current_organization_id',true)::uuid);
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_opportunity_saved_views; CREATE POLICY tenant_organization_isolation ON tenant.crm_opportunity_saved_views USING (organization_id=current_setting('app.current_organization_id',true)::uuid) WITH CHECK (organization_id=current_setting('app.current_organization_id',true)::uuid);
INSERT INTO tenant.crm_opportunity_stage_sla_policies(organization_id,pipeline_id,stage_id,maximum_days,created_by,updated_by)
SELECT p.organization_id,p.id,s.id,CASE WHEN s.probability>=80 THEN 7 WHEN s.probability>=40 THEN 14 ELSE 21 END,o.created_by,o.created_by FROM tenant.crm_pipelines p JOIN tenant.crm_pipeline_stages s ON s.organization_id=p.organization_id AND s.pipeline_id=p.id JOIN public.organizations o ON o.id=p.organization_id ON CONFLICT(organization_id,pipeline_id,stage_id) DO NOTHING;
COMMIT;
