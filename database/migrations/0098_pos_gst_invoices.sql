-- 0098 GST Invoice: the shared invoicing record behind every POS sale (and, later, other sales sources). POS keeps calculating nothing
-- itself — the tax engine's finalized values on the sale are copied, never recomputed. This adds what a statutory document needs:
--
-- 1. Statutory numbering series per seller registration (GSTIN), document kind and financial year: consecutive, at most 16 characters of
--    letters, digits, "/" and "-", allocated in the same transaction as the sale — so a failed sale never burns a number and two counters
--    never share one. The sale's receipt number stays its internal reference.
-- 2. Invoices: one per sale (or per return, as its credit note), with the seller and buyer as issued, place of supply, supply type (B2B /
--    B2C), totals by component, the tax fingerprint, e-invoice applicability, and a content hash. Issued values never change.
-- 3. Invoice lines: description, HSN/SAC, quantity, unit, price, item / promotion / cart discounts, taxable value, classification, rate and
--    each component (CGST, SGST, UTGST, IGST, cess) — for the document and for GST reporting (HSN summary, rate-wise totals).
-- 4. E-invoicing: whether a registration is under the e-invoice mandate (set by the company; it depends on turnover and notifications).
--    There is no IRP integration: a transaction that needs an IRN is blocked before payment, never issued as an ordinary invoice, and no
--    IRN or signed QR is ever made up. The invoice keeps the fields an integration would fill.
-- 5. Links: the sale's and the return's invoice number.

-- ============================================================ 1. numbering series

CREATE TABLE IF NOT EXISTS tenant.invoice_number_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  seller_registration_id uuid NOT NULL REFERENCES tenant.tax_registrations(id),
  document_kind text NOT NULL CHECK (document_kind IN ('tax_invoice', 'bill_of_supply', 'credit_note', 'debit_note')),
  financial_year text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  prefix text NOT NULL CHECK (prefix ~ '^[A-Za-z0-9/-]{1,8}$'),
  padding integer NOT NULL DEFAULT 5 CHECK (padding BETWEEN 3 AND 8),
  next_number bigint NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, seller_registration_id, document_kind, financial_year),
  CHECK (length(prefix) + 5 + padding <= 16)
);
ALTER TABLE tenant.invoice_number_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.invoice_number_series FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'invoice_number_series' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.invoice_number_series USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.invoice_number_series TO vercent_app;
GRANT SELECT ON tenant.invoice_number_series TO vercent_worker;

-- A number already issued is never issued again: the counter only moves forward, and the prefix is fixed once a number is out.
CREATE OR REPLACE FUNCTION tenant.invoice_number_series_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.next_number < OLD.next_number THEN
    RAISE EXCEPTION 'An invoice series never moves backwards.' USING ERRCODE = 'check_violation', CONSTRAINT = 'invoice_number_series_forward_only';
  END IF;
  IF OLD.next_number > 1 AND (NEW.prefix IS DISTINCT FROM OLD.prefix OR NEW.padding IS DISTINCT FROM OLD.padding OR NEW.financial_year IS DISTINCT FROM OLD.financial_year
     OR NEW.seller_registration_id IS DISTINCT FROM OLD.seller_registration_id OR NEW.document_kind IS DISTINCT FROM OLD.document_kind) THEN
    RAISE EXCEPTION 'A series that has issued numbers cannot change its format.' USING ERRCODE = 'check_violation', CONSTRAINT = 'invoice_number_series_format_fixed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER invoice_number_series_guard BEFORE UPDATE ON tenant.invoice_number_series FOR EACH ROW EXECUTE FUNCTION tenant.invoice_number_series_guard();

-- ============================================================ 2. invoices

