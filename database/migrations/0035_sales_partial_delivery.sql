-- Partial delivery.
--
-- A sales order's fulfilment status is about delivery only: Not delivered,
-- Partially delivered or Delivered (Not required for an order of services),
-- worked out from its dispatched deliveries and cancelled quantities.
-- Reservation has its own status. Orders whose fulfilment status still
-- records a reservation stage (nothing has been delivered on them) read
-- Not delivered.

UPDATE tenant.sales_orders
   SET fulfillment_status = 'not_started', updated_at = now()
 WHERE fulfillment_status IN ('allocated', 'partially_allocated');

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0035_sales_partial_delivery.sql', 'sales-partial-delivery');
