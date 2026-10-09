-- Internal Transfers: one Inventory document for moving company-owned stock between warehouses of the company or between locations of one
-- warehouse — never a sale, a purchase, a goods issue or a change of owner, never a change of disposition.
--
--   Warehouse transfer, in transit (default): Draft → Confirmed (source stock reserved) → Dispatched (source → the system transit position) →
--     Partially received → Completed (transit → destination, partly or in full). A transit loss is written off only on purpose.
--   Warehouse transfer, direct: Draft → Confirmed → Completed (source → destination at once).
--   Location transfer (one warehouse): Draft → Completed.
--   Cancelled before dispatch (the reservation released); Reversed only to undo a posting mistake.
--
-- Lines carry the unit entered with its conversion, the source and destination locations and the disposition the stock keeps; batch-tracked
-- lines their batches, serial-tracked lines their serial numbers — the same identities from source to destination. Every leg is a Stock Ledger
-- movement at the cost the stock left with. The earlier one-item stock_transfers table is no longer written (it holds no rows on live).

-- ============================================================ 1. documents
CREATE TABLE IF NOT EXISTS tenant.inventory_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  document_number text NOT NULL,
  transfer_type text NOT NULL CHECK (transfer_type IN ('warehouse', 'location')),
  transfer_mode text NOT NULL CHECK (transfer_mode IN ('direct', 'in_transit')),
  source_warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  destination_warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  transfer_date date NOT NULL,
  expected_arrival_date date,
  dispatch_date date,
  receipt_date date,
  reason_code text NOT NULL DEFAULT 'stock_rebalancing'
    CHECK (reason_code IN ('stock_rebalancing', 'fulfillment_requirement', 'warehouse_relocation', 'quality_movement', 'other')),
  reference text,
  carrier text,
  vehicle_number text,
  transport_reference text,
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'dispatched', 'partially_received', 'completed', 'cancelled', 'reversed')),
  discrepancy_note text,
  idempotency_key text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  dispatched_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  dispatched_at timestamptz,
  completed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason text,
  reversed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reversed_at timestamptz,
  reversal_reason text,
  UNIQUE (organization_id, document_number),
  UNIQUE (organization_id, idempotency_key),
  -- A warehouse transfer goes between two warehouses; a location transfer stays in one, and is never in transit.
  CHECK ((transfer_type = 'warehouse') = (source_warehouse_id <> destination_warehouse_id)),
  CHECK (transfer_type = 'warehouse' OR transfer_mode = 'direct')
);
CREATE INDEX IF NOT EXISTS inventory_transfers_list_idx ON tenant.inventory_transfers (organization_id, status, transfer_date DESC);
CREATE INDEX IF NOT EXISTS inventory_transfers_source_idx ON tenant.inventory_transfers (organization_id, source_warehouse_id, status);
CREATE INDEX IF NOT EXISTS inventory_transfers_destination_idx ON tenant.inventory_transfers (organization_id, destination_warehouse_id, status);

CREATE TABLE IF NOT EXISTS tenant.inventory_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  transfer_id uuid NOT NULL REFERENCES tenant.inventory_transfers(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  item_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  quantity numeric(24, 6) NOT NULL CHECK (quantity > 0),
  uom_id uuid NOT NULL,
  conversion_factor numeric(24, 10) NOT NULL CHECK (conversion_factor > 0),
  base_quantity numeric(20, 6) NOT NULL CHECK (base_quantity > 0),
  source_location_id uuid REFERENCES tenant.warehouse_locations(id),
  destination_location_id uuid REFERENCES tenant.warehouse_locations(id),
  disposition text NOT NULL DEFAULT 'available' CHECK (disposition IN ('available', 'quality_hold', 'quarantined', 'damaged', 'expired')),
  dispatched_base_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  received_base_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  lost_base_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, transfer_id, line_number),
  CHECK (received_base_quantity + lost_base_quantity <= dispatched_base_quantity AND dispatched_base_quantity <= base_quantity)
);
ALTER TABLE tenant.inventory_transfer_lines ADD CONSTRAINT inventory_transfer_lines_uom_fkey FOREIGN KEY (organization_id, uom_id) REFERENCES tenant.units_of_measure(organization_id, id);
CREATE INDEX IF NOT EXISTS inventory_transfer_lines_item_idx ON tenant.inventory_transfer_lines (organization_id, item_id);

