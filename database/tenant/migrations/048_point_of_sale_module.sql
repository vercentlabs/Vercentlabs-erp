BEGIN;

CREATE TABLE IF NOT EXISTS tenant.pos_settings (
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  require_shift_reconciliation boolean NOT NULL DEFAULT true,
  allow_negative_stock boolean NOT NULL DEFAULT false,
  allow_price_override boolean NOT NULL DEFAULT false,
  require_return_approval boolean NOT NULL DEFAULT true,
  prohibit_self_return_approval boolean NOT NULL DEFAULT true,
  default_currency_code text NOT NULL DEFAULT 'INR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,company_id)
);

CREATE TABLE IF NOT EXISTS tenant.pos_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  warehouse_id uuid NOT NULL,
  price_list_id uuid,
  currency_code text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,code)
);

CREATE TABLE IF NOT EXISTS tenant.pos_terminals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  code text NOT NULL,
  name text NOT NULL,
  terminal_key_hash text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive','maintenance')),
  receipt_prefix text NOT NULL DEFAULT 'POS',
  last_sequence bigint NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,store_id,code)
);

CREATE TABLE IF NOT EXISTS tenant.pos_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  terminal_id uuid NOT NULL REFERENCES tenant.pos_terminals(id),
  shift_number text NOT NULL,
  cashier_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','open','closing','closed','cancelled')),
  opening_cash numeric(20,6) NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  expected_cash numeric(20,6) NOT NULL DEFAULT 0,
  counted_cash numeric(20,6),
  cash_variance numeric(20,6),
  opened_at timestamptz,
  closed_at timestamptz,
  opened_by uuid,
  closed_by uuid,
  close_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,terminal_id,shift_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_terminal_open_shift_uidx
ON tenant.pos_shifts(terminal_id)
WHERE status IN ('open','closing');

CREATE TABLE IF NOT EXISTS tenant.pos_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  terminal_id uuid NOT NULL REFERENCES tenant.pos_terminals(id),
  shift_id uuid NOT NULL REFERENCES tenant.pos_shifts(id),
  receipt_number text NOT NULL,
  customer_id uuid,
  customer_name text,
  sale_date timestamptz NOT NULL DEFAULT now(),
  currency_code text NOT NULL,
  subtotal numeric(20,6) NOT NULL DEFAULT 0,
  discount_total numeric(20,6) NOT NULL DEFAULT 0,
  tax_total numeric(20,6) NOT NULL DEFAULT 0,
  rounding_adjustment numeric(20,6) NOT NULL DEFAULT 0,
  grand_total numeric(20,6) NOT NULL DEFAULT 0,
  paid_total numeric(20,6) NOT NULL DEFAULT 0,
  change_total numeric(20,6) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','completed','partially_returned','returned','voided')),
  sales_order_id uuid,
  accounting_invoice_id uuid,
  idempotency_key text NOT NULL,
  created_by uuid NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,receipt_number),
  UNIQUE (organization_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS tenant.pos_sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  sale_id uuid NOT NULL REFERENCES tenant.pos_sales(id) ON DELETE CASCADE,
  line_number integer NOT NULL CHECK (line_number > 0),
  item_id uuid NOT NULL,
  description text NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  unit_price numeric(20,6) NOT NULL CHECK (unit_price >= 0),
  discount_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total numeric(20,6) NOT NULL CHECK (line_total >= 0),
  warehouse_id uuid NOT NULL,
  warehouse_location_id uuid,
  batch_id uuid,
  serial_id uuid,
  stock_movement_id uuid REFERENCES tenant.stock_movements(id),
  returned_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  UNIQUE (sale_id,line_number)
);

CREATE TABLE IF NOT EXISTS tenant.pos_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  sale_id uuid NOT NULL REFERENCES tenant.pos_sales(id),
  shift_id uuid NOT NULL REFERENCES tenant.pos_shifts(id),
  payment_method text NOT NULL
    CHECK (payment_method IN ('cash','card','upi','bank_transfer','wallet','store_credit')),
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  provider_reference text,
  authorization_reference text,
  status text NOT NULL DEFAULT 'captured'
    CHECK (status IN ('pending','captured','failed','refunded','partially_refunded')),
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant.pos_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  terminal_id uuid NOT NULL REFERENCES tenant.pos_terminals(id),
  shift_id uuid NOT NULL REFERENCES tenant.pos_shifts(id),
  sale_id uuid NOT NULL REFERENCES tenant.pos_sales(id),
  return_number text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','approved','completed','rejected','cancelled')),
  refund_total numeric(20,6) NOT NULL DEFAULT 0,
  requested_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,return_number)
);

CREATE TABLE IF NOT EXISTS tenant.pos_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  return_id uuid NOT NULL REFERENCES tenant.pos_returns(id) ON DELETE CASCADE,
  sale_line_id uuid NOT NULL REFERENCES tenant.pos_sale_lines(id),
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  refund_amount numeric(20,6) NOT NULL CHECK (refund_amount >= 0),
  restock boolean NOT NULL DEFAULT true,
  stock_movement_id uuid REFERENCES tenant.stock_movements(id)
);

CREATE TABLE IF NOT EXISTS tenant.pos_cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  shift_id uuid NOT NULL REFERENCES tenant.pos_shifts(id),
  movement_number text NOT NULL,
  movement_type text NOT NULL
    CHECK (movement_type IN ('opening','sale','refund','paid_in','paid_out','closing_adjustment')),
  amount numeric(20,6) NOT NULL,
  reason text,
  reference_type text,
  reference_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,movement_number)
);

CREATE TABLE IF NOT EXISTS tenant.pos_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  shift_id uuid NOT NULL REFERENCES tenant.pos_shifts(id),
  payment_method text NOT NULL,
  expected_amount numeric(20,6) NOT NULL DEFAULT 0,
  counted_amount numeric(20,6) NOT NULL DEFAULT 0,
  variance_amount numeric(20,6) NOT NULL DEFAULT 0,
  provider_settlement_reference text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','matched','variance','resolved')),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift_id,payment_method)
);

CREATE TABLE IF NOT EXISTS tenant.pos_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_sales_shift_idx
  ON tenant.pos_sales(organization_id,shift_id,sale_date);
CREATE INDEX IF NOT EXISTS pos_payments_shift_idx
  ON tenant.pos_payments(organization_id,shift_id,payment_method);
CREATE INDEX IF NOT EXISTS pos_returns_sale_idx
  ON tenant.pos_returns(organization_id,sale_id,status);
CREATE INDEX IF NOT EXISTS pos_events_aggregate_idx
  ON tenant.pos_events(organization_id,aggregate_type,aggregate_id,occurred_at);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'pos_settings',
    'pos_stores',
    'pos_terminals',
    'pos_shifts',
    'pos_sales',
    'pos_sale_lines',
    'pos_payments',
    'pos_returns',
    'pos_return_lines',
    'pos_cash_movements',
    'pos_reconciliations',
    'pos_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON tenant.%I',
      table_name || '_organization_isolation',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON tenant.%I USING (organization_id=tenant.current_organization_id()) WITH CHECK (organization_id=tenant.current_organization_id())',
      table_name || '_organization_isolation',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
