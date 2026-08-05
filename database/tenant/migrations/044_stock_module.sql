BEGIN;
CREATE TABLE IF NOT EXISTS tenant.stock_settings (
 organization_id uuid NOT NULL, company_id uuid NOT NULL, costing_method text NOT NULL DEFAULT 'moving_average' CHECK(costing_method IN ('moving_average','fifo')),
 allow_negative_stock boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,company_id)
);
CREATE TABLE IF NOT EXISTS tenant.stock_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, company_id uuid NOT NULL, item_id uuid NOT NULL,
 batch_number text NOT NULL, manufactured_on date, expires_on date, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,company_id,item_id,batch_number)
);
CREATE TABLE IF NOT EXISTS tenant.stock_serials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, company_id uuid NOT NULL, item_id uuid NOT NULL,
 serial_number text NOT NULL, warehouse_id uuid, warehouse_location_id uuid, status text NOT NULL DEFAULT 'available', batch_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,company_id,serial_number)
);
CREATE TABLE IF NOT EXISTS tenant.stock_balances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, company_id uuid NOT NULL, item_id uuid NOT NULL, warehouse_id uuid NOT NULL,
 warehouse_location_id uuid, batch_id uuid, quantity numeric(20,6) NOT NULL DEFAULT 0, reserved_quantity numeric(20,6) NOT NULL DEFAULT 0,
 average_cost numeric(20,6) NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE NULLS NOT DISTINCT(organization_id,company_id,item_id,warehouse_id,warehouse_location_id,batch_id),
 CHECK(reserved_quantity>=0), CHECK(quantity>=reserved_quantity OR (quantity<0 AND reserved_quantity=0))
);
CREATE TABLE IF NOT EXISTS tenant.stock_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, company_id uuid NOT NULL, movement_number text NOT NULL,
 movement_type text NOT NULL CHECK(movement_type IN ('receipt','issue','transfer','adjustment','return','count')), item_id uuid NOT NULL,
 warehouse_id uuid NOT NULL, warehouse_location_id uuid, batch_id uuid, serial_id uuid, quantity numeric(20,6) NOT NULL CHECK(quantity<>0),
 unit_cost numeric(20,6) NOT NULL DEFAULT 0, reference_type text, reference_id uuid, reason text, occurred_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), idempotency_key text,
 UNIQUE(organization_id,idempotency_key), UNIQUE(organization_id,movement_number)
);
CREATE TABLE IF NOT EXISTS tenant.stock_valuation_layers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, company_id uuid NOT NULL, movement_id uuid NOT NULL REFERENCES tenant.stock_movements(id),
 item_id uuid NOT NULL, warehouse_id uuid NOT NULL, quantity numeric(20,6) NOT NULL, unit_cost numeric(20,6) NOT NULL, remaining_quantity numeric(20,6) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant.stock_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, company_id uuid NOT NULL, transfer_number text NOT NULL,
 item_id uuid NOT NULL, source_warehouse_id uuid NOT NULL, source_location_id uuid, destination_warehouse_id uuid NOT NULL, destination_location_id uuid,
 batch_id uuid, quantity numeric(20,6) NOT NULL CHECK(quantity>0), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_transit','completed','cancelled')),
 requested_by uuid NOT NULL, completed_by uuid, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,transfer_number)
);
CREATE TABLE IF NOT EXISTS tenant.stock_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, company_id uuid NOT NULL, item_id uuid NOT NULL, warehouse_id uuid NOT NULL,
 warehouse_location_id uuid, batch_id uuid, quantity numeric(20,6) NOT NULL CHECK(quantity>0), reference_type text NOT NULL, reference_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','released','consumed','cancelled')), reserved_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), released_at timestamptz
);
CREATE TABLE IF NOT EXISTS tenant.stock_reorder_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, company_id uuid NOT NULL, item_id uuid NOT NULL, warehouse_id uuid NOT NULL,
 minimum_quantity numeric(20,6) NOT NULL DEFAULT 0, reorder_quantity numeric(20,6) NOT NULL CHECK(reorder_quantity>0), maximum_quantity numeric(20,6),
 preferred_supplier_id uuid, lead_time_days integer NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,company_id,item_id,warehouse_id)
);
CREATE INDEX IF NOT EXISTS stock_movements_lookup_idx ON tenant.stock_movements(organization_id,company_id,item_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS stock_balances_lookup_idx ON tenant.stock_balances(organization_id,company_id,warehouse_id,item_id);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['stock_settings','stock_batches','stock_serials','stock_balances','stock_movements','stock_valuation_layers','stock_transfers','stock_reservations','stock_reorder_rules'] LOOP
 EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I',t);
 EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())',t);
END LOOP; END $$;
COMMIT;
