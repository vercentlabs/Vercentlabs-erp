-- Physical Inventory / Stock Count: verifying recorded stock against what physically exists in a warehouse, and turning confirmed differences
-- into one linked Stock Adjustment. A count discovers and proves discrepancies; the adjustment corrects them — the count itself never moves
-- or edits stock.
--
-- One document per company and warehouse, scoped to the whole warehouse, some locations, or some items (optionally in some locations): Draft →
-- In Progress (Start: the system stock of every position in scope is captured — quantity, balance version, last movement — lines are generated,
-- and the scope is frozen by count locks that every stock movement checks) → Ready for Review → Completed (the variances posted as one Stock
-- Adjustment, the locks released), or Cancelled. Each count attempt is kept (a recount never overwrites the first); serial numbers are counted
-- by identity (present, missing, unexpected); blank means not counted, zero means counted and none found. A completed count is never edited.
--
-- Replaces the earlier counts (tenant.stock_counts, kept as history; there is no data to carry over).

-- ============================================================ 1. counts and their scope
CREATE TABLE IF NOT EXISTS tenant.physical_inventory_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  document_number text NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  count_type text NOT NULL CHECK (count_type IN ('full_warehouse', 'locations', 'items')),
  blind_count boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'ready_for_review', 'completed', 'cancelled')),
  snapshot_at timestamptz,
  assigned_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  recount_threshold_percent numeric(7, 3) CHECK (recount_threshold_percent IS NULL OR recount_threshold_percent >= 0),
  reference text,
  instructions text,
  linked_adjustment_id uuid REFERENCES tenant.inventory_adjustments(id),
  idempotency_key text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  started_at timestamptz,
  submitted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  completed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason text,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, document_number),
  UNIQUE (organization_id, idempotency_key),
  CHECK ((status IN ('draft', 'cancelled')) OR snapshot_at IS NOT NULL),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS physical_inventory_counts_list_idx ON tenant.physical_inventory_counts (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS physical_inventory_counts_warehouse_idx ON tenant.physical_inventory_counts (organization_id, warehouse_id);

-- What a count covers: a location (location_scoped; location_id null is MAIN), an item, or an item in a location. A full-warehouse count has none.
CREATE TABLE IF NOT EXISTS tenant.physical_inventory_count_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  count_id uuid NOT NULL REFERENCES tenant.physical_inventory_counts(id) ON DELETE CASCADE,
  location_scoped boolean NOT NULL DEFAULT false,
  location_id uuid REFERENCES tenant.warehouse_locations(id),
  item_id uuid REFERENCES tenant.items(id),
  CHECK (location_scoped OR location_id IS NULL),
  CHECK (location_scoped OR item_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS physical_inventory_count_scopes_idx ON tenant.physical_inventory_count_scopes (organization_id, count_id);

-- ============================================================ 2. lines, attempts and serial numbers
-- One line per stock position at the snapshot (item, location, disposition, batch), or one found that the system did not know (unexpected).
-- Serial-numbered items: one line per item and location; their serial numbers are counted below.
CREATE TABLE IF NOT EXISTS tenant.physical_inventory_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  count_id uuid NOT NULL REFERENCES tenant.physical_inventory_counts(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  item_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  tracking_type text NOT NULL DEFAULT 'none',
  location_id uuid REFERENCES tenant.warehouse_locations(id),
  disposition text NOT NULL DEFAULT 'available' CHECK (disposition IN ('available', 'quality_hold', 'quarantined', 'damaged', 'expired')),
  batch_id uuid REFERENCES tenant.stock_batches(id),
  new_batch_number text,
  new_expires_on date,
  base_uom_id uuid,
  system_base_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  balance_version_snapshot bigint,
  last_movement_snapshot uuid,
  counted_base_quantity numeric(20, 6) CHECK (counted_base_quantity IS NULL OR counted_base_quantity >= 0),
  accepted_counted_base_quantity numeric(20, 6),
  variance_base_quantity numeric(20, 6),
  line_status text NOT NULL DEFAULT 'not_counted' CHECK (line_status IN ('not_counted', 'counted', 'recount_required', 'accepted')),
  is_unexpected boolean NOT NULL DEFAULT false,
  resolution_type text NOT NULL DEFAULT 'stock_adjustment'
    CHECK (resolution_type IN ('no_action', 'stock_adjustment', 'location_transfer', 'disposition_movement', 'manual_investigation')),
  resolution_note text,
  valuation_source text CHECK (valuation_source IS NULL OR valuation_source IN ('current_valuation_cost', 'manual_authorized_cost', 'zero_cost_authorized')),
  manual_unit_cost numeric(20, 6) CHECK (manual_unit_cost IS NULL OR manual_unit_cost >= 0),
  cost_note text,
  notes text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, count_id, line_number),
  CHECK (new_batch_number IS NULL OR (batch_id IS NULL AND is_unexpected))
);
CREATE INDEX IF NOT EXISTS physical_inventory_count_lines_idx ON tenant.physical_inventory_count_lines (organization_id, count_id, line_status);
CREATE INDEX IF NOT EXISTS physical_inventory_count_lines_item_idx ON tenant.physical_inventory_count_lines (organization_id, item_id);
CREATE UNIQUE INDEX IF NOT EXISTS physical_inventory_count_lines_position_uidx ON tenant.physical_inventory_count_lines
  (count_id, item_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid), disposition, COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::uuid),
   COALESCE(lower(new_batch_number), ''));