-- A batch-tracked line's batches (they add up to the line), and how much of each has arrived or been written off in transit.
CREATE TABLE IF NOT EXISTS tenant.inventory_transfer_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  line_id uuid NOT NULL REFERENCES tenant.inventory_transfer_lines(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES tenant.stock_batches(id),
  base_quantity numeric(20, 6) NOT NULL CHECK (base_quantity > 0),
  received_base_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  lost_base_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  UNIQUE (line_id, batch_id),
  CHECK (received_base_quantity + lost_base_quantity <= base_quantity)
);

-- A serial-tracked line's serial numbers: the same unit from source to destination.
CREATE TABLE IF NOT EXISTS tenant.inventory_transfer_serials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  line_id uuid NOT NULL REFERENCES tenant.inventory_transfer_lines(id) ON DELETE CASCADE,
  serial_id uuid NOT NULL REFERENCES tenant.stock_serials(id),
  status text NOT NULL DEFAULT 'allocated' CHECK (status IN ('allocated', 'in_transit', 'received', 'lost')),
  UNIQUE (line_id, serial_id)
);

CREATE TABLE IF NOT EXISTS tenant.inventory_transfer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  transfer_id uuid NOT NULL REFERENCES tenant.inventory_transfers(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS inventory_transfer_events_idx ON tenant.inventory_transfer_events (organization_id, transfer_id, created_at);

-- ============================================================ 2. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['inventory_transfers', 'inventory_transfer_lines', 'inventory_transfer_lots', 'inventory_transfer_serials', 'inventory_transfer_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', name);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
REVOKE UPDATE, DELETE ON tenant.inventory_transfer_events FROM vercent_app;

-- ============================================================ 3. permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('stock.transfers.view', 'View transfers', 'Inventory', 'See internal transfers, their lines, in-transit stock and stock movements.'),
  ('stock.transfers.create', 'Prepare transfers', 'Inventory', 'Create, edit and cancel draft transfers.'),
  ('stock.transfers.confirm', 'Confirm transfers', 'Inventory', 'Confirm a transfer (reserving its source stock) and cancel a confirmed one.'),
  ('stock.transfers.dispatch', 'Dispatch transfers', 'Inventory', 'Dispatch a confirmed transfer from its source warehouse, or complete a direct or location transfer.'),
  ('stock.transfers.receive', 'Receive transfers', 'Inventory', 'Receive a dispatched transfer at its destination, fully or partly.'),
  ('stock.transfers.restricted', 'Transfer restricted stock', 'Inventory', 'Move stock on quality hold, quarantined, damaged or expired (it keeps its disposition).'),
  ('stock.transfers.write_off', 'Write off transit losses', 'Inventory', 'Write off stock confirmed lost in transit.'),
  ('stock.transfers.reverse', 'Reverse transfers', 'Inventory', 'Reverse a completed transfer posted in error.'),
  ('stock.transfers.export', 'Export transfers', 'Inventory', 'Download the transfer list.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, granted.key FROM public.role_permissions existing
  JOIN (VALUES ('stock.view', 'stock.transfers.view'), ('stock.transfer', 'stock.transfers.view'), ('stock.transfer', 'stock.transfers.create'), ('stock.transfer', 'stock.transfers.confirm'),
               ('stock.transfer', 'stock.transfers.dispatch'), ('stock.transfer', 'stock.transfers.receive'), ('stock.adjust', 'stock.transfers.restricted'),
               ('stock.adjust', 'stock.transfers.write_off'), ('inventory_setup.manage', 'stock.transfers.restricted'), ('inventory_setup.manage', 'stock.transfers.write_off'),
               ('inventory_setup.manage', 'stock.transfers.reverse'), ('stock.reports.view', 'stock.transfers.export'), ('inventory_setup.manage', 'stock.transfers.export'))
       AS granted(source, key) ON granted.source = existing.permission_key
  JOIN public.permissions permission ON permission.key = granted.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0070_internal_transfers.sql', 'internal-transfers');
