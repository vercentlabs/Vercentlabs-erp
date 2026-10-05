-- Availability Check.
--
-- 1. Warehouses: whether a warehouse fulfils sales. Transit, work-in-progress,
--    virtual and returns warehouses do not: their stock is not available to
--    sales orders (stock in transit is never counted in two places).
-- 2. Order line progress: the warehouse a confirmed line ships from when it
--    was changed after confirmation (order lines themselves never change).
-- 3. Sales settings: whether stock is checked when an order is confirmed.
-- 4. Permissions: view stock availability, check a sales order's
--    availability, see other warehouses, and change a line's fulfillment
--    warehouse.
-- Availability itself is never stored: it is worked out from Inventory each
-- time it is asked for.

-- Worked out from the warehouse type, so a warehouse created later is classified the same way.
ALTER TABLE tenant.warehouses ADD COLUMN IF NOT EXISTS sales_fulfillment boolean
  GENERATED ALWAYS AS (warehouse_type NOT IN ('transit', 'work_in_progress', 'virtual', 'returns')) STORED;

ALTER TABLE tenant.sales_order_line_progress ADD COLUMN IF NOT EXISTS fulfillment_warehouse_id uuid REFERENCES tenant.warehouses(id);

ALTER TABLE tenant.sales_settings ADD COLUMN IF NOT EXISTS check_availability_on_confirm boolean NOT NULL DEFAULT true;

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('sales.availability.view', 'View stock availability', 'Sales', 'See on hand, reserved and available stock of products.'),
  ('sales.availability.check', 'Check sales order availability', 'Sales', 'Check whether the stock for a sales order is available.'),
  ('sales.availability.other_warehouses', 'View other warehouses'' stock', 'Sales', 'See stock of a product in warehouses other than the one an order line ships from.'),
  ('sales.order.change_warehouse', 'Change fulfillment warehouse', 'Sales', 'Change the warehouse a confirmed sales order line ships from.')
ON CONFLICT (key) DO NOTHING;

-- Everyone who opens sales orders sees their stock, in every warehouse.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.availability.view', 'sales.availability.check', 'sales.availability.other_warehouses'])
 WHERE existing.permission_key = 'sales.order.view'
ON CONFLICT DO NOTHING;

-- Whoever reserves stock for orders may move a line to another warehouse.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.order.change_warehouse'
  FROM public.role_permissions existing
 WHERE existing.permission_key = 'sales.order.reserve'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0031_sales_availability.sql', 'sales-availability');