-- Every count attempt, never overwritten: a recount adds the next attempt.
CREATE TABLE IF NOT EXISTS tenant.physical_inventory_count_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  line_id uuid NOT NULL REFERENCES tenant.physical_inventory_count_lines(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  entered_quantity numeric(24, 6) NOT NULL CHECK (entered_quantity >= 0),
  entered_uom_id uuid,
  conversion_factor numeric(24, 10) NOT NULL CHECK (conversion_factor > 0),
  counted_base_quantity numeric(20, 6) NOT NULL CHECK (counted_base_quantity >= 0),
  entry_source text NOT NULL DEFAULT 'manual' CHECK (entry_source IN ('manual', 'scan', 'import')),
  notes text,
  counted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  counted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (line_id, attempt_number)
);

-- Serial numbers by identity: each expected one present or missing, each unexpected one found.
CREATE TABLE IF NOT EXISTS tenant.physical_inventory_serial_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  count_id uuid NOT NULL REFERENCES tenant.physical_inventory_counts(id) ON DELETE CASCADE,
  line_id uuid NOT NULL REFERENCES tenant.physical_inventory_count_lines(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  expected_serial_id uuid REFERENCES tenant.stock_serials(id),
  scanned_serial_id uuid REFERENCES tenant.stock_serials(id),
  serial_number text NOT NULL,
  location_id uuid REFERENCES tenant.warehouse_locations(id),
  expected boolean NOT NULL,
  count_result text CHECK (count_result IS NULL OR count_result IN ('present', 'missing', 'unexpected')),
  counted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  counted_at timestamptz,
  CHECK (expected = (expected_serial_id IS NOT NULL)),
  CHECK (expected OR count_result = 'unexpected')
);
CREATE UNIQUE INDEX IF NOT EXISTS physical_inventory_serial_counts_uidx ON tenant.physical_inventory_serial_counts (count_id, lower(serial_number));

-- ============================================================ 3. the count freeze
-- While a count is in progress or under review, its scope is locked: no stock moves into or out of a locked position and no new reservation is
-- made on it (Inventory checks these locks on every movement). location_scoped false: every location; item_id null: every item.
CREATE TABLE IF NOT EXISTS tenant.inventory_count_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  count_id uuid NOT NULL REFERENCES tenant.physical_inventory_counts(id),
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  location_scoped boolean NOT NULL DEFAULT false,
  location_id uuid REFERENCES tenant.warehouse_locations(id),
  item_id uuid REFERENCES tenant.items(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);
CREATE INDEX IF NOT EXISTS inventory_count_locks_active_idx ON tenant.inventory_count_locks (organization_id, warehouse_id) WHERE released_at IS NULL;

