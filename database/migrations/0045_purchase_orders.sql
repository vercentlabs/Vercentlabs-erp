-- Purchase Orders, rebuilt as structured documents.
--
-- A purchase order is one supplier, one currency, one buying company. It is
-- Draft, Confirmed, Closed or Cancelled; what was received, billed, cancelled
-- and returned is never a status of its own but worked out from the goods
-- receipts, supplier bills (Accounts Payable), line cancellations and
-- purchase returns that exist. Each confirmation keeps a full snapshot as a
-- numbered version; an amendment is reconfirmed as the next version.
--
-- Goods receipts post the stock (into a quality location when held for
-- inspection); supplier bills are Accounts Payable bills whose lines point at
-- the order lines and receipt lines they bill; purchase returns issue stock
-- back to the supplier without rewriting the receipt.
--
-- The generic JSON documents used before (procurement_purchase_orders,
-- procurement_purchase_order_lines, procurement_purchase_order_schedules,
-- procurement_receipts, procurement_receipt_lines, procurement_match_exceptions,
-- procurement_matching_records, procurement_invoice_matches) are no longer
-- read or written. They cannot be dropped and stay empty.

-- ------------------------------------------------------------------ settings
CREATE TABLE IF NOT EXISTS tenant.procurement_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- receipt: goods are billed only once received (services by order); order: everything may be billed as ordered.
  billing_basis text NOT NULL DEFAULT 'receipt' CHECK (billing_basis IN ('receipt', 'order')),
  require_expected_date boolean NOT NULL DEFAULT false,
  default_warehouse_id uuid REFERENCES tenant.warehouses(id),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant.procurement_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.procurement_settings
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE ON tenant.procurement_settings TO vercent_app;
GRANT SELECT ON tenant.procurement_settings TO vercent_worker;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_suppliers_organization_id_id_key') THEN
    ALTER TABLE tenant.procurement_suppliers ADD CONSTRAINT procurement_suppliers_organization_id_id_key UNIQUE (organization_id, id);
  END IF;
END $$;

-- -------------------------------------------------------- supplier quotations
-- What a supplier offered: recorded, then converted into a purchase order that keeps its prices.
CREATE TABLE IF NOT EXISTS tenant.supplier_quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quotation_number text NOT NULL,
  supplier_id uuid NOT NULL,
  supplier_reference text,
  rfq_reference text,
  quotation_date date NOT NULL DEFAULT current_date,
  valid_until date,
  currency_code char(3) NOT NULL,
  payment_term_id uuid REFERENCES tenant.payment_terms(id),
  price_mode text NOT NULL DEFAULT 'exclusive' CHECK (price_mode IN ('exclusive', 'inclusive')),
  document_discount_type text CHECK (document_discount_type IN ('percent', 'amount')),
  document_discount_value numeric(20,6) NOT NULL DEFAULT 0 CHECK (document_discount_value >= 0),
  delivery_lead_days integer CHECK (delivery_lead_days >= 0),
  notes text,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'converted', 'cancelled')),
  converted_purchase_order_id uuid,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, quotation_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES tenant.procurement_suppliers(organization_id, id)
);
CREATE INDEX IF NOT EXISTS supplier_quotations_supplier_idx ON tenant.supplier_quotations (organization_id, supplier_id, status);

CREATE TABLE IF NOT EXISTS tenant.supplier_quotation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_quotation_id uuid NOT NULL,
  line_number integer NOT NULL,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  description text,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  uom_id uuid REFERENCES tenant.units_of_measure(id),
  unit_price numeric(20,6) NOT NULL CHECK (unit_price >= 0),
  discount_type text CHECK (discount_type IN ('percent', 'amount')),
  discount_value numeric(20,6) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  tax_category_id uuid REFERENCES tenant.tax_categories(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, supplier_quotation_id, line_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, supplier_quotation_id) REFERENCES tenant.supplier_quotations(organization_id, id) ON DELETE CASCADE
);

