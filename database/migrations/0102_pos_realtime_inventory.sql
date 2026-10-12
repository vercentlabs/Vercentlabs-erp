-- POS Real-Time Inventory: every committed change to what can be sold — a stock movement, a reservation made, consumed or released, a batch
-- expiring or blocked, a location put on hold — leaves a small "availability changed" event for that warehouse and item, written by the
-- database in the same transaction as the change (an outbox: the event exists if and only if the change committed). POS terminals subscribed
-- to their outlet's warehouse fetch the authoritative availability again when they see one. Inventory stays the only source of truth: the
-- events carry no quantities, only which warehouse and item changed, a version and why.
--
--   inventory_availability_versions  one row per warehouse and item: its version rises once per committing transaction that changed it.
--   inventory_availability_events    one row per transaction, warehouse and item (coalesced): the version it produced, the reason, when it
--                                    happened, and when it was first delivered. Ordered by a sequence for resuming streams.
--
-- Additive only. Nothing here changes a balance, a movement or a reservation.

-- ============================================================ 1. versions and events
CREATE TABLE IF NOT EXISTS tenant.inventory_availability_versions (
  organization_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  item_id uuid NOT NULL,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, warehouse_id, item_id)
);

CREATE SEQUENCE IF NOT EXISTS tenant.inventory_availability_event_seq;
CREATE TABLE IF NOT EXISTS tenant.inventory_availability_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint NOT NULL DEFAULT nextval('tenant.inventory_availability_event_seq'),
  organization_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  item_id uuid NOT NULL,
  inventory_version bigint NOT NULL,
  event_type text NOT NULL DEFAULT 'INVENTORY_AVAILABILITY_CHANGED' CHECK (event_type = 'INVENTORY_AVAILABILITY_CHANGED'),
  reason text NOT NULL,
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_availability_events_sequence_uidx ON tenant.inventory_availability_events (sequence);
-- Coalesced: one event per transaction, warehouse and item — however many balance rows the transaction touched.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_availability_events_txn_uidx ON tenant.inventory_availability_events (organization_id, transaction_id, warehouse_id, item_id);
CREATE INDEX IF NOT EXISTS inventory_availability_events_feed_idx ON tenant.inventory_availability_events (organization_id, warehouse_id, sequence);
CREATE INDEX IF NOT EXISTS inventory_availability_events_recent_idx ON tenant.inventory_availability_events (organization_id, occurred_at);
CREATE INDEX IF NOT EXISTS inventory_availability_events_unpublished_idx ON tenant.inventory_availability_events (organization_id, occurred_at) WHERE published_at IS NULL;

