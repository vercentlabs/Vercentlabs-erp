-- GST — GSTR-3B working paper inputs: GSTR-2B imports matched against supplier invoices, and input-tax-credit reversals / reclaims
-- (MVP 42). Additive:
--   1. gst_2b_imports + gst_2b_lines: the supplier-reported invoices of a GSTIN and month, as downloaded from the portal; a new import of the
--      same month supersedes the old one; each line is matched to the supplier invoice in the books (or reported as missing / differing);
--   2. gst_itc_adjustments: credit reversed (Rule 37 non-payment, Rules 42 / 43 common credit, s.17(5) blocked, other) — reclaimable or not —
--      and credit reclaimed later, each posted once to Finance;
--   3. the optional posting account itc_reversed ("Input GST reversed — reclaimable"; ineligible input tax is used when it is not set up).
-- Re-runnable.

CREATE TABLE IF NOT EXISTS tenant.gst_2b_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  period date NOT NULL CHECK (extract(day FROM period) = 1),
  file_name text,
  row_count integer NOT NULL DEFAULT 0,
  skipped jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'superseded')),
  imported_by uuid,
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS gst_2b_imports_current_uidx ON tenant.gst_2b_imports (organization_id, registration_id, period) WHERE status = 'current';

CREATE TABLE IF NOT EXISTS tenant.gst_2b_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  import_id uuid NOT NULL REFERENCES tenant.gst_2b_imports(id) ON DELETE CASCADE,
  supplier_gstin text NOT NULL,
  supplier_name text,
  document_type text NOT NULL DEFAULT 'invoice' CHECK (document_type IN ('invoice', 'credit_note', 'debit_note')),
  document_number text NOT NULL,
  document_key text NOT NULL,
  document_date date,
  place_of_supply text,
  reverse_charge boolean NOT NULL DEFAULT false,
  taxable numeric(18,2) NOT NULL DEFAULT 0,
  igst numeric(18,2) NOT NULL DEFAULT 0,
  cgst numeric(18,2) NOT NULL DEFAULT 0,
  sgst numeric(18,2) NOT NULL DEFAULT 0,
  cess numeric(18,2) NOT NULL DEFAULT 0,
  itc_available boolean NOT NULL DEFAULT true,
  match_status text NOT NULL DEFAULT 'pending' CHECK (match_status IN ('pending', 'matched', 'mismatch', 'not_in_books')),
  matched_source_type text,
  matched_source_id uuid,
  difference jsonb
);
CREATE INDEX IF NOT EXISTS gst_2b_lines_import_idx ON tenant.gst_2b_lines (import_id, match_status);
CREATE INDEX IF NOT EXISTS gst_2b_lines_key_idx ON tenant.gst_2b_lines (organization_id, supplier_gstin, document_key);

CREATE TABLE IF NOT EXISTS tenant.gst_itc_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  period date NOT NULL CHECK (extract(day FROM period) = 1),
  kind text NOT NULL CHECK (kind IN ('reversal', 'reclaim')),
  reason_code text NOT NULL CHECK (reason_code IN ('rule_37_non_payment', 'rule_42_43_common_credit', 'section_17_5_blocked', 'rule_38', 'other', 'reclaim')),
  reclaimable boolean NOT NULL DEFAULT false,
  reclaims_id uuid REFERENCES tenant.gst_itc_adjustments(id),
  source_type text,
  source_id uuid,
  igst numeric(18,2) NOT NULL DEFAULT 0 CHECK (igst >= 0),
  cgst numeric(18,2) NOT NULL DEFAULT 0 CHECK (cgst >= 0),
  sgst numeric(18,2) NOT NULL DEFAULT 0 CHECK (sgst >= 0),
  cess numeric(18,2) NOT NULL DEFAULT 0 CHECK (cess >= 0),
  journal_entry_id uuid,
  note text NOT NULL,
  idempotency_key text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (igst + cgst + sgst + cess > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS gst_itc_adjustments_reclaim_uidx ON tenant.gst_itc_adjustments (reclaims_id) WHERE reclaims_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS gst_itc_adjustments_key_uidx ON tenant.gst_itc_adjustments (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['gst_2b_imports', 'gst_2b_lines', 'gst_itc_adjustments'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.gst_2b_imports TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE ON tenant.gst_2b_lines TO vercent_app, vercent_worker;
-- adjustments are never edited: a wrong one is reclaimed or reversed in Finance
GRANT SELECT, INSERT, UPDATE (journal_entry_id) ON tenant.gst_itc_adjustments TO vercent_app, vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0213_gst_3b_2b_itc.sql', 'gst-3b-2b-itc') ON CONFLICT DO NOTHING;
