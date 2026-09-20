BEGIN;

-- F155-F167, F172-F179: production orders with reservations, material issue/return, backflush,
-- job cards, WIP cost, finished-goods receipt (batch/serial), scrap and waste, rework,
-- by-/co-products and make-to-order links.
ALTER TABLE tenant.manufacturing_work_orders DROP CONSTRAINT IF EXISTS manufacturing_work_orders_status_check;
ALTER TABLE tenant.manufacturing_work_orders ADD CONSTRAINT manufacturing_work_orders_status_check CHECK (status IN ('draft','planned','released','in_progress','on_hold','completed','cancelled'));
ALTER TABLE tenant.manufacturing_work_orders
  ADD COLUMN IF NOT EXISTS material_cost numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS labor_cost numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overhead_cost numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scrap_cost numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_absorbed numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rework_of_id uuid,
  ADD COLUMN IF NOT EXISTS source_label text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS close_reason text,
  ADD COLUMN IF NOT EXISTS hold_reason text,
  ADD COLUMN IF NOT EXISTS held_from_status text;
ALTER TABLE tenant.manufacturing_work_orders DROP CONSTRAINT IF EXISTS manufacturing_work_orders_source_type_check;
CREATE INDEX IF NOT EXISTS manufacturing_work_orders_status_idx ON tenant.manufacturing_work_orders (organization_id, company_id, status, planned_start_at);

ALTER TABLE tenant.manufacturing_work_order_materials
  ADD COLUMN IF NOT EXISTS reservation_id uuid,
  ADD COLUMN IF NOT EXISTS issued_cost numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returned_cost numeric(20,6) NOT NULL DEFAULT 0;

ALTER TABLE tenant.manufacturing_work_order_operations
  ADD COLUMN IF NOT EXISTS quantity_good numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_by uuid,
  ADD COLUMN IF NOT EXISTS inspection_required boolean NOT NULL DEFAULT false;

ALTER TABLE tenant.manufacturing_production_postings DROP CONSTRAINT IF EXISTS manufacturing_production_postings_posting_type_check;
ALTER TABLE tenant.manufacturing_production_postings ADD CONSTRAINT manufacturing_production_postings_posting_type_check CHECK (posting_type IN ('material_issue','material_return','production_receipt','scrap','byproduct_receipt'));

-- By-products and co-products: extra outputs of a BOM, per one BOM output, with a share of cost.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_bom_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  bom_id uuid NOT NULL REFERENCES tenant.manufacturing_boms(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  output_type text NOT NULL CHECK (output_type IN ('by_product','co_product')),
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  cost_share_percent numeric(7,3) NOT NULL DEFAULT 0 CHECK (cost_share_percent >= 0 AND cost_share_percent < 100),
  warehouse_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bom_id, item_id)
);

-- Scrap and waste: what was lost, why, and what it cost.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_scrap_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  operation_id uuid,
  item_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('scrap','waste')),
  scope text NOT NULL CHECK (scope IN ('product','component')),
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(20,6) NOT NULL DEFAULT 0,
  reason_code text NOT NULL,
  note text,
  stock_movement_id uuid,
  posted_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manufacturing_scrap_records_wo_idx ON tenant.manufacturing_scrap_records (organization_id, work_order_id);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['manufacturing_bom_outputs','manufacturing_scrap_records'] LOOP
  EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', t);
  EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
END LOOP; END $$;

COMMIT;
