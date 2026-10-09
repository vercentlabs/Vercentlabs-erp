-- Negative-Stock Control: no stock-consuming transaction may make a stock position (warehouse, location, batch) negative unless the company has
-- chosen controlled overrides and an authorised user overrides, with a reason, an untracked item. Batch, serial and transit stock never go
-- negative; reserved stock is never taken; Available never shows below zero; a backdated decrease is checked against the history after it.
--
-- One company policy (block — the default — or allow with override; there is no unrestricted allow) and an item may force block. The legacy
-- per-company, per-item and per-warehouse "allow negative stock" flags are no longer read: a company that allowed negative stock moves to
-- allow-with-override, which still needs the override permission and a reason every time.
--
-- An override is recorded for good (who, why, the quantity before, the movement, the quantity after, the source document). A negative position
-- is an exception: open while the balance is below zero, resolved by the inbound movement that brings it back to zero or above — only real
-- stock transactions resolve it, never an edit of the balance. Every attempt blocked, override used, position created, increased, partly or fully
-- resolved, policy and item setting changed is kept in the negative-stock history.

-- ============================================================ 1. policy
ALTER TABLE tenant.stock_settings ADD COLUMN IF NOT EXISTS negative_stock_policy text NOT NULL DEFAULT 'block';
ALTER TABLE tenant.stock_settings ADD COLUMN IF NOT EXISTS negative_stock_alerts_enabled boolean NOT NULL DEFAULT true;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_settings_negative_stock_policy_check') THEN
    ALTER TABLE tenant.stock_settings ADD CONSTRAINT stock_settings_negative_stock_policy_check CHECK (negative_stock_policy IN ('block', 'allow_with_override'));
  END IF;
END $$;
UPDATE tenant.stock_settings SET negative_stock_policy = 'allow_with_override' WHERE allow_negative_stock AND negative_stock_policy = 'block';

-- An item may only be stricter than the company: inherit, or always block.
ALTER TABLE tenant.items ADD COLUMN IF NOT EXISTS negative_stock_policy_override text NOT NULL DEFAULT 'inherit';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_negative_stock_policy_override_check') THEN
    ALTER TABLE tenant.items ADD CONSTRAINT items_negative_stock_policy_override_check CHECK (negative_stock_policy_override IN ('inherit', 'block'));
  END IF;
END $$;

