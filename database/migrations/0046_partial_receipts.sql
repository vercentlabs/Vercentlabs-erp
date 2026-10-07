-- Partial Receipts: receiving a purchase order in batches, through the
-- Goods Receipt already in place (no separate document).
--
-- Each receipt line records what was taken into custody — accepted (usable
-- stock), or held (inspection hold, or kept but damaged; in the warehouse's
-- quality location, never available) — and what was refused at the door
-- (rejected_quantity: never in custody, never stock). Held goods have a
-- disposition that is released to stock or returned later; the receipt
-- itself is never posted again.
--
-- A posted receipt is corrected only by an authorised reversal, which takes
-- the stock back out. The status check of goods_receipts cannot be widened
-- (a constraint cannot be dropped here), so a reversed receipt keeps status
-- 'posted' with reversed_at set; the screens show it as Reversed and nothing
-- counts it.
--
-- A purchase return never reopens what may be received: a replacement is a
-- new purchase order linked to the return. purchase_returns.replacement_expected
-- is no longer used and stays false.
--
-- Bills under receipt-based billing allocate their quantity to the receipt
-- lines they bill, so one received quantity is never billed twice.

-- --------------------------------------------------------------- goods receipts
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES tenant.warehouses(id);
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS supplier_challan_date date;
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS buying_registration_snapshot jsonb;
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS reversal_reason text;
ALTER TABLE tenant.goods_receipts ADD CONSTRAINT goods_receipts_reversal_check CHECK (reversed_at IS NULL OR (status = 'posted' AND reversed_by IS NOT NULL));
COMMENT ON COLUMN tenant.goods_receipts.supplier_delivery_note IS 'The supplier''s delivery challan number.';

-- held_quantity: taken into blocked custody (inspection hold + damaged); damaged_quantity is the damaged part of it.
ALTER TABLE tenant.goods_receipt_lines ADD COLUMN IF NOT EXISTS damaged_quantity numeric(20,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_damaged_check CHECK (damaged_quantity >= 0 AND damaged_quantity <= held_quantity);
ALTER TABLE tenant.goods_receipt_lines ADD COLUMN IF NOT EXISTS product_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tenant.goods_receipt_lines ADD COLUMN IF NOT EXISTS receipt_uom_id uuid REFERENCES tenant.units_of_measure(id);
ALTER TABLE tenant.goods_receipt_lines ADD COLUMN IF NOT EXISTS base_quantity numeric(20,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.goods_receipt_lines ADD COLUMN IF NOT EXISTS discrepancy_notes text;
COMMENT ON COLUMN tenant.goods_receipt_lines.rejected_quantity IS 'Refused at delivery: never taken into custody, never stock.';
COMMENT ON COLUMN tenant.goods_receipt_lines.held_quantity IS 'Taken into blocked custody (inspection hold plus damaged); damaged_quantity is the damaged part.';

-- What became of goods held at receipt: released to usable stock, or returned to the supplier.
CREATE TABLE IF NOT EXISTS tenant.goods_receipt_dispositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  goods_receipt_id uuid NOT NULL,
  goods_receipt_line_id uuid NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('inspection_hold', 'damaged')),
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  released_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (released_quantity >= 0),
  returned_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  location_id uuid REFERENCES tenant.warehouse_locations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, goods_receipt_line_id, disposition),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, goods_receipt_id) REFERENCES tenant.goods_receipts(organization_id, id),
  FOREIGN KEY (organization_id, goods_receipt_line_id) REFERENCES tenant.goods_receipt_lines(organization_id, id),
  CHECK (released_quantity + returned_quantity <= quantity)
);
CREATE TABLE IF NOT EXISTS tenant.goods_receipt_disposition_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  disposition_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('released', 'returned')),
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  stock_movement_ids uuid[] NOT NULL DEFAULT '{}',
  note text,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, disposition_id) REFERENCES tenant.goods_receipt_dispositions(organization_id, id)
);

-- Shortages, damage, wrong items, refusals: what the supplier is told about a delivery.
CREATE TABLE IF NOT EXISTS tenant.goods_receipt_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  goods_receipt_id uuid NOT NULL,
  goods_receipt_line_id uuid,
  discrepancy_type text NOT NULL CHECK (discrepancy_type IN ('short_delivery', 'damaged', 'wrong_item', 'refused', 'excess', 'other')),
  quantity numeric(20,6) CHECK (quantity IS NULL OR quantity > 0),
  notes text NOT NULL,
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, goods_receipt_id) REFERENCES tenant.goods_receipts(organization_id, id),
  FOREIGN KEY (organization_id, goods_receipt_line_id) REFERENCES tenant.goods_receipt_lines(organization_id, id)
);
CREATE INDEX IF NOT EXISTS goods_receipt_discrepancies_receipt_idx ON tenant.goods_receipt_discrepancies (organization_id, goods_receipt_id);

