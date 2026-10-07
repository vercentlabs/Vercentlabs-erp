-- Rejected Receipts: goods that cannot be accepted, recorded as a lightweight
-- rejection case (RJR-…) that links to the authoritative documents — the
-- purchase order line, the goods receipt line, Quality's inspection, the
-- purchase return, the order's cancellation — and is resolved by them.
--
--  * before custody: refused at the dock. No stock, never counts as received;
--    the order still owes the quantity until a replacement arrives or the
--    outstanding quantity is cancelled. A whole shipment may be refused
--    without any goods receipt.
--  * after custody: received (the posted receipt stays as it is) and then
--    rejected — damaged at receipt, failed inspection, or found unusable in
--    stock. The goods sit blocked in the warehouse's quality location until
--    they are returned, disposed of, or (exceptionally) accepted.
--
-- A case never moves stock or posts accounting by itself: Inventory,
-- Quality, Purchase Returns and Accounts Payable keep their own effects.
--
-- Held goods (goods_receipt_dispositions) now distinguish what Quality has
-- rejected (blocked_quantity, until it is returned, disposed of or accepted)
-- and what was disposed of; only the undecided rest is released or returned
-- directly. Damaged dispositions recorded before this migration have no case
-- and keep that direct handling.

CREATE TABLE IF NOT EXISTS tenant.receiving_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rejection_number text NOT NULL,
  purchase_order_id uuid NOT NULL,
  purchase_order_line_id uuid NOT NULL,
  goods_receipt_id uuid,
  goods_receipt_line_id uuid,
  disposition_id uuid,
  supplier_id uuid NOT NULL,
  warehouse_id uuid REFERENCES tenant.warehouses(id),
  location_id uuid REFERENCES tenant.warehouse_locations(id),
  source_location_id uuid REFERENCES tenant.warehouse_locations(id),
  product_id uuid REFERENCES tenant.items(id),
  product_type text NOT NULL,
  product_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  description_snapshot text NOT NULL,
  rejection_stage text NOT NULL CHECK (rejection_stage IN ('before_custody', 'after_custody')),
  stock_source text NOT NULL CHECK (stock_source IN ('dock', 'inspection_hold', 'damaged_at_receipt', 'usable_stock')),
  rejection_reason text NOT NULL CHECK (rejection_reason IN ('damaged_goods', 'defective_product', 'wrong_product', 'wrong_specification', 'poor_quality', 'expired_product',
    'incorrect_quantity', 'packaging_damage', 'missing_documentation', 'failed_inspection', 'other')),
  reason_tags text[] NOT NULL DEFAULT '{}',
  presented_quantity numeric(20,6) CHECK (presented_quantity IS NULL OR presented_quantity > 0),
  rejected_quantity numeric(20,6) NOT NULL CHECK (rejected_quantity > 0),
  uom_id uuid REFERENCES tenant.units_of_measure(id),
  uom_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  conversion_factor numeric(20,6) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  base_quantity numeric(20,6) NOT NULL CHECK (base_quantity > 0),
  batch_id uuid REFERENCES tenant.stock_batches(id),
  batch_number text,
  expiry_date date,
  serial_numbers text[] NOT NULL DEFAULT '{}',
  delivered_product_description text,
  description text,
  quality_inspection_id uuid REFERENCES tenant.quality_inspections(id),
  expected_resolution text CHECK (expected_resolution IN ('replacement_expected', 'cancel_outstanding', 'purchase_return', 'disposal', 'quality_review', 'close_refusal')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'cancelled')),
  resolved_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (resolved_quantity >= 0),
  returned_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  released_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (released_quantity >= 0),
  disposed_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (disposed_quantity >= 0),
  resolution_type text,
  resolution_notes text,
  stock_movement_ids uuid[] NOT NULL DEFAULT '{}',
  evidence_file_ids uuid[] NOT NULL DEFAULT '{}',
  source_key text,
  observed_at timestamptz NOT NULL,
  reported_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason text,
  UNIQUE (organization_id, rejection_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, purchase_order_id) REFERENCES tenant.purchase_orders(organization_id, id),
  FOREIGN KEY (organization_id, purchase_order_line_id) REFERENCES tenant.purchase_order_lines(organization_id, id),
  FOREIGN KEY (organization_id, goods_receipt_id) REFERENCES tenant.goods_receipts(organization_id, id),
  FOREIGN KEY (organization_id, goods_receipt_line_id) REFERENCES tenant.goods_receipt_lines(organization_id, id),
  FOREIGN KEY (organization_id, disposition_id) REFERENCES tenant.goods_receipt_dispositions(organization_id, id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES tenant.procurement_suppliers(organization_id, id),
  -- Goods taken into custody always come from a posted receipt line; refused goods never moved stock.
  CHECK (rejection_stage = 'before_custody' OR (goods_receipt_line_id IS NOT NULL AND stock_source <> 'dock')),
  CHECK (rejection_stage = 'after_custody' OR (stock_source = 'dock' AND disposition_id IS NULL AND returned_quantity = 0 AND released_quantity = 0 AND disposed_quantity = 0)),
  CHECK (returned_quantity + released_quantity + disposed_quantity <= rejected_quantity),
  CHECK (resolved_quantity <= rejected_quantity),
  CHECK (presented_quantity IS NULL OR rejected_quantity <= presented_quantity),
  CHECK (rejection_reason <> 'other' OR length(coalesce(description, '')) >= 3),
  CHECK (status <> 'resolved' OR (resolved_at IS NOT NULL AND resolved_quantity = rejected_quantity)),
  CHECK (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS receiving_rejections_source_key_idx ON tenant.receiving_rejections (organization_id, source_key) WHERE source_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS receiving_rejections_order_idx ON tenant.receiving_rejections (organization_id, purchase_order_id, purchase_order_line_id);
CREATE INDEX IF NOT EXISTS receiving_rejections_receipt_idx ON tenant.receiving_rejections (organization_id, goods_receipt_id);
CREATE INDEX IF NOT EXISTS receiving_rejections_status_idx ON tenant.receiving_rejections (organization_id, status, observed_at DESC);
CREATE INDEX IF NOT EXISTS receiving_rejections_inspection_idx ON tenant.receiving_rejections (organization_id, quality_inspection_id);

-- Each documented outcome (a case may be resolved in parts), pointing at the document that completed it.
CREATE TABLE IF NOT EXISTS tenant.receiving_rejection_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receiving_rejection_id uuid NOT NULL,
  resolution_type text NOT NULL CHECK (resolution_type IN ('replacement_received', 'outstanding_qty_cancelled', 'quality_accepted', 'purchase_return_posted', 'authorized_disposal',
    'refusal_closed')),
  quantity_resolved numeric(20,6) NOT NULL CHECK (quantity_resolved > 0),
  related_document_type text,
  related_document_id uuid,
  resolution_notes text NOT NULL,
  stock_movement_ids uuid[] NOT NULL DEFAULT '{}',
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, receiving_rejection_id) REFERENCES tenant.receiving_rejections(organization_id, id)
);
CREATE INDEX IF NOT EXISTS receiving_rejection_resolutions_case_idx ON tenant.receiving_rejection_resolutions (organization_id, receiving_rejection_id);
CREATE INDEX IF NOT EXISTS receiving_rejection_resolutions_document_idx ON tenant.receiving_rejection_resolutions (organization_id, related_document_type, related_document_id);

