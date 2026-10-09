-- Inventory Valuation: the financial carrying value of physical stock. The Stock Ledger is authoritative for quantity; the valuation entries
-- are authoritative for the value attached to each stock movement; Finance owns the General Ledger.
--
-- Two perpetual methods, one per item for the whole company (every warehouse): Moving Average (the default) and FIFO. Standard cost is no
-- longer a valuation method (items, categories and the company default that used it move to Moving Average).
--
-- Every stock movement has exactly one valuation entry (immutable: quantity delta, unit cost, value delta in the company's base currency,
-- where the cost came from, any foreign-currency snapshot, the effective time and a valuation sequence). Valuation state is kept per warehouse
-- and item: a balance projection (quantity, value, moving average) rebuilt from the entries, and for FIFO the cost layers each inbound entry
-- creates, with an allocation record for every layer quantity an outbound entry consumed (or a reversal restored). A backdated movement replays
-- the warehouse's stream from its date and records restatement entries for every later value that changed; it never edits an entry.

-- ============================================================ 1. two methods
UPDATE tenant.items SET valuation_method = 'moving_average' WHERE valuation_method NOT IN ('moving_average', 'fifo');
UPDATE tenant.stock_settings SET costing_method = 'moving_average' WHERE costing_method NOT IN ('moving_average', 'fifo');
UPDATE tenant.item_groups SET default_valuation_method = 'moving_average' WHERE default_valuation_method NOT IN ('moving_average', 'fifo');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_valuation_method_mvp_check') THEN
    ALTER TABLE tenant.items ADD CONSTRAINT items_valuation_method_mvp_check CHECK (valuation_method IN ('moving_average', 'fifo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_settings_costing_method_mvp_check') THEN
    ALTER TABLE tenant.stock_settings ADD CONSTRAINT stock_settings_costing_method_mvp_check CHECK (costing_method IN ('moving_average', 'fifo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_groups_default_valuation_mvp_check') THEN
    ALTER TABLE tenant.item_groups ADD CONSTRAINT item_groups_default_valuation_mvp_check CHECK (default_valuation_method IS NULL OR default_valuation_method IN ('moving_average', 'fifo'));
  END IF;
END $$;

-- ============================================================ 2. valuation entries
CREATE SEQUENCE IF NOT EXISTS tenant.inventory_valuation_sequence;
GRANT USAGE, SELECT ON SEQUENCE tenant.inventory_valuation_sequence TO vercent_app;

-- entry_kind: movement (the valuation of one stock movement — exactly one per movement), settlement (a receipt that brought a provisionally
-- valued negative position back: the difference between the provisional and the actual cost) and restatement (a later value changed by a
-- backdated movement). cost_role says how replay treats a movement entry: inbound (its value is fixed), outbound (its value comes from the
-- method), internal (a location or disposition move: no value).
CREATE TABLE IF NOT EXISTS tenant.inventory_valuation_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  movement_id uuid REFERENCES tenant.stock_movements(id),
  entry_kind text NOT NULL DEFAULT 'movement' CHECK (entry_kind IN ('movement', 'settlement', 'restatement')),
  cost_role text NOT NULL CHECK (cost_role IN ('inbound', 'outbound', 'internal', 'adjustment')),
  valuation_method text NOT NULL CHECK (valuation_method IN ('moving_average', 'fifo')),
  ledger_type text,
  base_quantity_delta numeric(20,6) NOT NULL,
  base_unit_cost numeric(24,10) NOT NULL DEFAULT 0,
  value_delta numeric(20,2) NOT NULL,
  base_currency text NOT NULL,
  source_currency text,
  source_unit_cost numeric(24,10),
  exchange_rate numeric(24,10),
  source_cost_type text NOT NULL,
  effective_at timestamptz NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  valuation_sequence bigint NOT NULL DEFAULT nextval('tenant.inventory_valuation_sequence'),
  reversal_of_id uuid REFERENCES tenant.inventory_valuation_entries(id),
  restates_entry_id uuid REFERENCES tenant.inventory_valuation_entries(id),
  balance_quantity_after numeric(20,6) NOT NULL,
  balance_value_after numeric(20,2) NOT NULL,
  journal_entry_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((entry_kind = 'movement') = (movement_id IS NOT NULL)),
  CHECK (entry_kind <> 'restatement' OR restates_entry_id IS NOT NULL)
);
-- One logical stock movement, one valuation effect.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_valuation_entries_movement_uidx ON tenant.inventory_valuation_entries (movement_id) WHERE entry_kind = 'movement';
CREATE INDEX IF NOT EXISTS inventory_valuation_entries_stream_idx ON tenant.inventory_valuation_entries (organization_id, warehouse_id, item_id, effective_at, valuation_sequence);
CREATE INDEX IF NOT EXISTS inventory_valuation_entries_item_idx ON tenant.inventory_valuation_entries (organization_id, item_id, effective_at);

CREATE OR REPLACE FUNCTION tenant.inventory_valuation_entry_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- The journal of a correction is linked once, after it is posted; nothing else ever changes.
  IF TG_OP = 'UPDATE' AND OLD.journal_entry_id IS NULL AND NEW.journal_entry_id IS NOT NULL
     AND (to_jsonb(NEW) - 'journal_entry_id') = (to_jsonb(OLD) - 'journal_entry_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Inventory valuation entries are immutable: correct them with a new entry.' USING ERRCODE = 'restrict_violation';
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'inventory_valuation_entries_immutable' AND tgrelid = 'tenant.inventory_valuation_entries'::regclass) THEN
    CREATE TRIGGER inventory_valuation_entries_immutable BEFORE UPDATE OR DELETE ON tenant.inventory_valuation_entries
      FOR EACH ROW EXECUTE FUNCTION tenant.inventory_valuation_entry_immutable();
  END IF;
END $$;

-- ============================================================ 3. the balance projection (per warehouse and item)
CREATE TABLE IF NOT EXISTS tenant.inventory_valuation_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  valuation_method text NOT NULL CHECK (valuation_method IN ('moving_average', 'fifo')),
  base_quantity numeric(20,6) NOT NULL DEFAULT 0,
  inventory_value numeric(20,2) NOT NULL DEFAULT 0,
  moving_average_cost numeric(24,10),
  last_valuation_entry_id uuid REFERENCES tenant.inventory_valuation_entries(id),
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, warehouse_id, item_id)
);

