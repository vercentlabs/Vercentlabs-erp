-- 3-Way Matching: a supplier bill against its confirmed purchase order AND the goods actually received (or accepted). It extends 2-Way
-- Matching (migration 0052): the same evaluations, line results and exceptions — no new document.
--
--  * every purchase order carries its matching policy, fixed when it is confirmed (from the workspace default) and changed only by an
--    authorised, audited policy change — never by whoever records the bill:
--      three_way_accepted   goods are billed against accepted (or released) received quantities: the default for stock
--      three_way_received   goods are billed against physically received quantities, held goods included
--      two_way              goods may be billed against the order before they arrive (authorised advance invoicing)
--    services are always matched 2-way (no fake receipts).
--  * the billing views read the order's policy instead of the workspace setting.
--  * evaluations and line results record the matching type, the receipt basis and the receipt figures they were checked against.

ALTER TABLE tenant.purchase_orders
  ADD COLUMN IF NOT EXISTS matching_policy text,
  ADD COLUMN IF NOT EXISTS matching_policy_reason text,
  ADD COLUMN IF NOT EXISTS matching_policy_changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS matching_policy_changed_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_matching_policy_check') THEN
    ALTER TABLE tenant.purchase_orders ADD CONSTRAINT purchase_orders_matching_policy_check
      CHECK (matching_policy IS NULL OR matching_policy IN ('three_way_accepted', 'three_way_received', 'two_way'));
  END IF;
END $$;
-- Orders already confirmed keep the policy they have been billed under (the workspace setting today).
UPDATE tenant.purchase_orders po
   SET matching_policy = CASE WHEN COALESCE(settings.billing_basis, 'receipt') = 'order' THEN 'two_way'
                              WHEN COALESCE(settings.bill_held_goods, false) THEN 'three_way_received' ELSE 'three_way_accepted' END
  FROM (SELECT org.id AS organization_id, s.billing_basis, s.bill_held_goods FROM public.organizations org
          LEFT JOIN tenant.procurement_settings s ON s.organization_id = org.id) settings
 WHERE settings.organization_id = po.organization_id AND po.matching_policy IS NULL AND po.status <> 'draft';

