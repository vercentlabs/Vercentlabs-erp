BEGIN;

CREATE TABLE IF NOT EXISTS tenant.crm_product_acceptance_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  release_sha text NOT NULL,
  dimension text NOT NULL CHECK (
    dimension IN (
      'backend',
      'web_ui',
      'mobile_ui',
      'automated_tests',
      'tenant_security',
      'provider_execution',
      'browser_acceptance',
      'business_acceptance'
    )
  ),
  acceptance_tier text NOT NULL CHECK (
    acceptance_tier IN ('local','sandbox','staging','production')
  ),
  status text NOT NULL CHECK (status IN ('passed','failed','blocked')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_hash text NOT NULL,
  verified_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.crm_provider_execution_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (
    job_type IN ('provider_sync','telephony_command','transcription_job','marketing_delivery','ai_provider')
  ),
  job_id uuid NOT NULL,
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('completed','failed','blocked')),
  provider_reference text,
  receipt jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_hash text NOT NULL,
  worker_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, job_type, job_id, status, evidence_hash)
);

CREATE INDEX IF NOT EXISTS crm_product_acceptance_release_idx
  ON tenant.crm_product_acceptance_runs(organization_id, release_sha, acceptance_tier, status);

CREATE INDEX IF NOT EXISTS crm_provider_execution_receipts_lookup_idx
  ON tenant.crm_provider_execution_receipts(organization_id, job_type, job_id, recorded_at DESC);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'crm_product_acceptance_runs',
    'crm_provider_execution_receipts'
  ] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id=current_setting(''app.current_organization_id'',true)::uuid) WITH CHECK (organization_id=current_setting(''app.current_organization_id'',true)::uuid)',
      table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION tenant.crm_product_acceptance_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CRM product acceptance evidence is immutable';
END $$;

DROP TRIGGER IF EXISTS crm_product_acceptance_immutable
  ON tenant.crm_product_acceptance_runs;
CREATE TRIGGER crm_product_acceptance_immutable
  BEFORE UPDATE OR DELETE ON tenant.crm_product_acceptance_runs
  FOR EACH ROW EXECUTE FUNCTION tenant.crm_product_acceptance_immutable();

DROP TRIGGER IF EXISTS crm_provider_execution_receipts_immutable
  ON tenant.crm_provider_execution_receipts;
CREATE TRIGGER crm_provider_execution_receipts_immutable
  BEFORE UPDATE OR DELETE ON tenant.crm_provider_execution_receipts
  FOR EACH ROW EXECUTE FUNCTION tenant.crm_product_acceptance_immutable();

GRANT SELECT, INSERT ON tenant.crm_product_acceptance_runs TO vercent_app;
GRANT SELECT, INSERT ON tenant.crm_provider_execution_receipts TO vercent_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA tenant TO vercent_app;

COMMIT;