-- ============================================================ 4. FIFO cost layers and what consumed them
-- A layer per inbound entry (a transfer in carries the source's layers across, keeping their age); remaining changes only through the
-- valuation engine. origin_layer_id: the layer a transferred one came from.
CREATE TABLE IF NOT EXISTS tenant.inventory_cost_layers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  source_entry_id uuid NOT NULL REFERENCES tenant.inventory_valuation_entries(id),
  source_movement_id uuid REFERENCES tenant.stock_movements(id),
  origin_layer_id uuid REFERENCES tenant.inventory_cost_layers(id),
  original_quantity numeric(20,6) NOT NULL CHECK (original_quantity > 0),
  original_value numeric(20,2) NOT NULL CHECK (original_value >= 0),
  remaining_quantity numeric(20,6) NOT NULL CHECK (remaining_quantity >= 0),
  remaining_value numeric(20,2) NOT NULL CHECK (remaining_value >= 0),
  unit_cost numeric(24,10) NOT NULL,
  effective_at timestamptz NOT NULL,
  valuation_sequence bigint NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'exhausted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_cost_layers_fifo_idx ON tenant.inventory_cost_layers (organization_id, warehouse_id, item_id, effective_at, valuation_sequence, id) WHERE status = 'open';

-- quantity > 0: consumed from the layer; quantity < 0: given back to it (a reversal restoring what an issue took).
CREATE TABLE IF NOT EXISTS tenant.inventory_valuation_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  valuation_entry_id uuid NOT NULL REFERENCES tenant.inventory_valuation_entries(id),
  cost_layer_id uuid NOT NULL REFERENCES tenant.inventory_cost_layers(id),
  quantity numeric(20,6) NOT NULL CHECK (quantity <> 0),
  value numeric(20,2) NOT NULL,
  unit_cost numeric(24,10) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_valuation_allocations_entry_idx ON tenant.inventory_valuation_allocations (organization_id, valuation_entry_id);
CREATE INDEX IF NOT EXISTS inventory_valuation_allocations_layer_idx ON tenant.inventory_valuation_allocations (organization_id, cost_layer_id);

-- ============================================================ 5. history of valuation operations
-- method_changed, reconciled, rebuilt, replayed (a backdated movement restated later values).
CREATE TABLE IF NOT EXISTS tenant.inventory_valuation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  event_type text NOT NULL,
  item_id uuid REFERENCES tenant.items(id),
  warehouse_id uuid REFERENCES tenant.warehouses(id),
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS inventory_valuation_events_idx ON tenant.inventory_valuation_events (organization_id, created_at DESC);

-- ============================================================ 6. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['inventory_valuation_entries', 'inventory_valuation_balances', 'inventory_cost_layers', 'inventory_valuation_allocations',
    'inventory_valuation_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', name);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
-- Entries, allocations and the history are evidence: never edited or removed by the application (a correction is a new entry).
REVOKE DELETE ON tenant.inventory_valuation_entries, tenant.inventory_valuation_allocations, tenant.inventory_valuation_events, tenant.inventory_cost_layers FROM vercent_app;
REVOKE UPDATE ON tenant.inventory_valuation_allocations, tenant.inventory_valuation_events FROM vercent_app;

-- ============================================================ 7. what was posted before: one entry per movement, in the stream's order
-- Each existing movement keeps the cost it was posted at; FIFO items get one opening layer per warehouse for what is left.
INSERT INTO tenant.inventory_valuation_entries (organization_id, warehouse_id, item_id, movement_id, entry_kind, cost_role, valuation_method, ledger_type, base_quantity_delta,
       base_unit_cost, value_delta, base_currency, source_cost_type, effective_at, posted_at, balance_quantity_after, balance_value_after, created_by)
SELECT movement.organization_id, movement.warehouse_id, movement.item_id, movement.id, 'movement',
       CASE WHEN movement.ledger_type IN ('location_transfer_in', 'location_transfer_out', 'disposition_in', 'disposition_out') THEN 'internal'
            WHEN movement.quantity > 0 THEN 'inbound' ELSE 'outbound' END,
       item.valuation_method, movement.ledger_type, movement.quantity, movement.unit_cost,
       CASE WHEN movement.ledger_type IN ('location_transfer_in', 'location_transfer_out', 'disposition_in', 'disposition_out') THEN 0 ELSE round(movement.quantity * movement.unit_cost, 2) END,
       COALESCE(trim(organization.base_currency), 'INR'), 'migrated', movement.occurred_at, movement.created_at,
       sum(movement.quantity) OVER stream,
       sum(CASE WHEN movement.ledger_type IN ('location_transfer_in', 'location_transfer_out', 'disposition_in', 'disposition_out') THEN 0 ELSE round(movement.quantity * movement.unit_cost, 2) END) OVER stream,
       movement.created_by
  FROM tenant.stock_movements movement
  JOIN tenant.items item ON item.organization_id = movement.organization_id AND item.id = movement.item_id
  JOIN public.organizations organization ON organization.id = movement.organization_id
 WHERE NOT EXISTS (SELECT 1 FROM tenant.inventory_valuation_entries entry WHERE entry.movement_id = movement.id)
WINDOW stream AS (PARTITION BY movement.organization_id, movement.warehouse_id, movement.item_id ORDER BY movement.occurred_at, movement.ledger_sequence)
 ORDER BY movement.occurred_at, movement.ledger_sequence;

INSERT INTO tenant.inventory_valuation_balances (organization_id, warehouse_id, item_id, valuation_method, base_quantity, inventory_value, moving_average_cost, version)
SELECT entry.organization_id, entry.warehouse_id, entry.item_id, item.valuation_method, sum(entry.base_quantity_delta), sum(entry.value_delta),
       CASE WHEN sum(entry.base_quantity_delta) <> 0 THEN sum(entry.value_delta) / sum(entry.base_quantity_delta) END, 1
  FROM tenant.inventory_valuation_entries entry
  JOIN tenant.items item ON item.organization_id = entry.organization_id AND item.id = entry.item_id
 GROUP BY entry.organization_id, entry.warehouse_id, entry.item_id, item.valuation_method
ON CONFLICT (organization_id, warehouse_id, item_id) DO NOTHING;

INSERT INTO tenant.inventory_cost_layers (organization_id, warehouse_id, item_id, source_entry_id, original_quantity, original_value, remaining_quantity, remaining_value, unit_cost,
       effective_at, valuation_sequence)
SELECT balance.organization_id, balance.warehouse_id, balance.item_id,
       (SELECT entry.id FROM tenant.inventory_valuation_entries entry WHERE entry.organization_id = balance.organization_id AND entry.warehouse_id = balance.warehouse_id
           AND entry.item_id = balance.item_id ORDER BY entry.valuation_sequence DESC LIMIT 1),
       balance.base_quantity, balance.inventory_value, balance.base_quantity, balance.inventory_value, balance.inventory_value / balance.base_quantity, now(), nextval('tenant.inventory_valuation_sequence')
  FROM tenant.inventory_valuation_balances balance
 WHERE balance.valuation_method = 'fifo' AND balance.base_quantity > 0 AND balance.inventory_value >= 0
   AND NOT EXISTS (SELECT 1 FROM tenant.inventory_cost_layers layer WHERE layer.organization_id = balance.organization_id AND layer.warehouse_id = balance.warehouse_id
                     AND layer.item_id = balance.item_id);

-- ============================================================ 8. Finance: cost of goods sold for deliveries and sales returns
-- A dispatched delivery takes its stock out of Inventory into the cost of goods sold, and a received sales return brings it back, at the value
-- Inventory Valuation gave the movements (never the selling price).
ALTER TABLE tenant.sales_fulfillment_requests ADD COLUMN IF NOT EXISTS cogs_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id);
ALTER TABLE tenant.sales_returns ADD COLUMN IF NOT EXISTS cogs_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id);