-- ----------------------------------------------------------- purchase orders
CREATE TABLE IF NOT EXISTS tenant.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_order_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'closed', 'cancelled')),
  communication_status text NOT NULL DEFAULT 'not_sent' CHECK (communication_status IN ('not_sent', 'sent', 'acknowledged')),
  supplier_id uuid NOT NULL,
  party_id uuid NOT NULL,
  -- The company registration (GSTIN, state) the order is placed from.
  buying_registration_id uuid REFERENCES tenant.tax_registrations(id),
  supplier_contact_id uuid,
  supplier_address_id uuid,
  supplier_billing_address_id uuid,
  supplier_ship_from_id uuid,
  supplier_tax_registration_id uuid,
  -- Snapshots: what the order was placed with; a later change to a master never rewrites them.
  supplier_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_snapshot jsonb,
  ordering_address_snapshot jsonb,
  billing_address_snapshot jsonb,
  ship_from_snapshot jsonb,
  supplier_tax_snapshot jsonb,
  buyer_registration_snapshot jsonb,
  bill_to_snapshot jsonb,
  ship_to_snapshot jsonb,
  payment_term_snapshot jsonb,
  order_date date NOT NULL DEFAULT current_date,
  expected_delivery_date date,
  source_quotation_id uuid,
  supplier_quotation_reference text,
  supplier_reference text,
  currency_code char(3) NOT NULL,
  payment_term_id uuid REFERENCES tenant.payment_terms(id),
  buyer_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  default_warehouse_id uuid REFERENCES tenant.warehouses(id),
  price_mode text NOT NULL DEFAULT 'exclusive' CHECK (price_mode IN ('exclusive', 'inclusive')),
  document_discount_type text CHECK (document_discount_type IN ('percent', 'amount')),
  document_discount_value numeric(20,6) NOT NULL DEFAULT 0 CHECK (document_discount_value >= 0),
  document_discount_amount numeric(20,6) NOT NULL DEFAULT 0,
  gross_total numeric(20,6) NOT NULL DEFAULT 0,
  line_discount_total numeric(20,6) NOT NULL DEFAULT 0,
  taxable_total numeric(20,6) NOT NULL DEFAULT 0,
  tax_total numeric(20,6) NOT NULL DEFAULT 0,
  grand_total numeric(20,6) NOT NULL DEFAULT 0,
  supplier_notes text,
  internal_notes text,
  -- revision: every save (optimistic locking); version_number: the confirmed version (0 until first confirmed).
  revision integer NOT NULL DEFAULT 1,
  version_number integer NOT NULL DEFAULT 0,
  amendment_reason text,
  confirmed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason_code text,
  cancel_reason text,
  closed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  close_reason text,
  last_sent_at timestamptz,
  last_sent_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  last_sent_to text,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  acknowledgement_reference text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, purchase_order_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES tenant.procurement_suppliers(organization_id, id),
  FOREIGN KEY (organization_id, party_id) REFERENCES tenant.business_parties(organization_id, id),
  FOREIGN KEY (organization_id, supplier_contact_id) REFERENCES tenant.procurement_supplier_contacts(organization_id, id),
  FOREIGN KEY (organization_id, supplier_address_id) REFERENCES tenant.procurement_supplier_addresses(organization_id, id),
  FOREIGN KEY (organization_id, supplier_billing_address_id) REFERENCES tenant.procurement_supplier_addresses(organization_id, id),
  FOREIGN KEY (organization_id, supplier_ship_from_id) REFERENCES tenant.procurement_supplier_addresses(organization_id, id),
  FOREIGN KEY (organization_id, supplier_tax_registration_id) REFERENCES tenant.procurement_supplier_tax_registrations(organization_id, id),
  FOREIGN KEY (organization_id, source_quotation_id) REFERENCES tenant.supplier_quotations(organization_id, id),
  CHECK (expected_delivery_date IS NULL OR expected_delivery_date >= order_date),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS purchase_orders_supplier_idx ON tenant.purchase_orders (organization_id, supplier_id, status);