-- ============================================================ 2. recording a change (inside the changing transaction)
CREATE OR REPLACE FUNCTION tenant.record_inventory_availability_change(p_organization uuid, p_warehouse uuid, p_item uuid, p_reason text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  next_version bigint;
BEGIN
  IF p_organization IS NULL OR p_warehouse IS NULL OR p_item IS NULL THEN RETURN; END IF;
  -- Already recorded by this transaction for this warehouse and item: one version step per transaction. A stock movement says more than the
  -- reservation change before it (a sale consumes its reservation, then issues the stock): its reason replaces a reservation reason.
  IF EXISTS (SELECT 1 FROM tenant.inventory_availability_events WHERE organization_id = p_organization AND transaction_id = txid_current()
              AND warehouse_id = p_warehouse AND item_id = p_item) THEN
    IF p_reason IS NOT NULL AND p_reason NOT LIKE 'reservation%' THEN
      UPDATE tenant.inventory_availability_events SET reason = left(p_reason, 60)
       WHERE organization_id = p_organization AND transaction_id = txid_current() AND warehouse_id = p_warehouse AND item_id = p_item AND reason LIKE 'reservation%';
    END IF;
    RETURN;
  END IF;
  INSERT INTO tenant.inventory_availability_versions (organization_id, warehouse_id, item_id, version, updated_at)
  VALUES (p_organization, p_warehouse, p_item, 1, now())
  ON CONFLICT (organization_id, warehouse_id, item_id) DO UPDATE SET version = tenant.inventory_availability_versions.version + 1, updated_at = now()
  RETURNING version INTO next_version;
  INSERT INTO tenant.inventory_availability_events (organization_id, warehouse_id, item_id, inventory_version, reason)
  VALUES (p_organization, p_warehouse, p_item, next_version, left(COALESCE(p_reason, 'stock_change'), 60));
END $$;

-- Stock balances: on hand or reserved changed (every module's movements and every reservation pass through here).
CREATE OR REPLACE FUNCTION tenant.stock_balance_availability_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  why text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity AND NEW.reserved_quantity IS NOT DISTINCT FROM OLD.reserved_quantity THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.quantity IS DISTINCT FROM OLD.quantity THEN
    why := COALESCE((SELECT ledger_type FROM tenant.stock_movements WHERE organization_id = NEW.organization_id AND id = NEW.last_movement_id), 'stock_movement');
  ELSIF NEW.reserved_quantity > OLD.reserved_quantity THEN
    why := 'reservation';
  ELSE
    why := 'reservation_released';
  END IF;
  PERFORM tenant.record_inventory_availability_change(NEW.organization_id, NEW.warehouse_id, NEW.item_id, why);
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'stock_balances_availability_change') THEN
    CREATE TRIGGER stock_balances_availability_change AFTER INSERT OR UPDATE OF quantity, reserved_quantity ON tenant.stock_balances
      FOR EACH ROW EXECUTE FUNCTION tenant.stock_balance_availability_change();
  END IF;
END $$;

-- A batch expired, blocked or released: its stock's sellability changed wherever it is held.
CREATE OR REPLACE FUNCTION tenant.stock_batch_availability_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.expires_on IS NOT DISTINCT FROM OLD.expires_on THEN RETURN NEW; END IF;
  PERFORM tenant.record_inventory_availability_change(balance.organization_id, balance.warehouse_id, balance.item_id, 'batch_status')
     FROM (SELECT DISTINCT organization_id, warehouse_id, item_id FROM tenant.stock_balances
            WHERE organization_id = NEW.organization_id AND batch_id = NEW.id AND quantity <> 0) AS balance;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'stock_batches_availability_change') THEN
    CREATE TRIGGER stock_batches_availability_change AFTER UPDATE OF status, expires_on ON tenant.stock_batches
      FOR EACH ROW EXECUTE FUNCTION tenant.stock_batch_availability_change();
  END IF;
END $$;

-- A location put on hold, into quarantine, made inactive or released: the stock it holds changed sellability.
CREATE OR REPLACE FUNCTION tenant.warehouse_location_availability_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.disposition IS NOT DISTINCT FROM OLD.disposition AND NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.allow_allocation IS NOT DISTINCT FROM OLD.allow_allocation THEN
    RETURN NEW;
  END IF;
  PERFORM tenant.record_inventory_availability_change(balance.organization_id, balance.warehouse_id, balance.item_id, 'location_status')
     FROM (SELECT DISTINCT organization_id, warehouse_id, item_id FROM tenant.stock_balances
            WHERE organization_id = NEW.organization_id AND warehouse_location_id = NEW.id AND quantity <> 0) AS balance;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'warehouse_locations_availability_change') THEN
    CREATE TRIGGER warehouse_locations_availability_change AFTER UPDATE OF disposition, status, allow_allocation ON tenant.warehouse_locations
      FOR EACH ROW EXECUTE FUNCTION tenant.warehouse_location_availability_change();
  END IF;
END $$;

-- ============================================================ 3. isolation and grants
ALTER TABLE tenant.inventory_availability_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.inventory_availability_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.inventory_availability_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.inventory_availability_events FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'inventory_availability_versions' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.inventory_availability_versions USING (organization_id = tenant.current_organization_id())
      WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'inventory_availability_events' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.inventory_availability_events USING (organization_id = tenant.current_organization_id())
      WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
-- Written only by the triggers (as whoever changes stock: the app or the worker); published_at is set on first delivery; the worker prunes.
GRANT SELECT, INSERT, UPDATE ON tenant.inventory_availability_versions TO vercent_app, vercent_worker;
GRANT SELECT, INSERT ON tenant.inventory_availability_events TO vercent_app, vercent_worker;
GRANT UPDATE (published_at, reason) ON tenant.inventory_availability_events TO vercent_app, vercent_worker;
GRANT DELETE ON tenant.inventory_availability_events TO vercent_worker;
GRANT USAGE ON SEQUENCE tenant.inventory_availability_event_seq TO vercent_app, vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0102_pos_realtime_inventory.sql', 'pos-realtime-inventory') ON CONFLICT DO NOTHING;