-- matching_type (0052) names the matching family (PO-based); match_scope records whether goods receipts were part of the check (3-Way) or
-- not (2-Way), and receipt_eligibility_basis which receipt quantities counted (accepted, or physically received).
ALTER TABLE tenant.supplier_bill_match_evaluations ADD COLUMN IF NOT EXISTS receipt_eligibility_basis text;
ALTER TABLE tenant.supplier_bill_match_evaluations ADD COLUMN IF NOT EXISTS match_scope text NOT NULL DEFAULT 'two_way';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_bill_match_evaluations_match_scope_check') THEN
    ALTER TABLE tenant.supplier_bill_match_evaluations ADD CONSTRAINT supplier_bill_match_evaluations_match_scope_check CHECK (match_scope IN ('two_way', 'three_way'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_bill_match_evaluations_receipt_basis_check') THEN
    ALTER TABLE tenant.supplier_bill_match_evaluations ADD CONSTRAINT supplier_bill_match_evaluations_receipt_basis_check
      CHECK (receipt_eligibility_basis IS NULL OR receipt_eligibility_basis IN ('accepted', 'physical_received'));
  END IF;
END $$;
ALTER TABLE tenant.supplier_bill_match_line_results
  ADD COLUMN IF NOT EXISTS matching_basis text,
  ADD COLUMN IF NOT EXISTS valid_received_quantity numeric(24,10),
  ADD COLUMN IF NOT EXISTS eligible_receipt_quantity numeric(24,10),
  ADD COLUMN IF NOT EXISTS previously_allocated_quantity numeric(24,10),
  ADD COLUMN IF NOT EXISTS currently_eligible_quantity numeric(24,10);

CREATE OR REPLACE VIEW tenant.purchase_order_line_progress WITH (security_invoker = true) AS
SELECT line.organization_id, line.purchase_order_id, line.id AS purchase_order_line_id, line.line_number, line.product_type, line.ordered_quantity,
       line.expected_delivery_date,
       COALESCE(received.accepted, 0) AS accepted_quantity, COALESCE(received.held, 0) AS held_quantity, COALESCE(received.rejected, 0) AS rejected_quantity,
       COALESCE(received.draft, 0) AS draft_receipt_quantity,
       COALESCE(returned.quantity, 0) AS returned_quantity, 0::numeric AS returned_for_replacement_quantity,
       COALESCE(cancelled.quantity, 0) AS cancelled_quantity,
       COALESCE(billed.posted, 0) AS billed_quantity, COALESCE(billed.posted, 0) AS posted_billed_quantity, COALESCE(billed.unposted, 0) AS unposted_billed_quantity,
       CASE po.matching_policy WHEN 'two_way' THEN 'order' WHEN 'three_way_accepted' THEN 'receipt' WHEN 'three_way_received' THEN 'receipt'
         ELSE COALESCE(settings.billing_basis, 'receipt') END AS billing_basis,
       COALESCE(received.damaged, 0) AS damaged_quantity,
       COALESCE(held.released, 0) AS released_quantity,
       COALESCE(held.open_inspection, 0) AS open_inspection_quantity,
       COALESCE(held.open_damaged, 0) AS open_damaged_quantity,
       COALESCE(returned.from_stock, 0) AS returned_from_stock_quantity,
       CASE po.matching_policy WHEN 'three_way_received' THEN true WHEN 'three_way_accepted' THEN false WHEN 'two_way' THEN false
         ELSE COALESCE(settings.bill_held_goods, false) END AS bill_held_goods,
       COALESCE(rejections.refused_at_dock, 0) AS refused_at_dock_quantity,
       COALESCE(rejections.after_custody, 0) AS quality_rejected_quantity,
       COALESCE(rejections.from_stock_open, 0) AS rejected_from_stock_quantity,
       COALESCE(rejections.open_cases, 0) AS open_rejection_cases,
       line.unit_price, COALESCE(billed.posted_amount, 0) AS billed_amount, COALESCE(billed.unposted_amount, 0) AS unposted_billed_amount,
       COALESCE(billed.amount_lines, 0) AS amount_billed_lines
  FROM tenant.purchase_order_lines line
  JOIN tenant.purchase_orders po ON po.organization_id = line.organization_id AND po.id = line.purchase_order_id
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
GRANT SELECT ON tenant.purchase_order_line_progress, tenant.purchase_order_line_status TO vercent_app, vercent_worker;

CREATE OR REPLACE VIEW tenant.goods_receipt_line_billing WITH (security_invoker = true) AS
SELECT receipt_line.organization_id, receipt_line.id AS goods_receipt_line_id, receipt_line.goods_receipt_id, receipt_line.purchase_order_line_id, receipt.receipt_number,
       receipt.receipt_date,
       receipt_line.accepted_quantity + COALESCE(held.released, 0) - COALESCE(returned.from_stock, 0) - COALESCE(rejected.from_stock_open, 0)
         + CASE WHEN CASE po.matching_policy WHEN 'three_way_received' THEN true WHEN 'three_way_accepted' THEN false WHEN 'two_way' THEN false
         ELSE COALESCE(settings.bill_held_goods, false) END THEN COALESCE(held.open_inspection, 0) ELSE 0 END AS billable_quantity,
       COALESCE(allocated.quantity, 0) AS allocated_quantity
  FROM tenant.goods_receipt_lines receipt_line
  JOIN tenant.goods_receipts receipt ON receipt.organization_id = receipt_line.organization_id AND receipt.id = receipt_line.goods_receipt_id
  JOIN tenant.purchase_orders po ON po.organization_id = receipt.organization_id AND po.id = receipt.purchase_order_id
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

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0053_three_way_matching.sql', 'three-way-matching');