CREATE TABLE IF NOT EXISTS tenant.receiving_rejection_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receiving_rejection_id uuid NOT NULL,
  event_type text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, receiving_rejection_id) REFERENCES tenant.receiving_rejections(organization_id, id)
);
CREATE INDEX IF NOT EXISTS receiving_rejection_events_case_idx ON tenant.receiving_rejection_events (organization_id, receiving_rejection_id, occurred_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['receiving_rejections', 'receiving_rejection_resolutions', 'receiving_rejection_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', t);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', t);
  END LOOP;
END $$;

-- Held goods: what Quality rejected (blocked until returned, disposed of or accepted) and what was disposed of.
ALTER TABLE tenant.goods_receipt_dispositions ADD COLUMN IF NOT EXISTS blocked_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (blocked_quantity >= 0);
ALTER TABLE tenant.goods_receipt_dispositions ADD COLUMN IF NOT EXISTS disposed_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (disposed_quantity >= 0);
ALTER TABLE tenant.goods_receipt_dispositions ADD CONSTRAINT goods_receipt_dispositions_accounted_check
  CHECK (released_quantity + returned_quantity + disposed_quantity + blocked_quantity <= quantity);

-- At the dock: how many units were presented, and the structured reason for refusing.
ALTER TABLE tenant.goods_receipt_lines ADD COLUMN IF NOT EXISTS presented_quantity numeric(20,6) CHECK (presented_quantity IS NULL OR presented_quantity > 0);
ALTER TABLE tenant.goods_receipt_lines ADD COLUMN IF NOT EXISTS refusal_reason_code text CHECK (refusal_reason_code IS NULL OR refusal_reason_code IN ('damaged_goods', 'defective_product',
  'wrong_product', 'wrong_specification', 'poor_quality', 'expired_product', 'incorrect_quantity', 'packaging_damage', 'missing_documentation', 'failed_inspection', 'other'));
ALTER TABLE tenant.goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_presented_check
  CHECK (presented_quantity IS NULL OR accepted_quantity + held_quantity + rejected_quantity = presented_quantity);

-- Lineage: the return and the cancellation that resolved a case.
ALTER TABLE tenant.purchase_return_lines ADD COLUMN IF NOT EXISTS receiving_rejection_id uuid;
ALTER TABLE tenant.purchase_return_lines ADD CONSTRAINT purchase_return_lines_rejection_fk
  FOREIGN KEY (organization_id, receiving_rejection_id) REFERENCES tenant.receiving_rejections(organization_id, id);
ALTER TABLE tenant.purchase_order_line_cancellations ADD COLUMN IF NOT EXISTS receiving_rejection_id uuid;
ALTER TABLE tenant.purchase_order_line_cancellations ADD CONSTRAINT purchase_order_line_cancellations_rejection_fk
  FOREIGN KEY (organization_id, receiving_rejection_id) REFERENCES tenant.receiving_rejections(organization_id, id);

-- ---------------------------------------------------------------- views
-- Progress now knows rejections: what was refused at the dock (never received), what was rejected after custody, what of the
-- usable stock was rejected and is still out of use, and how many cases are open. Held goods: undecided inspection hold, and
-- everything blocked (damaged, or rejected by Quality). Remaining to receive is unchanged: ordered − cancelled − received.
CREATE OR REPLACE VIEW tenant.purchase_order_line_progress WITH (security_invoker = true) AS
SELECT line.organization_id, line.purchase_order_id, line.id AS purchase_order_line_id, line.line_number, line.product_type, line.ordered_quantity,
       line.expected_delivery_date,
       COALESCE(received.accepted, 0) AS accepted_quantity, COALESCE(received.held, 0) AS held_quantity, COALESCE(received.rejected, 0) AS rejected_quantity,
       COALESCE(received.draft, 0) AS draft_receipt_quantity,
       COALESCE(returned.quantity, 0) AS returned_quantity, 0::numeric AS returned_for_replacement_quantity,
       COALESCE(cancelled.quantity, 0) AS cancelled_quantity,
       COALESCE(billed.quantity, 0) AS billed_quantity, COALESCE(billed.posted, 0) AS posted_billed_quantity, COALESCE(billed.unposted, 0) AS unposted_billed_quantity,
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
       COALESCE(rejections.open_cases, 0) AS open_rejection_cases
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
             FILTER (WHERE bill.status IN ('draft', 'pending_approval', 'approved')) AS unposted
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

-- Billable under receipt-based billing no longer counts usable stock that was later rejected (until it is accepted back).
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
       progress.refused_at_dock_quantity, progress.quality_rejected_quantity, progress.rejected_from_stock_quantity, progress.open_rejection_cases
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
     WHERE allocation.organization_id = receipt_line.organization_id AND allocation.goods_receipt_line_id = receipt_line.id AND bill.status NOT IN ('cancelled', 'reversed')) allocated ON true
 WHERE receipt.status = 'posted' AND receipt.reversed_at IS NULL AND receipt_line.product_type <> 'service';