CREATE TABLE IF NOT EXISTS tenant.gst_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('pos_sale', 'pos_return')),
  source_id uuid NOT NULL,
  store_id uuid REFERENCES tenant.pos_stores(id),
  seller_registration_id uuid REFERENCES tenant.tax_registrations(id),
  series_id uuid REFERENCES tenant.invoice_number_series(id),
  document_type text NOT NULL CHECK (document_type IN ('tax_invoice', 'bill_of_supply', 'invoice_cum_bill_of_supply', 'credit_note', 'debit_note', 'receipt')),
  invoice_number text NOT NULL CHECK (length(invoice_number) <= 16 AND invoice_number ~ '^[A-Za-z0-9/-]+$'),
  financial_year text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  original_invoice_id uuid REFERENCES tenant.gst_invoices(id),
  reason text,
  customer_mode text NOT NULL DEFAULT 'walk_in' CHECK (customer_mode IN ('walk_in', 'registered')),
  customer_id uuid,
  supply_type text NOT NULL DEFAULT 'b2c' CHECK (supply_type IN ('b2b', 'b2c')),
  buyer_gstin text,
  seller_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  buyer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  place_of_supply_code text,
  place_of_supply_name text,
  supply_mode text,
  reverse_charge boolean NOT NULL DEFAULT false,
  currency_code text NOT NULL DEFAULT 'INR',
  subtotal numeric(20,6) NOT NULL DEFAULT 0,
  discount_total numeric(20,6) NOT NULL DEFAULT 0,
  taxable_total numeric(20,6) NOT NULL DEFAULT 0,
  cgst_total numeric(20,6) NOT NULL DEFAULT 0,
  sgst_total numeric(20,6) NOT NULL DEFAULT 0,
  igst_total numeric(20,6) NOT NULL DEFAULT 0,
  utgst_total numeric(20,6) NOT NULL DEFAULT 0,
  cess_total numeric(20,6) NOT NULL DEFAULT 0,
  tax_total numeric(20,6) NOT NULL DEFAULT 0,
  rounding_adjustment numeric(20,6) NOT NULL DEFAULT 0,
  grand_total numeric(20,6) NOT NULL DEFAULT 0,
  tax_calculation_hash text,
  einvoice_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (einvoice_status IN ('not_applicable', 'required', 'ready', 'registration_pending', 'registered', 'failed', 'unknown', 'reconciliation_required')),
  irn text,
  irn_ack_number text,
  irn_ack_at timestamptz,
  signed_qr text,
  document_status text NOT NULL DEFAULT 'issued' CHECK (document_status IN ('issued', 'cancelled')),
  content_hash text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_type, source_id),
  CHECK (document_type <> 'credit_note' OR original_invoice_id IS NOT NULL),
  CHECK (supply_type <> 'b2b' OR buyer_gstin IS NOT NULL)
);
-- One number per seller registration and financial year: a GSTIN never issues the same number twice in a year.
CREATE UNIQUE INDEX IF NOT EXISTS gst_invoices_number_uidx ON tenant.gst_invoices (organization_id, COALESCE(seller_registration_id, '00000000-0000-0000-0000-000000000000'::uuid), financial_year, invoice_number);
CREATE INDEX IF NOT EXISTS gst_invoices_issued_idx ON tenant.gst_invoices (organization_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS gst_invoices_original_idx ON tenant.gst_invoices (organization_id, original_invoice_id) WHERE original_invoice_id IS NOT NULL;
ALTER TABLE tenant.gst_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.gst_invoices FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'gst_invoices' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.gst_invoices USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.gst_invoices TO vercent_app;
GRANT SELECT ON tenant.gst_invoices TO vercent_worker;

-- Issued values never change. Only the e-invoice registration fields (filled by an integration) and a controlled cancellation may move.
CREATE OR REPLACE FUNCTION tenant.gst_invoice_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR NEW.issued_at IS DISTINCT FROM OLD.issued_at OR NEW.document_type IS DISTINCT FROM OLD.document_type
     OR NEW.seller_registration_id IS DISTINCT FROM OLD.seller_registration_id OR NEW.seller_snapshot IS DISTINCT FROM OLD.seller_snapshot OR NEW.buyer_snapshot IS DISTINCT FROM OLD.buyer_snapshot
     OR NEW.buyer_gstin IS DISTINCT FROM OLD.buyer_gstin OR NEW.supply_type IS DISTINCT FROM OLD.supply_type OR NEW.place_of_supply_code IS DISTINCT FROM OLD.place_of_supply_code
     OR NEW.taxable_total IS DISTINCT FROM OLD.taxable_total OR NEW.tax_total IS DISTINCT FROM OLD.tax_total OR NEW.grand_total IS DISTINCT FROM OLD.grand_total
     OR NEW.cgst_total IS DISTINCT FROM OLD.cgst_total OR NEW.sgst_total IS DISTINCT FROM OLD.sgst_total OR NEW.igst_total IS DISTINCT FROM OLD.igst_total OR NEW.utgst_total IS DISTINCT FROM OLD.utgst_total
     OR NEW.cess_total IS DISTINCT FROM OLD.cess_total OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.original_invoice_id IS DISTINCT FROM OLD.original_invoice_id OR NEW.financial_year IS DISTINCT FROM OLD.financial_year THEN
    RAISE EXCEPTION 'An issued invoice cannot be changed; use a credit note or debit note.' USING ERRCODE = 'check_violation', CONSTRAINT = 'gst_invoice_immutable';
  END IF;
  IF OLD.document_status = 'cancelled' AND NEW.document_status <> 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled invoice stays cancelled.' USING ERRCODE = 'check_violation', CONSTRAINT = 'gst_invoice_cancel_final';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER gst_invoices_guard BEFORE UPDATE ON tenant.gst_invoices FOR EACH ROW EXECUTE FUNCTION tenant.gst_invoice_guard();

-- ============================================================ 3. invoice lines (insert-only)

CREATE TABLE IF NOT EXISTS tenant.gst_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES tenant.gst_invoices(id),
  line_number integer NOT NULL,
  source_line_id uuid,
  item_id uuid,
  description text NOT NULL,
  hsn_sac text,
  uom_code text,
  quantity numeric(20,6) NOT NULL,
  unit_price numeric(20,6) NOT NULL DEFAULT 0,
  price_includes_tax boolean NOT NULL DEFAULT false,
  gross_amount numeric(20,6) NOT NULL DEFAULT 0,
  item_discount numeric(20,6) NOT NULL DEFAULT 0,
  promotion_discount numeric(20,6) NOT NULL DEFAULT 0,
  cart_discount numeric(20,6) NOT NULL DEFAULT 0,
  taxable_amount numeric(20,6) NOT NULL DEFAULT 0,
  tax_classification text,
  tax_rate numeric(9,4),
  cgst_rate numeric(9,4) NOT NULL DEFAULT 0,
  cgst_amount numeric(20,6) NOT NULL DEFAULT 0,
  sgst_rate numeric(9,4) NOT NULL DEFAULT 0,
  sgst_amount numeric(20,6) NOT NULL DEFAULT 0,
  igst_rate numeric(9,4) NOT NULL DEFAULT 0,
  igst_amount numeric(20,6) NOT NULL DEFAULT 0,
  utgst_rate numeric(9,4) NOT NULL DEFAULT 0,
  utgst_amount numeric(20,6) NOT NULL DEFAULT 0,
  cess_rate numeric(9,4) NOT NULL DEFAULT 0,
  cess_amount numeric(20,6) NOT NULL DEFAULT 0,
  line_total numeric(20,6) NOT NULL DEFAULT 0,
  UNIQUE (organization_id, invoice_id, line_number)
);
CREATE INDEX IF NOT EXISTS gst_invoice_lines_hsn_idx ON tenant.gst_invoice_lines (organization_id, hsn_sac);
ALTER TABLE tenant.gst_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.gst_invoice_lines FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'gst_invoice_lines' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.gst_invoice_lines USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT ON tenant.gst_invoice_lines TO vercent_app;
GRANT SELECT ON tenant.gst_invoice_lines TO vercent_worker;

-- ============================================================ 4. e-invoicing applicability (per registration)

ALTER TABLE tenant.tax_registrations
  ADD COLUMN IF NOT EXISTS einvoice_applicable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS einvoice_applicable_from date;

-- ============================================================ 5. links

ALTER TABLE tenant.pos_sales
  ADD COLUMN IF NOT EXISTS gst_invoice_id uuid REFERENCES tenant.gst_invoices(id),
  ADD COLUMN IF NOT EXISTS invoice_number text;
ALTER TABLE tenant.pos_returns
  ADD COLUMN IF NOT EXISTS credit_note_id uuid REFERENCES tenant.gst_invoices(id),
  ADD COLUMN IF NOT EXISTS credit_note_number text;
CREATE INDEX IF NOT EXISTS pos_sales_invoice_number_idx ON tenant.pos_sales (organization_id, invoice_number) WHERE invoice_number IS NOT NULL;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0098_pos_gst_invoices.sql', 'pos-gst-invoices') ON CONFLICT DO NOTHING;
