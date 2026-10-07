-- Partial Supplier Billing: several ordinary supplier bills against one purchase order, each for what the supplier actually invoiced.
-- No new document: a partial bill is a supplier bill (migration 0049) with its order lines and receipt allocations. This makes the order's
-- billing progress authoritative and adds what partial billing needs:
--
--  * only POSTED bills consume what may be billed. A draft (or a bill awaiting approval) is shown as a warning but never reserves quantity,
--    so two drafts for the last 20 units can exist; the second to post is refused. Receipt allocations count the same way.
--  * amount-based billing of fixed-value services: a bill line bills an amount of the order line's agreed value (billing_basis 'amount');
--    billed_amount on order bill lines records the agreed value each bill consumed (quantity × agreed price for quantity lines).
--  * the basis a bill was matched on (the order's commitment or goods-receipt allocations) and the receipts it was raised from.
--  * receipt allocations in the base unit too, so bills reconcile with receipts across units of measure.

ALTER TABLE tenant.accounting_vendor_bill_lines
  ADD COLUMN IF NOT EXISTS billing_basis text NOT NULL DEFAULT 'quantity',
  ADD COLUMN IF NOT EXISTS billed_amount numeric(24,6);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_vendor_bill_lines_billing_basis_check') THEN
    ALTER TABLE tenant.accounting_vendor_bill_lines ADD CONSTRAINT accounting_vendor_bill_lines_billing_basis_check CHECK (billing_basis IN ('quantity', 'amount'));
  END IF;
END $$;

ALTER TABLE tenant.accounting_vendor_bills
  ADD COLUMN IF NOT EXISTS matching_basis text,
  ADD COLUMN IF NOT EXISTS source_goods_receipt_ids uuid[];
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_vendor_bills_matching_basis_check') THEN
    ALTER TABLE tenant.accounting_vendor_bills ADD CONSTRAINT accounting_vendor_bills_matching_basis_check CHECK (matching_basis IS NULL OR matching_basis IN ('purchase_order', 'goods_receipt'));
  END IF;
END $$;

ALTER TABLE tenant.supplier_bill_receipt_allocations ADD COLUMN IF NOT EXISTS base_quantity numeric(24,10);
UPDATE tenant.supplier_bill_receipt_allocations allocation SET base_quantity = allocation.quantity * COALESCE(line.conversion_factor, 1)
  FROM tenant.purchase_order_lines line
 WHERE line.organization_id = allocation.organization_id AND line.id = allocation.purchase_order_line_id AND allocation.base_quantity IS NULL;

CREATE INDEX IF NOT EXISTS accounting_vendor_bill_lines_po_line_idx ON tenant.accounting_vendor_bill_lines (organization_id, purchase_order_line_id) WHERE purchase_order_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS supplier_bill_receipt_allocations_receipt_line_idx ON tenant.supplier_bill_receipt_allocations (organization_id, goods_receipt_line_id);

CREATE OR REPLACE VIEW tenant.purchase_order_line_progress WITH (security_invoker = true) AS
SELECT line.organization_id, line.purchase_order_id, line.id AS purchase_order_line_id, line.line_number, line.product_type, line.ordered_quantity,
       line.expected_delivery_date,
       COALESCE(received.accepted, 0) AS accepted_quantity, COALESCE(received.held, 0) AS held_quantity, COALESCE(received.rejected, 0) AS rejected_quantity,
       COALESCE(received.draft, 0) AS draft_receipt_quantity,
       COALESCE(returned.quantity, 0) AS returned_quantity, 0::numeric AS returned_for_replacement_quantity,
       COALESCE(cancelled.quantity, 0) AS cancelled_quantity,
       COALESCE(billed.posted, 0) AS billed_quantity, COALESCE(billed.posted, 0) AS posted_billed_quantity, COALESCE(billed.unposted, 0) AS unposted_billed_quantity,
       COALESCE(settings.billing_basis, 'receipt') AS billing_basis,
       COALESCE(received.damaged, 0) AS damaged_quantity,
       COALESCE(held.released, 0) AS released_quantity,
       COALESCE(held.open_inspection, 0) AS open_inspection_quantity,
       COALESCE(held.open_damaged, 0) AS open_damaged_quantity,
       COALESCE(returned.from_stock, 0) AS returned_from_stock_quantity,
       COALESCE(settings.bill_held_goods, false) AS bill_held_goods,
       COALESCE(rejections.refused_at_dock, 0) AS refused_at_dock_quantity,
       COALESCE(rejections.after_custody, 0) AS quality_rejected_quantity,
       COALESCE(rejections.from_stock_open, 0) AS rejected_from_stock_quantity,
       COALESCE(rejections.open_cases, 0) AS open_rejection_cases,
       line.unit_price, COALESCE(billed.posted_amount, 0) AS billed_amount, COALESCE(billed.unposted_amount, 0) AS unposted_billed_amount,
       COALESCE(billed.amount_lines, 0) AS amount_billed_lines
  FROM tenant.purchase_order_lines line
  LEFT JOIN tenant.procurement_settings settings ON settings.organization_id = line.organization_id
  LEFT JOIN LATERAL (
    SELECT sum(receipt_line.accepted_quantity) FILTER (WHERE receipt.status = 'posted' AND receipt.reversed_at IS NULL) AS accepted,
           sum(receipt_line.held_quantity) FILTER (WHERE receipt.status = 'posted' AND receipt.reversed_at IS NULL) AS held,
           sum(receipt_line.damaged_quantity) FILTER (WHERE receipt.status = 'posted' AND receipt.reversed_at IS NULL) AS damaged,
           sum(receipt_line.rejected_quantity) FILTER (WHERE receipt.status = 'posted' AND receipt.reversed_at IS NULL) AS rejected,
           sum(receipt_line.accepted_quantity + receipt_line.held_quantity) FILTER (WHERE receipt.status = 'draft') AS draft
      FROM tenant.goods_receipt_lines receipt_line
      JOIN tenant.goods_receipts receipt ON receipt.organization_id = receipt_line.organization_id AND receipt.id = receipt_line.goods_receipt_id
     WHERE receipt_line.organization_id = line.organization_id AND receipt_line.purchase_order_line_id = line.id) received ON true
  LEFT JOIN LATERAL (
    SELECT sum(disposition.released_quantity) AS released,
           sum(disposition.quantity - disposition.released_quantity - disposition.returned_quantity - disposition.disposed_quantity - disposition.blocked_quantity)
             FILTER (WHERE disposition.disposition = 'inspection_hold') AS open_inspection,
           sum(CASE WHEN disposition.disposition = 'damaged'
                    THEN disposition.quantity - disposition.released_quantity - disposition.returned_quantity - disposition.disposed_quantity
                    ELSE disposition.blocked_quantity END) AS open_damaged
      FROM tenant.goods_receipt_dispositions disposition
      JOIN tenant.goods_receipt_lines receipt_line ON receipt_line.organization_id = disposition.organization_id AND receipt_line.id = disposition.goods_receipt_line_id
      JOIN tenant.goods_receipts receipt ON receipt.organization_id = disposition.organization_id AND receipt.id = disposition.goods_receipt_id
     WHERE disposition.organization_id = line.organization_id AND receipt_line.purchase_order_line_id = line.id AND receipt.reversed_at IS NULL) held ON true
  LEFT JOIN LATERAL (
    SELECT sum(return_line.quantity) AS quantity, sum(return_line.quantity) FILTER (WHERE return_line.disposition_id IS NULL AND NOT return_line.from_hold) AS from_stock
      FROM tenant.purchase_return_lines return_line
     WHERE return_line.organization_id = line.organization_id AND return_line.purchase_order_line_id = line.id) returned ON true
  LEFT JOIN LATERAL (
    SELECT sum(cancellation.quantity) AS quantity FROM tenant.purchase_order_line_cancellations cancellation
     WHERE cancellation.organization_id = line.organization_id AND cancellation.purchase_order_line_id = line.id) cancelled ON true
  LEFT JOIN LATERAL (
    SELECT sum(CASE WHEN bill.bill_type = 'credit_note' THEN -bill_line.quantity ELSE bill_line.quantity END) AS quantity,
           sum(CASE WHEN bill.bill_type = 'credit_note' THEN -bill_line.quantity ELSE bill_line.quantity END)
             FILTER (WHERE bill.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')) AS posted,
           sum(CASE WHEN bill.bill_type = 'credit_note' THEN -bill_line.quantity ELSE bill_line.quantity END)
             FILTER (WHERE bill.status IN ('draft', 'pending_approval', 'approved')) AS unposted,
           sum(CASE WHEN bill.bill_type = 'credit_note' THEN -1 ELSE 1 END * COALESCE(bill_line.billed_amount, round(bill_line.quantity * line.unit_price, 2)))
             FILTER (WHERE bill.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')) AS posted_amount,
           sum(CASE WHEN bill.bill_type = 'credit_note' THEN -1 ELSE 1 END * COALESCE(bill_line.billed_amount, round(bill_line.quantity * line.unit_price, 2)))
             FILTER (WHERE bill.status IN ('draft', 'pending_approval', 'approved')) AS unposted_amount,
           count(*) FILTER (WHERE bill_line.billing_basis = 'amount') AS amount_lines
      FROM tenant.accounting_vendor_bill_lines bill_line
      JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = bill_line.organization_id AND bill.id = bill_line.vendor_bill_id
     WHERE bill_line.organization_id = line.organization_id AND bill_line.purchase_order_line_id = line.id
       AND bill.bill_type IN ('bill', 'credit_note') AND bill.status NOT IN ('cancelled', 'reversed')) billed ON true
  LEFT JOIN LATERAL (
    SELECT sum(rejection.rejected_quantity) FILTER (WHERE rejection.rejection_stage = 'before_custody') AS refused_at_dock,
           sum(rejection.rejected_quantity) FILTER (WHERE rejection.rejection_stage = 'after_custody') AS after_custody,
           sum(rejection.rejected_quantity - rejection.released_quantity - rejection.returned_quantity) FILTER (WHERE rejection.stock_source = 'usable_stock') AS from_stock_open,
           count(*) FILTER (WHERE rejection.status = 'open') AS open_cases
      FROM tenant.receiving_rejections rejection
     WHERE rejection.organization_id = line.organization_id AND rejection.purchase_order_line_id = line.id AND rejection.status <> 'cancelled') rejections ON true;

CREATE OR REPLACE VIEW tenant.purchase_order_line_status WITH (security_invoker = true) AS
SELECT progress.organization_id, progress.purchase_order_id, progress.purchase_order_line_id, progress.line_number, progress.product_type, progress.ordered_quantity,
       progress.expected_delivery_date, progress.accepted_quantity, progress.held_quantity, progress.rejected_quantity, progress.draft_receipt_quantity,
       progress.returned_quantity, progress.returned_for_replacement_quantity, progress.cancelled_quantity, progress.billed_quantity, progress.posted_billed_quantity,
       progress.unposted_billed_quantity, progress.billing_basis,
       progress.product_type <> 'service' AS receipt_required,
       progress.accepted_quantity + progress.held_quantity AS received_quantity,
       CASE WHEN progress.product_type = 'service' THEN 0
            ELSE GREATEST(progress.ordered_quantity - progress.cancelled_quantity - progress.accepted_quantity - progress.held_quantity, 0) END AS remaining_to_receive,
       CASE WHEN progress.product_type = 'service' OR progress.billing_basis = 'order'
              THEN progress.ordered_quantity - progress.cancelled_quantity - progress.returned_quantity
            ELSE progress.accepted_quantity + progress.released_quantity - progress.returned_from_stock_quantity - progress.rejected_from_stock_quantity
                 + CASE WHEN progress.bill_held_goods THEN progress.open_inspection_quantity ELSE 0 END END AS billable_quantity,
       progress.ordered_quantity - progress.cancelled_quantity - progress.returned_quantity AS bill_target_quantity,
       progress.damaged_quantity, progress.released_quantity, progress.open_inspection_quantity, progress.open_damaged_quantity, progress.returned_from_stock_quantity,
       progress.accepted_quantity + progress.held_quantity - progress.returned_quantity AS net_retained_quantity,
       progress.refused_at_dock_quantity, progress.quality_rejected_quantity, progress.rejected_from_stock_quantity, progress.open_rejection_cases,
       progress.unit_price,
       round((progress.ordered_quantity - progress.cancelled_quantity - progress.returned_quantity) * progress.unit_price, 2) AS agreed_amount,
       progress.billed_amount, progress.unposted_billed_amount, progress.amount_billed_lines
  FROM tenant.purchase_order_line_progress progress;
GRANT SELECT ON tenant.purchase_order_line_progress, tenant.purchase_order_line_status TO vercent_app, vercent_worker;

CREATE OR REPLACE VIEW tenant.goods_receipt_line_billing WITH (security_invoker = true) AS
SELECT receipt_line.organization_id, receipt_line.id AS goods_receipt_line_id, receipt_line.goods_receipt_id, receipt_line.purchase_order_line_id, receipt.receipt_number,
       receipt.receipt_date,
       receipt_line.accepted_quantity + COALESCE(held.released, 0) - COALESCE(returned.from_stock, 0) - COALESCE(rejected.from_stock_open, 0)
         + CASE WHEN COALESCE(settings.bill_held_goods, false) THEN COALESCE(held.open_inspection, 0) ELSE 0 END AS billable_quantity,
       COALESCE(allocated.quantity, 0) AS allocated_quantity
  FROM tenant.goods_receipt_lines receipt_line
  JOIN tenant.goods_receipts receipt ON receipt.organization_id = receipt_line.organization_id AND receipt.id = receipt_line.goods_receipt_id
  LEFT JOIN tenant.procurement_settings settings ON settings.organization_id = receipt_line.organization_id
  LEFT JOIN LATERAL (
    SELECT sum(disposition.released_quantity) AS released,
           sum(disposition.quantity - disposition.released_quantity - disposition.returned_quantity - disposition.disposed_quantity - disposition.blocked_quantity)
             FILTER (WHERE disposition.disposition = 'inspection_hold') AS open_inspection
      FROM tenant.goods_receipt_dispositions disposition WHERE disposition.organization_id = receipt_line.organization_id AND disposition.goods_receipt_line_id = receipt_line.id) held ON true
  LEFT JOIN LATERAL (
    SELECT sum(return_line.quantity) FILTER (WHERE return_line.disposition_id IS NULL AND NOT return_line.from_hold) AS from_stock
      FROM tenant.purchase_return_lines return_line WHERE return_line.organization_id = receipt_line.organization_id AND return_line.goods_receipt_line_id = receipt_line.id) returned ON true
  LEFT JOIN LATERAL (
    SELECT sum(rejection.rejected_quantity - rejection.released_quantity - rejection.returned_quantity) AS from_stock_open
      FROM tenant.receiving_rejections rejection
     WHERE rejection.organization_id = receipt_line.organization_id AND rejection.goods_receipt_line_id = receipt_line.id AND rejection.stock_source = 'usable_stock'
       AND rejection.status <> 'cancelled') rejected ON true
  LEFT JOIN LATERAL (
    SELECT sum(allocation.quantity) AS quantity
      FROM tenant.supplier_bill_receipt_allocations allocation
      JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = allocation.organization_id AND bill.id = allocation.vendor_bill_id
     WHERE allocation.organization_id = receipt_line.organization_id AND allocation.goods_receipt_line_id = receipt_line.id
       AND bill.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')) allocated ON true
 WHERE receipt.status = 'posted' AND receipt.reversed_at IS NULL AND receipt_line.product_type <> 'service';
GRANT SELECT ON tenant.goods_receipt_line_billing TO vercent_app, vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0051_partial_supplier_billing.sql', 'partial-supplier-billing');
