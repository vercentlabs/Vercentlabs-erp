BEGIN;

-- F129-F135: standard costing records the purchase-price variance on the movement that caused it.
ALTER TABLE tenant.stock_movements ADD COLUMN IF NOT EXISTS cost_variance numeric(20,6) NOT NULL DEFAULT 0;

-- F136: landed cost is capitalised into the receipt's valuation layers. One row per (landed cost,
-- receipt movement) makes the allocation idempotent and traceable; `expensed_amount` is the part
-- that belongs to stock already issued (or to a standard-costed item) and so is NOT added to
-- inventory value.
ALTER TABLE tenant.stock_valuation_layers ADD COLUMN IF NOT EXISTS landed_cost_total numeric(20,6) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS tenant.stock_landed_cost_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  landed_cost_id uuid NOT NULL,
  movement_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN ('quantity','value')),
  allocated_amount numeric(20,6) NOT NULL,
  capitalised_amount numeric(20,6) NOT NULL DEFAULT 0,
  expensed_amount numeric(20,6) NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, landed_cost_id, movement_id)
);
CREATE INDEX IF NOT EXISTS stock_landed_cost_alloc_cost_idx ON tenant.stock_landed_cost_allocations (organization_id, landed_cost_id);
ALTER TABLE tenant.stock_landed_cost_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.stock_landed_cost_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.stock_landed_cost_allocations;
CREATE POLICY tenant_organization_isolation ON tenant.stock_landed_cost_allocations USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());

-- FIFO consumption reads layers oldest-first per item and warehouse.
CREATE INDEX IF NOT EXISTS stock_valuation_layers_fifo_idx ON tenant.stock_valuation_layers (organization_id, company_id, item_id, warehouse_id, created_at) WHERE remaining_quantity > 0;

COMMIT;