GRANT SELECT ON tenant.goods_receipt_line_billing TO vercent_app, vercent_worker;

-- ---------------------------------------------------------------- permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('procurement.rejections.view', 'View receiving rejections', 'Procurement', 'See rejection cases on the purchase orders you see, with their evidence.'),
  ('procurement.rejections.view_all', 'View all receiving rejections', 'Procurement', 'See every rejection case in the workspace.'),
  ('procurement.rejections.record', 'Record receiving rejections', 'Procurement', 'Record goods refused at the dock, and damage found in received stock.'),
  ('procurement.rejections.edit', 'Edit open rejections', 'Procurement', 'Correct the reason, notes and expected resolution of an open rejection case.'),
  ('procurement.rejections.cancel', 'Cancel invalid rejections', 'Procurement', 'Cancel a rejection case recorded in error or twice.'),
  ('procurement.rejections.quality', 'Record quality rejections', 'Procurement', 'Reject held or received goods after inspection, blocking them from use.'),
  ('procurement.rejections.resolve', 'Resolve rejections', 'Procurement', 'Record how a rejection was resolved: replacement received, refusal closed, quantity cancelled.'),
  ('procurement.rejections.override', 'Accept previously rejected goods', 'Procurement', 'Exceptionally accept rejected goods back into usable stock, with a reason.'),
  ('procurement.rejections.dispose', 'Dispose of rejected goods', 'Procurement', 'Write off rejected goods that cannot be returned, with evidence.'),
  ('procurement.rejections.financial', 'View rejection financial links', 'Procurement', 'See the supplier bills and billing mismatches behind rejected goods.')
