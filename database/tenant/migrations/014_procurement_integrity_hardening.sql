BEGIN;

-- Normalize external idempotency and critical commercial relationships. JSON remains
-- a read-compatible snapshot, but these columns become the authoritative references.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'procurement_suppliers',
    'procurement_categories',
    'procurement_catalogs',
    'procurement_requisitions',
    'procurement_sourcing_events',
    'procurement_agreements',
    'procurement_purchase_orders',
    'procurement_receipts',
    'procurement_service_entries',
    'procurement_returns',
    'procurement_match_exceptions'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE tenant.%I ADD COLUMN IF NOT EXISTS idempotency_key text',
      table_name
    );
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON tenant.%I(organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL',
      table_name || '_idempotency_uidx',
      table_name
    );
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON tenant.%I(organization_id,company_id,id)',
      table_name || '_org_company_id_uidx',
      table_name
    );
  END LOOP;
END $$;

ALTER TABLE tenant.procurement_agreements
  ADD COLUMN IF NOT EXISTS supplier_id uuid,
  ADD COLUMN IF NOT EXISTS source_event_id uuid,
  ADD COLUMN IF NOT EXISTS selected_bid_id uuid;

ALTER TABLE tenant.procurement_purchase_orders
  ADD COLUMN IF NOT EXISTS supplier_id uuid,
  ADD COLUMN IF NOT EXISTS agreement_id uuid,
  ADD COLUMN IF NOT EXISTS requisition_id uuid,
  ADD COLUMN IF NOT EXISTS source_event_id uuid,
  ADD COLUMN IF NOT EXISTS selected_bid_id uuid;

ALTER TABLE tenant.procurement_receipts
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid,
  ADD COLUMN IF NOT EXISTS supplier_id uuid;

ALTER TABLE tenant.procurement_service_entries
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid,
  ADD COLUMN IF NOT EXISTS supplier_id uuid;

ALTER TABLE tenant.procurement_returns
  ADD COLUMN IF NOT EXISTS receipt_id uuid,
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid,
  ADD COLUMN IF NOT EXISTS supplier_id uuid;

ALTER TABLE tenant.procurement_match_exceptions
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid,
  ADD COLUMN IF NOT EXISTS supplier_id uuid,
  ADD COLUMN IF NOT EXISTS invoice_number text;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'procurement_supplier_sites',
    'procurement_supplier_qualifications',
    'procurement_supplier_certifications',
    'procurement_supplier_scorecards',
    'procurement_catalog_items',
    'procurement_requisition_lines',
    'procurement_requisition_distributions',
    'procurement_sourcing_invitations',
    'procurement_sourcing_bids',
    'procurement_sourcing_evaluations',
    'procurement_agreement_lines',
    'procurement_purchase_order_lines',
    'procurement_purchase_order_schedules',
    'procurement_advance_shipping_notices',
    'procurement_receipt_lines',
    'procurement_service_entry_lines',
    'procurement_return_lines',
    'procurement_matching_records'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE tenant.%I
         ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
         ADD COLUMN IF NOT EXISTS content_hash text,
         ADD COLUMN IF NOT EXISTS updated_by uuid,
         ADD COLUMN IF NOT EXISTS idempotency_key text',
      table_name
    );
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON tenant.%I(organization_id,parent_id,idempotency_key) WHERE idempotency_key IS NOT NULL',
      table_name || '_idempotency_uidx',
      table_name
    );
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON tenant.%I(organization_id,company_id,id)',
      table_name || '_org_company_id_uidx',
      table_name
    );
  END LOOP;
END $$;

