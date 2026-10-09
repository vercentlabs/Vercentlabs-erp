-- Quarantine / Quality-Held Stock: one Inventory workflow (the Quality Hold case) that keeps owned stock on hand while it may not be sold,
-- reserved, issued or consumed until an authorised quality decision. Quality hold and quarantine are dispositions of the stock, not warehouses:
-- the hold moves stock (a balanced Disposition Out / Disposition In in the Stock Ledger) into a location of the warehouse whose disposition is
-- quality hold, quarantined or damaged; on hand never changes, Available does.
--
-- A hold case: Draft (no stock effect) → Active (stock restricted) → Partially resolved → Resolved, or Cancelled while a draft. Lines say what
-- (item, quantity in the line's unit and in base); allocations say exactly where the held stock is (warehouse, location, batch, serial) and how
-- much of it is still held. Resolutions record every outcome — released to available, escalated to quarantine, moved to damaged, returned to
-- the supplier, disposed of, transferred, adjusted — and the document that did it. The hold case belongs to the company: an allocation follows
-- held stock that is moved or transferred. Goods receipts and sales returns into hold open a case for what they put on hold.
--
-- Replaces the earlier logical quality holds (tenant.quality_holds: a quantity gate with no stock movement, kept as history; they no longer
-- restrict stock).

-- ============================================================ 1. reasons
CREATE TABLE IF NOT EXISTS tenant.inventory_hold_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  default_hold_type text NOT NULL DEFAULT 'quality_hold' CHECK (default_hold_type IN ('quality_hold', 'quarantine')),
  requires_notes boolean NOT NULL DEFAULT false,
  default_review_days integer CHECK (default_review_days IS NULL OR default_review_days BETWEEN 0 AND 365),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  system boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

-- ============================================================ 2. hold cases
CREATE TABLE IF NOT EXISTS tenant.inventory_stock_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  document_number text NOT NULL,
  hold_type text NOT NULL CHECK (hold_type IN ('quality_hold', 'quarantine')),
  reason_id uuid NOT NULL REFERENCES tenant.inventory_hold_reasons(id),
  source_document_type text NOT NULL DEFAULT 'manual' CHECK (source_document_type IN ('manual', 'goods_receipt', 'sales_return', 'existing_stock')),
  source_document_id uuid,
  source_document_number text,
  source_line_id uuid,
  origin_warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  assigned_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  review_due_on date,
  inspection_result text CHECK (inspection_result IS NULL OR inspection_result IN ('pass', 'fail', 'partial_pass', 'escalate')),
  inspection_notes text,
  decision_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decision_at timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'partially_resolved', 'resolved', 'cancelled')),
  notes text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  activated_at timestamptz,
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason text,
  movement_group_id uuid REFERENCES tenant.stock_movement_groups(id),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, document_number),
  CHECK (status = 'draft' OR status = 'cancelled' OR activated_at IS NOT NULL)
);
-- A goods receipt or sales return line opens at most one case.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_stock_holds_source_line_uidx ON tenant.inventory_stock_holds (organization_id, source_document_type, source_line_id) WHERE source_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_stock_holds_list_idx ON tenant.inventory_stock_holds (organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant.inventory_stock_hold_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  hold_id uuid NOT NULL REFERENCES tenant.inventory_stock_holds(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  sku_snapshot text NOT NULL,
  item_name_snapshot text NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  source_location_id uuid REFERENCES tenant.warehouse_locations(id),
  target_location_id uuid REFERENCES tenant.warehouse_locations(id),
  batch_id uuid REFERENCES tenant.stock_batches(id),
  serial_ids uuid[] NOT NULL DEFAULT '{}',
  uom_id uuid REFERENCES tenant.units_of_measure(id),
  conversion_factor numeric(24,10) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  transaction_quantity numeric(20,6) NOT NULL CHECK (transaction_quantity > 0),
  original_base_quantity numeric(20,6) NOT NULL CHECK (original_base_quantity > 0),
  unresolved_base_quantity numeric(20,6) NOT NULL CHECK (unresolved_base_quantity >= 0),
  source_disposition text NOT NULL CHECK (source_disposition IN ('available', 'quality_hold', 'quarantined', 'damaged')),
  hold_disposition text NOT NULL CHECK (hold_disposition IN ('quality_hold', 'quarantined')),
  notes text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hold_id, line_number)
);
CREATE INDEX IF NOT EXISTS inventory_stock_hold_lines_item_idx ON tenant.inventory_stock_hold_lines (organization_id, item_id);

