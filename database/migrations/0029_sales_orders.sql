-- Sales Orders.
--
-- 1. Order: four lifecycle states (Draft, Confirmed, Cancelled, Closed).
--    Fulfilment and invoicing each have their own status, worked out from
--    reservations, deliveries and invoices. Orders left awaiting approval go
--    back to Draft and orders on hold back to Confirmed: neither state exists
--    any more. Who confirmed, cancelled and closed an order is recorded.
-- 2. Order version: a customer reference next to the customer PO number, and
--    a default warehouse for the lines.
-- 3. Delivery lines: what each delivery delivered, per order line. Delivered
--    quantity on an order is always the sum of its deliveries.
-- 4. Stock reservations for an order belong to its lines.
-- 5. Sales settings: reserve stock when an order is confirmed.
-- 6. Permissions for record visibility, reopening, cancelling a remaining
--    quantity, reserving stock and printing.

-- ============================================================ 1. order

ALTER TABLE tenant.sales_orders
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason_code text,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_sent_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS confirmation_sent_to text;

ALTER TABLE tenant.sales_orders
  ADD CONSTRAINT sales_orders_cancel_reason_code_check CHECK (cancel_reason_code IS NULL OR cancel_reason_code IN
    ('customer_cancelled', 'product_unavailable', 'pricing_error', 'duplicate_order', 'order_replaced', 'other'));

-- States the lifecycle no longer has.
UPDATE tenant.sales_orders SET lifecycle_status = 'draft', approval_status = 'not_required' WHERE lifecycle_status IN ('pending_approval', 'approved');
UPDATE tenant.sales_orders SET lifecycle_status = 'confirmed' WHERE lifecycle_status = 'on_hold';
UPDATE tenant.sales_order_holds SET status = 'released', released_at = COALESCE(released_at, now()), release_note = COALESCE(release_note, 'Order holds were retired.') WHERE status = 'active';
UPDATE public.approval_requests SET status = 'cancelled' WHERE status = 'pending' AND entity_type IN ('sales_order', 'sales_order_amendment');
UPDATE tenant.sales_orders SET billing_status = 'ready' WHERE lifecycle_status = 'confirmed' AND billing_status IN ('not_billable', 'blocked');
UPDATE tenant.sales_orders SET billing_status = 'not_billable' WHERE lifecycle_status = 'draft';

CREATE INDEX IF NOT EXISTS sales_orders_date_idx ON tenant.sales_orders (organization_id, order_date DESC);
CREATE INDEX IF NOT EXISTS sales_orders_party_idx ON tenant.sales_orders (organization_id, party_id);

-- ============================================================ 2. order version

ALTER TABLE tenant.sales_order_versions
  ADD COLUMN IF NOT EXISTS customer_reference text,
  ADD COLUMN IF NOT EXISTS default_warehouse_id uuid;
CREATE INDEX IF NOT EXISTS sales_order_versions_po_idx ON tenant.sales_order_versions (organization_id, lower(customer_po_number)) WHERE customer_po_number IS NOT NULL;

-- A line keeps whether its price was overridden and why, like a quotation line.
ALTER TABLE tenant.sales_order_lines
  ADD COLUMN IF NOT EXISTS manual_price_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_price_reason text;
UPDATE tenant.sales_order_lines SET manual_price_override = true WHERE NOT manual_price_override AND pricing_trace->>'manualOverride' = 'true';

-- ============================================================ 3. delivery lines

-- A delivery is a fulfilment record of the order; it gains the date goods left and a note.
ALTER TABLE tenant.sales_fulfillment_requests
  ADD COLUMN IF NOT EXISTS delivery_date date,
  ADD COLUMN IF NOT EXISTS notes text;

CREATE TABLE IF NOT EXISTS tenant.sales_delivery_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  delivery_id uuid NOT NULL REFERENCES tenant.sales_fulfillment_requests(id) ON DELETE CASCADE,
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id) ON DELETE CASCADE,
  sales_order_line_id uuid NOT NULL REFERENCES tenant.sales_order_lines(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  warehouse_id uuid,
  -- In the order line's unit, and in the product's base unit (what stock moves in).
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  base_quantity numeric(20, 6) NOT NULL CHECK (base_quantity > 0),
  uom_snapshot text,
  stock_issued boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, sales_order_line_id)
);
CREATE INDEX IF NOT EXISTS sales_delivery_lines_order_idx ON tenant.sales_delivery_lines (organization_id, sales_order_id);
CREATE INDEX IF NOT EXISTS sales_delivery_lines_line_idx ON tenant.sales_delivery_lines (organization_id, sales_order_line_id);
ALTER TABLE tenant.sales_delivery_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_delivery_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.sales_delivery_lines
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT ON tenant.sales_delivery_lines TO vercent_app;
GRANT SELECT ON tenant.sales_delivery_lines TO vercent_worker;