-- ============================================================ 9. permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('stock.valuation.view_rate', 'See valuation rates', 'Inventory', 'See the current valuation rate (moving average or carrying rate) of stock.'),
  ('stock.valuation.view_layers', 'See FIFO cost layers', 'Inventory', 'See what remains of each FIFO cost layer.'),
  ('stock.valuation.view_movements', 'See valuation movements and COGS', 'Inventory', 'See the value every stock movement added or removed, and its cost of goods sold.'),
  ('stock.valuation.view_cost_source', 'See cost sources', 'Inventory', 'See where each value came from (receipt cost, average, layers, original delivery cost…).'),
  ('stock.valuation.view_exchange_rate', 'See valuation exchange rates', 'Inventory', 'See the source currency and exchange-rate snapshot of foreign-currency receipts.'),
  ('stock.valuation.configure_method', 'Configure valuation method', 'Inventory', 'Choose the valuation method of an item (or the company default) before any stock history.'),
  ('stock.valuation.reconcile_view', 'View valuation reconciliation', 'Inventory', 'See quantity, layer and value reconciliation and valuation exceptions.'),
  ('stock.valuation.reconcile_run', 'Run valuation reconciliation', 'Inventory', 'Run the valuation reconciliation.'),
  ('stock.valuation.rebuild', 'Rebuild valuation projection', 'Inventory', 'Rebuild the valuation balances and FIFO layers from the valuation entries (administrators).'),
  ('stock.valuation.finance_reconcile', 'View valuation against the GL', 'Inventory', 'Compare inventory value with the Inventory Asset accounts in the General Ledger.'),
  ('stock.valuation.export', 'Export valuation', 'Inventory', 'Export valuation reports.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, granted.key FROM public.role_permissions existing
  JOIN (VALUES ('stock.valuation.view', 'stock.valuation.view_rate'), ('stock.valuation.view', 'stock.valuation.view_layers'), ('stock.valuation.view', 'stock.valuation.view_movements'),
               ('stock.valuation.view', 'stock.valuation.view_cost_source'), ('stock.valuation.view', 'stock.valuation.view_exchange_rate'),
               ('stock.valuation.view', 'stock.valuation.reconcile_view'), ('stock.valuation.view', 'stock.valuation.export'),
               ('inventory_setup.manage', 'stock.valuation.configure_method'), ('products.configure_accounting', 'stock.valuation.configure_method'),
               ('inventory_setup.manage', 'stock.valuation.reconcile_view'),
               ('inventory_setup.manage', 'stock.valuation.reconcile_run'),
               ('accounting.view', 'stock.valuation.finance_reconcile'), ('accounting.view', 'stock.valuation.reconcile_view'))
       AS granted(source, key) ON granted.source = existing.permission_key
  JOIN public.permissions permission ON permission.key = granted.key
ON CONFLICT DO NOTHING;
-- The rebuild is for administrators: granted with the role permission that rebuilds stock balances.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'stock.valuation.rebuild' FROM public.role_permissions existing
 WHERE existing.permission_key = 'stock.balance.rebuild' AND EXISTS (SELECT 1 FROM public.permissions WHERE key = 'stock.valuation.rebuild')
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0075_inventory_valuation.sql', 'inventory-valuation');
