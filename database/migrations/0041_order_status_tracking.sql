-- Order Status Tracking.
--
-- Where a sales order stands is never one status. Its lifecycle (Draft,
-- Confirmed, Cancelled, Closed) is the order's own; reservation, fulfilment,
-- invoicing, payment, returns, credits and refunds are each worked out from
-- the documents that own them (reservations, deliveries, invoices, receipts,
-- returns, credit notes, refunds) by one tracking service, the same for the
-- order page, the list, the customer, the dashboard and the reports. Nothing
-- here stores a second copy of that progress.
--
-- An order closes by itself when nothing is left to deliver or invoice,
-- whether or not it is paid: collections stay with Finance. This migration
-- adds the one thing that is the order's own to record: an authorised
-- person closing it by hand (for example a service order, or an invoicing
-- remainder that is deliberately waived), with the reason.
--
-- 1. tenant.sales_orders: closed by hand, and why.
-- 2. Permissions to close an order and to reopen one closed by hand.

ALTER TABLE tenant.sales_orders ADD COLUMN IF NOT EXISTS closed_manually boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.sales_orders ADD COLUMN IF NOT EXISTS close_reason text;

-- The list is read by the dimensions of an order's progress.
CREATE INDEX IF NOT EXISTS sales_orders_tracking_idx ON tenant.sales_orders (organization_id, lifecycle_status, fulfillment_status, billing_status);
CREATE INDEX IF NOT EXISTS sales_orders_requested_delivery_idx ON tenant.sales_orders (organization_id, requested_delivery_date) WHERE lifecycle_status = 'confirmed';

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('sales.order.close', 'Close sales orders', 'Sales', 'Close a confirmed order by hand when its work is done, with a reason.'),
  ('sales.order.reopen_closed', 'Reopen closed sales orders', 'Sales', 'Reopen an order that was closed by hand, with a reason.')
ON CONFLICT (key) DO NOTHING;

-- Whoever confirms orders closes them; reopening a closed order is for whoever approves orders or manages Sales settings.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.order.close' FROM public.role_permissions existing WHERE existing.permission_key = 'sales.order.confirm'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.order.reopen_closed' FROM public.role_permissions existing WHERE existing.permission_key IN ('sales.order.approve', 'sales.settings.manage')
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0041_order_status_tracking.sql', 'order-status-tracking');
