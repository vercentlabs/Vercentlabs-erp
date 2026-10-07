-- Purchase Returns: a separate document for goods sent back to the supplier after they were received — damaged, defective, failed
-- inspection, wrong, expired, surplus. It now has a real lifecycle and its own supplier, financial and replacement tracking:
--
--  * document_status: draft (editable, no stock or financial effect) → posted (the goods physically left: Inventory's outbound movement,
--    GRNI cleared when receipts accrue) · cancelled (a draft) · reversed (the goods came back: an inbound correction). The 0045 column
--    "status" can only hold 'posted'; it stays as it is and document_status is the lifecycle.
--  * header: the buying company, returning warehouse, supplier return-to address, expected resolution (credit, refund, replacement), the
--    supplier's RMA, carrier / tracking / challan references, the supplier's acknowledgement, dispatch, posting, cancellation and reversal.
--  * lines: a structured reason each, product and unit snapshots, base quantity, the source location, the expected credit value.
--  * resolutions: what the supplier actually did — credit, refund, replacement received, other.
--  * financial allocations: each returned quantity against what was billed or not, and the debit notes that corrected it — never twice.
--  * only POSTED returns count in the order and receipt quantities.

ALTER TABLE tenant.purchase_returns
  ADD COLUMN IF NOT EXISTS document_status text NOT NULL DEFAULT 'posted',
  ADD COLUMN IF NOT EXISTS buying_registration_id uuid,
  ADD COLUMN IF NOT EXISTS warehouse_id uuid,
  ADD COLUMN IF NOT EXISTS supplier_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS return_to_address_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS expected_resolution text,
  ADD COLUMN IF NOT EXISTS supplier_rma_reference text,
  ADD COLUMN IF NOT EXISTS carrier_reference text,
  ADD COLUMN IF NOT EXISTS tracking_reference text,
  ADD COLUMN IF NOT EXISTS dispatch_reference text,
  ADD COLUMN IF NOT EXISTS supplier_acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS supplier_acknowledgement_reference text,
  ADD COLUMN IF NOT EXISTS supplier_acknowledged_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS posted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS accrual_journal_entry_id uuid,
  ADD COLUMN IF NOT EXISTS replacement_no_charge boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_returns_document_status_check') THEN
    ALTER TABLE tenant.purchase_returns ADD CONSTRAINT purchase_returns_document_status_check CHECK (document_status IN ('draft', 'posted', 'cancelled', 'reversed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_returns_expected_resolution_check') THEN
    ALTER TABLE tenant.purchase_returns ADD CONSTRAINT purchase_returns_expected_resolution_check
      CHECK (expected_resolution IS NULL OR expected_resolution IN ('supplier_credit', 'supplier_refund', 'replacement', 'no_resolution'));
  END IF;
END $$;
-- Returns recorded before: posted at their creation, by their creator, expecting a credit (or the replacement drafted with them).
UPDATE tenant.purchase_returns SET posted_at = COALESCE(posted_at, created_at), posted_by = COALESCE(posted_by, created_by), dispatched_at = COALESCE(dispatched_at, created_at),
       expected_resolution = COALESCE(expected_resolution, CASE WHEN replacement_purchase_order_id IS NOT NULL THEN 'replacement' ELSE 'supplier_credit' END)
 WHERE document_status = 'posted' AND posted_at IS NULL;

ALTER TABLE tenant.purchase_return_lines
  ADD COLUMN IF NOT EXISTS line_number integer,
  ADD COLUMN IF NOT EXISTS return_reason text,
  ADD COLUMN IF NOT EXISTS reason_notes text,
  ADD COLUMN IF NOT EXISTS product_id uuid,
  ADD COLUMN IF NOT EXISTS product_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS uom_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS conversion_factor numeric(24,10),
  ADD COLUMN IF NOT EXISTS base_quantity numeric(24,10),
  ADD COLUMN IF NOT EXISTS warehouse_location_id uuid,
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS stock_disposition text,
  ADD COLUMN IF NOT EXISTS expected_credit_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS billing_allocation text,
  ADD COLUMN IF NOT EXISTS notes text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_return_lines_reason_check') THEN
    ALTER TABLE tenant.purchase_return_lines ADD CONSTRAINT purchase_return_lines_reason_check CHECK (return_reason IS NULL OR return_reason IN ('damaged_goods', 'defective_product',
      'failed_quality_inspection', 'wrong_product', 'wrong_specification', 'expired_goods', 'near_expiry', 'incorrect_variant', 'excess_goods', 'supplier_recall', 'surplus_goods', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_return_lines_billing_allocation_check') THEN
    ALTER TABLE tenant.purchase_return_lines ADD CONSTRAINT purchase_return_lines_billing_allocation_check CHECK (billing_allocation IS NULL OR billing_allocation IN ('auto', 'unbilled', 'billed'));
  END IF;
END $$;

-- What the supplier actually did about a return (a promise is not a resolution).
CREATE TABLE IF NOT EXISTS tenant.purchase_return_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_return_id uuid NOT NULL,
  purchase_return_line_id uuid,
  resolution_type text NOT NULL CHECK (resolution_type IN ('supplier_credit', 'supplier_refund', 'replacement_received', 'other_authorized_resolution')),
  resolved_quantity numeric(24,10),
  amount numeric(24,6),
  related_document_type text,
  related_document_id uuid,
  reference text,
  notes text,
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, purchase_return_id) REFERENCES tenant.purchase_returns(organization_id, id)
);
CREATE INDEX IF NOT EXISTS purchase_return_resolutions_return_idx ON tenant.purchase_return_resolutions (organization_id, purchase_return_id);

-- Each returned quantity against billing: what was not billed yet, what posted bills had billed (and must be corrected), and the debit
-- notes that corrected it. The same returned quantity is never credited twice.
CREATE TABLE IF NOT EXISTS tenant.purchase_return_financial_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_return_id uuid NOT NULL,
  purchase_return_line_id uuid NOT NULL,
  allocation_type text NOT NULL CHECK (allocation_type IN ('unbilled', 'billed', 'debit_note')),
  supplier_bill_id uuid,
  supplier_bill_line_id uuid,
  debit_note_id uuid,
  debit_note_line_id uuid,
  allocated_quantity numeric(24,10) NOT NULL CHECK (allocated_quantity > 0),
  allocated_value numeric(24,6),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, purchase_return_id) REFERENCES tenant.purchase_returns(organization_id, id)
);
CREATE INDEX IF NOT EXISTS purchase_return_financial_allocations_return_idx ON tenant.purchase_return_financial_allocations (organization_id, purchase_return_id);
CREATE INDEX IF NOT EXISTS purchase_return_financial_allocations_bill_line_idx ON tenant.purchase_return_financial_allocations (organization_id, supplier_bill_line_id);

