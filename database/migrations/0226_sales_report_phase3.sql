-- Sales report, Phase 3 (the should-have features).

-- Sales warnings: a message on a customer ("Cash only") or a product ("Discontinued soon") shown when it is chosen on a quotation or an
-- order. A product's warning can also block it from new documents. (A customer is blocked with its own Block action, as before.)
ALTER TABLE tenant.business_parties ADD COLUMN IF NOT EXISTS sales_warning text;
ALTER TABLE tenant.items ADD COLUMN IF NOT EXISTS sales_warning text;
ALTER TABLE tenant.items ADD COLUMN IF NOT EXISTS sales_warning_level text NOT NULL DEFAULT 'none';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_sales_warning_level_check') THEN
    ALTER TABLE tenant.items ADD CONSTRAINT items_sales_warning_level_check CHECK (sales_warning_level IN ('none', 'warn', 'block'));
  END IF;
END $$;

-- Billing by product: a product billed as ordered (a service, a subscription) or as delivered, whatever the company's default. Empty: the
-- company's setting.
ALTER TABLE tenant.items ADD COLUMN IF NOT EXISTS invoice_basis text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_invoice_basis_check') THEN
    ALTER TABLE tenant.items ADD CONSTRAINT items_invoice_basis_check CHECK (invoice_basis IS NULL OR invoice_basis IN ('ordered', 'delivered'));
  END IF;
END $$;

-- Export invoices: the shipping bill and port code on the invoice (entered once known, also after it is final), and the LUT the company
-- exports under without IGST, on its GSTIN. Printed on the invoice and reported in GSTR-1 table 6A.
ALTER TABLE tenant.sales_invoices ADD COLUMN IF NOT EXISTS shipping_bill_number text;
ALTER TABLE tenant.sales_invoices ADD COLUMN IF NOT EXISTS shipping_bill_date date;
ALTER TABLE tenant.sales_invoices ADD COLUMN IF NOT EXISTS port_code text;
ALTER TABLE tenant.tax_registrations ADD COLUMN IF NOT EXISTS lut_number text;
ALTER TABLE tenant.tax_registrations ADD COLUMN IF NOT EXISTS lut_date date;
-- A final invoice's Sales record stays fixed, except its sending, its reversal, a due-date correction and, for an export, the shipping
-- bill and port (known only after the goods are cleared).
CREATE OR REPLACE FUNCTION tenant.sales_invoice_posted_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_status text;
  open_columns text[] := ARRAY['sent_at', 'sent_by', 'sent_to', 'sent_channel', 'reversed_at', 'reversed_by', 'reversal_reason', 'reversal_journal_entry_id',
    'calculated_due_date', 'due_date_overridden', 'due_date_override_reason', 'shipping_bill_number', 'shipping_bill_date', 'port_code', 'updated_at'];
BEGIN
  SELECT status INTO invoice_status FROM tenant.accounting_customer_invoices WHERE id = OLD.customer_invoice_id;
  IF invoice_status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed', 'reversed', 'cancelled') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'A posted invoice cannot be changed; use a credit note or a reversal';
    END IF;
    IF TG_TABLE_NAME = 'sales_invoices' THEN
      IF (to_jsonb(OLD) - open_columns) IS DISTINCT FROM (to_jsonb(NEW) - open_columns) THEN
        RAISE EXCEPTION 'A posted invoice cannot be changed; use a credit note or a reversal';
      END IF;
    ELSE
      RAISE EXCEPTION 'A posted invoice cannot be changed; use a credit note or a reversal';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Customer TDS certificates: the Form 16A each customer that deducted TDS must send for each quarter, matched against the TDS recorded on
-- their payments, so missing certificates can be chased before the TDS credit (Form 26AS) is needed.
CREATE TABLE IF NOT EXISTS tenant.sales_tds_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id uuid NOT NULL,
  financial_year integer NOT NULL CHECK (financial_year BETWEEN 2000 AND 2100),
  quarter integer NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  certificate_number text NOT NULL,
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  received_on date NOT NULL,
  section text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, party_id, certificate_number)
);
CREATE INDEX IF NOT EXISTS sales_tds_certificates_year ON tenant.sales_tds_certificates (organization_id, financial_year, quarter);
ALTER TABLE tenant.sales_tds_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_tds_certificates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.sales_tds_certificates;
CREATE POLICY organization_isolation ON tenant.sales_tds_certificates USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.sales_tds_certificates TO vercent_app;
GRANT SELECT ON tenant.sales_tds_certificates TO vercent_worker;

