-- Real-Time Stock Balance: the current stock position is a projection of the Inventory ledger (stock_movements) and the active reservations,
-- kept in stock_balances by the same transaction that posts each movement, never edited by hand, and always rebuildable from them.
--
-- This migration adds what the projection needs to be checked and trusted: a version and the last movement on every balance row (so a
-- change is traceable and concurrent updates are visible), the audit of every reconciliation repair or rebuild, two-step transfers
-- (dispatched into transit, then received), the indexes the balance and as-of queries use, and the permissions to backdate a movement
-- and to rebuild the projection.

-- ============================================================ 1. the projection
ALTER TABLE tenant.stock_balances
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_movement_id uuid;
CREATE INDEX IF NOT EXISTS stock_balances_item_idx ON tenant.stock_balances (organization_id, item_id);
CREATE INDEX IF NOT EXISTS stock_balances_warehouse_item_idx ON tenant.stock_balances (organization_id, warehouse_id, item_id);
CREATE INDEX IF NOT EXISTS stock_balances_location_item_idx ON tenant.stock_balances (organization_id, warehouse_id, warehouse_location_id, item_id);
CREATE INDEX IF NOT EXISTS stock_balances_batch_idx ON tenant.stock_balances (organization_id, item_id, batch_id) WHERE batch_id IS NOT NULL;
-- As-of balances and running balances read the ledger by item, warehouse and effective time.
CREATE INDEX IF NOT EXISTS stock_movements_item_effective_idx ON tenant.stock_movements (organization_id, item_id, warehouse_id, occurred_at);
CREATE INDEX IF NOT EXISTS stock_reservations_active_idx ON tenant.stock_reservations (organization_id, item_id, warehouse_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS stock_serials_item_idx ON tenant.stock_serials (organization_id, item_id, warehouse_id, status);

-- ============================================================ 2. two-step transfers
-- A transfer is completed in one step (issue and receipt together), or dispatched (issued from the source, then in transit: owned, at
-- neither warehouse) and received later at the destination.
ALTER TABLE tenant.stock_transfers
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatched_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS stock_transfers_open_idx ON tenant.stock_transfers (organization_id, item_id, status) WHERE status IN ('draft', 'in_transit');

-- ============================================================ 3. reconciliation audit
CREATE TABLE IF NOT EXISTS tenant.stock_balance_rebuilds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  reason text NOT NULL,
  quantity_corrections integer NOT NULL DEFAULT 0,
  reservation_corrections integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '[]'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS stock_balance_rebuilds_idx ON tenant.stock_balance_rebuilds (organization_id, created_at DESC);
ALTER TABLE tenant.stock_balance_rebuilds ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.stock_balance_rebuilds FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'stock_balance_rebuilds' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.stock_balance_rebuilds USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT ON tenant.stock_balance_rebuilds TO vercent_app;
GRANT SELECT ON tenant.stock_balance_rebuilds TO vercent_worker;

-- ============================================================ 4. permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('stock.backdate', 'Backdate stock movements', 'Inventory', 'Post an adjustment or other stock movement with an earlier effective date.'),
  ('stock.balance.rebuild', 'Rebuild stock balances', 'Inventory', 'Correct the current stock balances from the Inventory ledger and the active reservations.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('stock.backdate', 'stock.balance.rebuild')
 WHERE existing.permission_key = 'inventory_setup.manage'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0064_stock_balance.sql', 'stock-balance');
