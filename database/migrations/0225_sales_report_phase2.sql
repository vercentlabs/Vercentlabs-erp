-- Sales report, Phase 2 (the must-have features).

-- Online decline, changes and signature: the signature the customer drew when accepting online, kept as a file on the quotation.
ALTER TABLE tenant.sales_quotations ADD COLUMN IF NOT EXISTS signature_file_id uuid;
ALTER TABLE tenant.sales_quotations ADD COLUMN IF NOT EXISTS signed_by_name text;

-- Headings and notes inside the lines: blocks beside the lines ([{ kind: section | note, text, position }]), never priced or booked.
ALTER TABLE tenant.sales_quotation_versions ADD COLUMN IF NOT EXISTS section_lines jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tenant.sales_order_versions ADD COLUMN IF NOT EXISTS section_lines jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tenant.sales_invoices ADD COLUMN IF NOT EXISTS section_lines jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Quotation templates: a ready-made start for a quotation (its lines, headings and notes, how long it stays valid, terms, payment terms and
-- the note to the customer). New quotation › Start from template fills the form from one; the quotation is then changed as any other.
CREATE TABLE IF NOT EXISTS tenant.sales_quotation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  description text,
  validity_days integer CHECK (validity_days IS NULL OR validity_days BETWEEN 1 AND 365),
  payment_term_id uuid,
  terms_and_conditions text,
  customer_notes text,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  section_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_quotation_templates_name ON tenant.sales_quotation_templates (organization_id, lower(name)) WHERE status = 'active';
ALTER TABLE tenant.sales_quotation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_quotation_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.sales_quotation_templates;
CREATE POLICY organization_isolation ON tenant.sales_quotation_templates USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.sales_quotation_templates TO vercent_app;
GRANT SELECT ON tenant.sales_quotation_templates TO vercent_worker;

-- Cheque register: every cheque received, through Received → Deposited → Cleared, or Bounced. A cheque dated today or earlier posts its
-- receipt when entered; a post-dated cheque waits here with no receipt and is posted when it clears. A bounce reverses the receipt.
CREATE TABLE IF NOT EXISTS tenant.sales_cheques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id uuid NOT NULL,
  receipt_id uuid,
  cheque_number text NOT NULL,
  cheque_date date NOT NULL,
  drawee_bank text,
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  currency_code text NOT NULL,
  allocations jsonb,
  reference text,
  notes text,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'deposited', 'cleared', 'bounced', 'cancelled')),
  deposited_on date,
  cleared_on date,
  bounced_on date,
  bounce_reason text,
  bounce_charge numeric(18, 2),
  bounce_debit_note_id uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_cheques_status ON tenant.sales_cheques (organization_id, status, cheque_date);
CREATE INDEX IF NOT EXISTS sales_cheques_receipt ON tenant.sales_cheques (organization_id, receipt_id);
ALTER TABLE tenant.sales_cheques ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_cheques FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.sales_cheques;
CREATE POLICY organization_isolation ON tenant.sales_cheques USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE ON tenant.sales_cheques TO vercent_app;
GRANT SELECT ON tenant.sales_cheques TO vercent_worker;

-- Automatic payment reminders: rules by days before or after the due date, by email and WhatsApp. Off until switched on; Preview logs what
-- would be sent without sending. Each rule reminds about an invoice once. A customer can be left out.
ALTER TABLE tenant.sales_settings ADD COLUMN IF NOT EXISTS payment_reminders_mode text NOT NULL DEFAULT 'off';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_payment_reminders_mode_check') THEN
    ALTER TABLE tenant.sales_settings ADD CONSTRAINT sales_settings_payment_reminders_mode_check CHECK (payment_reminders_mode IN ('off', 'preview', 'send'));
  END IF;
END $$;
ALTER TABLE tenant.business_parties ADD COLUMN IF NOT EXISTS payment_reminders_paused boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS tenant.sales_reminder_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  days_offset integer NOT NULL CHECK (days_offset BETWEEN -60 AND 365),
  send_email boolean NOT NULL DEFAULT true,
  send_whatsapp boolean NOT NULL DEFAULT false,
  whatsapp_template text,
  whatsapp_language text NOT NULL DEFAULT 'en',
  subject text,
  message text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (send_email OR send_whatsapp)
);
CREATE TABLE IF NOT EXISTS tenant.sales_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL,
  party_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  run_on date NOT NULL,
  status text NOT NULL CHECK (status IN ('previewed', 'sent', 'failed', 'skipped')),
  channels text[] NOT NULL DEFAULT ARRAY[]::text[],
  amount_due numeric(18, 2),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Once per rule and invoice when sent (or tried); a preview is kept once too, apart from the real send.
CREATE UNIQUE INDEX IF NOT EXISTS sales_reminder_log_once ON tenant.sales_reminder_log (organization_id, rule_id, invoice_id) WHERE status <> 'previewed';
CREATE UNIQUE INDEX IF NOT EXISTS sales_reminder_log_preview_once ON tenant.sales_reminder_log (organization_id, rule_id, invoice_id) WHERE status = 'previewed';
CREATE INDEX IF NOT EXISTS sales_reminder_log_party ON tenant.sales_reminder_log (organization_id, party_id, created_at DESC);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_reminder_rules', 'sales_reminder_log'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = t AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', t);
    EXECUTE format('GRANT SELECT, INSERT ON tenant.%I TO vercent_worker', t);
  END LOOP;
