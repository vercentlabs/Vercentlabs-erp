BEGIN;

-- F122-F124: a reorder rule now carries a safety stock buffer. The rule fires when the
-- available quantity falls to (minimum + safety); an optional maximum turns it into an
-- order-up-to level.
ALTER TABLE tenant.stock_reorder_rules
  ADD COLUMN IF NOT EXISTS safety_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE tenant.stock_reorder_rules DROP CONSTRAINT IF EXISTS stock_reorder_rules_safety_quantity_check;
ALTER TABLE tenant.stock_reorder_rules ADD CONSTRAINT stock_reorder_rules_safety_quantity_check CHECK (safety_quantity >= 0);

-- F129: standard costing is a selectable company method (items could already declare it).
ALTER TABLE tenant.stock_settings DROP CONSTRAINT IF EXISTS stock_settings_costing_method_check;
ALTER TABLE tenant.stock_settings ADD CONSTRAINT stock_settings_costing_method_check CHECK (costing_method IN ('moving_average','fifo','standard'));
ALTER TABLE tenant.stock_settings ADD COLUMN IF NOT EXISTS updated_by uuid;

-- F115-F118: batch lifecycle. A blocked or expired batch cannot be used (stockDimension
-- only accepts status='active').
ALTER TABLE tenant.stock_batches
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE tenant.stock_batches DROP CONSTRAINT IF EXISTS stock_batches_status_check;
ALTER TABLE tenant.stock_batches ADD CONSTRAINT stock_batches_status_check CHECK (status IN ('active','blocked','expired'));

COMMIT;