CREATE INDEX IF NOT EXISTS purchase_orders_status_idx ON tenant.purchase_orders (organization_id, status, order_date DESC);
CREATE INDEX IF NOT EXISTS purchase_orders_buyer_idx ON tenant.purchase_orders (organization_id, buyer_user_id);
-- A quotation converts once (unless that order is cancelled).
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_source_quotation_key ON tenant.purchase_orders (organization_id, source_quotation_id)
  WHERE source_quotation_id IS NOT NULL AND status <> 'cancelled';
ALTER TABLE tenant.supplier_quotations ADD CONSTRAINT supplier_quotations_converted_po_fk
  FOREIGN KEY (organization_id, converted_purchase_order_id) REFERENCES tenant.purchase_orders(organization_id, id);

CREATE TABLE IF NOT EXISTS tenant.purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL,
  line_number integer NOT NULL,
  -- stock: inventory-tracked goods; non_stock: goods received but not stocked; service: never received into stock.
  product_type text NOT NULL CHECK (product_type IN ('stock', 'non_stock', 'service')),
  -- Null only for an authorised one-off descriptive line.
  product_id uuid REFERENCES tenant.items(id),
  product_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text NOT NULL,
  hsn_sac_code text,
  ordered_quantity numeric(20,6) NOT NULL CHECK (ordered_quantity > 0),
  purchase_uom_id uuid NOT NULL REFERENCES tenant.units_of_measure(id),
  uom_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  conversion_factor numeric(20,9) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  base_uom_id uuid REFERENCES tenant.units_of_measure(id),
  base_quantity numeric(20,6) NOT NULL CHECK (base_quantity > 0),
  unit_price numeric(20,6) NOT NULL CHECK (unit_price >= 0),
  price_source text NOT NULL DEFAULT 'manual' CHECK (price_source IN ('manual', 'product_cost', 'quotation')),
  zero_price_reason text,
  discount_type text CHECK (discount_type IN ('percent', 'amount')),
  discount_value numeric(20,6) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  gross_amount numeric(20,6) NOT NULL DEFAULT 0,
  line_discount numeric(20,6) NOT NULL DEFAULT 0,
  allocated_document_discount numeric(20,6) NOT NULL DEFAULT 0,
  taxable_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (taxable_amount >= 0),
  tax_category_id uuid REFERENCES tenant.tax_categories(id),
  tax_treatment text NOT NULL DEFAULT 'taxable',
  tax_rate numeric(9,4) NOT NULL DEFAULT 0,
  tax_total numeric(20,6) NOT NULL DEFAULT 0,
  line_total numeric(20,6) NOT NULL DEFAULT 0,
  receiving_warehouse_id uuid REFERENCES tenant.warehouses(id),
  expected_delivery_date date,
  source_quotation_line_id uuid,
  -- Where a descriptive line is booked when billed.
  expense_account_id uuid REFERENCES tenant.accounting_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, purchase_order_id, line_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, purchase_order_id) REFERENCES tenant.purchase_orders(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, source_quotation_line_id) REFERENCES tenant.supplier_quotation_lines(organization_id, id),
  CHECK (product_id IS NOT NULL OR product_type <> 'stock'),
  CHECK (unit_price > 0 OR zero_price_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS purchase_order_lines_order_idx ON tenant.purchase_order_lines (organization_id, purchase_order_id);
CREATE INDEX IF NOT EXISTS purchase_order_lines_product_idx ON tenant.purchase_order_lines (organization_id, product_id);

CREATE TABLE IF NOT EXISTS tenant.purchase_order_line_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL,
  purchase_order_line_id uuid NOT NULL,
  sequence integer NOT NULL,
  tax_type text NOT NULL,
  label text NOT NULL,
  rate numeric(9,4) NOT NULL,
  taxable_amount numeric(20,6) NOT NULL,
  tax_amount numeric(20,6) NOT NULL,
  FOREIGN KEY (organization_id, purchase_order_id) REFERENCES tenant.purchase_orders(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, purchase_order_line_id) REFERENCES tenant.purchase_order_lines(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS purchase_order_line_taxes_order_idx ON tenant.purchase_order_line_taxes (organization_id, purchase_order_id);

-- Each confirmation: the exact commercial document authorised, kept for good.
CREATE TABLE IF NOT EXISTS tenant.purchase_order_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  amendment_reason text,
  snapshot jsonb NOT NULL,
  content_hash text NOT NULL,
  grand_total numeric(20,6) NOT NULL,
  confirmed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  UNIQUE (organization_id, purchase_order_id, version_number),
  FOREIGN KEY (organization_id, purchase_order_id) REFERENCES tenant.purchase_orders(organization_id, id)
);

-- Outstanding quantity no longer wanted. The ordered quantity is never changed.
CREATE TABLE IF NOT EXISTS tenant.purchase_order_line_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL,
  purchase_order_line_id uuid NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  reason_code text NOT NULL,
  reason text,
  cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, purchase_order_id) REFERENCES tenant.purchase_orders(organization_id, id),
  FOREIGN KEY (organization_id, purchase_order_line_id) REFERENCES tenant.purchase_order_lines(organization_id, id)
);
CREATE INDEX IF NOT EXISTS purchase_order_line_cancellations_line_idx ON tenant.purchase_order_line_cancellations (organization_id, purchase_order_line_id);

