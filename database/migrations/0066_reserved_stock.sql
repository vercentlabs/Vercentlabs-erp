-- Reserved Stock: a hard commitment of existing, eligible stock to one business document, never a stock movement. Every reserved quantity
-- is explained by active reservations (each an allocation to one warehouse position: location, batch and — for serial-numbered stock — the
-- exact serial) linked to a real source document; stock_balances.reserved_quantity is their projection.
--
-- This migration adds what that needs: the source of a reservation is one of the known document types (no anonymous holds); a serial can
-- be held by only one active reservation; an optional expiry for temporary holds; and the history of every reservation (created, consumed,
-- released, cancelled, reallocated, expired) with quantities, reasons and who did it. Permissions to release another document's reservation
-- and to reallocate one are their own.

-- ============================================================ 1. reservations
ALTER TABLE tenant.stock_reservations
  ADD COLUMN IF NOT EXISTS serial_id uuid,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_reservations_serial_fkey') THEN
    ALTER TABLE tenant.stock_reservations ADD CONSTRAINT stock_reservations_serial_fkey FOREIGN KEY (serial_id) REFERENCES tenant.stock_serials(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_reservations_serial_quantity_check') THEN
    ALTER TABLE tenant.stock_reservations ADD CONSTRAINT stock_reservations_serial_quantity_check CHECK (serial_id IS NULL OR quantity = 1);
  END IF;
END $$;
-- Anonymous holds made before this (no document behind them) stay readable but are released here: nothing explains them.
UPDATE tenant.stock_reservations SET released_quantity = quantity - consumed_quantity, status = 'released', released_at = now(),
       release_reason_code = 'no_source_document', release_reason = 'Released: a reservation needs a source document'
 WHERE status = 'active' AND reference_type NOT IN ('sales_order_line', 'sales_order', 'stock_transfer', 'purchase_return', 'manufacturing_work_order');
UPDATE tenant.stock_balances balance SET reserved_quantity = COALESCE((SELECT sum(reservation.active_quantity) FROM tenant.stock_reservations reservation
    WHERE reservation.organization_id = balance.organization_id AND reservation.item_id = balance.item_id AND reservation.warehouse_id = balance.warehouse_id
      AND reservation.warehouse_location_id IS NOT DISTINCT FROM balance.warehouse_location_id AND reservation.batch_id IS NOT DISTINCT FROM balance.batch_id
      AND reservation.status = 'active'), 0)
 WHERE balance.reserved_quantity <> COALESCE((SELECT sum(reservation.active_quantity) FROM tenant.stock_reservations reservation
    WHERE reservation.organization_id = balance.organization_id AND reservation.item_id = balance.item_id AND reservation.warehouse_id = balance.warehouse_id
      AND reservation.warehouse_location_id IS NOT DISTINCT FROM balance.warehouse_location_id AND reservation.batch_id IS NOT DISTINCT FROM balance.batch_id
      AND reservation.status = 'active'), 0);
-- From now on a reservation always belongs to a document of a known kind (released holds of the past keep their old type).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_reservations_source_check') THEN
    ALTER TABLE tenant.stock_reservations ADD CONSTRAINT stock_reservations_source_check
      CHECK (reference_type IN ('sales_order_line', 'sales_order', 'stock_transfer', 'purchase_return', 'manufacturing_work_order')) NOT VALID;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS stock_reservations_one_per_serial_uidx ON tenant.stock_reservations (organization_id, serial_id) WHERE status = 'active' AND serial_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_reservations_expiry_idx ON tenant.stock_reservations (organization_id, expires_at) WHERE status = 'active' AND expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_reservations_source_idx ON tenant.stock_reservations (organization_id, reference_type, reference_id);

-- ============================================================ 2. history
CREATE TABLE IF NOT EXISTS tenant.stock_reservation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  reservation_id uuid NOT NULL REFERENCES tenant.stock_reservations(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created', 'consumed', 'released', 'cancelled', 'reallocated', 'expired')),
  quantity numeric(20, 6) NOT NULL DEFAULT 0,
  active_after numeric(20, 6) NOT NULL DEFAULT 0,
  reason_code text,
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS stock_reservation_events_idx ON tenant.stock_reservation_events (organization_id, reservation_id, created_at);
ALTER TABLE tenant.stock_reservation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.stock_reservation_events FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'stock_reservation_events' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.stock_reservation_events USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT ON tenant.stock_reservation_events TO vercent_app;
GRANT SELECT ON tenant.stock_reservation_events TO vercent_worker;
-- Every reservation that exists already starts its history.
INSERT INTO tenant.stock_reservation_events (organization_id, reservation_id, event_type, quantity, active_after, actor_user_id, created_at)
SELECT reservation.organization_id, reservation.id, 'created', reservation.quantity, reservation.active_quantity, reservation.reserved_by, reservation.created_at
  FROM tenant.stock_reservations reservation
 WHERE NOT EXISTS (SELECT 1 FROM tenant.stock_reservation_events event WHERE event.reservation_id = reservation.id);

-- ============================================================ 3. permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('stock.reservation.release', 'Release stock reservations', 'Inventory', 'Release a reservation held for another document, with a reason.'),
  ('stock.reservation.reallocate', 'Reallocate stock reservations', 'Inventory', 'Move a reservation to another warehouse, location, batch or serial without losing it.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('stock.reservation.release', 'stock.reservation.reallocate')
 WHERE existing.permission_key = 'inventory_setup.manage'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0066_reserved_stock.sql', 'reserved-stock');
