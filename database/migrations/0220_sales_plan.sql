-- Sales Module — Implementation Plan (22 Oct 2026): collect, comply and field sales.

-- 1. A payment received records the cheque (number, date and the bank it is drawn on) beside its UTR / reference (Payments Received).
ALTER TABLE tenant.accounting_customer_receipts ADD COLUMN IF NOT EXISTS cheque_number text CHECK (cheque_number IS NULL OR char_length(cheque_number) <= 20);
ALTER TABLE tenant.accounting_customer_receipts ADD COLUMN IF NOT EXISTS cheque_date date;
ALTER TABLE tenant.accounting_customer_receipts ADD COLUMN IF NOT EXISTS drawee_bank text CHECK (drawee_bank IS NULL OR char_length(drawee_bank) <= 100);

-- 2. GST & e-invoice settings: an invoice gets its IRN when it is posted (once the GSP is tested), and a company with turnover of
--    ₹10 crore or more is warned that an invoice must reach the IRP within 30 days of its date. Both off until switched on.
ALTER TABLE tenant.sales_settings ADD COLUMN IF NOT EXISTS einvoice_on_post boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.sales_settings ADD COLUMN IF NOT EXISTS einvoice_30_day_limit boolean NOT NULL DEFAULT false;

-- 3. Credit hold: an order refused at confirmation for credit stays held (since when, why) until it is confirmed or changed, so the order
--    list has a Credit hold view and the home counts it; the salesperson can ask a manager to release it.
ALTER TABLE tenant.sales_orders ADD COLUMN IF NOT EXISTS credit_hold_since timestamptz;
ALTER TABLE tenant.sales_orders ADD COLUMN IF NOT EXISTS credit_hold_reasons jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tenant.sales_orders ADD COLUMN IF NOT EXISTS credit_release_requested_at timestamptz;
ALTER TABLE tenant.sales_orders ADD COLUMN IF NOT EXISTS credit_release_requested_by uuid REFERENCES public.users(id);
CREATE INDEX IF NOT EXISTS sales_orders_credit_hold_idx ON tenant.sales_orders (organization_id) WHERE credit_hold_since IS NOT NULL;

-- 4. Collections: what was said to a customer about what it owes — a reminder sent (WhatsApp or email), a promise to pay (by when, how
--    much) or a note. The Outstanding page shows the latest promise beside the customer.
CREATE TABLE IF NOT EXISTS tenant.sales_collection_notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES tenant.business_parties(id),
  kind text NOT NULL CHECK (kind IN ('reminder', 'promise', 'note')),
  channel text CHECK (channel IS NULL OR channel IN ('whatsapp', 'email', 'call', 'visit')),
  promised_date date,
  promised_amount numeric(20,2) CHECK (promised_amount IS NULL OR promised_amount > 0),
  amount_due numeric(20,2),
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (kind <> 'promise' OR promised_date IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS sales_collection_notes_party_idx ON tenant.sales_collection_notes (organization_id, party_id, created_at DESC);
ALTER TABLE tenant.sales_collection_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_collection_notes FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'sales_collection_notes' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.sales_collection_notes USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END
$$;
GRANT SELECT, INSERT ON tenant.sales_collection_notes TO vercent_app;
GRANT SELECT ON tenant.sales_collection_notes TO vercent_worker;

-- 5. Debit notes to customers: an undercharge or rate difference billed after a posted invoice. It is Finance's customer debit note
--    (tenant.accounting_customer_invoices, invoice_type 'debit_note', numbered in the GSTIN's debit note series); Sales keeps beside it
--    the invoice it adds to, its order, the reason and the customer and seller as billed, and each line's source invoice line.
CREATE TABLE IF NOT EXISTS tenant.sales_debit_notes (
  customer_invoice_id uuid PRIMARY KEY REFERENCES tenant.accounting_customer_invoices(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  source_invoice_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id),
  sales_order_id uuid REFERENCES tenant.sales_orders(id),
  idempotency_key text,
  reason_code text NOT NULL CHECK (reason_code IN ('rate_difference', 'undercharge', 'tax_correction', 'additional_charge', 'other')),
  reason_note text CHECK (reason_note IS NULL OR char_length(reason_note) <= 1000),
  customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  seller_registration_id uuid,
  seller_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  place_of_supply_name text,
  supply_nature text,
  sent_at timestamptz,
  sent_channel text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_debit_notes_key_idx ON tenant.sales_debit_notes (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_debit_notes_source_idx ON tenant.sales_debit_notes (organization_id, source_invoice_id);
CREATE TABLE IF NOT EXISTS tenant.sales_debit_note_lines (
  customer_invoice_line_id uuid PRIMARY KEY REFERENCES tenant.accounting_customer_invoice_lines(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  customer_invoice_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id),
  source_invoice_line_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoice_lines(id),
  item_name_snapshot text NOT NULL,
  hsn_sac_kind text,
  uom_snapshot text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS sales_debit_note_lines_note_idx ON tenant.sales_debit_note_lines (organization_id, customer_invoice_id);
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['sales_debit_notes', 'sales_debit_note_lines'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', target);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = target AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', target);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON tenant.%I TO vercent_app', target);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', target);
  END LOOP;
END
$$;

-- 6. Beats (routes): the round a salesperson makes on given weekdays; each customer is on at most one, and orders are listed by beat.
CREATE TABLE IF NOT EXISTS tenant.sales_routes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 30),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  salesperson_user_id uuid REFERENCES public.users(id),
  -- ISO weekdays the beat is visited (1 Monday … 7 Sunday).
  visit_days smallint[] NOT NULL DEFAULT '{}'::smallint[] CHECK (visit_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, code)
);
ALTER TABLE tenant.sales_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_routes FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'sales_routes' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.sales_routes USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END
$$;
GRANT SELECT, INSERT, UPDATE ON tenant.sales_routes TO vercent_app;
GRANT SELECT ON tenant.sales_routes TO vercent_worker;
ALTER TABLE tenant.business_parties ADD COLUMN IF NOT EXISTS sales_route_id uuid REFERENCES tenant.sales_routes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS business_parties_sales_route_idx ON tenant.business_parties (organization_id, sales_route_id) WHERE sales_route_id IS NOT NULL;

-- 7. Message templates (Setup › Print & WhatsApp templates): the text a WhatsApp or email message for each document starts from, with
--    {placeholders}. Without one, the built-in wording is used.
CREATE TABLE IF NOT EXISTS tenant.sales_message_templates (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_kind text NOT NULL CHECK (document_kind IN ('quotation', 'order_confirmation', 'invoice', 'credit_note', 'debit_note', 'receipt', 'payment_reminder')),
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, document_kind, channel)
);
ALTER TABLE tenant.sales_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_message_templates FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'sales_message_templates' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.sales_message_templates USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END
$$;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.sales_message_templates TO vercent_app;
GRANT SELECT ON tenant.sales_message_templates TO vercent_worker;
