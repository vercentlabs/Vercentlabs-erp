-- Stock Ledger: the immutable, auditable history of every physical stock change.
--
-- Every movement now belongs to a movement group (one business posting: a goods receipt, a delivery, a transfer dispatch…) that names its
-- source document, carries a normalized ledger type, a monotonic ledger sequence, the item's base unit and the disposition of the stock it
-- moved, and links a reversal to what it reverses. Posted movements and groups can no longer be updated or deleted. In-transit stock gets a
-- real position (a system "Goods in transit" warehouse), so a dispatched transfer is two balanced legs and its receipt two more. Serial
-- transfers carry their serial numbers. Reconciliation runs are recorded.

-- ============================================================ 1. movement groups
CREATE SEQUENCE IF NOT EXISTS tenant.stock_ledger_sequence;
GRANT USAGE, SELECT ON SEQUENCE tenant.stock_ledger_sequence TO vercent_app, vercent_worker;

CREATE TABLE IF NOT EXISTS tenant.stock_movement_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  source_document_type text NOT NULL,
  source_document_id uuid NOT NULL,
  source_document_number text,
  operation_type text NOT NULL,
  posting_key text NOT NULL,
  effective_at timestamptz NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by uuid,
  reversal_of_group_id uuid REFERENCES tenant.stock_movement_groups(id),
  reason text,
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, posting_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_movement_groups_one_reversal_uidx ON tenant.stock_movement_groups (reversal_of_group_id) WHERE reversal_of_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_movement_groups_source_idx ON tenant.stock_movement_groups (organization_id, source_document_type, source_document_id);
ALTER TABLE tenant.stock_movement_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.stock_movement_groups FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'stock_movement_groups' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.stock_movement_groups USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT ON tenant.stock_movement_groups TO vercent_app, vercent_worker;

-- ============================================================ 2. ledger facts on every movement
ALTER TABLE tenant.stock_movements
  ADD COLUMN IF NOT EXISTS movement_group_id uuid REFERENCES tenant.stock_movement_groups(id),
  ADD COLUMN IF NOT EXISTS ledger_type text,
  ADD COLUMN IF NOT EXISTS ledger_sequence bigint,
  ADD COLUMN IF NOT EXISTS base_uom_id uuid,
  ADD COLUMN IF NOT EXISTS disposition text,
  ADD COLUMN IF NOT EXISTS source_line_id uuid,
  ADD COLUMN IF NOT EXISTS reversed_movement_id uuid REFERENCES tenant.stock_movements(id);

-- The order the ledger was written in: by posting time, then number.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, movement_number, id) AS position FROM tenant.stock_movements WHERE ledger_sequence IS NULL
)
UPDATE tenant.stock_movements movement SET ledger_sequence = (SELECT COALESCE(max(ledger_sequence), 0) FROM tenant.stock_movements) + ordered.position
  FROM ordered WHERE ordered.id = movement.id;
DO $$ BEGIN PERFORM setval('tenant.stock_ledger_sequence', GREATEST((SELECT COALESCE(max(ledger_sequence), 0) FROM tenant.stock_movements), 1)); END $$;
ALTER TABLE tenant.stock_movements ALTER COLUMN ledger_sequence SET DEFAULT nextval('tenant.stock_ledger_sequence');

UPDATE tenant.stock_movements movement SET base_uom_id = item.uom_id
  FROM tenant.items item WHERE item.organization_id = movement.organization_id AND item.id = movement.item_id AND movement.base_uom_id IS NULL;

UPDATE tenant.stock_movements movement SET disposition = COALESCE(location.disposition, 'available')
  FROM tenant.stock_movements self
  LEFT JOIN tenant.warehouse_locations location ON location.organization_id = self.organization_id AND location.id = self.warehouse_location_id
 WHERE self.id = movement.id AND movement.disposition IS NULL;

