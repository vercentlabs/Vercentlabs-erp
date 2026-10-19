-- Shared Platform plan, step 7: India compliance.
--
-- 1. GST unit codes (UQC): every unit names the code GST returns and the HSN summary use (NOS, KGS, LTR …). Existing units get the
--    code that matches theirs; others are left for the company to choose (OTH until then).
ALTER TABLE tenant.units_of_measure ADD COLUMN IF NOT EXISTS uqc text CHECK (uqc IS NULL OR uqc ~ '^[A-Z]{3}$');
UPDATE tenant.units_of_measure SET uqc = CASE upper(code)
    WHEN 'EA' THEN 'NOS' WHEN 'NOS' THEN 'NOS' WHEN 'NO' THEN 'NOS' WHEN 'UNIT' THEN 'UNT' WHEN 'UNT' THEN 'UNT' WHEN 'PCS' THEN 'PCS' WHEN 'PC' THEN 'PCS'
    WHEN 'KG' THEN 'KGS' WHEN 'KGS' THEN 'KGS' WHEN 'G' THEN 'GMS' WHEN 'GM' THEN 'GMS' WHEN 'GMS' THEN 'GMS' WHEN 'MG' THEN 'OTH' WHEN 'T' THEN 'TON' WHEN 'TON' THEN 'TON'
    WHEN 'MT' THEN 'MTS' WHEN 'QTL' THEN 'QTL' WHEN 'L' THEN 'LTR' WHEN 'LTR' THEN 'LTR' WHEN 'ML' THEN 'MLT' WHEN 'KL' THEN 'KLR'
    WHEN 'M' THEN 'MTR' WHEN 'MTR' THEN 'MTR' WHEN 'CM' THEN 'CMS' WHEN 'MM' THEN 'OTH' WHEN 'KM' THEN 'KME' WHEN 'FT' THEN 'OTH' WHEN 'IN' THEN 'OTH'
    WHEN 'SQM' THEN 'SQM' WHEN 'SQF' THEN 'SQF' WHEN 'SQFT' THEN 'SQF' WHEN 'CBM' THEN 'CBM' WHEN 'CCM' THEN 'CCM'
    WHEN 'BOX' THEN 'BOX' WHEN 'BAG' THEN 'BAG' WHEN 'BDL' THEN 'BDL' WHEN 'BKL' THEN 'BKL' WHEN 'BTL' THEN 'BTL' WHEN 'BOTTLE' THEN 'BTL' WHEN 'CAN' THEN 'CAN'
    WHEN 'CTN' THEN 'CTN' WHEN 'DOZ' THEN 'DOZ' WHEN 'DZ' THEN 'DOZ' WHEN 'DRM' THEN 'DRM' WHEN 'GGK' THEN 'GGK' WHEN 'GRS' THEN 'GRS' WHEN 'PAC' THEN 'PAC' WHEN 'PKT' THEN 'PAC'
    WHEN 'PAIR' THEN 'PRS' WHEN 'PRS' THEN 'PRS' WHEN 'ROL' THEN 'ROL' WHEN 'ROLL' THEN 'ROL' WHEN 'SET' THEN 'SET' WHEN 'SETS' THEN 'SET' WHEN 'TBS' THEN 'TBS' WHEN 'TUB' THEN 'TUB'
    WHEN 'YDS' THEN 'YDS' WHEN 'NOS.' THEN 'NOS'
    ELSE CASE category WHEN 'time' THEN 'OTH' ELSE NULL END END
  WHERE uqc IS NULL;

-- 2. Composition scheme: a registration under it charges no GST (bill of supply, "composition taxable person"), and pays a rate of its
--    turnover each quarter (CMP-08): 1% manufacturers and traders, 5% restaurants, 6% service providers.
ALTER TABLE tenant.tax_registrations ADD COLUMN IF NOT EXISTS composition_category text CHECK (composition_category IS NULL OR composition_category IN ('manufacturer', 'trader', 'restaurant', 'service'));
ALTER TABLE tenant.tax_registrations ADD COLUMN IF NOT EXISTS composition_rate numeric(5,2) CHECK (composition_rate IS NULL OR (composition_rate >= 0 AND composition_rate <= 10));

