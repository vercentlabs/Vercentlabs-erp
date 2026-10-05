-- Delivery / Shipment.
--
-- 1. A delivery (tenant.sales_fulfillment_requests, numbered DEL-YYYY-NNNNNN)
--    has its own lifecycle: Draft → Ready → Dispatched → Delivered, or
--    Cancelled before dispatch. Stock leaves at Dispatch, never before. The
--    older `status` column follows it (pending before dispatch, completed
--    once dispatched, cancelled), so every count of delivered quantity keeps
--    reading dispatched deliveries only.
-- 2. The delivery keeps its own snapshots: customer, contact, ship-to
--    address, customer PO, delivery instructions; plus shipment details
--    (carrier, tracking number and link, vehicle, packages, expected date)
--    and who prepared, dispatched, delivered or cancelled it, and when.
-- 3. Delivery lines keep the product as delivered (code, name, description,
--    unit) and the order quantities at the time; a line cannot change once
--    its delivery has been dispatched.
-- 4. Invoice lines can name the delivery line they bill.
-- 5. Sales settings: whether the delivery note shows prices (default no).
-- 6. Permissions for viewing, editing, dispatching, delivering, cancelling
--    and printing deliveries.

ALTER TABLE tenant.sales_fulfillment_requests
  ADD COLUMN IF NOT EXISTS delivery_status text,
  ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES tenant.business_parties(id),
  ADD COLUMN IF NOT EXISTS customer_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS contact_id uuid,
  ADD COLUMN IF NOT EXISTS contact_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS shipping_address_id uuid,
  ADD COLUMN IF NOT EXISTS shipping_address_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS customer_po_number text,
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES tenant.warehouses(id),
  ADD COLUMN IF NOT EXISTS dispatch_date date,
  ADD COLUMN IF NOT EXISTS expected_delivery_date date,
  ADD COLUMN IF NOT EXISTS tracking_url text,
  ADD COLUMN IF NOT EXISTS vehicle_reference text,
  ADD COLUMN IF NOT EXISTS package_count integer CHECK (package_count IS NULL OR package_count >= 0),
  ADD COLUMN IF NOT EXISTS package_notes text,
  ADD COLUMN IF NOT EXISTS delivery_instructions text,
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_by uuid,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatched_by uuid,
  ADD COLUMN IF NOT EXISTS delivered_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancel_reason_code text
    CHECK (cancel_reason_code IS NULL OR cancel_reason_code IN ('customer_request', 'incorrect_delivery', 'warehouse_change', 'order_change', 'duplicate_delivery', 'other')),
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- Deliveries made before this migration were issued from stock when they were recorded: dispatched, or delivered once received.
UPDATE tenant.sales_fulfillment_requests delivery
   SET delivery_status = CASE
         WHEN delivery.status = 'completed' AND delivery.delivered_at IS NOT NULL THEN 'delivered'
         WHEN delivery.status = 'completed' THEN 'dispatched'
         WHEN delivery.status = 'cancelled' THEN 'cancelled'
         ELSE 'draft' END,
       dispatch_date = COALESCE(delivery.dispatch_date, delivery.delivery_date, delivery.completed_at::date),
       dispatched_at = CASE WHEN delivery.status = 'completed' THEN COALESCE(delivery.dispatched_at, delivery.completed_at) END,
       dispatched_by = CASE WHEN delivery.status = 'completed' THEN COALESCE(delivery.dispatched_by, delivery.requested_by) END,
       internal_notes = COALESCE(delivery.internal_notes, delivery.notes),
       party_id = sales_order.party_id,
       customer_snapshot = version.customer_snapshot,
       contact_id = sales_order.contact_id,
       contact_snapshot = version.contact_snapshot,
       shipping_address_id = version.shipping_address_id,
       shipping_address_snapshot = version.shipping_address_snapshot,
       customer_po_number = version.customer_po_number,
       warehouse_id = (SELECT line.warehouse_id FROM tenant.sales_delivery_lines line WHERE line.delivery_id = delivery.id AND line.warehouse_id IS NOT NULL LIMIT 1)
  FROM tenant.sales_orders sales_order
  JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
 WHERE sales_order.organization_id = delivery.organization_id AND sales_order.id = delivery.sales_order_id AND delivery.delivery_status IS NULL;
UPDATE tenant.sales_fulfillment_requests SET delivery_status = 'cancelled' WHERE delivery_status IS NULL;

ALTER TABLE tenant.sales_fulfillment_requests
  ALTER COLUMN delivery_status SET NOT NULL,
  ALTER COLUMN delivery_status SET DEFAULT 'draft',
  ADD CONSTRAINT sales_fulfillment_requests_delivery_status_check CHECK (delivery_status IN ('draft', 'ready', 'dispatched', 'delivered', 'cancelled'));
CREATE INDEX IF NOT EXISTS sales_fulfillment_requests_delivery_status_idx ON tenant.sales_fulfillment_requests (organization_id, delivery_status);
CREATE INDEX IF NOT EXISTS sales_fulfillment_requests_order_idx ON tenant.sales_fulfillment_requests (organization_id, sales_order_id);

-- The older status follows the delivery's own: stock has left only when it is dispatched or delivered.
CREATE OR REPLACE FUNCTION tenant.sales_delivery_status_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.status := CASE NEW.delivery_status WHEN 'dispatched' THEN 'completed' WHEN 'delivered' THEN 'completed' WHEN 'cancelled' THEN 'cancelled' ELSE 'pending' END;
  IF TG_OP = 'UPDATE' AND OLD.delivery_status IN ('dispatched', 'delivered') AND NEW.delivery_status NOT IN ('dispatched', 'delivered') THEN
    RAISE EXCEPTION 'A dispatched delivery cannot go back or be cancelled; use a sales return.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.delivery_status = 'cancelled' AND NEW.delivery_status <> 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled delivery stays cancelled.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sales_delivery_status_sync
  BEFORE INSERT OR UPDATE ON tenant.sales_fulfillment_requests
  FOR EACH ROW EXECUTE FUNCTION tenant.sales_delivery_status_sync();