-- Sending the order to the supplier and the supplier's acknowledgement.
CREATE TABLE IF NOT EXISTS tenant.purchase_order_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL,
  version_number integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sent', 'acknowledged')),
  channel text NOT NULL,
  recipients text,
  subject text,
  note text,
  message_id text,
  pdf_file_id uuid,
  idempotency_key text,
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, purchase_order_id) REFERENCES tenant.purchase_orders(organization_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_communications_key ON tenant.purchase_order_communications (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.purchase_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, purchase_order_id) REFERENCES tenant.purchase_orders(organization_id, id)
);
CREATE INDEX IF NOT EXISTS purchase_order_events_order_idx ON tenant.purchase_order_events (organization_id, purchase_order_id, occurred_at DESC);

-- -------------------------------------------------------------- goods receipts
CREATE TABLE IF NOT EXISTS tenant.goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receipt_number text NOT NULL,
  purchase_order_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled')),
  receipt_date date NOT NULL DEFAULT current_date,
  supplier_delivery_note text,
  ship_from_snapshot jsonb,
  notes text,
  posted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  posted_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, receipt_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, purchase_order_id) REFERENCES tenant.purchase_orders(organization_id, id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES tenant.procurement_suppliers(organization_id, id),
  CHECK ((status = 'posted') = (posted_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS goods_receipts_order_idx ON tenant.goods_receipts (organization_id, purchase_order_id, status);

CREATE TABLE IF NOT EXISTS tenant.goods_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  goods_receipt_id uuid NOT NULL,
  purchase_order_id uuid NOT NULL,
  purchase_order_line_id uuid NOT NULL,
  line_number integer NOT NULL,
  product_id uuid REFERENCES tenant.items(id),
  product_type text NOT NULL,
  description text NOT NULL,
  warehouse_id uuid REFERENCES tenant.warehouses(id),
  warehouse_location_id uuid REFERENCES tenant.warehouse_locations(id),
  -- accepted: into stock; held: into the warehouse's quality location, not usable; rejected: not taken in.
  accepted_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0),
  held_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (held_quantity >= 0),
  rejected_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  rejection_reason text,
  conversion_factor numeric(20,9) NOT NULL DEFAULT 1,
  uom_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  batch_number text,
  batch_id uuid REFERENCES tenant.stock_batches(id),
  serial_numbers text[] NOT NULL DEFAULT '{}',
  hold_location_id uuid REFERENCES tenant.warehouse_locations(id),
  stock_movement_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, goods_receipt_id, line_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, goods_receipt_id) REFERENCES tenant.goods_receipts(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, purchase_order_line_id) REFERENCES tenant.purchase_order_lines(organization_id, id),
  CHECK (accepted_quantity + held_quantity + rejected_quantity > 0)
);
CREATE INDEX IF NOT EXISTS goods_receipt_lines_po_line_idx ON tenant.goods_receipt_lines (organization_id, purchase_order_line_id);