CREATE TABLE IF NOT EXISTS tenant.goods_receipt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  goods_receipt_id uuid NOT NULL,
  event_type text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, goods_receipt_id) REFERENCES tenant.goods_receipts(organization_id, id)
);
CREATE INDEX IF NOT EXISTS goods_receipt_events_receipt_idx ON tenant.goods_receipt_events (organization_id, goods_receipt_id, occurred_at DESC);

-- ------------------------------------------------------------ returns
ALTER TABLE tenant.purchase_return_lines ADD COLUMN IF NOT EXISTS disposition_id uuid;
ALTER TABLE tenant.purchase_return_lines ADD CONSTRAINT purchase_return_lines_disposition_fk
  FOREIGN KEY (organization_id, disposition_id) REFERENCES tenant.goods_receipt_dispositions(organization_id, id);
ALTER TABLE tenant.purchase_returns ADD COLUMN IF NOT EXISTS replacement_purchase_order_id uuid;
ALTER TABLE tenant.purchase_returns ADD CONSTRAINT purchase_returns_replacement_po_fk
  FOREIGN KEY (organization_id, replacement_purchase_order_id) REFERENCES tenant.purchase_orders(organization_id, id);
UPDATE tenant.purchase_returns SET replacement_expected = false WHERE replacement_expected;
COMMENT ON COLUMN tenant.purchase_returns.replacement_expected IS 'Not used: a replacement is the linked replacement_purchase_order_id.';

-- --------------------------------------------- bills allocated to receipt lines
CREATE TABLE IF NOT EXISTS tenant.supplier_bill_receipt_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_bill_id uuid NOT NULL,
  vendor_bill_line_id uuid NOT NULL REFERENCES tenant.accounting_vendor_bill_lines(id) ON DELETE CASCADE,
  purchase_order_line_id uuid NOT NULL,
  goods_receipt_line_id uuid NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, vendor_bill_id) REFERENCES tenant.accounting_vendor_bills(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, purchase_order_line_id) REFERENCES tenant.purchase_order_lines(organization_id, id),
  FOREIGN KEY (organization_id, goods_receipt_line_id) REFERENCES tenant.goods_receipt_lines(organization_id, id)
);
CREATE INDEX IF NOT EXISTS supplier_bill_receipt_allocations_receipt_idx ON tenant.supplier_bill_receipt_allocations (organization_id, goods_receipt_line_id);

