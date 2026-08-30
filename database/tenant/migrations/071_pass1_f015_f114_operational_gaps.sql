BEGIN;

-- Pass 1/5 closes operational schema gaps for canonical features F015-F114.
-- Existing mature tables remain authoritative; this migration only adds
-- capabilities that were absent from the frozen baseline.

-- F015 — immutable Task lifecycle history over the canonical crm_activities row.
CREATE TABLE IF NOT EXISTS tenant.crm_task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES tenant.crm_activities(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created','updated','started','completed','cancelled')),
  from_status text,
  to_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_task_events_activity_idx
  ON tenant.crm_task_events(organization_id,activity_id,occurred_at DESC,id DESC);
CREATE OR REPLACE FUNCTION tenant.crm_task_events_immutable_f015()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRM Task event history is immutable';
END;
$$;
DROP TRIGGER IF EXISTS crm_task_events_immutable_f015 ON tenant.crm_task_events;
CREATE TRIGGER crm_task_events_immutable_f015
BEFORE UPDATE OR DELETE ON tenant.crm_task_events
FOR EACH ROW EXECUTE FUNCTION tenant.crm_task_events_immutable_f015();

-- F102 — UOM conversions need lifecycle state so they can use governed master-data CRUD.
ALTER TABLE tenant.item_uom_conversions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','inactive'));

-- F100 — Item variants.
CREATE TABLE IF NOT EXISTS tenant.item_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES tenant.items(id) ON DELETE CASCADE,
  sku text NOT NULL,
  name text NOT NULL,
  barcode text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  sales_price numeric(24,6),
  purchase_price numeric(24,6),
  standard_cost numeric(24,6),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sku),
  UNIQUE (organization_id, item_id, name)
);
CREATE INDEX IF NOT EXISTS item_variants_item_idx
  ON tenant.item_variants(organization_id,item_id,status);
CREATE UNIQUE INDEX IF NOT EXISTS item_variants_barcode_idx
  ON tenant.item_variants(organization_id,barcode)
  WHERE barcode IS NOT NULL AND barcode <> '';

-- F112-F114 — durable, idempotent reservations and queryable availability.
ALTER TABLE tenant.stock_reservations
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS stock_reservations_idempotency_idx
  ON tenant.stock_reservations(organization_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_reservations_reference_idx
  ON tenant.stock_reservations(organization_id,company_id,reference_type,reference_id,status);

-- F110 — transfer requests are replay-safe before they post the paired ledger movements.
ALTER TABLE tenant.stock_transfers
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS stock_transfers_idempotency_idx
  ON tenant.stock_transfers(organization_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- F052 — Advance payments.
CREATE TABLE IF NOT EXISTS tenant.sales_advance_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id) ON DELETE RESTRICT,
  amount numeric(24,6) NOT NULL CHECK (amount > 0),
  currency_code char(3) NOT NULL,
  payment_reference text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','applied','refunded','cancelled')),
  note text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,payment_reference)
);
CREATE INDEX IF NOT EXISTS sales_advance_payments_order_idx
  ON tenant.sales_advance_payments(organization_id,sales_order_id,status,received_at DESC);

-- F055 — Credit-note/refund handoff requests. Accounting remains the financial system of record.
CREATE TABLE IF NOT EXISTS tenant.sales_credit_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id) ON DELETE RESTRICT,
  return_request_id uuid REFERENCES tenant.sales_return_requests(id) ON DELETE SET NULL,
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('credit_note','refund')),
  amount numeric(24,6) NOT NULL CHECK (amount > 0),
  currency_code char(3) NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','completed','rejected','cancelled')),
  external_reference text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_credit_adjustments_order_idx
  ON tenant.sales_credit_adjustment_requests(organization_id,sales_order_id,status,created_at DESC);

-- F056 — Drop shipping.
CREATE TABLE IF NOT EXISTS tenant.sales_drop_ship_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id) ON DELETE RESTRICT,
  sales_order_line_id uuid NOT NULL REFERENCES tenant.sales_order_lines(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL,
  quantity numeric(24,10) NOT NULL CHECK (quantity > 0),
  ship_to_address_id uuid REFERENCES tenant.addresses(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','ordered','acknowledged','shipped','delivered','cancelled')),
  procurement_reference text,
  idempotency_key text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS sales_drop_ship_order_idx
  ON tenant.sales_drop_ship_requests(organization_id,sales_order_id,status,created_at DESC);

-- F057 — Sales commissions.
CREATE TABLE IF NOT EXISTS tenant.sales_commission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  rate_percent numeric(9,4) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  basis text NOT NULL DEFAULT 'net_sales' CHECK (basis IN ('net_sales','gross_margin')),
  valid_from date,
  valid_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);
CREATE TABLE IF NOT EXISTS tenant.sales_commission_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id) ON DELETE RESTRICT,
  rule_id uuid REFERENCES tenant.sales_commission_rules(id) ON DELETE SET NULL,
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  basis_amount numeric(24,6) NOT NULL,
  rate_percent numeric(9,4) NOT NULL,
  commission_amount numeric(24,6) NOT NULL,
  status text NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued','approved','paid','reversed')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,sales_order_id,owner_user_id,rule_id)
);
CREATE INDEX IF NOT EXISTS sales_commission_entries_owner_idx
  ON tenant.sales_commission_entries(organization_id,owner_user_id,status,created_at DESC);