-- Price list formulas: rules that work out a list's prices — cost plus a percentage, or another list less (or plus) a percentage — for
-- all products, a category or one product, rounded to a whole number or to end in 9 or .99. "Work out prices" writes them as the list's
-- prices (with history), so documents keep reading fixed prices.
CREATE TABLE IF NOT EXISTS tenant.price_list_formulas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  price_list_id uuid NOT NULL,
  sequence integer NOT NULL DEFAULT 10,
  applies_to text NOT NULL CHECK (applies_to IN ('all', 'category', 'product')),
  item_group_id uuid,
  item_id uuid,
  base text NOT NULL CHECK (base IN ('cost', 'list')),
  base_price_list_id uuid,
  percent numeric(9, 3) NOT NULL DEFAULT 0 CHECK (percent BETWEEN -99 AND 1000),
  rounding text NOT NULL DEFAULT 'none' CHECK (rounding IN ('none', 'whole', 'end_9', 'end_99')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (applies_to <> 'category' OR item_group_id IS NOT NULL),
  CHECK (applies_to <> 'product' OR item_id IS NOT NULL),
  CHECK (base <> 'list' OR base_price_list_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS price_list_formulas_list ON tenant.price_list_formulas (organization_id, price_list_id, sequence);
ALTER TABLE tenant.price_list_formulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.price_list_formulas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.price_list_formulas;
CREATE POLICY organization_isolation ON tenant.price_list_formulas USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.price_list_formulas TO vercent_app;
GRANT SELECT ON tenant.price_list_formulas TO vercent_worker;

-- Optional products on a quotation: extras offered beside the lines (priced, not in the total). The customer ticks the ones they want when
-- accepting online; the order made from the quotation includes them.
ALTER TABLE tenant.sales_quotation_versions ADD COLUMN IF NOT EXISTS optional_lines jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tenant.sales_quotations ADD COLUMN IF NOT EXISTS optional_chosen jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Delivery methods with shipping cost rules: a fixed amount, per kg of the goods' gross weight, or a percentage of their value; free
-- above an amount; limited to some states. A quotation or order with a method gets its freight charge worked out from it.
CREATE TABLE IF NOT EXISTS tenant.sales_delivery_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  basis text NOT NULL CHECK (basis IN ('fixed', 'per_kg', 'percent')),
  rate numeric(18, 4) NOT NULL CHECK (rate >= 0),
  minimum_charge numeric(18, 2),
  free_above numeric(18, 2),
  state_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant.sales_delivery_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_delivery_methods FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.sales_delivery_methods;
CREATE POLICY organization_isolation ON tenant.sales_delivery_methods USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.sales_delivery_methods TO vercent_app;
GRANT SELECT ON tenant.sales_delivery_methods TO vercent_worker;
ALTER TABLE tenant.sales_quotation_versions ADD COLUMN IF NOT EXISTS delivery_method_id uuid;
ALTER TABLE tenant.sales_order_versions ADD COLUMN IF NOT EXISTS delivery_method_id uuid;

-- Coupons: a code worth an amount or a percentage off a quotation or order, with a minimum order, dates, a cap and use limits. A use is
-- an order carrying the code that is not cancelled. The coupon on a version is kept with the amount it took off.
CREATE TABLE IF NOT EXISTS tenant.sales_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{3,30}$'),
  description text,
  discount_type text NOT NULL CHECK (discount_type IN ('amount', 'percent')),
  value numeric(18, 2) NOT NULL CHECK (value > 0),
  maximum_discount numeric(18, 2),
  minimum_order numeric(18, 2),
  valid_from date,
  valid_to date,
  uses_total integer CHECK (uses_total IS NULL OR uses_total > 0),
  uses_per_customer integer CHECK (uses_per_customer IS NULL OR uses_per_customer > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
ALTER TABLE tenant.sales_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_coupons FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.sales_coupons;
CREATE POLICY organization_isolation ON tenant.sales_coupons USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.sales_coupons TO vercent_app;
GRANT SELECT ON tenant.sales_coupons TO vercent_worker;
ALTER TABLE tenant.sales_quotation_versions ADD COLUMN IF NOT EXISTS coupon_id uuid, ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS coupon_amount numeric(18, 2) NOT NULL DEFAULT 0;
ALTER TABLE tenant.sales_order_versions ADD COLUMN IF NOT EXISTS coupon_id uuid, ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS coupon_amount numeric(18, 2) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS sales_order_versions_coupon ON tenant.sales_order_versions (organization_id, coupon_id) WHERE coupon_id IS NOT NULL;

-- Recurring orders and invoices: a schedule on an order repeats it every 1, 3, 6 or 12 months on a day of the month; each run makes and
-- confirms a new order and, when the schedule makes invoices, bills, finalises and can email it. One run per schedule and date.
CREATE TABLE IF NOT EXISTS tenant.sales_recurring_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_order_id uuid NOT NULL,
  party_id uuid,
  interval_months integer NOT NULL CHECK (interval_months IN (1, 3, 6, 12)),
  day_of_month integer NOT NULL CHECK (day_of_month BETWEEN 1 AND 28),
  start_date date NOT NULL,
  end_date date,
  next_run_date date NOT NULL,
  makes text NOT NULL DEFAULT 'order' CHECK (makes IN ('order', 'invoice')),
  auto_send boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  runs integer NOT NULL DEFAULT 0,
  last_run_date date,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_recurring_schedules_one_open ON tenant.sales_recurring_schedules (organization_id, source_order_id) WHERE status <> 'ended';
CREATE INDEX IF NOT EXISTS sales_recurring_schedules_due ON tenant.sales_recurring_schedules (organization_id, next_run_date) WHERE status = 'active';
CREATE TABLE IF NOT EXISTS tenant.sales_recurring_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  schedule_id uuid NOT NULL REFERENCES tenant.sales_recurring_schedules(id) ON DELETE CASCADE,
  run_date date NOT NULL,
  sales_order_id uuid,
  invoice_id uuid,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, run_date)
);
ALTER TABLE tenant.sales_recurring_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_recurring_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.sales_recurring_schedules;
CREATE POLICY organization_isolation ON tenant.sales_recurring_schedules USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.sales_recurring_schedules TO vercent_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.sales_recurring_schedules TO vercent_worker;
ALTER TABLE tenant.sales_recurring_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_recurring_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.sales_recurring_runs;
CREATE POLICY organization_isolation ON tenant.sales_recurring_runs USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.sales_recurring_runs TO vercent_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.sales_recurring_runs TO vercent_worker;

-- The daily recurring run (worker) makes and confirms orders and bills, finalises and emails invoices: the tables it writes or locks.
GRANT INSERT, UPDATE ON tenant.sales_order_tax_lines, tenant.sales_order_confirmations, tenant.invoice_number_series, tenant.sales_invoices, tenant.sales_invoice_lines,
  tenant.sales_invoice_line_taxes, tenant.sales_invoice_sends TO vercent_worker;
GRANT UPDATE ON tenant.sales_returns, tenant.project_time_billing_requests TO vercent_worker;

-- Make-to-order: an order line is supplied from stock, bought for the order or made for it. Confirming raises the "buy" and "make" lines
-- through Procurement or Manufacturing; what was raised (or why not) is kept against the order.
ALTER TABLE tenant.sales_order_lines ADD COLUMN IF NOT EXISTS supply_route text NOT NULL DEFAULT 'stock';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_order_lines_supply_route_check') THEN
    ALTER TABLE tenant.sales_order_lines ADD CONSTRAINT sales_order_lines_supply_route_check CHECK (supply_route IN ('stock', 'buy', 'make'));
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS tenant.sales_order_supply (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_order_id uuid NOT NULL,
  line_sequence integer NOT NULL,
  item_id uuid,
  route text NOT NULL CHECK (route IN ('buy', 'make')),
  quantity numeric(20, 6) NOT NULL,
  document_type text CHECK (document_type IN ('purchase_indent', 'purchase_order', 'manufacturing_order')),
  document_id uuid,
  document_number text,
  error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_order_supply_order ON tenant.sales_order_supply (organization_id, sales_order_id);
ALTER TABLE tenant.sales_order_supply ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_order_supply FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.sales_order_supply;
CREATE POLICY organization_isolation ON tenant.sales_order_supply USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.sales_order_supply TO vercent_app;
GRANT SELECT, INSERT ON tenant.sales_order_supply TO vercent_worker;

-- Email replies on documents: every Sales document email in and out, by message id; a company reply-to address for document emails;
-- and the inbound-mail target that files replies on their document.
CREATE TABLE IF NOT EXISTS tenant.sales_document_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('sales.quotation', 'sales.order', 'sales.invoice', 'sales.credit_note')),
  entity_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  message_id text,
  sender text,
  recipients text,
  subject text,
  body text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS sales_document_emails_record ON tenant.sales_document_emails (organization_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_document_emails_message ON tenant.sales_document_emails (organization_id, message_id) WHERE message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_document_emails_inbound_once ON tenant.sales_document_emails (organization_id, message_id) WHERE direction = 'in';
ALTER TABLE tenant.sales_document_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_document_emails FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.sales_document_emails;
CREATE POLICY organization_isolation ON tenant.sales_document_emails USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT ON tenant.sales_document_emails TO vercent_app, vercent_worker;
ALTER TABLE tenant.sales_settings ADD COLUMN IF NOT EXISTS document_reply_to text;
ALTER TABLE public.inbound_mail_routes DROP CONSTRAINT IF EXISTS inbound_mail_routes_target_check;
ALTER TABLE public.inbound_mail_routes ADD CONSTRAINT inbound_mail_routes_target_check CHECK (target IN ('support.email_to_ticket', 'crm.email_to_lead', 'sales.email_replies'));

-- Pay online on the invoice link: the company's own Razorpay account (keys encrypted), and each payment started on a link — recorded
-- once as a receipt when its checkout signature or Razorpay's webhook confirms it.
CREATE TABLE IF NOT EXISTS tenant.sales_payment_gateways (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'razorpay' CHECK (provider IN ('razorpay')),
  key_id text NOT NULL,
  encrypted_secrets jsonb NOT NULL,
  bank_account_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant.sales_gateway_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL,
  party_id uuid NOT NULL,
  gateway_order_id text NOT NULL,
  gateway_payment_id text,
  amount numeric(18, 2) NOT NULL,
  currency_code text NOT NULL,
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'recorded')),
  receipt_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz,
  UNIQUE (organization_id, gateway_order_id)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['sales_payment_gateways', 'sales_gateway_payments'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS organization_isolation ON tenant.%I', t);
    EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON tenant.%I TO vercent_app', t);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', t);
  END LOOP;
END $$;

-- The customer portal: one address per company (its key kept hashed for lookup and encrypted to show again), sign-in codes sent by
-- email, and 7-day sessions. The address resolves its company before any tenant is set, through a definer function that returns only
-- the company of an active portal.
CREATE TABLE IF NOT EXISTS tenant.sales_customer_portals (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  key_encrypted jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant.sales_portal_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  party_ids uuid[] NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS sales_portal_codes_email ON tenant.sales_portal_codes (organization_id, email, created_at DESC);
CREATE TABLE IF NOT EXISTS tenant.sales_portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  party_ids uuid[] NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['sales_customer_portals', 'sales_portal_codes', 'sales_portal_sessions'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS organization_isolation ON tenant.%I', t);
    EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', t);
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION tenant.sales_resolve_customer_portal(key_hash_in text)
RETURNS TABLE(organization_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'tenant', 'public', 'pg_temp'
AS $$
  SELECT portal.organization_id FROM tenant.sales_customer_portals portal WHERE portal.key_hash = key_hash_in AND portal.status = 'active' LIMIT 1
$$;
REVOKE ALL ON FUNCTION tenant.sales_resolve_customer_portal(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant.sales_resolve_customer_portal(text) TO vercent_app;

-- Field sales on the phone: a collection taken on the beat, kept once per key from the phone (an offline sync may send it twice).
CREATE TABLE IF NOT EXISTS tenant.sales_field_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  party_id uuid,
  collected_by uuid,
  collected_on date NOT NULL,
  method text,
  amount numeric(18, 2),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS sales_field_collections_day ON tenant.sales_field_collections (organization_id, collected_by, collected_on);
ALTER TABLE tenant.sales_field_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_field_collections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.sales_field_collections;
CREATE POLICY organization_isolation ON tenant.sales_field_collections USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE ON tenant.sales_field_collections TO vercent_app;
GRANT SELECT ON tenant.sales_field_collections TO vercent_worker;
