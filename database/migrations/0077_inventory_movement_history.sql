-- Inventory Movement History: a read-only, human-readable view of the canonical Stock Ledger (tenant.stock_movements and their postings,
-- tenant.stock_movement_groups). It adds no movement table and stores no quantity, direction, category or running balance: all of those are
-- derived on read, so the history can never disagree with the ledger and needs no rebuild. Its permissions are the Stock Ledger's
-- (stock.ledger.view / view_cost / export / reconcile): quantities and costs are seen separately, exactly as on the ledger.
--
-- This migration adds what reading it at scale needs:
--   1. the item's SKU and name as they were when a movement was posted (the current name is shown, the name at posting stays available);
--   2. indexes for posted-date chronology, movement-type and event (posting) queries.

-- ============================================================ 1. the item at posting
ALTER TABLE tenant.stock_movements ADD COLUMN IF NOT EXISTS item_code_snapshot text;
ALTER TABLE tenant.stock_movements ADD COLUMN IF NOT EXISTS item_name_snapshot text;

-- Filled as each movement is posted (the ledger is append-only: movements posted before this migration keep no snapshot and show the item as
-- it is now).
CREATE OR REPLACE FUNCTION tenant.stock_movement_item_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.item_code_snapshot IS NULL OR NEW.item_name_snapshot IS NULL THEN
    SELECT COALESCE(NEW.item_code_snapshot, item.code), COALESCE(NEW.item_name_snapshot, item.name)
      INTO NEW.item_code_snapshot, NEW.item_name_snapshot
      FROM tenant.items item WHERE item.organization_id = NEW.organization_id AND item.id = NEW.item_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER stock_movements_item_snapshot BEFORE INSERT ON tenant.stock_movements FOR EACH ROW EXECUTE FUNCTION tenant.stock_movement_item_snapshot();

-- ============================================================ 2. indexes
-- Posted-date chronology (audit order), by company and by item.
CREATE INDEX IF NOT EXISTS stock_movements_posted_order_idx ON tenant.stock_movements (organization_id, created_at, ledger_sequence);
CREATE INDEX IF NOT EXISTS stock_movements_item_posted_idx ON tenant.stock_movements (organization_id, item_id, created_at, ledger_sequence);
-- Movement type over time, and a location's history.
CREATE INDEX IF NOT EXISTS stock_movements_type_effective_idx ON tenant.stock_movements (organization_id, ledger_type, occurred_at, ledger_sequence);
CREATE INDEX IF NOT EXISTS stock_movements_location_effective_idx ON tenant.stock_movements (organization_id, warehouse_location_id, occurred_at, ledger_sequence)
  WHERE warehouse_location_id IS NOT NULL;
-- Transaction Events: postings in effective and posted order, and the reversal link from an original.
CREATE INDEX IF NOT EXISTS stock_movement_groups_effective_idx ON tenant.stock_movement_groups (organization_id, effective_at, id);
CREATE INDEX IF NOT EXISTS stock_movement_groups_posted_idx ON tenant.stock_movement_groups (organization_id, posted_at, id);
CREATE INDEX IF NOT EXISTS stock_movement_groups_operation_idx ON tenant.stock_movement_groups (organization_id, source_document_id, operation_type, posted_at);
-- A reservation consumed by a movement (shown beside the movement, never as one).
CREATE INDEX IF NOT EXISTS stock_reservation_events_movement_idx ON tenant.stock_reservation_events (organization_id, (details->>'movementId'))
  WHERE event_type = 'consumed';

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0077_inventory_movement_history.sql', 'inventory-movement-history');