-- ------------------------------------------------------------- settings and access
-- bill_held_goods: under receipt-based billing, may goods still on inspection hold be billed? (default: no, only once released).
ALTER TABLE tenant.procurement_settings ADD COLUMN IF NOT EXISTS bill_held_goods boolean NOT NULL DEFAULT false;
-- Who may receive into a warehouse. A warehouse with no one listed may be received into by anyone allowed to receive.
CREATE TABLE IF NOT EXISTS tenant.warehouse_receiving_users (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, warehouse_id, user_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['goods_receipt_dispositions', 'goods_receipt_disposition_events', 'goods_receipt_discrepancies', 'goods_receipt_events',
    'supplier_bill_receipt_allocations', 'warehouse_receiving_users'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', t);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------------ progress
-- Received: accepted + held, from posted receipts that were not reversed. Returns are a physical summary beside it: they
-- never reduce what was received nor reopen what may be received. returned_for_replacement_quantity is kept for the column
-- order and is always 0. Billable under receipt basis: usable stock (accepted, plus held goods released) net of goods returned
-- from it, plus goods still on inspection hold when the settings allow billing them.
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
       COALESCE(settings.bill_held_goods, false) AS bill_held_goods
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
           sum(disposition.quantity - disposition.released_quantity - disposition.returned_quantity) FILTER (WHERE disposition.disposition = 'inspection_hold') AS open_inspection,
           sum(disposition.quantity - disposition.released_quantity - disposition.returned_quantity) FILTER (WHERE disposition.disposition = 'damaged') AS open_damaged
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
       AND bill.bill_type IN ('bill', 'credit_note') AND bill.status NOT IN ('cancelled', 'reversed')) billed ON true;

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
            ELSE progress.accepted_quantity + progress.released_quantity - progress.returned_from_stock_quantity
                 + CASE WHEN progress.bill_held_goods THEN progress.open_inspection_quantity ELSE 0 END END AS billable_quantity,
       progress.ordered_quantity - progress.cancelled_quantity - progress.returned_quantity AS bill_target_quantity,
       progress.damaged_quantity, progress.released_quantity, progress.open_inspection_quantity, progress.open_damaged_quantity, progress.returned_from_stock_quantity,
       progress.accepted_quantity + progress.held_quantity - progress.returned_quantity AS net_retained_quantity
  FROM tenant.purchase_order_line_progress progress;
GRANT SELECT ON tenant.purchase_order_line_progress, tenant.purchase_order_line_status TO vercent_app, vercent_worker;

-- What each posted receipt line may still be billed for (receipt-based billing): its usable quantity net of returns from it,
-- plus held goods when allowed, less what bills have already been allocated to it.
CREATE OR REPLACE VIEW tenant.goods_receipt_line_billing WITH (security_invoker = true) AS
SELECT receipt_line.organization_id, receipt_line.id AS goods_receipt_line_id, receipt_line.goods_receipt_id, receipt_line.purchase_order_line_id, receipt.receipt_number,
       receipt.receipt_date,
       receipt_line.accepted_quantity + COALESCE(held.released, 0) - COALESCE(returned.from_stock, 0)
         + CASE WHEN COALESCE(settings.bill_held_goods, false) THEN COALESCE(held.open_inspection, 0) ELSE 0 END AS billable_quantity,
       COALESCE(allocated.quantity, 0) AS allocated_quantity
  FROM tenant.goods_receipt_lines receipt_line
  JOIN tenant.goods_receipts receipt ON receipt.organization_id = receipt_line.organization_id AND receipt.id = receipt_line.goods_receipt_id
  LEFT JOIN tenant.procurement_settings settings ON settings.organization_id = receipt_line.organization_id
  LEFT JOIN LATERAL (
    SELECT sum(disposition.released_quantity) AS released,
           sum(disposition.quantity - disposition.released_quantity - disposition.returned_quantity) FILTER (WHERE disposition.disposition = 'inspection_hold') AS open_inspection
      FROM tenant.goods_receipt_dispositions disposition WHERE disposition.organization_id = receipt_line.organization_id AND disposition.goods_receipt_line_id = receipt_line.id) held ON true
  LEFT JOIN LATERAL (
    SELECT sum(return_line.quantity) FILTER (WHERE return_line.disposition_id IS NULL AND NOT return_line.from_hold) AS from_stock
      FROM tenant.purchase_return_lines return_line WHERE return_line.organization_id = receipt_line.organization_id AND return_line.goods_receipt_line_id = receipt_line.id) returned ON true
  LEFT JOIN LATERAL (
    SELECT sum(allocation.quantity) AS quantity
      FROM tenant.supplier_bill_receipt_allocations allocation
      JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = allocation.organization_id AND bill.id = allocation.vendor_bill_id
     WHERE allocation.organization_id = receipt_line.organization_id AND allocation.goods_receipt_line_id = receipt_line.id AND bill.status NOT IN ('cancelled', 'reversed')) allocated ON true
 WHERE receipt.status = 'posted' AND receipt.reversed_at IS NULL AND receipt_line.product_type <> 'service';
GRANT SELECT ON tenant.goods_receipt_line_billing TO vercent_app, vercent_worker;

-- ---------------------------------------------------------------- permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('procurement.receipts.post', 'Post goods receipts', 'Procurement', 'Post a goods receipt: the stock moves into the warehouse.'),
  ('procurement.receipts.reverse', 'Reverse goods receipts', 'Procurement', 'Reverse a posted goods receipt that nothing has used yet, taking its stock back out.'),
  ('procurement.receipts.release', 'Release held goods', 'Procurement', 'Release goods held for inspection (or kept damaged) into usable stock.'),
  ('procurement.receipts.access', 'Manage receiving warehouses', 'Procurement', 'Choose who may receive goods into each warehouse.')
ON CONFLICT (key) DO NOTHING;
-- Whoever records receipts posts them; whoever approved receipts may reverse them; whoever inspects releases held goods;
-- whoever manages procurement settings decides who receives where.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'procurement.receipts.post' FROM public.role_permissions existing WHERE existing.permission_key = 'procurement.receipts.manage'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'procurement.receipts.reverse' FROM public.role_permissions existing WHERE existing.permission_key = 'procurement.receipts.approve'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'procurement.receipts.release' FROM public.role_permissions existing WHERE existing.permission_key = 'procurement.inspection.manage'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'procurement.receipts.access' FROM public.role_permissions existing WHERE existing.permission_key = 'procurement.settings.manage'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0046_partial_receipts.sql', 'partial-receipts');