-- The business meaning of each movement already posted, from the document behind it.
UPDATE tenant.stock_movements movement SET ledger_type = CASE
    WHEN movement.reference_type = 'opening_stock' THEN 'opening_stock'
    WHEN movement.reference_type IN ('opening_stock_reversal', 'goods_receipt_reversal', 'purchase_return_reversal') THEN 'reversal'
    WHEN movement.reference_type IN ('goods_receipt', 'goods_receipt_line') THEN 'purchase_receipt'
    WHEN movement.reference_type = 'purchase_return' THEN CASE WHEN movement.quantity < 0 THEN 'purchase_return' ELSE 'adjustment_in' END
    WHEN movement.reference_type IN ('sales_delivery', 'pos_sale') THEN CASE WHEN movement.quantity < 0 THEN 'sales_delivery' ELSE 'sales_return' END
    WHEN movement.reference_type IN ('sales_return', 'pos_return') THEN CASE WHEN movement.quantity > 0 THEN 'sales_return' ELSE 'sales_delivery' END
    WHEN movement.reference_type = 'manufacturing_work_order' THEN CASE WHEN movement.quantity < 0 THEN 'production_issue' ELSE 'production_receipt' END
    WHEN movement.reference_type = 'receiving_rejection' THEN CASE WHEN movement.quantity < 0 THEN 'disposition_out' ELSE 'disposition_in' END
    WHEN movement.reference_type = 'stock_transfer' THEN CASE
      WHEN transfer.source_warehouse_id = transfer.destination_warehouse_id THEN
        CASE WHEN COALESCE(source.disposition, 'available') <> COALESCE(destination.disposition, 'available')
             THEN CASE WHEN movement.quantity < 0 THEN 'disposition_out' ELSE 'disposition_in' END
             ELSE CASE WHEN movement.quantity < 0 THEN 'location_transfer_out' ELSE 'location_transfer_in' END END
      ELSE CASE WHEN movement.quantity < 0 THEN 'transfer_out' ELSE 'transfer_in' END END
    ELSE CASE WHEN movement.quantity < 0 THEN 'adjustment_out' ELSE 'adjustment_in' END
  END
  FROM tenant.stock_movements self
  LEFT JOIN tenant.stock_transfers transfer ON self.reference_type = 'stock_transfer' AND transfer.organization_id = self.organization_id AND transfer.id = self.reference_id
  LEFT JOIN tenant.warehouse_locations source ON source.organization_id = transfer.organization_id AND source.id = transfer.source_location_id
  LEFT JOIN tenant.warehouse_locations destination ON destination.organization_id = transfer.organization_id AND destination.id = transfer.destination_location_id
 WHERE self.id = movement.id AND movement.ledger_type IS NULL;

-- A goods receipt's movements name the receipt line they came from.
UPDATE tenant.stock_movements SET source_line_id = reference_id
 WHERE reference_type IN ('goods_receipt_line', 'goods_receipt_reversal', 'receiving_rejection') AND source_line_id IS NULL;

-- One group per posting already made: the movements one transaction wrote for one document and operation.
CREATE TEMP TABLE ledger_backfill AS
SELECT movement.id AS movement_id, movement.organization_id, movement.created_at, movement.occurred_at, movement.created_by, movement.movement_number,
       movement.reference_type, movement.reference_id, movement.ledger_type,
       CASE WHEN movement.ledger_type IN ('transfer_out', 'transfer_in') THEN 'transfer' WHEN movement.ledger_type IN ('location_transfer_out', 'location_transfer_in') THEN 'location_move'
            WHEN movement.ledger_type IN ('disposition_out', 'disposition_in') THEN 'disposition_move'
            ELSE movement.ledger_type END AS operation_type,
       dense_rank() OVER (ORDER BY movement.organization_id, COALESCE(movement.reference_type, ''), COALESCE(movement.reference_id, movement.id), movement.created_at,
         CASE WHEN movement.ledger_type IN ('transfer_out', 'transfer_in') THEN 'transfer' WHEN movement.ledger_type IN ('location_transfer_out', 'location_transfer_in') THEN 'location_move'
            WHEN movement.ledger_type IN ('disposition_out', 'disposition_in') THEN 'disposition_move'
              ELSE movement.ledger_type END) AS group_rank
  FROM tenant.stock_movements movement WHERE movement.movement_group_id IS NULL;
