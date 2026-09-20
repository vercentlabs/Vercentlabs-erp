BEGIN;

-- Sales orders have an `approved` lifecycle state between `pending_approval`
-- and `confirmed`: submitSalesOrder writes it when no approval is required (and
-- approveSalesOrder writes it when an approver signs off), and
-- confirmSalesOrder refuses anything that is not `approved`. The original
-- constraint in 008_sales_module.sql omitted it, so against a real database no
-- order could ever get past submission -- the confirmation path (credit check,
-- holds, amendments, fulfilment and invoice hand-off) was unreachable.
--
-- Widening a CHECK is safe for existing rows: every value already stored is
-- still permitted.
ALTER TABLE tenant.sales_orders DROP CONSTRAINT IF EXISTS sales_orders_lifecycle_status_check;
ALTER TABLE tenant.sales_orders
  ADD CONSTRAINT sales_orders_lifecycle_status_check
  CHECK (lifecycle_status IN ('draft','pending_approval','approved','confirmed','on_hold','cancelled','closed'));

COMMIT;
