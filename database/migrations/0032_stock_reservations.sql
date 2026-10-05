-- Stock Reservation.
--
-- 1. A reservation keeps the quantity it reserved. What a delivery consumed
--    and what was released are recorded beside it, never by rewriting it:
--      active = reserved − consumed − released, never below zero.
--    A partial delivery consumes part of a reservation; a partial release
--    gives part back. Its status follows: Active while anything is held,
--    then Consumed, Released or Cancelled. The database refuses any change to
--    what was reserved, any decrease of what was consumed or released, and
--    any deletion.
-- 2. A sales reservation names its sales order and order line, and keeps the
--    quantity in the line's selling unit beside the stock (base) quantity.
-- 3. Each consumption is recorded against the delivery and delivery line
--    that consumed it.
-- 4. Reservations are numbered (RES-…) from now on, with who released them,
--    when and why.
-- 5. Permissions: view reservations, release a reservation, and view every
--    reservation across orders and warehouses.

ALTER TABLE tenant.stock_reservations
  ADD COLUMN IF NOT EXISTS reservation_number text,
  ADD COLUMN IF NOT EXISTS consumed_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS released_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES tenant.sales_orders(id),
  ADD COLUMN IF NOT EXISTS sales_order_line_id uuid REFERENCES tenant.sales_order_lines(id),
  ADD COLUMN IF NOT EXISTS sales_quantity numeric(20, 6),
  ADD COLUMN IF NOT EXISTS sales_uom text,
  ADD COLUMN IF NOT EXISTS released_by uuid,
  ADD COLUMN IF NOT EXISTS release_reason_code text,
  ADD COLUMN IF NOT EXISTS release_reason text,
  ADD COLUMN IF NOT EXISTS last_consumed_at timestamptz;

-- Reservations closed before this migration: a consumed one consumed all it held, a released or cancelled one gave it all back.
UPDATE tenant.stock_reservations SET consumed_quantity = quantity
 WHERE status = 'consumed' AND consumed_quantity = 0 AND released_quantity = 0;
UPDATE tenant.stock_reservations SET released_quantity = quantity
 WHERE status IN ('released', 'cancelled') AND consumed_quantity = 0 AND released_quantity = 0;

-- Sales reservations belong to their order line and order.
UPDATE tenant.stock_reservations reservation
   SET sales_order_line_id = line.id, sales_order_id = version.sales_order_id
  FROM tenant.sales_order_lines line
  JOIN tenant.sales_order_versions version ON version.organization_id = line.organization_id AND version.id = line.sales_order_version_id
 WHERE reservation.reference_type = 'sales_order_line' AND reservation.reference_id = line.id AND reservation.organization_id = line.organization_id
   AND reservation.sales_order_line_id IS NULL;

ALTER TABLE tenant.stock_reservations
  ADD COLUMN IF NOT EXISTS active_quantity numeric(20, 6) GENERATED ALWAYS AS (quantity - consumed_quantity - released_quantity) STORED;
ALTER TABLE tenant.stock_reservations
  ADD CONSTRAINT stock_reservations_quantities_check
    CHECK (consumed_quantity >= 0 AND released_quantity >= 0 AND consumed_quantity + released_quantity <= quantity),
  ADD CONSTRAINT stock_reservations_status_check_active
    CHECK ((status = 'active') = (quantity - consumed_quantity - released_quantity > 0));
CREATE UNIQUE INDEX IF NOT EXISTS stock_reservations_number_idx ON tenant.stock_reservations (organization_id, reservation_number) WHERE reservation_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_reservations_sales_line_idx ON tenant.stock_reservations (organization_id, sales_order_line_id) WHERE sales_order_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_reservations_sales_order_idx ON tenant.stock_reservations (organization_id, sales_order_id) WHERE sales_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_reservations_active_idx ON tenant.stock_reservations (organization_id, item_id, warehouse_id) WHERE status = 'active';

-- What was reserved never changes; consumed and released only grow; nothing is deleted.
CREATE OR REPLACE FUNCTION tenant.stock_reservation_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A stock reservation is never deleted; release it instead.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.warehouse_location_id IS DISTINCT FROM OLD.warehouse_location_id OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.reference_type IS DISTINCT FROM OLD.reference_type OR NEW.reference_id IS DISTINCT FROM OLD.reference_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.sales_order_id IS DISTINCT FROM OLD.sales_order_id
     OR NEW.sales_order_line_id IS DISTINCT FROM OLD.sales_order_line_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'What a stock reservation reserved cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.consumed_quantity < OLD.consumed_quantity OR NEW.released_quantity < OLD.released_quantity THEN
    RAISE EXCEPTION 'Consumed and released quantities of a stock reservation never decrease.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stock_reservation_guard
  BEFORE UPDATE OR DELETE ON tenant.stock_reservations
  FOR EACH ROW EXECUTE FUNCTION tenant.stock_reservation_guard();

CREATE TABLE IF NOT EXISTS tenant.stock_reservation_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL REFERENCES tenant.stock_reservations(id),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  delivery_id uuid REFERENCES tenant.sales_fulfillment_requests(id),
  delivery_line_id uuid REFERENCES tenant.sales_delivery_lines(id),
  stock_movement_id uuid,
  consumed_by uuid,
  consumed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_reservation_consumptions_reservation_idx ON tenant.stock_reservation_consumptions (organization_id, reservation_id);
CREATE INDEX IF NOT EXISTS stock_reservation_consumptions_delivery_idx ON tenant.stock_reservation_consumptions (organization_id, delivery_id);
ALTER TABLE tenant.stock_reservation_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.stock_reservation_consumptions FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.stock_reservation_consumptions
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT ON tenant.stock_reservation_consumptions TO vercent_app;
GRANT SELECT ON tenant.stock_reservation_consumptions TO vercent_worker;

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('sales.reservation.view', 'View stock reservations', 'Sales', 'See the stock reserved for the sales orders the user can open.'),
  ('sales.reservation.release', 'Release stock reservations', 'Sales', 'Give stock reserved for a sales order back, with a reason.'),
  ('sales.reservation.view_all', 'View all stock reservations', 'Sales', 'See every stock reservation across sales orders and warehouses.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.reservation.view' FROM public.role_permissions existing WHERE existing.permission_key = 'sales.order.view'
ON CONFLICT DO NOTHING;
-- Whoever reserves stock for orders may release it, as before.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.reservation.release' FROM public.role_permissions existing WHERE existing.permission_key = 'sales.order.reserve'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.reservation.view_all' FROM public.role_permissions existing WHERE existing.permission_key IN ('sales.order.view_all', 'stock.view')
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0032_stock_reservations.sql', 'stock-reservations');