-- Quantities already delivered were kept only as a counter on the order line.
-- Each such order gets its delivery lines, on its latest completed delivery
-- (or on one made for it), so the counter and the deliveries agree.
INSERT INTO tenant.sales_fulfillment_requests (organization_id, request_number, sales_order_id, sales_order_version_id, idempotency_key, status, payload, requested_by, completed_at, delivery_date)
SELECT sales_order.organization_id, 'DEL-' || sales_order.sales_order_number, sales_order.id, sales_order.current_version_id, 'legacy-delivery:' || sales_order.id, 'completed',
       '{"legacy": true}'::jsonb, sales_order.updated_by, sales_order.updated_at, sales_order.updated_at::date
  FROM tenant.sales_orders sales_order
 WHERE EXISTS (SELECT 1 FROM tenant.sales_order_lines line JOIN tenant.sales_order_line_progress progress ON progress.sales_order_line_id = line.id
                WHERE line.sales_order_version_id = sales_order.current_version_id AND progress.fulfilled_quantity > 0)
   AND NOT EXISTS (SELECT 1 FROM tenant.sales_fulfillment_requests request WHERE request.sales_order_id = sales_order.id AND request.status = 'completed')
ON CONFLICT DO NOTHING;

INSERT INTO tenant.sales_delivery_lines (organization_id, delivery_id, sales_order_id, sales_order_line_id, item_id, warehouse_id, quantity, base_quantity, uom_snapshot, stock_issued)
SELECT line.organization_id, delivery.id, sales_order.id, line.id, line.item_id, line.warehouse_id, progress.fulfilled_quantity,
       progress.fulfilled_quantity * COALESCE(NULLIF(line.conversion_factor, 0), 1), line.uom_snapshot, true
  FROM tenant.sales_orders sales_order
  JOIN tenant.sales_order_lines line ON line.sales_order_version_id = sales_order.current_version_id
  JOIN tenant.sales_order_line_progress progress ON progress.sales_order_line_id = line.id AND progress.fulfilled_quantity > 0
  JOIN LATERAL (SELECT request.id FROM tenant.sales_fulfillment_requests request
                 WHERE request.sales_order_id = sales_order.id AND request.status = 'completed' ORDER BY request.completed_at DESC NULLS LAST LIMIT 1) delivery ON true
ON CONFLICT (delivery_id, sales_order_line_id) DO NOTHING;

UPDATE tenant.sales_fulfillment_requests SET delivery_date = COALESCE(shipped_at, completed_at, requested_at)::date WHERE delivery_date IS NULL AND status = 'completed';
-- A delivery is recorded when the goods leave: requests never fulfilled are closed.
UPDATE tenant.sales_fulfillment_requests SET status = 'cancelled', last_error = COALESCE(last_error, 'Open fulfilment requests were retired.') WHERE status IN ('pending', 'processing', 'failed');

-- ============================================================ 4. reservations

-- A reservation for an order belongs to the order line it was made for.
UPDATE tenant.stock_reservations reservation
   SET reference_type = 'sales_order_line', reference_id = target.line_id
  FROM (SELECT DISTINCT ON (held.id) held.id AS reservation_id, line.id AS line_id
          FROM tenant.stock_reservations held
          JOIN tenant.sales_orders sales_order ON sales_order.organization_id = held.organization_id AND sales_order.id = held.reference_id
          JOIN tenant.sales_order_lines line ON line.sales_order_version_id = sales_order.current_version_id AND line.item_id = held.item_id
               AND line.warehouse_id IS NOT DISTINCT FROM held.warehouse_id
         WHERE held.reference_type = 'sales_order' AND held.status = 'active'
         ORDER BY held.id, line.sequence) target
 WHERE target.reservation_id = reservation.id;

-- ============================================================ 5. settings

ALTER TABLE tenant.sales_settings ADD COLUMN IF NOT EXISTS reserve_stock_on_confirm boolean NOT NULL DEFAULT true;

-- ============================================================ 6. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('sales.order.view', 'View sales orders', 'Sales', 'Open the sales orders the user owns.'),
  ('sales.order.view_team', 'View team sales orders', 'Sales', 'See sales orders owned by the user''s sales team.'),
  ('sales.order.view_all', 'View all sales orders', 'Sales', 'See every sales order of the organization.'),
  ('sales.order.reopen', 'Reopen confirmed sales orders', 'Sales', 'Return a confirmed order with no delivery or invoice to Draft.'),
  ('sales.order.cancel_remaining', 'Cancel remaining quantity', 'Sales', 'Cancel the undelivered quantity of a sales order line.'),
  ('sales.order.reserve', 'Reserve stock for sales orders', 'Sales', 'Check availability, reserve and release stock for a sales order.'),
  ('sales.order.export', 'Print and export sales orders', 'Sales', 'Download, print, email and export sales orders.')
ON CONFLICT (key) DO NOTHING;

-- Everyone who opens Sales keeps seeing every order and printing it, as before.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.order.view', 'sales.order.view_all', 'sales.order.export'])
 WHERE existing.permission_key = 'sales.view'
ON CONFLICT DO NOTHING;

-- Whoever cancels orders may reopen them and cancel a remaining quantity.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.order.reopen', 'sales.order.cancel_remaining'])
 WHERE existing.permission_key = 'sales.order.cancel'
ON CONFLICT DO NOTHING;

-- Whoever confirms orders or requests their fulfilment reserves stock for them.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.order.reserve'
  FROM public.role_permissions existing
 WHERE existing.permission_key IN ('sales.order.confirm', 'sales.fulfillment.request')
ON CONFLICT DO NOTHING;

-- Approvers and Sales administrators see their team's orders.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.order.view_team'
  FROM public.role_permissions existing
 WHERE existing.permission_key IN ('sales.order.approve', 'sales.settings.manage')
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0029_sales_orders.sql', 'sales-orders');