-- ------------------------------------------------------------ purchase returns
CREATE TABLE IF NOT EXISTS tenant.purchase_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  return_number text NOT NULL,
  purchase_order_id uuid NOT NULL,
  goods_receipt_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  return_date date NOT NULL DEFAULT current_date,
  reason text NOT NULL,
  -- true: the supplier is to send a replacement, so the quantity is open for receipt again.
  replacement_expected boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, return_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, purchase_order_id) REFERENCES tenant.purchase_orders(organization_id, id),
  FOREIGN KEY (organization_id, goods_receipt_id) REFERENCES tenant.goods_receipts(organization_id, id)
);
CREATE INDEX IF NOT EXISTS purchase_returns_order_idx ON tenant.purchase_returns (organization_id, purchase_order_id);

CREATE TABLE IF NOT EXISTS tenant.purchase_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_return_id uuid NOT NULL,
  goods_receipt_line_id uuid NOT NULL,
  purchase_order_line_id uuid NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  from_hold boolean NOT NULL DEFAULT false,
  serial_numbers text[] NOT NULL DEFAULT '{}',
  stock_movement_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, purchase_return_id) REFERENCES tenant.purchase_returns(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, goods_receipt_line_id) REFERENCES tenant.goods_receipt_lines(organization_id, id),
  FOREIGN KEY (organization_id, purchase_order_line_id) REFERENCES tenant.purchase_order_lines(organization_id, id)
);
CREATE INDEX IF NOT EXISTS purchase_return_lines_po_line_idx ON tenant.purchase_return_lines (organization_id, purchase_order_line_id);

-- ------------------------------------------------- supplier bills (Accounts Payable)
-- A bill line names the order line (and receipt line) it bills; the bill names the order.
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS purchase_order_line_id uuid;
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS goods_receipt_line_id uuid;
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS ordered_unit_price numeric(20,6);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_vendor_bill_lines_po_line_fk') THEN
    ALTER TABLE tenant.accounting_vendor_bill_lines ADD CONSTRAINT accounting_vendor_bill_lines_po_line_fk
      FOREIGN KEY (organization_id, purchase_order_line_id) REFERENCES tenant.purchase_order_lines(organization_id, id);
    ALTER TABLE tenant.accounting_vendor_bill_lines ADD CONSTRAINT accounting_vendor_bill_lines_receipt_line_fk
      FOREIGN KEY (organization_id, goods_receipt_line_id) REFERENCES tenant.goods_receipt_lines(organization_id, id);
    ALTER TABLE tenant.accounting_vendor_bills ADD CONSTRAINT accounting_vendor_bills_purchase_order_fk
      FOREIGN KEY (organization_id, source_purchase_order_id) REFERENCES tenant.purchase_orders(organization_id, id) NOT VALID;
  END IF;
END $$;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS match_override_reason text;
CREATE INDEX IF NOT EXISTS accounting_vendor_bill_lines_po_line_idx ON tenant.accounting_vendor_bill_lines (organization_id, purchase_order_line_id) WHERE purchase_order_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS accounting_vendor_bills_po_idx ON tenant.accounting_vendor_bills (organization_id, source_purchase_order_id) WHERE source_purchase_order_id IS NOT NULL;
-- The same supplier invoice is never billed twice, whatever its letter case.
CREATE UNIQUE INDEX IF NOT EXISTS accounting_vendor_bills_supplier_invoice_ci_key ON tenant.accounting_vendor_bills (organization_id, party_id, lower(supplier_invoice_number))
  WHERE supplier_invoice_number IS NOT NULL AND bill_type = 'bill' AND status NOT IN ('cancelled', 'reversed');

-- ------------------------------------------------------- isolation and grants
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_quotations', 'supplier_quotation_lines', 'purchase_orders', 'purchase_order_lines', 'purchase_order_line_taxes',
    'purchase_order_confirmations', 'purchase_order_line_cancellations', 'purchase_order_communications', 'purchase_order_events', 'goods_receipts',
    'goods_receipt_lines', 'purchase_returns', 'purchase_return_lines'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', t);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------------ progress
