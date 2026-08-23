BEGIN;

CREATE TABLE IF NOT EXISTS tenant.crm_import_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource text NOT NULL,
  file_name text NOT NULL,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','completed','completed_with_errors','failed')),
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  succeeded_rows integer NOT NULL DEFAULT 0 CHECK (succeeded_rows >= 0),
  failed_rows integer NOT NULL DEFAULT 0 CHECK (failed_rows >= 0),
  error_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, resource, content_hash)
);

CREATE INDEX IF NOT EXISTS crm_import_receipts_recent_idx
  ON tenant.crm_import_receipts(organization_id, resource, started_at DESC);

ALTER TABLE tenant.crm_import_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_import_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.crm_import_receipts;
CREATE POLICY organization_isolation ON tenant.crm_import_receipts
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
COMMIT;
