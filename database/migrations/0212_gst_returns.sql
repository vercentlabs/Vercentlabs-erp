-- GST — return working papers and the tax exception queue (MVP 41). Additive:
--   1. gst_returns: one working paper per return type (GSTR-1 now, GSTR-3B next), company GST registration and month:
--      DRAFT → PREPARED → APPROVED (by someone other than the preparer) → FILED (with the portal's reference); an approved return can be
--      reopened before filing, a filed one never changes (later corrections are amendments in a later period);
--   2. gst_return_documents: the documents (or, for B2C small and nil-rated supplies, the aggregates) each return reports, by section and
--      rate — a document is reported in one GSTR-1 only (a partial unique index), so it can't be counted twice;
--   3. gst_return_hsn: the HSN / SAC summary;
--   4. gst_exceptions: what stops or needs review — blocking ones must be fixed at the source, warnings can be waived with a reason;
--   5. permissions gst.view, gst.return.prepare, gst.return.approve, gst.return.file, gst.itc.manage.
-- Re-runnable.

CREATE TABLE IF NOT EXISTS tenant.gst_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  return_type text NOT NULL CHECK (return_type IN ('GSTR1', 'GSTR3B')),
  registration_id uuid NOT NULL,
  gstin text NOT NULL,
  period date NOT NULL CHECK (extract(day FROM period) = 1),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PREPARED', 'APPROVED', 'FILED')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciliation jsonb NOT NULL DEFAULT '{}'::jsonb,
  label text,
  content_hash text,
  prepared_by uuid,
  prepared_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  filed_by uuid,
  filed_at timestamptz,
  filed_on date,
  filing_reference text,
  reopened_reason text,
  version integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, return_type, registration_id, period)
);

CREATE TABLE IF NOT EXISTS tenant.gst_return_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  return_id uuid NOT NULL REFERENCES tenant.gst_returns(id) ON DELETE CASCADE,
  return_type text NOT NULL,
  section text NOT NULL,
  source_type text NOT NULL,
  source_id uuid,
  document_type text,
  document_number text,
  document_date date,
  counterparty_gstin text,
  counterparty_name text,
  place_of_supply text,
  supply_nature text,
  classification text NOT NULL DEFAULT 'taxable',
  rate numeric(7,3) NOT NULL DEFAULT 0,
  taxable numeric(18,2) NOT NULL DEFAULT 0,
  igst numeric(18,2) NOT NULL DEFAULT 0,
  cgst numeric(18,2) NOT NULL DEFAULT 0,
  sgst numeric(18,2) NOT NULL DEFAULT 0,
  utgst numeric(18,2) NOT NULL DEFAULT 0,
  cess numeric(18,2) NOT NULL DEFAULT 0,
  document_value numeric(18,2),
  original_number text,
  original_date date,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS gst_return_documents_return_idx ON tenant.gst_return_documents (return_id, section);
-- a document is reported once per return type
CREATE UNIQUE INDEX IF NOT EXISTS gst_return_documents_once_uidx ON tenant.gst_return_documents (organization_id, return_type, source_type, source_id, section, rate, classification)
  WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.gst_return_hsn (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  return_id uuid NOT NULL REFERENCES tenant.gst_returns(id) ON DELETE CASCADE,
  recipient text NOT NULL CHECK (recipient IN ('b2b', 'b2c')),
  hsn_sac text NOT NULL,
  description text,
  uqc text NOT NULL DEFAULT 'OTH',
  quantity numeric(18,3) NOT NULL DEFAULT 0,
  rate numeric(7,3) NOT NULL DEFAULT 0,
  taxable numeric(18,2) NOT NULL DEFAULT 0,
  igst numeric(18,2) NOT NULL DEFAULT 0,
  cgst numeric(18,2) NOT NULL DEFAULT 0,
  sgst numeric(18,2) NOT NULL DEFAULT 0,
  utgst numeric(18,2) NOT NULL DEFAULT 0,
  cess numeric(18,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS gst_return_hsn_return_idx ON tenant.gst_return_hsn (return_id);

CREATE TABLE IF NOT EXISTS tenant.gst_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  return_id uuid NOT NULL REFERENCES tenant.gst_returns(id) ON DELETE CASCADE,
  key text NOT NULL,
  code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('blocking', 'warning')),
  source_type text,
  source_id uuid,
  document_number text,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waived', 'resolved')),
  note text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (return_id, key)
);
CREATE INDEX IF NOT EXISTS gst_exceptions_open_idx ON tenant.gst_exceptions (organization_id, status, severity);

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['gst_returns', 'gst_return_documents', 'gst_return_hsn', 'gst_exceptions'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app, vercent_worker', name);
  END LOOP;
END $$;

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('gst.view', 'View GST returns', 'GST', 'See GST return working papers, summaries, reconciliations and the exception queue.'),
  ('gst.return.prepare', 'Prepare GST returns', 'GST', 'Prepare GSTR-1 / GSTR-3B working data from posted documents and waive warnings.'),
  ('gst.return.approve', 'Approve GST returns', 'GST', 'Approve a prepared GST return (not one you prepared) or reopen it before filing.'),
  ('gst.return.file', 'Record GST filing', 'GST', 'Record that an approved return was filed on the GST portal, with its reference.'),
  ('gst.itc.manage', 'Manage input tax credit', 'GST', 'Import GSTR-2B, match it with supplier invoices, and reverse or reclaim input tax credit.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (
    SELECT slug, key FROM (VALUES ('finance_manager'), ('tax_compliance_accountant'), ('system_administrator'), ('organization_owner')) AS r(slug)
      CROSS JOIN (VALUES ('gst.view'), ('gst.return.prepare'), ('gst.return.approve'), ('gst.return.file'), ('gst.itc.manage')) AS k(key)
    UNION ALL SELECT 'accountant', 'gst.view' UNION ALL SELECT 'accountant', 'gst.return.prepare' UNION ALL SELECT 'accountant', 'gst.itc.manage'
    UNION ALL SELECT 'auditor', 'gst.view'
  ) AS grant_row ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0212_gst_returns.sql', 'gst-returns') ON CONFLICT DO NOTHING;