ALTER TABLE tenant.sales_delivery_lines
  ADD COLUMN IF NOT EXISTS sequence integer,
  ADD COLUMN IF NOT EXISTS item_code_snapshot text,
  ADD COLUMN IF NOT EXISTS item_name_snapshot text,
  ADD COLUMN IF NOT EXISTS description_snapshot text,
  ADD COLUMN IF NOT EXISTS uom_id uuid,
  ADD COLUMN IF NOT EXISTS ordered_quantity numeric(20, 6),
  ADD COLUMN IF NOT EXISTS previously_delivered_quantity numeric(20, 6),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
UPDATE tenant.sales_delivery_lines delivered
   SET sequence = line.sequence, item_code_snapshot = line.item_code_snapshot, item_name_snapshot = line.item_name_snapshot,
       description_snapshot = line.description_snapshot, uom_id = line.uom_id, ordered_quantity = line.quantity
  FROM tenant.sales_order_lines line
 WHERE line.organization_id = delivered.organization_id AND line.id = delivered.sales_order_line_id AND delivered.item_name_snapshot IS NULL;
GRANT UPDATE, DELETE ON tenant.sales_delivery_lines TO vercent_app;

-- What a dispatched delivery carried never changes.
CREATE OR REPLACE FUNCTION tenant.sales_delivery_line_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  state text;
BEGIN
  SELECT delivery_status INTO state FROM tenant.sales_fulfillment_requests WHERE id = COALESCE(OLD.delivery_id, NEW.delivery_id);
  IF TG_OP = 'DELETE' AND state IN ('dispatched', 'delivered') THEN
    RAISE EXCEPTION 'A line of a dispatched delivery cannot be removed.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND state IN ('dispatched', 'delivered', 'cancelled')
     AND (NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.base_quantity IS DISTINCT FROM OLD.base_quantity OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
          OR NEW.sales_order_line_id IS DISTINCT FROM OLD.sales_order_line_id OR NEW.item_id IS DISTINCT FROM OLD.item_id) THEN
    RAISE EXCEPTION 'A line of a dispatched or cancelled delivery cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sales_delivery_line_guard
  BEFORE UPDATE OR DELETE ON tenant.sales_delivery_lines
  FOR EACH ROW EXECUTE FUNCTION tenant.sales_delivery_line_guard();

ALTER TABLE tenant.accounting_customer_invoice_lines ADD COLUMN IF NOT EXISTS source_sales_delivery_line_id uuid REFERENCES tenant.sales_delivery_lines(id);
CREATE INDEX IF NOT EXISTS accounting_customer_invoice_lines_delivery_line_idx
  ON tenant.accounting_customer_invoice_lines (organization_id, source_sales_delivery_line_id) WHERE source_sales_delivery_line_id IS NOT NULL;

ALTER TABLE tenant.sales_settings ADD COLUMN IF NOT EXISTS show_prices_on_delivery_note boolean NOT NULL DEFAULT false;

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('sales.delivery.view', 'View deliveries', 'Sales', 'Open the deliveries of the sales orders the user can see.'),
  ('sales.delivery.view_all', 'View all deliveries', 'Sales', 'See every delivery, whoever owns the order.'),
  ('sales.delivery.edit', 'Prepare deliveries', 'Sales', 'Edit a draft delivery, change its address, contact and shipment details, and mark it ready.'),
  ('sales.delivery.dispatch', 'Dispatch deliveries', 'Sales', 'Dispatch a delivery: the goods leave the warehouse and stock is issued.'),
  ('sales.delivery.deliver', 'Confirm delivery', 'Sales', 'Mark a dispatched delivery as delivered to the customer and add proof of delivery.'),
  ('sales.delivery.cancel', 'Cancel deliveries', 'Sales', 'Cancel a delivery that has not been dispatched.'),
  ('sales.delivery.print', 'Print delivery notes', 'Sales', 'View, download and print delivery notes.')
ON CONFLICT (key) DO NOTHING;
UPDATE public.permissions SET name = 'Create deliveries', description = 'Create deliveries from confirmed sales orders.' WHERE key = 'sales.fulfillment.request';

-- Whoever sees orders sees their deliveries and their notes; the warehouse sees every delivery.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.delivery.view', 'sales.delivery.print'])
 WHERE existing.permission_key IN ('sales.order.view', 'stock.view')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.delivery.view_all' FROM public.role_permissions existing WHERE existing.permission_key IN ('sales.order.view_all', 'stock.view')
ON CONFLICT DO NOTHING;
-- Whoever creates deliveries, sales managers (who confirm orders) and the warehouse (who issues stock) prepare them,
-- cancel them before dispatch and confirm receipt.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.delivery.edit', 'sales.delivery.deliver', 'sales.delivery.cancel'])
 WHERE existing.permission_key IN ('sales.fulfillment.request', 'sales.order.confirm', 'stock.issue')
ON CONFLICT DO NOTHING;
-- Dispatch issues stock, so it is narrower: sales managers and the warehouse, not every salesperson.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.delivery.dispatch' FROM public.role_permissions existing WHERE existing.permission_key IN ('sales.order.confirm', 'stock.issue')
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0034_sales_deliveries.sql', 'sales-deliveries');