ALTER TABLE tenant.procurement_purchase_order_lines
  ADD COLUMN IF NOT EXISTS item_id uuid,
  ADD COLUMN IF NOT EXISTS uom_id uuid,
  ADD COLUMN IF NOT EXISTS warehouse_id uuid,
  ADD COLUMN IF NOT EXISTS requisition_line_id uuid,
  ADD COLUMN IF NOT EXISTS received_quantity numeric(24,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoiced_quantity numeric(24,6) NOT NULL DEFAULT 0,
  ADD CONSTRAINT procurement_po_line_quantities_nonnegative
    CHECK (received_quantity >= 0 AND invoiced_quantity >= 0) NOT VALID;

ALTER TABLE tenant.procurement_receipt_lines
  ADD COLUMN IF NOT EXISTS purchase_order_line_id uuid,
  ADD COLUMN IF NOT EXISTS item_id uuid,
  ADD COLUMN IF NOT EXISTS uom_id uuid,
  ADD COLUMN IF NOT EXISTS warehouse_id uuid,
  ADD COLUMN IF NOT EXISTS accepted_quantity numeric(24,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_quantity numeric(24,6) NOT NULL DEFAULT 0,
  ADD CONSTRAINT procurement_receipt_line_quantities_nonnegative
    CHECK (accepted_quantity >= 0 AND rejected_quantity >= 0) NOT VALID;

ALTER TABLE tenant.procurement_service_entry_lines
  ADD COLUMN IF NOT EXISTS purchase_order_line_id uuid,
  ADD COLUMN IF NOT EXISTS item_id uuid,
  ADD COLUMN IF NOT EXISTS uom_id uuid;

ALTER TABLE tenant.procurement_return_lines
  ADD COLUMN IF NOT EXISTS receipt_line_id uuid,
  ADD COLUMN IF NOT EXISTS purchase_order_line_id uuid,
  ADD COLUMN IF NOT EXISTS item_id uuid,
  ADD COLUMN IF NOT EXISTS uom_id uuid;

-- Safe backfill: only references that resolve within the same organisation/company
-- are promoted from JSON.
UPDATE tenant.procurement_agreements agreement
   SET supplier_id = supplier.id
  FROM tenant.procurement_suppliers supplier
 WHERE agreement.supplier_id IS NULL
   AND supplier.organization_id = agreement.organization_id
   AND supplier.company_id = agreement.company_id
   AND supplier.id::text = agreement.data->>'supplierId';

UPDATE tenant.procurement_purchase_orders purchase_order
   SET supplier_id = supplier.id
  FROM tenant.procurement_suppliers supplier
 WHERE purchase_order.supplier_id IS NULL
   AND supplier.organization_id = purchase_order.organization_id
   AND supplier.company_id = purchase_order.company_id
   AND supplier.id::text = purchase_order.data->>'supplierId';

UPDATE tenant.procurement_receipts receipt
   SET purchase_order_id = purchase_order.id,
       supplier_id = purchase_order.supplier_id
  FROM tenant.procurement_purchase_orders purchase_order
 WHERE receipt.purchase_order_id IS NULL
   AND purchase_order.organization_id = receipt.organization_id
   AND purchase_order.company_id = receipt.company_id
   AND purchase_order.id::text = receipt.data->>'purchaseOrderId';

UPDATE tenant.procurement_service_entries service_entry
   SET purchase_order_id = purchase_order.id,
       supplier_id = purchase_order.supplier_id
  FROM tenant.procurement_purchase_orders purchase_order
 WHERE service_entry.purchase_order_id IS NULL
   AND purchase_order.organization_id = service_entry.organization_id
   AND purchase_order.company_id = service_entry.company_id
   AND purchase_order.id::text = service_entry.data->>'purchaseOrderId';

UPDATE tenant.procurement_returns purchase_return
   SET receipt_id = receipt.id,
       purchase_order_id = receipt.purchase_order_id,
       supplier_id = receipt.supplier_id
  FROM tenant.procurement_receipts receipt
 WHERE purchase_return.receipt_id IS NULL
   AND receipt.organization_id = purchase_return.organization_id
   AND receipt.company_id = purchase_return.company_id
   AND receipt.id::text = purchase_return.data->>'receiptId';

UPDATE tenant.procurement_match_exceptions match_exception
   SET purchase_order_id = purchase_order.id,
       supplier_id = purchase_order.supplier_id,
       invoice_number = NULLIF(match_exception.data->>'invoiceNumber','')
  FROM tenant.procurement_purchase_orders purchase_order
 WHERE match_exception.purchase_order_id IS NULL
   AND purchase_order.organization_id = match_exception.organization_id
   AND purchase_order.company_id = match_exception.company_id
   AND purchase_order.id::text = match_exception.data->>'purchaseOrderId';

UPDATE tenant.procurement_purchase_order_lines line
   SET item_id = CASE
         WHEN coalesce(line.data->>'itemId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           THEN (line.data->>'itemId')::uuid
         ELSE NULL
       END,
       uom_id = CASE
         WHEN coalesce(line.data->>'uomId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           THEN (line.data->>'uomId')::uuid
         ELSE NULL
       END,
       warehouse_id = CASE
         WHEN coalesce(line.data->>'warehouseId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           THEN (line.data->>'warehouseId')::uuid
         ELSE NULL
       END,
       received_quantity = CASE WHEN coalesce(line.data->>'receivedQuantity','') ~ '^[+-]?[0-9]+(?:\.[0-9]+)?$' THEN (line.data->>'receivedQuantity')::numeric ELSE 0 END,
       invoiced_quantity = CASE WHEN coalesce(line.data->>'invoicedQuantity','') ~ '^[+-]?[0-9]+(?:\.[0-9]+)?$' THEN (line.data->>'invoicedQuantity')::numeric ELSE 0 END
 WHERE line.item_id IS NULL
    OR line.uom_id IS NULL
    OR line.received_quantity = 0
    OR line.invoiced_quantity = 0;

CREATE TABLE IF NOT EXISTS tenant.procurement_sourcing_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  source_event_id uuid NOT NULL,
  selected_bid_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  award_type text NOT NULL CHECK (award_type IN ('purchase-order','agreement')),
  created_record_id uuid NOT NULL,
  award_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_event_id)
);

CREATE TABLE IF NOT EXISTS tenant.procurement_invoice_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  purchase_order_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  invoice_id uuid,
  invoice_number text NOT NULL,
  currency_code char(3) NOT NULL,
  match_mode text NOT NULL CHECK (match_mode IN ('two-way','three-way','four-way')),
  status text NOT NULL CHECK (status IN ('matched','exception','reversed')),
  invoice_total numeric(24,6) NOT NULL DEFAULT 0,
  order_matched_total numeric(24,6) NOT NULL DEFAULT 0,
  variance_amount numeric(24,6) NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz
);

CREATE INDEX IF NOT EXISTS procurement_sourcing_awards_source_idx
  ON tenant.procurement_sourcing_awards(organization_id,source_event_id);
CREATE INDEX IF NOT EXISTS procurement_invoice_matches_po_idx
  ON tenant.procurement_invoice_matches(organization_id,purchase_order_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS procurement_invoice_matches_duplicate_uidx
  ON tenant.procurement_invoice_matches(organization_id,company_id,supplier_id,upper(invoice_number))
  WHERE status <> 'reversed';

CREATE UNIQUE INDEX IF NOT EXISTS items_org_id_uidx
  ON tenant.items(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS units_of_measure_org_id_uidx
  ON tenant.units_of_measure(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_org_company_id_uidx
  ON tenant.warehouses(organization_id,company_id,id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_agreements_supplier_fk') THEN
    ALTER TABLE tenant.procurement_agreements ADD CONSTRAINT procurement_agreements_supplier_fk
      FOREIGN KEY (organization_id,company_id,supplier_id)
      REFERENCES tenant.procurement_suppliers(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_agreements_source_event_fk') THEN
    ALTER TABLE tenant.procurement_agreements ADD CONSTRAINT procurement_agreements_source_event_fk
      FOREIGN KEY (organization_id,company_id,source_event_id)
      REFERENCES tenant.procurement_sourcing_events(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_agreements_selected_bid_fk') THEN
    ALTER TABLE tenant.procurement_agreements ADD CONSTRAINT procurement_agreements_selected_bid_fk
      FOREIGN KEY (organization_id,company_id,selected_bid_id)
      REFERENCES tenant.procurement_sourcing_bids(organization_id,company_id,id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_purchase_orders_supplier_fk') THEN
    ALTER TABLE tenant.procurement_purchase_orders ADD CONSTRAINT procurement_purchase_orders_supplier_fk
      FOREIGN KEY (organization_id,company_id,supplier_id)
      REFERENCES tenant.procurement_suppliers(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_purchase_orders_agreement_fk') THEN
    ALTER TABLE tenant.procurement_purchase_orders ADD CONSTRAINT procurement_purchase_orders_agreement_fk
      FOREIGN KEY (organization_id,company_id,agreement_id)
      REFERENCES tenant.procurement_agreements(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_purchase_orders_requisition_fk') THEN
    ALTER TABLE tenant.procurement_purchase_orders ADD CONSTRAINT procurement_purchase_orders_requisition_fk
      FOREIGN KEY (organization_id,company_id,requisition_id)
      REFERENCES tenant.procurement_requisitions(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_purchase_orders_source_event_fk') THEN
    ALTER TABLE tenant.procurement_purchase_orders ADD CONSTRAINT procurement_purchase_orders_source_event_fk
      FOREIGN KEY (organization_id,company_id,source_event_id)
      REFERENCES tenant.procurement_sourcing_events(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_purchase_orders_selected_bid_fk') THEN
    ALTER TABLE tenant.procurement_purchase_orders ADD CONSTRAINT procurement_purchase_orders_selected_bid_fk
      FOREIGN KEY (organization_id,company_id,selected_bid_id)
      REFERENCES tenant.procurement_sourcing_bids(organization_id,company_id,id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_receipts_po_fk') THEN
    ALTER TABLE tenant.procurement_receipts ADD CONSTRAINT procurement_receipts_po_fk
      FOREIGN KEY (organization_id,company_id,purchase_order_id)
      REFERENCES tenant.procurement_purchase_orders(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_receipts_supplier_fk') THEN
    ALTER TABLE tenant.procurement_receipts ADD CONSTRAINT procurement_receipts_supplier_fk
      FOREIGN KEY (organization_id,company_id,supplier_id)
      REFERENCES tenant.procurement_suppliers(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_service_entries_po_fk') THEN
    ALTER TABLE tenant.procurement_service_entries ADD CONSTRAINT procurement_service_entries_po_fk
      FOREIGN KEY (organization_id,company_id,purchase_order_id)
      REFERENCES tenant.procurement_purchase_orders(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_service_entries_supplier_fk') THEN
    ALTER TABLE tenant.procurement_service_entries ADD CONSTRAINT procurement_service_entries_supplier_fk
      FOREIGN KEY (organization_id,company_id,supplier_id)
      REFERENCES tenant.procurement_suppliers(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_returns_receipt_fk') THEN
    ALTER TABLE tenant.procurement_returns ADD CONSTRAINT procurement_returns_receipt_fk
      FOREIGN KEY (organization_id,company_id,receipt_id)
      REFERENCES tenant.procurement_receipts(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_returns_po_fk') THEN
    ALTER TABLE tenant.procurement_returns ADD CONSTRAINT procurement_returns_po_fk
      FOREIGN KEY (organization_id,company_id,purchase_order_id)
      REFERENCES tenant.procurement_purchase_orders(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_returns_supplier_fk') THEN
    ALTER TABLE tenant.procurement_returns ADD CONSTRAINT procurement_returns_supplier_fk
      FOREIGN KEY (organization_id,company_id,supplier_id)
      REFERENCES tenant.procurement_suppliers(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_match_exceptions_po_fk') THEN
    ALTER TABLE tenant.procurement_match_exceptions ADD CONSTRAINT procurement_match_exceptions_po_fk
      FOREIGN KEY (organization_id,company_id,purchase_order_id)
      REFERENCES tenant.procurement_purchase_orders(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_match_exceptions_supplier_fk') THEN
    ALTER TABLE tenant.procurement_match_exceptions ADD CONSTRAINT procurement_match_exceptions_supplier_fk
      FOREIGN KEY (organization_id,company_id,supplier_id)
      REFERENCES tenant.procurement_suppliers(organization_id,company_id,id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_po_lines_parent_fk') THEN
    ALTER TABLE tenant.procurement_purchase_order_lines ADD CONSTRAINT procurement_po_lines_parent_fk
      FOREIGN KEY (organization_id,company_id,parent_id)
      REFERENCES tenant.procurement_purchase_orders(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_po_lines_requisition_line_fk') THEN
    ALTER TABLE tenant.procurement_purchase_order_lines ADD CONSTRAINT procurement_po_lines_requisition_line_fk
      FOREIGN KEY (organization_id,company_id,requisition_line_id)
      REFERENCES tenant.procurement_requisition_lines(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_po_lines_item_fk') THEN
    ALTER TABLE tenant.procurement_purchase_order_lines ADD CONSTRAINT procurement_po_lines_item_fk
      FOREIGN KEY (organization_id,item_id) REFERENCES tenant.items(organization_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_po_lines_uom_fk') THEN
    ALTER TABLE tenant.procurement_purchase_order_lines ADD CONSTRAINT procurement_po_lines_uom_fk
      FOREIGN KEY (organization_id,uom_id) REFERENCES tenant.units_of_measure(organization_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_po_lines_warehouse_fk') THEN
    ALTER TABLE tenant.procurement_purchase_order_lines ADD CONSTRAINT procurement_po_lines_warehouse_fk
      FOREIGN KEY (organization_id,company_id,warehouse_id)
      REFERENCES tenant.warehouses(organization_id,company_id,id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_receipt_lines_parent_fk') THEN
    ALTER TABLE tenant.procurement_receipt_lines ADD CONSTRAINT procurement_receipt_lines_parent_fk
      FOREIGN KEY (organization_id,company_id,parent_id)
      REFERENCES tenant.procurement_receipts(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_receipt_lines_po_line_fk') THEN
    ALTER TABLE tenant.procurement_receipt_lines ADD CONSTRAINT procurement_receipt_lines_po_line_fk
      FOREIGN KEY (organization_id,company_id,purchase_order_line_id)
      REFERENCES tenant.procurement_purchase_order_lines(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_receipt_lines_item_fk') THEN
    ALTER TABLE tenant.procurement_receipt_lines ADD CONSTRAINT procurement_receipt_lines_item_fk
      FOREIGN KEY (organization_id,item_id) REFERENCES tenant.items(organization_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_receipt_lines_uom_fk') THEN
    ALTER TABLE tenant.procurement_receipt_lines ADD CONSTRAINT procurement_receipt_lines_uom_fk
      FOREIGN KEY (organization_id,uom_id) REFERENCES tenant.units_of_measure(organization_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_receipt_lines_warehouse_fk') THEN
    ALTER TABLE tenant.procurement_receipt_lines ADD CONSTRAINT procurement_receipt_lines_warehouse_fk
      FOREIGN KEY (organization_id,company_id,warehouse_id)
      REFERENCES tenant.warehouses(organization_id,company_id,id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_service_lines_po_line_fk') THEN
    ALTER TABLE tenant.procurement_service_entry_lines ADD CONSTRAINT procurement_service_lines_po_line_fk
      FOREIGN KEY (organization_id,company_id,purchase_order_line_id)
      REFERENCES tenant.procurement_purchase_order_lines(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_return_lines_receipt_line_fk') THEN
    ALTER TABLE tenant.procurement_return_lines ADD CONSTRAINT procurement_return_lines_receipt_line_fk
      FOREIGN KEY (organization_id,company_id,receipt_line_id)
      REFERENCES tenant.procurement_receipt_lines(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_return_lines_po_line_fk') THEN
    ALTER TABLE tenant.procurement_return_lines ADD CONSTRAINT procurement_return_lines_po_line_fk
      FOREIGN KEY (organization_id,company_id,purchase_order_line_id)
      REFERENCES tenant.procurement_purchase_order_lines(organization_id,company_id,id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_sourcing_awards_event_fk') THEN
    ALTER TABLE tenant.procurement_sourcing_awards ADD CONSTRAINT procurement_sourcing_awards_event_fk
      FOREIGN KEY (organization_id,company_id,source_event_id)
      REFERENCES tenant.procurement_sourcing_events(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_sourcing_awards_bid_fk') THEN
    ALTER TABLE tenant.procurement_sourcing_awards ADD CONSTRAINT procurement_sourcing_awards_bid_fk
      FOREIGN KEY (organization_id,company_id,selected_bid_id)
      REFERENCES tenant.procurement_sourcing_bids(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_sourcing_awards_supplier_fk') THEN
    ALTER TABLE tenant.procurement_sourcing_awards ADD CONSTRAINT procurement_sourcing_awards_supplier_fk
      FOREIGN KEY (organization_id,company_id,supplier_id)
      REFERENCES tenant.procurement_suppliers(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_invoice_matches_po_fk') THEN
    ALTER TABLE tenant.procurement_invoice_matches ADD CONSTRAINT procurement_invoice_matches_po_fk
      FOREIGN KEY (organization_id,company_id,purchase_order_id)
      REFERENCES tenant.procurement_purchase_orders(organization_id,company_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='procurement_invoice_matches_supplier_fk') THEN
    ALTER TABLE tenant.procurement_invoice_matches ADD CONSTRAINT procurement_invoice_matches_supplier_fk
      FOREIGN KEY (organization_id,company_id,supplier_id)
      REFERENCES tenant.procurement_suppliers(organization_id,company_id,id) NOT VALID;
  END IF;
END $$;

ALTER TABLE tenant.procurement_sourcing_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_sourcing_awards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_sourcing_awards_tenant_policy ON tenant.procurement_sourcing_awards;
CREATE POLICY procurement_sourcing_awards_tenant_policy
  ON tenant.procurement_sourcing_awards
  USING (organization_id=tenant.current_organization_id())
  WITH CHECK (organization_id=tenant.current_organization_id());

ALTER TABLE tenant.procurement_invoice_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_invoice_matches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procurement_invoice_matches_tenant_policy ON tenant.procurement_invoice_matches;
CREATE POLICY procurement_invoice_matches_tenant_policy
  ON tenant.procurement_invoice_matches
  USING (organization_id=tenant.current_organization_id())
  WITH CHECK (organization_id=tenant.current_organization_id());

COMMIT;