-- 3. TDS: per section, thresholds (one bill, and the financial year's total to the supplier), a rate for individuals and HUFs beside the
--    rate for others, and the rate without a PAN (section 206AA: the higher of 20% and twice the rate, unless set). Lower-deduction
--    certificates (section 197) per supplier and section, valid for dates and an amount.
ALTER TABLE tenant.withholding_tax_sections ADD COLUMN IF NOT EXISTS threshold_single numeric(20,2) CHECK (threshold_single IS NULL OR threshold_single >= 0);
ALTER TABLE tenant.withholding_tax_sections ADD COLUMN IF NOT EXISTS threshold_annual numeric(20,2) CHECK (threshold_annual IS NULL OR threshold_annual >= 0);
ALTER TABLE tenant.withholding_tax_sections ADD COLUMN IF NOT EXISTS rate_individual numeric(7,4) CHECK (rate_individual IS NULL OR (rate_individual >= 0 AND rate_individual <= 100));
ALTER TABLE tenant.withholding_tax_sections ADD COLUMN IF NOT EXISTS rate_no_pan numeric(7,4) CHECK (rate_no_pan IS NULL OR (rate_no_pan >= 0 AND rate_no_pan <= 100));

CREATE TABLE IF NOT EXISTS tenant.supplier_tds_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL,
  section_id uuid NOT NULL REFERENCES tenant.withholding_tax_sections(id) ON DELETE CASCADE,
  certificate_number text NOT NULL CHECK (length(certificate_number) BETWEEN 1 AND 40),
  rate numeric(7,4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  valid_from date NOT NULL,
  valid_to date NOT NULL CHECK (valid_to >= valid_from),
  amount_limit numeric(20,2) CHECK (amount_limit IS NULL OR amount_limit > 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_tds_certificates_lookup_idx ON tenant.supplier_tds_certificates (organization_id, supplier_id, section_id, valid_from);
ALTER TABLE tenant.supplier_tds_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.supplier_tds_certificates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.supplier_tds_certificates;
CREATE POLICY organization_isolation ON tenant.supplier_tds_certificates USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.supplier_tds_certificates TO vercent_app, vercent_worker;

-- 4. e-invoice (IRN) and e-way bills, through the company's GSP: what was sent, what came back (IRN, acknowledgement, signed QR; e-way
--    bill number and validity), cancellations and failures. One live IRN per document; one live e-way bill per movement.
CREATE TABLE IF NOT EXISTS tenant.einvoice_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('invoice', 'credit_note', 'debit_note')),
  document_id uuid NOT NULL,
  document_number text NOT NULL,
  seller_gstin text NOT NULL,
  irn text,
  ack_number text,
  ack_date timestamptz,
  signed_qr text,
  signed_invoice text,
  status text NOT NULL CHECK (status IN ('generated', 'cancelled', 'failed')),
  error text,
  cancel_reason text,
  cancelled_at timestamptz,
  payload jsonb NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS einvoice_documents_live_uidx ON tenant.einvoice_documents (organization_id, document_type, document_id) WHERE status = 'generated';
CREATE INDEX IF NOT EXISTS einvoice_documents_document_idx ON tenant.einvoice_documents (organization_id, document_id, created_at DESC);
ALTER TABLE tenant.einvoice_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.einvoice_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.einvoice_documents;
CREATE POLICY organization_isolation ON tenant.einvoice_documents USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.einvoice_documents TO vercent_app, vercent_worker;

CREATE TABLE IF NOT EXISTS tenant.eway_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('sales_delivery', 'stock_transfer', 'purchase_return')),
  source_id uuid NOT NULL,
  source_number text NOT NULL,
  ewb_number text,
  ewb_date timestamptz,
  valid_until timestamptz,
  status text NOT NULL CHECK (status IN ('generated', 'cancelled', 'failed')),
  transport_mode text CHECK (transport_mode IS NULL OR transport_mode IN ('road', 'rail', 'air', 'ship')),
  vehicle_number text,
  transporter_id text,
  transporter_document text,
  distance_km integer CHECK (distance_km IS NULL OR distance_km BETWEEN 0 AND 4000),
  part_b_updated_at timestamptz,
  error text,
  cancel_reason text,
  cancelled_at timestamptz,
  payload jsonb NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS eway_bills_live_uidx ON tenant.eway_bills (organization_id, source_type, source_id) WHERE status = 'generated';
ALTER TABLE tenant.eway_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.eway_bills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.eway_bills;
CREATE POLICY organization_isolation ON tenant.eway_bills USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.eway_bills TO vercent_app, vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0191_platform_india_compliance.sql', 'platform-india-compliance') ON CONFLICT DO NOTHING;