-- The return's own activity: created, edited, posted, acknowledged, resolutions, financial corrections, replacement, reversal.
CREATE TABLE IF NOT EXISTS tenant.purchase_return_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_return_id uuid NOT NULL,
  event_type text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, purchase_return_id) REFERENCES tenant.purchase_returns(organization_id, id)
);
CREATE INDEX IF NOT EXISTS purchase_return_events_return_idx ON tenant.purchase_return_events (organization_id, purchase_return_id, occurred_at);

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['purchase_return_resolutions', 'purchase_return_financial_allocations', 'purchase_return_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', name);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;

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
     WHERE return_line.organization_id = line.organization_id AND return_line.purchase_order_line_id = line.id
       AND EXISTS (SELECT 1 FROM tenant.purchase_returns posted_return WHERE posted_return.organization_id = return_line.organization_id
         AND posted_return.id = return_line.purchase_return_id AND posted_return.document_status = 'posted')) returned ON true
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
      FROM tenant.purchase_return_lines return_line WHERE return_line.organization_id = receipt_line.organization_id AND return_line.goods_receipt_line_id = receipt_line.id
       AND EXISTS (SELECT 1 FROM tenant.purchase_returns posted_return WHERE posted_return.organization_id = return_line.organization_id
         AND posted_return.id = return_line.purchase_return_id AND posted_return.document_status = 'posted')) returned ON true
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

-- ---------------------------------------------------------------- permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('procurement.returns.view', 'View purchase returns', 'Procurement', 'See purchase returns, their items, stock movements, resolution and financial status.'),
  ('procurement.returns.post', 'Post purchase returns', 'Procurement', 'Confirm that returned goods physically left: posts the stock movement.'),
  ('procurement.returns.reverse', 'Reverse purchase returns', 'Procurement', 'Reverse a posted return when the goods physically came back.'),
  ('procurement.returns.commercial', 'Approve commercial returns', 'Procurement', 'Return good stock for commercial reasons (excess, surplus) the supplier agreed to take back.'),
  ('procurement.returns.resolve', 'Record purchase return resolutions', 'Procurement', 'Record the supplier''s acknowledgement, credits, refunds and replacements of a return.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, granted.key FROM public.role_permissions existing
  JOIN (VALUES
    ('procurement.po.view', 'procurement.returns.view'), ('procurement.po.view_all', 'procurement.returns.view'), ('accounting.payables.manage', 'procurement.returns.view'),
    ('procurement.returns.manage', 'procurement.returns.post'), ('procurement.returns.manage', 'procurement.returns.resolve'),
    ('procurement.po.approve', 'procurement.returns.reverse'), ('procurement.po.approve', 'procurement.returns.commercial'),
    ('accounting.payables.manage', 'procurement.returns.resolve'), ('procurement.po.manage', 'procurement.returns.resolve')
  ) AS granted(source, key) ON granted.source = existing.permission_key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0054_purchase_returns.sql', 'purchase-returns');