CREATE TEMP TABLE ledger_backfill_groups AS
SELECT gen_random_uuid() AS group_id, group_rank, organization_id, min(reference_type) AS reference_type, (array_agg(reference_id))[1] AS reference_id,
       min(operation_type) AS operation_type, min(created_at) AS created_at, min(occurred_at) AS effective_at, (array_agg(created_by ORDER BY movement_number))[1] AS posted_by,
       min(movement_number) AS first_number
  FROM ledger_backfill GROUP BY group_rank, organization_id;
INSERT INTO tenant.stock_movement_groups (id, organization_id, source_document_type, source_document_id, source_document_number, operation_type, posting_key, effective_at, posted_at,
       posted_by, created_at)
SELECT batch.group_id, batch.organization_id,
       CASE WHEN batch.reference_type IS NULL THEN 'stock_adjustment'
            WHEN batch.reference_type IN ('goods_receipt_line', 'goods_receipt_reversal', 'receiving_rejection') THEN 'goods_receipt'
            WHEN batch.reference_type = 'opening_stock_reversal' THEN 'opening_stock'
            WHEN batch.reference_type = 'purchase_return_reversal' THEN 'purchase_return'
            WHEN batch.reference_type = 'receiving_rejection_disposal' THEN 'receiving_rejection'
            ELSE batch.reference_type END,
       CASE WHEN batch.reference_type IS NULL THEN batch.group_id
            WHEN batch.reference_type IN ('goods_receipt_line', 'goods_receipt_reversal', 'receiving_rejection') THEN COALESCE(receipt_line.goods_receipt_id, batch.reference_id)
            ELSE batch.reference_id END,
       NULL, batch.operation_type, 'legacy:' || batch.first_number, batch.effective_at, batch.created_at, batch.posted_by, batch.created_at
  FROM ledger_backfill_groups batch
  LEFT JOIN tenant.goods_receipt_lines receipt_line ON batch.reference_type IN ('goods_receipt_line', 'goods_receipt_reversal', 'receiving_rejection')
       AND receipt_line.organization_id = batch.organization_id AND receipt_line.id = batch.reference_id;
UPDATE tenant.stock_movements movement SET movement_group_id = batch_group.group_id
  FROM ledger_backfill backfill JOIN ledger_backfill_groups batch_group ON batch_group.group_rank = backfill.group_rank
 WHERE backfill.movement_id = movement.id;
-- A manual movement is its own adjustment document: it carries the group as its reference.
UPDATE tenant.stock_movements movement SET reference_type = 'stock_adjustment', reference_id = movement.movement_group_id WHERE movement.reference_type IS NULL;

-- The document numbers the ledger shows, as they were.
UPDATE tenant.stock_movement_groups movement_group SET source_document_number = CASE movement_group.source_document_type
    WHEN 'opening_stock' THEN (SELECT document_number FROM tenant.opening_stocks WHERE id = movement_group.source_document_id)
    WHEN 'goods_receipt' THEN (SELECT receipt_number FROM tenant.goods_receipts WHERE id = movement_group.source_document_id)
    WHEN 'receiving_rejection' THEN (SELECT rejection_number FROM tenant.receiving_rejections WHERE id = movement_group.source_document_id)
    WHEN 'purchase_return' THEN (SELECT return_number FROM tenant.purchase_returns WHERE id = movement_group.source_document_id)
    WHEN 'sales_delivery' THEN (SELECT request_number FROM tenant.sales_fulfillment_requests WHERE id = movement_group.source_document_id)
    WHEN 'sales_return' THEN (SELECT return_number FROM tenant.sales_returns WHERE id = movement_group.source_document_id)
    WHEN 'stock_transfer' THEN (SELECT transfer_number FROM tenant.stock_transfers WHERE id = movement_group.source_document_id)
    WHEN 'stock_count' THEN (SELECT count_number FROM tenant.stock_counts WHERE id = movement_group.source_document_id)
    WHEN 'manufacturing_work_order' THEN (SELECT work_order_number FROM tenant.manufacturing_work_orders WHERE id = movement_group.source_document_id)
    WHEN 'pos_sale' THEN (SELECT receipt_number FROM tenant.pos_sales WHERE id = movement_group.source_document_id)
    WHEN 'pos_return' THEN (SELECT return_number FROM tenant.pos_returns WHERE id = movement_group.source_document_id)
    WHEN 'stock_adjustment' THEN (SELECT min(movement_number) FROM tenant.stock_movements WHERE movement_group_id = movement_group.id)
  END
 WHERE movement_group.source_document_number IS NULL;