ON CONFLICT (key) DO NOTHING;
-- Seen by whoever sees procurement, Accounts Payable and Quality; recorded and corrected by whoever records receipts; quality rejections by whoever
-- inspects; cancelled, resolved, accepted back and disposed of by whoever approves receipts (buyers resolve replacements and refusals too);
-- disposal also by whoever adjusts stock; financial links by Accounts Payable and whoever sees what suppliers are owed.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, granted.key FROM public.role_permissions existing
  JOIN (VALUES
    ('procurement.view', 'procurement.rejections.view'), ('accounting.payables.manage', 'procurement.rejections.view'), ('quality.inspect', 'procurement.rejections.view'),
    ('procurement.view', 'procurement.rejections.view_all'), ('accounting.payables.manage', 'procurement.rejections.view_all'), ('quality.inspect', 'procurement.rejections.view_all'),
    ('procurement.receipts.manage', 'procurement.rejections.record'), ('procurement.receipts.manage', 'procurement.rejections.edit'),
    ('procurement.receipts.approve', 'procurement.rejections.cancel'),
    ('procurement.inspection.manage', 'procurement.rejections.quality'), ('quality.inspect', 'procurement.rejections.quality'),
    ('procurement.receipts.manage', 'procurement.rejections.resolve'), ('procurement.receipts.approve', 'procurement.rejections.resolve'),
    ('procurement.po.manage', 'procurement.rejections.resolve'),
    ('procurement.receipts.approve', 'procurement.rejections.override'), ('quality.release', 'procurement.rejections.override'),
    ('procurement.receipts.approve', 'procurement.rejections.dispose'), ('stock.adjust', 'procurement.rejections.dispose'),
    ('accounting.payables.manage', 'procurement.rejections.financial'), ('procurement.suppliers.payables.view', 'procurement.rejections.financial')
  ) AS granted(source, key) ON granted.source = existing.permission_key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0048_rejected_receipts.sql', 'rejected-receipts');