-- ============================================================ 2. negative positions (exceptions)
-- One open exception per stock position while its balance is below zero. origin: override (an authorised override made it negative) or
-- reconciliation (found negative with no override behind it — an integrity failure to investigate).
CREATE TABLE IF NOT EXISTS tenant.negative_stock_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  location_id uuid REFERENCES tenant.warehouse_locations(id),
  batch_id uuid REFERENCES tenant.stock_batches(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  origin text NOT NULL DEFAULT 'override' CHECK (origin IN ('override', 'reconciliation')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by_movement_id uuid REFERENCES tenant.stock_movements(id),
  current_quantity numeric(20,6) NOT NULL,
  lowest_quantity numeric(20,6) NOT NULL,
  last_movement_id uuid REFERENCES tenant.stock_movements(id),
  resolved_at timestamptz,
  resolved_by_movement_id uuid REFERENCES tenant.stock_movements(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS negative_stock_exceptions_open_uidx ON tenant.negative_stock_exceptions
  (organization_id, item_id, warehouse_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS negative_stock_exceptions_list_idx ON tenant.negative_stock_exceptions (organization_id, status, opened_at DESC);

-- ============================================================ 3. overrides
-- Every authorised override, kept for good: it is audit, not stock — the stock ledger stays the source of truth.
CREATE TABLE IF NOT EXISTS tenant.negative_stock_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  exception_id uuid REFERENCES tenant.negative_stock_exceptions(id),
  movement_id uuid NOT NULL REFERENCES tenant.stock_movements(id),
  source_document_type text,
  source_document_id uuid,
  source_document_number text,
  source_line_id uuid,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  location_id uuid REFERENCES tenant.warehouse_locations(id),
  quantity_before numeric(20,6) NOT NULL,
  movement_quantity numeric(20,6) NOT NULL,
  quantity_after numeric(20,6) NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN ('DELAYED_RECEIPT_POSTING', 'MIGRATION_TIMING', 'EMERGENCY_OPERATION', 'AUTHORIZED_BACKDATE', 'OTHER')),
  notes text NOT NULL CHECK (length(btrim(notes)) > 0),
  overridden_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  overridden_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS negative_stock_overrides_movement_uidx ON tenant.negative_stock_overrides (movement_id);
CREATE INDEX IF NOT EXISTS negative_stock_overrides_list_idx ON tenant.negative_stock_overrides (organization_id, overridden_at DESC);

-- ============================================================ 4. history
-- blocked, backdate_blocked, override_used, position_created, position_increased, partly_resolved, resolved, policy_changed, item_policy_changed,
-- reconciled. A blocked attempt is written after the attempt's own transaction has rolled back.
CREATE TABLE IF NOT EXISTS tenant.negative_stock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  event_type text NOT NULL,
  item_id uuid REFERENCES tenant.items(id),
  warehouse_id uuid REFERENCES tenant.warehouses(id),
  location_id uuid REFERENCES tenant.warehouse_locations(id),
  batch_id uuid REFERENCES tenant.stock_batches(id),
  exception_id uuid REFERENCES tenant.negative_stock_exceptions(id),
  movement_id uuid REFERENCES tenant.stock_movements(id),
  source_document_type text,
  source_document_id uuid,
  quantity_before numeric(20,6),
  movement_quantity numeric(20,6),
  quantity_after numeric(20,6),
  reason_code text,
  notes text,
  permission text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS negative_stock_events_idx ON tenant.negative_stock_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS negative_stock_events_item_idx ON tenant.negative_stock_events (organization_id, item_id, created_at DESC);

-- ============================================================ 5. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['negative_stock_exceptions', 'negative_stock_overrides', 'negative_stock_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', name);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
-- Overrides and the history are evidence: never edited or removed by the application.
REVOKE UPDATE, DELETE ON tenant.negative_stock_overrides, tenant.negative_stock_events FROM vercent_app;
REVOKE DELETE ON tenant.negative_stock_exceptions FROM vercent_app;

-- ============================================================ 6. the database backs the application up
-- A stock balance never goes below zero (or further below) unless the movement carries an authorised override (set for that one statement by
-- the stock engine) or the projection is being rebuilt from the ledger; a batch balance never goes negative except in a rebuild.
CREATE OR REPLACE FUNCTION tenant.guard_negative_stock_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mode text := COALESCE(current_setting('vercent.negative_stock', true), '');
  previous numeric;
BEGIN
  IF NEW.quantity >= 0 OR mode = 'rebuild' OR (mode = 'override' AND NEW.batch_id IS NULL) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    previous := OLD.quantity;
  ELSE
    -- An upsert fires the insert trigger with the proposed row before it becomes an update: compare with the row it will update, if any.
    SELECT balance.quantity INTO previous FROM tenant.stock_balances balance
     WHERE balance.organization_id = NEW.organization_id AND balance.item_id = NEW.item_id AND balance.warehouse_id = NEW.warehouse_id
       AND balance.warehouse_location_id IS NOT DISTINCT FROM NEW.warehouse_location_id AND balance.batch_id IS NOT DISTINCT FROM NEW.batch_id;
  END IF;
  -- Below zero is refused only when the balance goes (further) down: a receipt into a negative position that leaves it still negative is fine.
  IF previous IS NULL OR NEW.quantity < previous THEN
    RAISE EXCEPTION 'NEGATIVE_STOCK_BLOCKED: stock balance of item % in warehouse % would become %', NEW.item_id, NEW.warehouse_id, NEW.quantity
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'stock_balances_negative_guard' AND tgrelid = 'tenant.stock_balances'::regclass) THEN
    CREATE TRIGGER stock_balances_negative_guard BEFORE INSERT OR UPDATE OF quantity ON tenant.stock_balances
      FOR EACH ROW EXECUTE FUNCTION tenant.guard_negative_stock_balance();
  END IF;
END $$;

-- ============================================================ 7. permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('stock.negative.view_warnings', 'See negative-stock warnings', 'Inventory', 'See that an item or stock position is negative.'),
  ('stock.negative.view_exceptions', 'View negative-stock exceptions', 'Inventory', 'See the negative-stock report: open and resolved negative positions.'),
  ('stock.negative.override', 'Override negative stock', 'Inventory', 'Post an untracked stock issue beyond the stock on hand, with a reason, when the company allows controlled overrides.'),
  ('stock.negative.view_audit', 'View negative-stock audit', 'Inventory', 'See every override, blocked attempt and policy change.'),
  ('stock.negative.configure', 'Configure negative-stock policy', 'Inventory', 'Choose the company negative-stock policy and run reconciliation.'),
  ('stock.negative.item_block', 'Block negative stock per item', 'Inventory', 'Force an item to always block negative stock.'),
  ('stock.negative.export', 'Export negative-stock report', 'Inventory', 'Export the negative-stock report.')
ON CONFLICT (key) DO NOTHING;
-- The override is deliberately granted to no role: the owner has it, anyone else is given it on purpose.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, granted.key FROM public.role_permissions existing
  JOIN (VALUES ('stock.view', 'stock.negative.view_warnings'),
               ('stock.adjust', 'stock.negative.view_exceptions'), ('stock.adjust', 'stock.negative.export'),
               ('inventory_setup.manage', 'stock.negative.view_warnings'), ('inventory_setup.manage', 'stock.negative.view_exceptions'),
               ('inventory_setup.manage', 'stock.negative.view_audit'), ('inventory_setup.manage', 'stock.negative.configure'),
               ('inventory_setup.manage', 'stock.negative.item_block'), ('inventory_setup.manage', 'stock.negative.export'),
               ('stock.audit.view', 'stock.negative.view_exceptions'), ('stock.audit.view', 'stock.negative.view_audit'))
       AS granted(source, key) ON granted.source = existing.permission_key
  JOIN public.permissions permission ON permission.key = granted.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0074_negative_stock_control.sql', 'negative-stock-control');