-- ============================================================ 4. history
CREATE TABLE IF NOT EXISTS tenant.physical_inventory_count_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  count_id uuid NOT NULL REFERENCES tenant.physical_inventory_counts(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS physical_inventory_count_events_idx ON tenant.physical_inventory_count_events (organization_id, count_id, created_at);

-- ============================================================ 5. the adjustment a count posts; a reason per adjustment line
ALTER TABLE tenant.inventory_adjustments ADD COLUMN IF NOT EXISTS physical_count_id uuid REFERENCES tenant.physical_inventory_counts(id);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_adjustments_physical_count_uidx ON tenant.inventory_adjustments (physical_count_id) WHERE physical_count_id IS NOT NULL AND status <> 'cancelled';
-- A count's gains and losses go in one adjustment: each line carries its own reason (Physical count gain / loss); the header's is the default.
ALTER TABLE tenant.inventory_adjustment_lines ADD COLUMN IF NOT EXISTS reason_id uuid REFERENCES tenant.inventory_adjustment_reasons(id);

-- ============================================================ 6. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['physical_inventory_counts', 'physical_inventory_count_scopes', 'physical_inventory_count_lines', 'physical_inventory_count_entries',
    'physical_inventory_serial_counts', 'inventory_count_locks', 'physical_inventory_count_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', name);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
-- Count attempts and the history are evidence: never edited or removed by the application.
REVOKE UPDATE, DELETE ON tenant.physical_inventory_count_entries, tenant.physical_inventory_count_events FROM vercent_app;

-- ============================================================ 7. permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('stock.counts.view', 'View stock counts', 'Inventory', 'See stock counts, their lines and progress.'),
  ('stock.counts.create', 'Create stock counts', 'Inventory', 'Create draft stock counts.'),
  ('stock.counts.configure', 'Configure count scope', 'Inventory', 'Choose the locations and items a count covers, blind counting and recount threshold.'),
  ('stock.counts.start', 'Start stock counts', 'Inventory', 'Start a count: capture the system stock and freeze its scope.'),
  ('stock.counts.count', 'Enter physical counts', 'Inventory', 'Enter counted quantities.'),
  ('stock.counts.count_batch', 'Count batches', 'Inventory', 'Enter counts batch by batch.'),
  ('stock.counts.count_serial', 'Count serial numbers', 'Inventory', 'Record serial numbers present, missing and found.'),
  ('stock.counts.add_unexpected', 'Add unexpected stock', 'Inventory', 'Record stock found that the system does not know.'),
  ('stock.counts.import', 'Import count entries', 'Inventory', 'Import counted quantities from a count sheet.'),
  ('stock.counts.submit', 'Submit stock counts', 'Inventory', 'Submit a count for review.'),
  ('stock.counts.request_recount', 'Request recounts', 'Inventory', 'Ask for lines to be counted again.'),
  ('stock.counts.recount', 'Recount', 'Inventory', 'Count lines again when a recount is requested.'),
  ('stock.counts.review', 'Review stock count variances', 'Inventory', 'Review variances, accept counts and choose how each variance is resolved.'),
  ('stock.counts.view_system_quantity', 'See system quantity in blind counts', 'Inventory', 'See the system quantity and variance while a blind count is open.'),
  ('stock.counts.view_value', 'See stock count value', 'Inventory', 'See the inventory value of count variances.'),
  ('stock.counts.resolve_reservations', 'Resolve count reservation conflicts', 'Inventory', 'Release or reallocate reservations a count shortage breaks.'),
  ('stock.counts.complete', 'Complete stock counts', 'Inventory', 'Complete a count, posting its variances as a stock adjustment.'),
  ('stock.counts.cancel', 'Cancel stock counts', 'Inventory', 'Cancel a started count (its freeze is released).'),
  ('stock.counts.export', 'Export count sheets', 'Inventory', 'Print or export count sheets.'),
  ('stock.counts.view_history', 'View stock count history', 'Inventory', 'See every count attempt and event.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, granted.key FROM public.role_permissions existing
  JOIN (VALUES ('stock.view', 'stock.counts.view'), ('stock.view', 'stock.counts.view_history'),
               ('stock.count', 'stock.counts.view'), ('stock.count', 'stock.counts.count'), ('stock.count', 'stock.counts.count_batch'), ('stock.count', 'stock.counts.count_serial'),
               ('stock.count', 'stock.counts.add_unexpected'), ('stock.count', 'stock.counts.import'), ('stock.count', 'stock.counts.submit'), ('stock.count', 'stock.counts.recount'),
               ('stock.count', 'stock.counts.export'), ('stock.count', 'stock.counts.view_history'),
               ('stock.adjust', 'stock.counts.create'), ('stock.adjust', 'stock.counts.configure'), ('stock.adjust', 'stock.counts.start'), ('stock.adjust', 'stock.counts.request_recount'),
               ('stock.adjust', 'stock.counts.review'), ('stock.adjust', 'stock.counts.view_system_quantity'), ('stock.adjust', 'stock.counts.complete'), ('stock.adjust', 'stock.counts.export'),
               ('stock.valuation.view', 'stock.counts.view_value'),
               ('inventory_setup.manage', 'stock.counts.resolve_reservations'), ('inventory_setup.manage', 'stock.counts.cancel'))
       AS granted(source, key) ON granted.source = existing.permission_key
  JOIN public.permissions permission ON permission.key = granted.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0073_stock_counts.sql', 'stock-counts');