ALTER TABLE tenant.stock_movements ALTER COLUMN movement_group_id SET NOT NULL;
ALTER TABLE tenant.stock_movements ALTER COLUMN ledger_type SET NOT NULL;
ALTER TABLE tenant.stock_movements ALTER COLUMN ledger_sequence SET NOT NULL;
ALTER TABLE tenant.stock_movements ALTER COLUMN base_uom_id SET NOT NULL;
ALTER TABLE tenant.stock_movements ALTER COLUMN disposition SET DEFAULT 'available';
ALTER TABLE tenant.stock_movements ALTER COLUMN disposition SET NOT NULL;
ALTER TABLE tenant.stock_movements ALTER COLUMN reference_type SET NOT NULL;
ALTER TABLE tenant.stock_movements ALTER COLUMN reference_id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_ledger_type_check') THEN
    ALTER TABLE tenant.stock_movements ADD CONSTRAINT stock_movements_ledger_type_check CHECK (ledger_type IN (
      'opening_stock', 'purchase_receipt', 'purchase_return', 'sales_delivery', 'sales_return', 'transfer_out', 'transfer_in', 'transfer_to_transit',
      'transfer_from_transit', 'adjustment_in', 'adjustment_out', 'location_transfer_out', 'location_transfer_in', 'disposition_out', 'disposition_in',
      'production_issue', 'production_receipt', 'reversal'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_disposition_check') THEN
    ALTER TABLE tenant.stock_movements ADD CONSTRAINT stock_movements_disposition_check CHECK (disposition IN ('available', 'quality_hold', 'quarantined', 'damaged'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_base_uom_fkey') THEN
    ALTER TABLE tenant.stock_movements ADD CONSTRAINT stock_movements_base_uom_fkey FOREIGN KEY (organization_id, base_uom_id) REFERENCES tenant.units_of_measure(organization_id, id) ON DELETE RESTRICT;
  END IF;
  -- A serial number is one whole unit: its movement is exactly one in or one out.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_serial_unit_check') THEN
    ALTER TABLE tenant.stock_movements ADD CONSTRAINT stock_movements_serial_unit_check CHECK (serial_id IS NULL OR abs(quantity) = 1) NOT VALID;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_ledger_sequence_uidx ON tenant.stock_movements (ledger_sequence);
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_one_reversal_uidx ON tenant.stock_movements (reversed_movement_id) WHERE reversed_movement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_movements_ledger_order_idx ON tenant.stock_movements (organization_id, occurred_at, ledger_sequence);
CREATE INDEX IF NOT EXISTS stock_movements_ledger_item_idx ON tenant.stock_movements (organization_id, item_id, occurred_at, ledger_sequence);
CREATE INDEX IF NOT EXISTS stock_movements_ledger_warehouse_idx ON tenant.stock_movements (organization_id, warehouse_id, occurred_at, ledger_sequence);
CREATE INDEX IF NOT EXISTS stock_movements_ledger_batch_idx ON tenant.stock_movements (organization_id, batch_id, occurred_at, ledger_sequence) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_movements_ledger_serial_idx ON tenant.stock_movements (organization_id, serial_id, occurred_at, ledger_sequence) WHERE serial_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_movements_group_idx ON tenant.stock_movements (organization_id, movement_group_id);
CREATE INDEX IF NOT EXISTS stock_movements_reference_idx ON tenant.stock_movements (organization_id, reference_type, reference_id);

-- ============================================================ 3. immutable
-- A posted movement or group is evidence: corrections are compensating movements, never edits or deletions.
CREATE OR REPLACE FUNCTION tenant.stock_ledger_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Posted stock ledger entries are immutable: post a reversal or a correcting document instead.' USING ERRCODE = 'check_violation';
END;
$$;
CREATE OR REPLACE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON tenant.stock_movements FOR EACH ROW EXECUTE FUNCTION tenant.stock_ledger_immutable();
CREATE OR REPLACE TRIGGER stock_movement_groups_immutable BEFORE UPDATE OR DELETE ON tenant.stock_movement_groups FOR EACH ROW EXECUTE FUNCTION tenant.stock_ledger_immutable();
REVOKE UPDATE, DELETE ON tenant.stock_movements FROM vercent_app, vercent_worker;

-- ============================================================ 4. in transit, and serial transfers
-- The company's goods between warehouses: one system warehouse per company, created on the first dispatch, holding stock in a TRANSIT
-- location that is never allocated.
ALTER TABLE tenant.warehouses ADD COLUMN IF NOT EXISTS system_role text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouses_system_role_check') THEN
    ALTER TABLE tenant.warehouses ADD CONSTRAINT warehouses_system_role_check CHECK (system_role IS NULL OR (system_role = 'in_transit' AND warehouse_type = 'transit' AND NOT is_default));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_one_transit_uidx ON tenant.warehouses (organization_id) WHERE system_role = 'in_transit';

ALTER TABLE tenant.stock_transfers ADD COLUMN IF NOT EXISTS serial_ids uuid[] NOT NULL DEFAULT '{}';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfers_serial_quantity_check') THEN
    ALTER TABLE tenant.stock_transfers ADD CONSTRAINT stock_transfers_serial_quantity_check CHECK (cardinality(serial_ids) = 0 OR cardinality(serial_ids) = quantity);
  END IF;
END $$;

-- ============================================================ 5. reconciliation runs
CREATE TABLE IF NOT EXISTS tenant.stock_ledger_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  run_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  run_at timestamptz NOT NULL DEFAULT now(),
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  position_differences integer NOT NULL DEFAULT 0,
  batch_differences integer NOT NULL DEFAULT 0,
  serial_differences integer NOT NULL DEFAULT 0,
  group_differences integer NOT NULL DEFAULT 0,
  result jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS stock_ledger_reconciliations_idx ON tenant.stock_ledger_reconciliations (organization_id, run_at DESC);
ALTER TABLE tenant.stock_ledger_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.stock_ledger_reconciliations FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'stock_ledger_reconciliations' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.stock_ledger_reconciliations USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT ON tenant.stock_ledger_reconciliations TO vercent_app;
GRANT SELECT ON tenant.stock_ledger_reconciliations TO vercent_worker;

-- ============================================================ 6. permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('stock.ledger.view', 'View stock ledger', 'Inventory', 'See the movements of stock (quantities in, out and the running balance) in the warehouses the user may see, with batch and serial history.'),
  ('stock.ledger.view_cost', 'View stock ledger valuation', 'Inventory', 'See unit cost and movement value on the stock ledger.'),
  ('stock.ledger.export', 'Export stock ledger', 'Inventory', 'Download the filtered stock ledger.'),
  ('stock.ledger.reconcile', 'Reconcile stock ledger', 'Inventory', 'Compare current stock balances, batches and serial numbers with the ledger.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, granted.key FROM public.role_permissions existing
  JOIN (VALUES ('stock.view', 'stock.ledger.view'), ('stock.valuation.view', 'stock.ledger.view_cost'), ('stock.reports.view', 'stock.ledger.export'),
               ('inventory_setup.manage', 'stock.ledger.export'), ('inventory_setup.manage', 'stock.ledger.reconcile'), ('stock.audit.view', 'stock.ledger.reconcile'))
       AS granted(source, key) ON granted.source = existing.permission_key
  JOIN public.permissions permission ON permission.key = granted.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0067_stock_ledger.sql', 'stock-ledger');
