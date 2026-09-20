BEGIN;

-- F158-F161, F168: MRP runs convert to production orders; finite-capacity scheduling writes dates
-- onto operations and keeps the customer/due date separate from the scheduled dates.
ALTER TABLE tenant.manufacturing_material_requirements
  ADD COLUMN IF NOT EXISTS converted_order_id uuid,
  ADD COLUMN IF NOT EXISTS supply_quantity numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS safety_shortfall numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS has_bom boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pegging jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 0;
ALTER TABLE tenant.manufacturing_planning_runs
  ADD COLUMN IF NOT EXISTS note text;
CREATE INDEX IF NOT EXISTS manufacturing_material_requirements_run_idx ON tenant.manufacturing_material_requirements (organization_id, planning_run_id);

ALTER TABLE tenant.manufacturing_work_orders ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE tenant.manufacturing_work_order_operations
  ADD COLUMN IF NOT EXISTS scheduled_start date,
  ADD COLUMN IF NOT EXISTS scheduled_end date;

COMMIT;