-- F079 — supplier-specific purchase price catalogue.
CREATE TABLE IF NOT EXISTS tenant.procurement_supplier_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES tenant.procurement_suppliers(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES tenant.items(id) ON DELETE CASCADE,
  uom_id uuid REFERENCES tenant.units_of_measure(id) ON DELETE SET NULL,
  minimum_quantity numeric(24,10) NOT NULL DEFAULT 1 CHECK (minimum_quantity > 0),
  rate numeric(24,6) NOT NULL CHECK (rate >= 0),
  currency_code char(3) NOT NULL,
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from <= valid_to),
  UNIQUE (organization_id,supplier_id,item_id,uom_id,minimum_quantity,valid_from)
);
CREATE INDEX IF NOT EXISTS procurement_supplier_prices_lookup_idx
  ON tenant.procurement_supplier_prices(organization_id,company_id,supplier_id,item_id,status,valid_from DESC);

-- F087 — landed-cost allocation evidence owned by Procurement; Stock allocation can consume approved rows.
CREATE TABLE IF NOT EXISTS tenant.procurement_landed_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  purchase_order_id uuid REFERENCES tenant.procurement_purchase_orders(id) ON DELETE RESTRICT,
  receipt_id uuid REFERENCES tenant.procurement_receipts(id) ON DELETE RESTRICT,
  cost_type text NOT NULL,
  amount numeric(24,6) NOT NULL CHECK (amount >= 0),
  currency_code char(3) NOT NULL,
  allocation_method text NOT NULL DEFAULT 'value' CHECK (allocation_method IN ('value','quantity','weight','manual')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','allocated','cancelled')),
  note text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (purchase_order_id IS NOT NULL OR receipt_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS procurement_landed_costs_parent_idx
  ON tenant.procurement_landed_costs(organization_id,company_id,purchase_order_id,receipt_id,status);

-- F091 — supplier lead-time catalogue.
CREATE TABLE IF NOT EXISTS tenant.procurement_supplier_lead_times (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES tenant.procurement_suppliers(id) ON DELETE CASCADE,
  item_id uuid REFERENCES tenant.items(id) ON DELETE CASCADE,
  lead_time_days integer NOT NULL CHECK (lead_time_days >= 0 AND lead_time_days <= 3650),
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_from <= effective_to)
);
CREATE INDEX IF NOT EXISTS procurement_supplier_lead_times_lookup_idx
  ON tenant.procurement_supplier_lead_times(organization_id,supplier_id,item_id,status,effective_from DESC);

-- F094 — reorder-generated purchasing queue.
CREATE TABLE IF NOT EXISTS tenant.procurement_reorder_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  reorder_rule_id uuid NOT NULL REFERENCES tenant.stock_reorder_rules(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES tenant.items(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id) ON DELETE RESTRICT,
  supplier_id uuid,
  quantity numeric(24,10) NOT NULL CHECK (quantity > 0),
  required_by date,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','converted','cancelled')),
  purchase_order_id uuid REFERENCES tenant.procurement_purchase_orders(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS procurement_reorder_queue_idx
  ON tenant.procurement_reorder_requests(organization_id,company_id,status,required_by);

-- F095 — subcontract purchasing.
CREATE TABLE IF NOT EXISTS tenant.procurement_subcontract_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES tenant.procurement_suppliers(id) ON DELETE RESTRICT,
  purchase_order_id uuid REFERENCES tenant.procurement_purchase_orders(id) ON DELETE SET NULL,
  reference_type text,
  reference_id uuid,
  item_id uuid REFERENCES tenant.items(id) ON DELETE RESTRICT,
  quantity numeric(24,10) NOT NULL CHECK (quantity > 0),
  expected_return_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','dispatched','partially_received','received','cancelled')),
  note text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS procurement_subcontract_orders_idx
  ON tenant.procurement_subcontract_orders(organization_id,company_id,supplier_id,status,expected_return_date);

-- Consistent tenant isolation for all new operational tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'crm_task_events','item_variants',
    'sales_advance_payments','sales_credit_adjustment_requests','sales_drop_ship_requests',
    'sales_commission_rules','sales_commission_entries',
    'procurement_supplier_prices','procurement_landed_costs','procurement_supplier_lead_times',
    'procurement_reorder_requests','procurement_subcontract_orders'
  ] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())',
      t
    );
  END LOOP;
END $$;

COMMIT;