-- Where the held stock is. status: active (held there now), resolved (nothing left held there), moved (carried to another position — the
-- allocation that took it over names this one).
CREATE TABLE IF NOT EXISTS tenant.inventory_stock_hold_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  hold_id uuid NOT NULL REFERENCES tenant.inventory_stock_holds(id),
  line_id uuid NOT NULL REFERENCES tenant.inventory_stock_hold_lines(id),
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  location_id uuid REFERENCES tenant.warehouse_locations(id),
  batch_id uuid REFERENCES tenant.stock_batches(id),
  serial_id uuid REFERENCES tenant.stock_serials(id),
  held_base_quantity numeric(20,6) NOT NULL CHECK (held_base_quantity > 0),
  resolved_base_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (resolved_base_quantity >= 0),
  current_disposition text NOT NULL CHECK (current_disposition IN ('quality_hold', 'quarantined', 'damaged')),
  carried_from_allocation_id uuid REFERENCES tenant.inventory_stock_hold_allocations(id),
  -- In transit: the transfer line the held stock travels with (only that transfer takes it out of transit).
  carried_reference_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'moved')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (resolved_base_quantity <= held_base_quantity),
  CHECK (serial_id IS NULL OR held_base_quantity = 1)
);
-- Finding the held stock at a stock position (every movement out of a held position looks it up).
CREATE INDEX IF NOT EXISTS inventory_stock_hold_allocations_position_idx ON tenant.inventory_stock_hold_allocations (organization_id, item_id, warehouse_id, location_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS inventory_stock_hold_allocations_hold_idx ON tenant.inventory_stock_hold_allocations (organization_id, hold_id);

-- ============================================================ 3. outcomes and history
-- Every quantity that left (or changed) held stock, and what did it. action: placed (stock put on hold), released (back to available),
-- escalated (quality hold → quarantine), damaged, purchase_return, disposed, transferred (carried with the stock), adjusted, issued.
CREATE TABLE IF NOT EXISTS tenant.inventory_stock_hold_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  hold_id uuid NOT NULL REFERENCES tenant.inventory_stock_holds(id),
  line_id uuid NOT NULL REFERENCES tenant.inventory_stock_hold_lines(id),
  allocation_id uuid REFERENCES tenant.inventory_stock_hold_allocations(id),
  action text NOT NULL CHECK (action IN ('placed', 'released', 'escalated', 'damaged', 'purchase_return', 'disposed', 'transferred', 'adjusted', 'issued')),
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  from_disposition text,
  to_disposition text,
  from_location_id uuid REFERENCES tenant.warehouse_locations(id),
  to_location_id uuid REFERENCES tenant.warehouse_locations(id),
  movement_id uuid REFERENCES tenant.stock_movements(id),
  document_type text,
  document_id uuid,
  document_number text,
  reason text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS inventory_stock_hold_resolutions_hold_idx ON tenant.inventory_stock_hold_resolutions (organization_id, hold_id, created_at);
CREATE INDEX IF NOT EXISTS inventory_stock_hold_resolutions_movement_idx ON tenant.inventory_stock_hold_resolutions (organization_id, movement_id) WHERE movement_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.inventory_stock_hold_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  hold_id uuid NOT NULL REFERENCES tenant.inventory_stock_holds(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS inventory_stock_hold_events_idx ON tenant.inventory_stock_hold_events (organization_id, hold_id, created_at);

-- ============================================================ 4. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['inventory_hold_reasons', 'inventory_stock_holds', 'inventory_stock_hold_lines', 'inventory_stock_hold_allocations', 'inventory_stock_hold_resolutions',
    'inventory_stock_hold_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', name);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
-- Outcomes and history are evidence: never edited or removed by the application.
REVOKE UPDATE, DELETE ON tenant.inventory_stock_hold_resolutions, tenant.inventory_stock_hold_events FROM vercent_app;
REVOKE DELETE ON tenant.inventory_stock_hold_allocations FROM vercent_app;

-- ============================================================ 5. permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('stock.holds.view', 'View quality-held stock', 'Inventory', 'See quality holds, quarantined stock and their history.'),
  ('stock.holds.create', 'Create quality holds', 'Inventory', 'Create draft quality holds.'),
  ('stock.holds.edit_draft', 'Edit draft quality holds', 'Inventory', 'Change or cancel a draft quality hold.'),
  ('stock.holds.place', 'Place stock on quality hold', 'Inventory', 'Activate a quality hold: move stock into quality hold.'),
  ('stock.holds.place_quarantine', 'Place stock in quarantine', 'Inventory', 'Activate a quarantine: move stock into quarantine.'),
  ('stock.holds.release', 'Release quality-held stock', 'Inventory', 'Release stock on quality hold back to available.'),
  ('stock.holds.release_quarantine', 'Release quarantined stock', 'Inventory', 'Release quarantined stock back to available (stronger than releasing a quality hold).'),
  ('stock.holds.partial_release', 'Partly release held stock', 'Inventory', 'Release part of a hold and keep the rest held.'),
  ('stock.holds.escalate', 'Escalate holds to quarantine', 'Inventory', 'Move quality-held stock into quarantine.'),
  ('stock.holds.damage', 'Move held stock to damaged', 'Inventory', 'Move held stock to damaged.'),
  ('stock.holds.batch', 'Hold batch stock', 'Inventory', 'Place and release batch-tracked stock.'),
  ('stock.holds.serial', 'Hold serial-numbered stock', 'Inventory', 'Place and release serial-numbered stock.'),
  ('stock.holds.resolve_reservations', 'Resolve hold reservation conflicts', 'Inventory', 'Hold stock that reservations rely on: they are reallocated or released.'),
  ('stock.holds.view_history', 'View quality hold history', 'Inventory', 'See every movement, decision and outcome of a hold.'),
  ('stock.holds.view_value', 'View held stock value', 'Inventory', 'See the inventory value of held stock.'),
  ('stock.holds.manage_reasons', 'Manage hold reasons', 'Inventory', 'Add, change and deactivate hold reasons.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, granted.key FROM public.role_permissions existing
  JOIN (VALUES ('stock.view', 'stock.holds.view'), ('stock.view', 'stock.holds.view_history'),
               ('stock.adjust', 'stock.holds.view'), ('stock.adjust', 'stock.holds.create'), ('stock.adjust', 'stock.holds.edit_draft'), ('stock.adjust', 'stock.holds.place'),
               ('stock.adjust', 'stock.holds.release'), ('stock.adjust', 'stock.holds.partial_release'), ('stock.adjust', 'stock.holds.batch'), ('stock.adjust', 'stock.holds.serial'),
               ('stock.adjust', 'stock.holds.view_history'),
               ('quality.hold', 'stock.holds.view'), ('quality.hold', 'stock.holds.create'), ('quality.hold', 'stock.holds.edit_draft'), ('quality.hold', 'stock.holds.place'),
               ('quality.hold', 'stock.holds.place_quarantine'), ('quality.hold', 'stock.holds.escalate'), ('quality.hold', 'stock.holds.damage'), ('quality.hold', 'stock.holds.batch'),
               ('quality.hold', 'stock.holds.serial'), ('quality.hold', 'stock.holds.view_history'),
               ('quality.release', 'stock.holds.release'), ('quality.release', 'stock.holds.partial_release'), ('quality.manage', 'stock.holds.release_quarantine'),
               ('inventory_setup.manage', 'stock.holds.place_quarantine'), ('inventory_setup.manage', 'stock.holds.escalate'), ('inventory_setup.manage', 'stock.holds.damage'),
               ('inventory_setup.manage', 'stock.holds.release_quarantine'), ('inventory_setup.manage', 'stock.holds.resolve_reservations'),
               ('inventory_setup.manage', 'stock.holds.manage_reasons'), ('stock.valuation.view', 'stock.holds.view_value'))
       AS granted(source, key) ON granted.source = existing.permission_key
  JOIN public.permissions permission ON permission.key = granted.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0076_quality_holds.sql', 'quality-holds');