-- What each order line has been through, from the documents alone: nothing
-- here is stored, so it can never drift from the receipts, bills, returns
-- and cancellations it is read from. Quantities are in the line's purchase unit.
CREATE OR REPLACE VIEW tenant.purchase_order_line_progress WITH (security_invoker = true) AS
SELECT line.organization_id, line.purchase_order_id, line.id AS purchase_order_line_id, line.line_number, line.product_type, line.ordered_quantity,
       line.expected_delivery_date,
       COALESCE(received.accepted, 0) AS accepted_quantity, COALESCE(received.held, 0) AS held_quantity, COALESCE(received.rejected, 0) AS rejected_quantity,
       COALESCE(received.draft, 0) AS draft_receipt_quantity,
       COALESCE(returned.quantity, 0) AS returned_quantity, COALESCE(returned.replacement, 0) AS returned_for_replacement_quantity,
       COALESCE(cancelled.quantity, 0) AS cancelled_quantity,
       COALESCE(billed.quantity, 0) AS billed_quantity, COALESCE(billed.posted, 0) AS posted_billed_quantity, COALESCE(billed.unposted, 0) AS unposted_billed_quantity,
       COALESCE(settings.billing_basis, 'receipt') AS billing_basis
  FROM tenant.purchase_order_lines line
  LEFT JOIN tenant.procurement_settings settings ON settings.organization_id = line.organization_id
  LEFT JOIN LATERAL (
    SELECT sum(receipt_line.accepted_quantity) FILTER (WHERE receipt.status = 'posted') AS accepted,
           sum(receipt_line.held_quantity) FILTER (WHERE receipt.status = 'posted') AS held,
           sum(receipt_line.rejected_quantity) FILTER (WHERE receipt.status = 'posted') AS rejected,
           sum(receipt_line.accepted_quantity + receipt_line.held_quantity) FILTER (WHERE receipt.status = 'draft') AS draft
      FROM tenant.goods_receipt_lines receipt_line
      JOIN tenant.goods_receipts receipt ON receipt.organization_id = receipt_line.organization_id AND receipt.id = receipt_line.goods_receipt_id
     WHERE receipt_line.organization_id = line.organization_id AND receipt_line.purchase_order_line_id = line.id) received ON true
  LEFT JOIN LATERAL (
    SELECT sum(return_line.quantity) AS quantity, sum(return_line.quantity) FILTER (WHERE purchase_return.replacement_expected) AS replacement
      FROM tenant.purchase_return_lines return_line
      JOIN tenant.purchase_returns purchase_return ON purchase_return.organization_id = return_line.organization_id AND purchase_return.id = return_line.purchase_return_id
     WHERE return_line.organization_id = line.organization_id AND return_line.purchase_order_line_id = line.id) returned ON true
  LEFT JOIN LATERAL (
    SELECT sum(cancellation.quantity) AS quantity FROM tenant.purchase_order_line_cancellations cancellation
     WHERE cancellation.organization_id = line.organization_id AND cancellation.purchase_order_line_id = line.id) cancelled ON true
  LEFT JOIN LATERAL (
    SELECT sum(CASE WHEN bill.bill_type = 'credit_note' THEN -bill_line.quantity ELSE bill_line.quantity END) AS quantity,
           sum(CASE WHEN bill.bill_type = 'credit_note' THEN -bill_line.quantity ELSE bill_line.quantity END)
             FILTER (WHERE bill.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')) AS posted,
           sum(CASE WHEN bill.bill_type = 'credit_note' THEN -bill_line.quantity ELSE bill_line.quantity END)
             FILTER (WHERE bill.status IN ('draft', 'pending_approval', 'approved')) AS unposted
      FROM tenant.accounting_vendor_bill_lines bill_line
      JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = bill_line.organization_id AND bill.id = bill_line.vendor_bill_id
     WHERE bill_line.organization_id = line.organization_id AND bill_line.purchase_order_line_id = line.id
       AND bill.bill_type IN ('bill', 'credit_note') AND bill.status NOT IN ('cancelled', 'reversed')) billed ON true;

-- received: valid quantity taken in (accepted + held). remaining_to_receive: still owed by the supplier;
-- a return reopens it only when a replacement is expected. billable: what may be billed now under the
-- company's basis; bill_target: what the line is finally billed for once nothing more is to come.
CREATE OR REPLACE VIEW tenant.purchase_order_line_status WITH (security_invoker = true) AS
SELECT progress.*,
       progress.product_type <> 'service' AS receipt_required,
       progress.accepted_quantity + progress.held_quantity AS received_quantity,
       CASE WHEN progress.product_type = 'service' THEN 0
            ELSE GREATEST(progress.ordered_quantity - progress.cancelled_quantity - progress.accepted_quantity - progress.held_quantity
                          + progress.returned_for_replacement_quantity, 0) END AS remaining_to_receive,
       CASE WHEN progress.product_type = 'service' OR progress.billing_basis = 'order'
              THEN progress.ordered_quantity - progress.cancelled_quantity - (progress.returned_quantity - progress.returned_for_replacement_quantity)
            ELSE progress.accepted_quantity + progress.held_quantity - progress.returned_quantity END AS billable_quantity,
       progress.ordered_quantity - progress.cancelled_quantity - (progress.returned_quantity - progress.returned_for_replacement_quantity) AS bill_target_quantity
  FROM tenant.purchase_order_line_progress progress;
GRANT SELECT ON tenant.purchase_order_line_progress, tenant.purchase_order_line_status TO vercent_app, vercent_worker;

-- ---------------------------------------------------------------- permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('procurement.po.view', 'View purchase orders', 'Procurement', 'See the purchase orders you buy for or created.'),
  ('procurement.po.view_all', 'View all purchase orders', 'Procurement', 'See every purchase order, not only your own.'),
  ('procurement.po.confirm', 'Confirm purchase orders', 'Procurement', 'Commit the company to a purchase: confirm a draft or an amended order.'),
  ('procurement.po.close', 'Close purchase orders', 'Procurement', 'Close an order once nothing is left to receive or bill.'),
  ('procurement.po.send', 'Send purchase orders', 'Procurement', 'Email the order to the supplier, mark it sent, record the supplier''s acknowledgement.'),
  ('procurement.po.override_price', 'Override purchase prices', 'Procurement', 'Order at no charge, or change the price of a line taken from a supplier quotation.'),
  ('procurement.po.change_warehouse', 'Change receiving warehouse', 'Procurement', 'Change where a confirmed order''s goods are received.'),
  ('procurement.po.update_dates', 'Update expected dates', 'Procurement', 'Move the expected delivery dates of a confirmed order.'),
  ('procurement.po.descriptive_lines', 'Order items outside the catalogue', 'Procurement', 'Add a one-off service or expense line that is not a product, with its unit, price, tax and expense account.'),
  ('procurement.quotations.manage', 'Record supplier quotations', 'Procurement', 'Record what a supplier offered, ready to become a purchase order.')
ON CONFLICT (key) DO NOTHING;
-- Whoever saw procurement sees purchase orders, as before; Accounts Payable sees them to bill them.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['procurement.po.view', 'procurement.po.view_all'])
 WHERE existing.permission_key IN ('procurement.view', 'accounting.payables.manage')
ON CONFLICT DO NOTHING;
-- Whoever approved purchase orders now confirms and closes them and may override prices.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['procurement.po.confirm', 'procurement.po.close', 'procurement.po.override_price', 'procurement.po.send'])
 WHERE existing.permission_key = 'procurement.po.approve'
ON CONFLICT DO NOTHING;
-- Whoever dispatched orders sends them.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'procurement.po.send' FROM public.role_permissions existing WHERE existing.permission_key = 'procurement.po.dispatch'
ON CONFLICT DO NOTHING;
-- Whoever managed orders keeps their dates and warehouses up to date.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['procurement.po.change_warehouse', 'procurement.po.update_dates', 'procurement.po.descriptive_lines'])
 WHERE existing.permission_key = 'procurement.po.manage'
ON CONFLICT DO NOTHING;
-- Whoever ran sourcing records supplier quotations.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'procurement.quotations.manage' FROM public.role_permissions existing WHERE existing.permission_key = 'procurement.sourcing.manage'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0045_purchase_orders.sql', 'purchase-orders');
