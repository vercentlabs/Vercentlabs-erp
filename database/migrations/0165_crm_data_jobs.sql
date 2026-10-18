-- CRM plan, step 2.5: deal import, and imports and exports that run in the background.
--
-- 1. Deals can be imported (CSV or XLSX), open ones and, if wished, ones already won or lost with their reason. Its own permission,
--    granted to every role that may export deals (the managers) and to whoever may import companies.
-- 2. A file too large to handle while the person waits — more rows than an import or export takes at once — runs in the background:
--    tenant.crm_data_jobs records each run (what, whose, with which options), the uploaded file and the file it produced (the export,
--    or the rows an import could not take, with the reason); the person is told when it finishes. The run uses the requester's
--    permissions as they are when it runs.
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('crm.opportunities.import', 'Import deals', 'CRM', 'Import deals from a CSV or XLSX file.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'crm.opportunities.import' FROM public.role_permissions existing
 WHERE existing.permission_key IN ('crm.opportunities.export', 'crm.accounts.import')
   AND EXISTS (SELECT 1 FROM public.role_permissions creates WHERE creates.role_id = existing.role_id AND creates.permission_key = 'crm.opportunities.create')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, 'crm.opportunities.import' FROM public.roles role
 WHERE role.slug IN ('organization_owner', 'system_administrator', 'crm_administrator')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS tenant.crm_data_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('import', 'export')),
  entity text NOT NULL CHECK (entity IN ('leads', 'accounts', 'contacts', 'opportunities')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  file_name text,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_file_id uuid REFERENCES public.attachments(id),
  output_file_id uuid REFERENCES public.attachments(id),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  job_id uuid,
  requested_by uuid NOT NULL REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS crm_data_jobs_requester_idx ON tenant.crm_data_jobs (organization_id, requested_by, requested_at DESC);

ALTER TABLE tenant.crm_data_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_data_jobs FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'crm_data_jobs' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.crm_data_jobs USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.crm_data_jobs TO vercent_app, vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0165_crm_data_jobs.sql', 'crm-data-jobs') ON CONFLICT DO NOTHING;