END $$;

-- E-invoice per company: each GSTIN connects its own GST Suvidha Provider account. Credentials are kept encrypted and never shown again;
-- every call made with them is logged. Without a connection, the platform-wide GSP (if any) is used as before.
CREATE TABLE IF NOT EXISTS tenant.gsp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL,
  provider text NOT NULL,
  base_url text,
  encrypted_credentials jsonb NOT NULL,
  credential_hint text,
  status text NOT NULL DEFAULT 'untested' CHECK (status IN ('untested', 'connected', 'failed')),
  last_tested_at timestamptz,
  last_error text,
  last_used_at timestamptz,
  use_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, registration_id)
);
CREATE TABLE IF NOT EXISTS tenant.gsp_connection_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  action text NOT NULL,
  ok boolean NOT NULL,
  detail text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gsp_connection_events_connection ON tenant.gsp_connection_events (organization_id, connection_id, created_at DESC);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gsp_connections', 'gsp_connection_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = t AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', t);
  END LOOP;
END $$;
-- The worker makes e-invoices too (on finalising, from bulk runs): it reads the connection and logs its use.
GRANT SELECT, UPDATE ON tenant.gsp_connections TO vercent_worker;
GRANT INSERT ON tenant.gsp_connection_events TO vercent_worker;

-- GST on advances: a receipt voucher (Rule 50) for an advance received before the supply, with GST worked out of it at the supply's rate;
-- its adjustment when the advance is used on an invoice; a refund voucher (Rule 51) when it is returned without a supply. GSTR-1 reports
-- them in tables 11A and 11B. The company switches this on from a date, so documents before it are never touched.
ALTER TABLE tenant.sales_settings ADD COLUMN IF NOT EXISTS receipt_vouchers_from date;
CREATE TABLE IF NOT EXISTS tenant.sales_receipt_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  voucher_number text NOT NULL,
  voucher_date date NOT NULL,
  party_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  registration_id uuid,
  seller_gstin text,
  customer_name text,
  customer_gstin text,
  place_of_supply text NOT NULL,
  supply_nature text NOT NULL CHECK (supply_nature IN ('intra', 'inter')),
  description text,
  sac_hsn text,
  rate numeric(6, 3) NOT NULL CHECK (rate >= 0 AND rate <= 40),
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  taxable numeric(18, 2) NOT NULL,
  igst numeric(18, 2) NOT NULL DEFAULT 0,
  cgst numeric(18, 2) NOT NULL DEFAULT 0,
  sgst numeric(18, 2) NOT NULL DEFAULT 0,
  adjusted_amount numeric(18, 2) NOT NULL DEFAULT 0,
  refunded_amount numeric(18, 2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'partly_used', 'used', 'refunded', 'cancelled')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, voucher_number)
);
CREATE INDEX IF NOT EXISTS sales_receipt_vouchers_receipt ON tenant.sales_receipt_vouchers (organization_id, receipt_id);
CREATE INDEX IF NOT EXISTS sales_receipt_vouchers_date ON tenant.sales_receipt_vouchers (organization_id, voucher_date);
CREATE TABLE IF NOT EXISTS tenant.sales_receipt_voucher_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  voucher_id uuid NOT NULL REFERENCES tenant.sales_receipt_vouchers(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL,
  adjusted_on date NOT NULL,
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  taxable numeric(18, 2) NOT NULL,
  igst numeric(18, 2) NOT NULL DEFAULT 0,
  cgst numeric(18, 2) NOT NULL DEFAULT 0,
  sgst numeric(18, 2) NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_receipt_voucher_adjustments_date ON tenant.sales_receipt_voucher_adjustments (organization_id, adjusted_on);
CREATE INDEX IF NOT EXISTS sales_receipt_voucher_adjustments_invoice ON tenant.sales_receipt_voucher_adjustments (organization_id, invoice_id);
CREATE TABLE IF NOT EXISTS tenant.sales_refund_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  voucher_number text NOT NULL,
  receipt_voucher_id uuid NOT NULL REFERENCES tenant.sales_receipt_vouchers(id),
  refund_date date NOT NULL,
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  taxable numeric(18, 2) NOT NULL,
  igst numeric(18, 2) NOT NULL DEFAULT 0,
  cgst numeric(18, 2) NOT NULL DEFAULT 0,
  sgst numeric(18, 2) NOT NULL DEFAULT 0,
  reason text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, voucher_number)
);
CREATE INDEX IF NOT EXISTS sales_refund_vouchers_date ON tenant.sales_refund_vouchers (organization_id, refund_date);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_receipt_vouchers', 'sales_receipt_voucher_adjustments', 'sales_refund_vouchers'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = t AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON tenant.%I TO vercent_app', t);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', t);
  END LOOP;
END $$;
