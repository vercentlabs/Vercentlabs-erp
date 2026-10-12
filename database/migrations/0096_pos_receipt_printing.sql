-- 0096 POS Receipt Printing: a completed sale (or return) gets one finalized document — its content frozen when first issued, never
-- recalculated — rendered for an 80 mm or 58 mm thermal roll or A4 from that same snapshot, and printed through the browser (or, where a
-- supported print bridge exists, a registered terminal printer). Printing has its own lifecycle and can never change the sale, the payment,
-- the stock or the invoice number; a reprint is the same document marked as a copy.
--
-- 1. Document snapshots: the sale's (or return's) document — type, number, issue time and timezone, the seller, outlet, buyer, lines, tax,
--    discounts, totals, payments (or refunds) as finalized — with a content hash and a version. Never changed once written.
-- 2. Receipt printers per terminal: name, connection (browser, print agent, network bridge), paper width (58 / 80 mm), profile, one
--    default per terminal, automatic printing, copies, merchant copy, paper cut, encoding, the bridge's device reference (a name, never a URL
--    or a path), enabled.
-- 3. Print jobs: which document (and version), which printer and terminal, why (automatic, manual, reprint, test), the copy label
--    (original / copy), the state (queued → ready / dispatched → acknowledged, failed, outcome unknown, cancelled — never "printed" unless a
--    device can prove it), attempts, the last error, who asked. One automatic job per document version.
-- 4. Outlet receipt branding: the return policy and support text, and whether a scannable receipt reference is printed.

-- ============================================================ 1. document snapshots

CREATE TABLE IF NOT EXISTS tenant.pos_document_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  source_type text NOT NULL CHECK (source_type IN ('pos_sale', 'pos_return')),
  source_id uuid NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('tax_invoice', 'bill_of_supply', 'invoice_cum_bill_of_supply', 'sale_receipt', 'return_receipt', 'credit_note')),
  document_number text NOT NULL,
  document_version integer NOT NULL DEFAULT 1 CHECK (document_version > 0),
  lookup_reference text NOT NULL,
  issued_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  content jsonb NOT NULL,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'finalized' CHECK (status IN ('finalized', 'superseded')),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_type, source_id, document_version)
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_document_snapshots_lookup_uidx ON tenant.pos_document_snapshots (organization_id, lookup_reference, document_version);
ALTER TABLE tenant.pos_document_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_document_snapshots FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'pos_document_snapshots' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.pos_document_snapshots USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.pos_document_snapshots TO vercent_app;
GRANT SELECT ON tenant.pos_document_snapshots TO vercent_worker;

CREATE OR REPLACE FUNCTION tenant.pos_document_snapshot_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.document_number IS DISTINCT FROM OLD.document_number
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at OR NEW.document_type IS DISTINCT FROM OLD.document_type OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.document_version IS DISTINCT FROM OLD.document_version OR NEW.lookup_reference IS DISTINCT FROM OLD.lookup_reference THEN
    RAISE EXCEPTION 'A finalized document cannot be changed; issue a new version through the document workflow.' USING ERRCODE = 'check_violation', CONSTRAINT = 'pos_document_snapshot_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER pos_document_snapshots_guard BEFORE UPDATE ON tenant.pos_document_snapshots FOR EACH ROW EXECUTE FUNCTION tenant.pos_document_snapshot_guard();

-- ============================================================ 2. receipt printers

CREATE TABLE IF NOT EXISTS tenant.pos_receipt_printers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  terminal_id uuid NOT NULL REFERENCES tenant.pos_terminals(id),
  display_name text NOT NULL,
  connection_mode text NOT NULL DEFAULT 'browser' CHECK (connection_mode IN ('browser', 'print_agent', 'network_bridge')),
  printer_profile text NOT NULL DEFAULT 'thermal_generic' CHECK (printer_profile IN ('thermal_generic', 'escpos', 'a4_document')),
  paper_width_mm integer NOT NULL DEFAULT 80 CHECK (paper_width_mm IN (58, 80, 210)),
  default_for_terminal boolean NOT NULL DEFAULT false,
  auto_print_enabled boolean NOT NULL DEFAULT false,
  copies integer NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 3),
  merchant_copy boolean NOT NULL DEFAULT false,
  cut_paper boolean NOT NULL DEFAULT true,
  character_encoding text NOT NULL DEFAULT 'utf-8' CHECK (character_encoding IN ('utf-8', 'cp437', 'cp858')),
  bridge_device_reference text CHECK (bridge_device_reference IS NULL OR bridge_device_reference ~ '^[A-Za-z0-9._:-]{1,80}$'),
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_receipt_printers_default_uidx ON tenant.pos_receipt_printers (organization_id, terminal_id) WHERE default_for_terminal AND enabled;
CREATE INDEX IF NOT EXISTS pos_receipt_printers_terminal_idx ON tenant.pos_receipt_printers (organization_id, terminal_id);
ALTER TABLE tenant.pos_receipt_printers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_receipt_printers FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'pos_receipt_printers' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.pos_receipt_printers USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.pos_receipt_printers TO vercent_app;
GRANT SELECT ON tenant.pos_receipt_printers TO vercent_worker;

-- ============================================================ 3. print jobs

CREATE TABLE IF NOT EXISTS tenant.pos_receipt_print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  document_id uuid REFERENCES tenant.pos_document_snapshots(id),
  document_version integer,
  printer_id uuid REFERENCES tenant.pos_receipt_printers(id),
  terminal_id uuid REFERENCES tenant.pos_terminals(id),
  request_type text NOT NULL CHECK (request_type IN ('auto', 'manual', 'reprint', 'test')),
  copy_label text NOT NULL DEFAULT 'original' CHECK (copy_label IN ('original', 'copy', 'merchant_copy', 'test')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'rendering', 'ready', 'dispatched', 'acknowledged', 'failed', 'outcome_unknown', 'cancelled')),
  render_format text NOT NULL DEFAULT 'html',
  render_version text NOT NULL DEFAULT 'receipt-html-1',
  paper_width_mm integer NOT NULL DEFAULT 80 CHECK (paper_width_mm IN (58, 80, 210)),
  document_hash text,
  idempotency_key text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  requested_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_receipt_print_jobs_auto_uidx ON tenant.pos_receipt_print_jobs (organization_id, document_id, document_version) WHERE request_type = 'auto';
CREATE INDEX IF NOT EXISTS pos_receipt_print_jobs_document_idx ON tenant.pos_receipt_print_jobs (organization_id, document_id, created_at);
ALTER TABLE tenant.pos_receipt_print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_receipt_print_jobs FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'pos_receipt_print_jobs' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.pos_receipt_print_jobs USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.pos_receipt_print_jobs TO vercent_app;
GRANT SELECT ON tenant.pos_receipt_print_jobs TO vercent_worker;

-- ============================================================ 4. outlet receipt branding

ALTER TABLE tenant.pos_stores
  ADD COLUMN IF NOT EXISTS receipt_return_policy text,
  ADD COLUMN IF NOT EXISTS receipt_support_text text,
  ADD COLUMN IF NOT EXISTS receipt_reference_code_enabled boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stores_receipt_text_check') THEN
    ALTER TABLE tenant.pos_stores ADD CONSTRAINT pos_stores_receipt_text_check CHECK (
      (receipt_return_policy IS NULL OR length(receipt_return_policy) <= 500) AND (receipt_support_text IS NULL OR length(receipt_support_text) <= 200));
  END IF;
END $$;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0096_pos_receipt_printing.sql', 'pos-receipt-printing') ON CONFLICT DO NOTHING;
