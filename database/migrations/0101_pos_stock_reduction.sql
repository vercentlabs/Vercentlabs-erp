-- POS Stock Reduction: a checkout reserves the stock it sells in Inventory's own reservations (no POS stock table), the sale consumes exactly
-- those reservations once, and anything that stops that is visible as a stock recovery on the bill.
--
--   * A reservation may now belong to a POS checkout (reference pos_checkout, the checkout's reference; one reservation per cart line and item).
--     The three source-type CHECKs are replaced by the same lists plus pos_checkout — every existing row stays valid (the one exception to the
--     additive-only rule, agreed for this feature).
--   * A checkout reservation is a lease: it expires with the checkout, is renewed while payment is under way (never beyond the outlet's maximum
--     hold) and is released when the bill goes back to editing, lapses or is given up. Renewals are counted on the allocation.
--   * The bill records when a sale could not take its stock after payment (stock_recovery_*), until the sale completes or the payment is refunded.
--   * Consumption is linked to the sale and the sale line (stock_reservation_consumptions.pos_sale_id / pos_sale_line_id); the movement itself already
--     names the sale and the line.

-- ============================================================ 1. a POS checkout is a reservation source
ALTER TABLE tenant.inventory_reservations DROP CONSTRAINT IF EXISTS inventory_reservations_reference_type_check;
ALTER TABLE tenant.inventory_reservations ADD CONSTRAINT inventory_reservations_reference_type_check
  CHECK (reference_type IN ('sales_order_line', 'sales_order', 'stock_transfer', 'purchase_return', 'manufacturing_work_order', 'pos_checkout'));
ALTER TABLE tenant.inventory_reservations DROP CONSTRAINT IF EXISTS inventory_reservations_source_document_type_check;
ALTER TABLE tenant.inventory_reservations ADD CONSTRAINT inventory_reservations_source_document_type_check
  CHECK (source_document_type IN ('sales_order', 'inventory_transfer', 'purchase_return', 'manufacturing_work_order', 'pos_checkout'));
ALTER TABLE tenant.stock_reservations DROP CONSTRAINT IF EXISTS stock_reservations_source_check;
ALTER TABLE tenant.stock_reservations ADD CONSTRAINT stock_reservations_source_check
  CHECK (reference_type IN ('sales_order_line', 'sales_order', 'stock_transfer', 'purchase_return', 'manufacturing_work_order', 'pos_checkout')) NOT VALID;

-- ============================================================ 2. the lease
ALTER TABLE tenant.stock_reservations
  ADD COLUMN IF NOT EXISTS renewal_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS renewed_at timestamptz;
CREATE INDEX IF NOT EXISTS stock_reservations_pos_checkout_idx ON tenant.stock_reservations (organization_id, reference_id) WHERE reference_type = 'pos_checkout';

ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS stock_reservation_max_hold_minutes integer NOT NULL DEFAULT 30;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_settings_stock_hold_check') THEN
    ALTER TABLE tenant.pos_settings ADD CONSTRAINT pos_settings_stock_hold_check CHECK (stock_reservation_max_hold_minutes BETWEEN 5 AND 240);
  END IF;
END $$;

-- ============================================================ 3. the bill's stock recovery
ALTER TABLE tenant.pos_carts
  ADD COLUMN IF NOT EXISTS stock_recovery_status text,
  ADD COLUMN IF NOT EXISTS stock_recovery_code text,
  ADD COLUMN IF NOT EXISTS stock_recovery_message text,
  ADD COLUMN IF NOT EXISTS stock_recovery_at timestamptz,
  ADD COLUMN IF NOT EXISTS stock_recovery_resolved_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_carts_stock_recovery_check') THEN
    ALTER TABLE tenant.pos_carts ADD CONSTRAINT pos_carts_stock_recovery_check CHECK (stock_recovery_status IS NULL OR stock_recovery_status IN ('required', 'resolved'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS pos_carts_stock_recovery_idx ON tenant.pos_carts (organization_id, stock_recovery_at DESC) WHERE stock_recovery_status = 'required';

-- ============================================================ 4. consumption linked to the sale
ALTER TABLE tenant.stock_reservation_consumptions
  ADD COLUMN IF NOT EXISTS pos_sale_id uuid,
  ADD COLUMN IF NOT EXISTS pos_sale_line_id uuid;
CREATE INDEX IF NOT EXISTS stock_reservation_consumptions_pos_sale_idx ON tenant.stock_reservation_consumptions (organization_id, pos_sale_id) WHERE pos_sale_id IS NOT NULL;
-- One consumption per reservation and sale line: a retried completion can never consume the same allocation for the same line twice.
CREATE UNIQUE INDEX IF NOT EXISTS stock_reservation_consumptions_pos_line_uidx ON tenant.stock_reservation_consumptions (organization_id, reservation_id, pos_sale_line_id)
  WHERE pos_sale_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_movements_pos_sale_idx ON tenant.stock_movements (organization_id, reference_id) WHERE reference_type = 'pos_sale';

-- ============================================================ 5. the worker releases expired checkout holds
-- Releasing a hold also refreshes its reservation's totals and records the release in its history.
GRANT UPDATE ON tenant.inventory_reservations TO vercent_worker;
GRANT INSERT ON tenant.stock_reservation_events TO vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0101_pos_stock_reduction.sql', 'pos-stock-reduction') ON CONFLICT DO NOTHING;
