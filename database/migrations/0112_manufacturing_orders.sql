-- Manufacturing Orders: the authoritative instruction and execution record for producing a quantity of an item from an approved BOM revision.
-- The order owns the production workflow; Inventory owns the stock (reservations, issues, returns, finished-goods receipts — posted through
-- its own movements and reservations, source type 'manufacturing_work_order'); Finance owns the accounting (work in progress, finished-goods
-- capitalisation, variance) through the shared posting service.
--
--   orders              DRAFT → AWAITING_APPROVAL → RELEASED → IN_PROGRESS → COMPLETED (ON_HOLD from released or in progress; CANCELLED while
--                       nothing physical is unresolved). The frozen recipe (a BOM snapshot), warehouses, schedule, demand source, the parent
--                       order of a subassembly order, and the running quantities and work-in-progress values.
--   materials           one line per recipe line (or an approved extra material): planned and authorised extra quantity, issued, returned,
--                       consumed, issue cost and the estimate. Reservations are Inventory's, read from it.
--   material movements  each issue to production and each return from it: the Inventory movements and the journal behind it. Append-only.
--   consumption         what production actually used of what was issued. Append-only.
--   variances           requests for material beyond the plan and their decision (never a change to the BOM).
--   production entries  output reported: accepted, rejected and awaiting inspection; quality decisions settle the pending part. Append-only.
--   receipts            accepted output received into finished-goods stock, at its material cost. Append-only.
--   exceptions          holds and problems that block completion until resolved.
--   events              the history of everything above.
--
-- The earlier production-order tables stay unused (no DROP); Inventory's 'manufacturing_work_order' source now names these orders.

-- ============================================================ 1. orders
CREATE TABLE IF NOT EXISTS tenant.manufacturing_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  mo_number text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'AWAITING_APPROVAL', 'RELEASED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETION_PENDING', 'COMPLETED', 'CANCELLED', 'RECOVERY_REQUIRED')),
  held_from_status text CHECK (held_from_status IS NULL OR held_from_status IN ('RELEASED', 'IN_PROGRESS')),
  finished_item_id uuid NOT NULL REFERENCES tenant.items(id),
  planned_quantity numeric(20, 6) NOT NULL CHECK (planned_quantity > 0),
  output_uom_id uuid NOT NULL REFERENCES tenant.units_of_measure(id),
  planned_base_quantity numeric(20, 6) NOT NULL CHECK (planned_base_quantity > 0),
  bom_id uuid REFERENCES tenant.manufacturing_bom_masters(id),
  bom_revision_id uuid REFERENCES tenant.manufacturing_bom_revisions(id),
  bom_snapshot_id uuid REFERENCES tenant.manufacturing_bom_snapshots(id),
  manufacturing_warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  material_warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  finished_goods_warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  planned_start_at timestamptz NOT NULL,
  planned_end_at timestamptz NOT NULL,
  actual_start_at timestamptz,
  completed_at timestamptz,
  source_demand_type text NOT NULL DEFAULT 'MANUAL' CHECK (source_demand_type IN ('MANUAL', 'SALES_ORDER', 'PLANNING', 'PARENT_ORDER')),
  source_demand_id uuid,
  source_reference text,
  parent_order_id uuid REFERENCES tenant.manufacturing_orders(id),
  parent_material_id uuid,
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH')),
  notes text,
  production_owner_id uuid REFERENCES public.users(id),
  -- Output, in the finished item's base unit: reported = accepted + rejected + awaiting inspection; received never exceeds accepted.
  reported_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (reported_quantity >= 0),
  accepted_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0),
  rejected_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  pending_inspection_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (pending_inspection_quantity >= 0),
  received_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  -- Work in progress, in the base currency: net material issued in, value received out to finished goods, the variance closed at completion.
  estimated_material_cost numeric(20, 2),
  wip_material_cost numeric(20, 2) NOT NULL DEFAULT 0,
  wip_capitalised_cost numeric(20, 2) NOT NULL DEFAULT 0,
  wip_variance_cost numeric(20, 2) NOT NULL DEFAULT 0,
  submitted_by uuid REFERENCES public.users(id),
  submitted_at timestamptz,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  approval_note text,
  returned_reason text,
  released_by uuid REFERENCES public.users(id),
  released_at timestamptz,
  started_by uuid REFERENCES public.users(id),
  partial_start_reason text,
  hold_reason text,
  hold_category text,
  completed_by uuid REFERENCES public.users(id),
  short_close_reason text,
  completion_summary jsonb,
  cancelled_by uuid REFERENCES public.users(id),
  cancelled_at timestamptz,
  cancel_reason text,
  idempotency_key text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (planned_end_at >= planned_start_at),
  CHECK (accepted_quantity + rejected_quantity + pending_inspection_quantity = reported_quantity),
  CHECK (received_quantity <= accepted_quantity),
  CHECK (status NOT IN ('RELEASED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETION_PENDING', 'COMPLETED') OR (bom_snapshot_id IS NOT NULL AND approved_by IS NOT NULL)),
  CHECK (status <> 'ON_HOLD' OR (held_from_status IS NOT NULL AND hold_reason IS NOT NULL)),
  CHECK (status <> 'CANCELLED' OR cancel_reason IS NOT NULL),
  CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_orders_number_uidx ON tenant.manufacturing_orders (organization_id, mo_number);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_orders_key_uidx ON tenant.manufacturing_orders (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS manufacturing_orders_status_idx ON tenant.manufacturing_orders (organization_id, status, planned_start_at);
CREATE INDEX IF NOT EXISTS manufacturing_orders_item_idx ON tenant.manufacturing_orders (organization_id, finished_item_id);
CREATE INDEX IF NOT EXISTS manufacturing_orders_parent_idx ON tenant.manufacturing_orders (organization_id, parent_order_id) WHERE parent_order_id IS NOT NULL;

-- ============================================================ 2. materials
CREATE TABLE IF NOT EXISTS tenant.manufacturing_order_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  line_number integer NOT NULL CHECK (line_number > 0),
  origin text NOT NULL DEFAULT 'RECIPE' CHECK (origin IN ('RECIPE', 'EXTRA')),
  bom_line_id uuid,
  lineage_id uuid,
  component_item_id uuid NOT NULL REFERENCES tenant.items(id),
  uom_id uuid NOT NULL REFERENCES tenant.units_of_measure(id),
  kind text NOT NULL DEFAULT 'MATERIAL' CHECK (kind IN ('MATERIAL', 'SUBASSEMBLY')),
  -- Quantities in the component's base unit.
  planned_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (planned_quantity >= 0),
  authorized_extra_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (authorized_extra_quantity >= 0),
  issued_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (issued_quantity >= 0),
  returned_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  consumed_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (consumed_quantity >= 0),
  issued_cost numeric(20, 2) NOT NULL DEFAULT 0,
  returned_cost numeric(20, 2) NOT NULL DEFAULT 0,
  estimated_unit_cost numeric(20, 6),
  estimated_cost numeric(20, 2),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (returned_quantity <= issued_quantity),
  -- Consumption never exceeds what is in production custody (issued less returned).
  CHECK (consumed_quantity <= issued_quantity - returned_quantity),
  CHECK (planned_quantity + authorized_extra_quantity > 0 OR origin = 'RECIPE'),
  UNIQUE (manufacturing_order_id, line_number)
);
CREATE INDEX IF NOT EXISTS manufacturing_order_materials_item_idx ON tenant.manufacturing_order_materials (organization_id, component_item_id);

-- ============================================================ 3. material movements (issues and returns)
CREATE TABLE IF NOT EXISTS tenant.manufacturing_order_material_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  material_id uuid NOT NULL REFERENCES tenant.manufacturing_order_materials(id),
  movement_number text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('ISSUE', 'RETURN')),
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(20, 6) NOT NULL CHECK (unit_cost >= 0),
  total_cost numeric(20, 2) NOT NULL CHECK (total_cost >= 0),
  allocations jsonb NOT NULL DEFAULT '[]'::jsonb,
  stock_movement_ids uuid[] NOT NULL DEFAULT '{}',
  journal_entry_id uuid,
  reason text,
  idempotency_key text NOT NULL,
  posted_by uuid REFERENCES public.users(id),
  posted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (direction = 'ISSUE' OR reason IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_order_material_movements_number_uidx ON tenant.manufacturing_order_material_movements (organization_id, movement_number);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_order_material_movements_key_uidx ON tenant.manufacturing_order_material_movements (organization_id, idempotency_key, material_id);
CREATE INDEX IF NOT EXISTS manufacturing_order_material_movements_order_idx ON tenant.manufacturing_order_material_movements (organization_id, manufacturing_order_id, posted_at);

-- ============================================================ 4. consumption
CREATE TABLE IF NOT EXISTS tenant.manufacturing_order_consumption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  material_id uuid NOT NULL REFERENCES tenant.manufacturing_order_materials(id),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  note text,
  automatic boolean NOT NULL DEFAULT false,
  recorded_by uuid REFERENCES public.users(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_order_consumption_order_idx ON tenant.manufacturing_order_consumption (organization_id, manufacturing_order_id);

-- ============================================================ 5. material variances (extra material)
CREATE TABLE IF NOT EXISTS tenant.manufacturing_order_material_variances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  material_id uuid REFERENCES tenant.manufacturing_order_materials(id),
  component_item_id uuid NOT NULL REFERENCES tenant.items(id),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED')),
  requested_by uuid REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_note text,
  CHECK (status = 'REQUESTED' OR decided_by IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS manufacturing_order_material_variances_order_idx ON tenant.manufacturing_order_material_variances (organization_id, manufacturing_order_id, status);

-- ============================================================ 6. production entries and quality decisions
CREATE TABLE IF NOT EXISTS tenant.manufacturing_production_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  entry_number text NOT NULL,
  batch_reference text,
  reported_quantity numeric(20, 6) NOT NULL CHECK (reported_quantity > 0),
  accepted_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0),
  rejected_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  pending_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (pending_quantity >= 0),
  -- What is still awaiting a quality decision (only this column changes after the entry is written).
  pending_remaining numeric(20, 6) NOT NULL DEFAULT 0 CHECK (pending_remaining >= 0),
  rejection_reason text,
  notes text,
  idempotency_key text NOT NULL,
  recorded_by uuid REFERENCES public.users(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (accepted_quantity + rejected_quantity + pending_quantity = reported_quantity),
  CHECK (pending_remaining <= pending_quantity),
  CHECK (rejected_quantity = 0 OR rejection_reason IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_production_entries_number_uidx ON tenant.manufacturing_production_entries (organization_id, entry_number);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_production_entries_key_uidx ON tenant.manufacturing_production_entries (organization_id, idempotency_key);
CREATE INDEX IF NOT EXISTS manufacturing_production_entries_order_idx ON tenant.manufacturing_production_entries (organization_id, manufacturing_order_id, recorded_at);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_quality_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  production_entry_id uuid NOT NULL REFERENCES tenant.manufacturing_production_entries(id),
  accepted_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0),
  rejected_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  rejection_reason text,
  disposition text CHECK (disposition IS NULL OR disposition IN ('SCRAP', 'REWORK')),
  inspection_reference text,
  idempotency_key text NOT NULL,
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (accepted_quantity + rejected_quantity > 0),
  CHECK (rejected_quantity = 0 OR (rejection_reason IS NOT NULL AND disposition IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_quality_decisions_key_uidx ON tenant.manufacturing_quality_decisions (organization_id, idempotency_key);

-- ============================================================ 7. finished-goods receipts
CREATE TABLE IF NOT EXISTS tenant.manufacturing_goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  receipt_number text NOT NULL,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(20, 6) NOT NULL CHECK (unit_cost >= 0),
  total_cost numeric(20, 2) NOT NULL CHECK (total_cost >= 0),
  cost_basis jsonb NOT NULL,
  batch_id uuid REFERENCES tenant.stock_batches(id),
  serial_numbers text[],
  stock_movement_ids uuid[] NOT NULL DEFAULT '{}',
  journal_entry_id uuid,
  idempotency_key text NOT NULL,
  received_by uuid REFERENCES public.users(id),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_goods_receipts_number_uidx ON tenant.manufacturing_goods_receipts (organization_id, receipt_number);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_goods_receipts_key_uidx ON tenant.manufacturing_goods_receipts (organization_id, idempotency_key);

-- ============================================================ 8. exceptions and events
CREATE TABLE IF NOT EXISTS tenant.manufacturing_order_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  category text NOT NULL CHECK (category IN ('MATERIAL_SHORTAGE', 'QUALITY_ISSUE', 'EQUIPMENT_DOWNTIME', 'PRIORITY_CHANGE', 'COST_VARIANCE', 'QUANTITY_VARIANCE', 'POSTING_FAILURE', 'OTHER')),
  reason text NOT NULL,
  source_type text,
  source_id uuid,
  quantity numeric(20, 6),
  value numeric(20, 2),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  raised_by uuid REFERENCES public.users(id),
  raised_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  resolution text,
  CHECK (status = 'OPEN' OR (resolved_by IS NOT NULL AND resolution IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS manufacturing_order_exceptions_order_idx ON tenant.manufacturing_order_exceptions (organization_id, manufacturing_order_id, status);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  action text NOT NULL,
  from_status text,
  to_status text,
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_order_events_order_idx ON tenant.manufacturing_order_events (organization_id, manufacturing_order_id, occurred_at);

-- Material demand handed to Procurement can name the order it is for.
ALTER TABLE tenant.manufacturing_material_demands ADD COLUMN IF NOT EXISTS manufacturing_order_id uuid REFERENCES tenant.manufacturing_orders(id);

-- ============================================================ 9. guards
-- An order moves only along its lifecycle; a completed or cancelled order never changes; nothing is deleted.
CREATE OR REPLACE FUNCTION tenant.manufacturing_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A manufacturing order is cancelled, never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'A % manufacturing order does not change.', lower(OLD.status) USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.mo_number <> OLD.mo_number OR NEW.organization_id <> OLD.organization_id OR NEW.finished_item_id <> OLD.finished_item_id THEN
    RAISE EXCEPTION 'A manufacturing order keeps its number and product.' USING ERRCODE = 'check_violation';
  END IF;
  -- The plan is fixed once released: quantity, recipe and warehouses change only while a draft.
  IF OLD.status NOT IN ('DRAFT', 'AWAITING_APPROVAL') AND (NEW.planned_quantity <> OLD.planned_quantity OR NEW.output_uom_id <> OLD.output_uom_id
      OR NEW.bom_revision_id IS DISTINCT FROM OLD.bom_revision_id OR NEW.bom_snapshot_id IS DISTINCT FROM OLD.bom_snapshot_id
      OR NEW.material_warehouse_id <> OLD.material_warehouse_id OR NEW.finished_goods_warehouse_id <> OLD.finished_goods_warehouse_id) THEN
    RAISE EXCEPTION 'A released manufacturing order keeps its plan; amend it through material variances.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status IN ('AWAITING_APPROVAL', 'CANCELLED'))
    OR (OLD.status = 'AWAITING_APPROVAL' AND NEW.status IN ('DRAFT', 'RELEASED', 'CANCELLED'))
    OR (OLD.status = 'RELEASED' AND NEW.status IN ('IN_PROGRESS', 'ON_HOLD', 'CANCELLED', 'RECOVERY_REQUIRED'))
    OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('ON_HOLD', 'COMPLETION_PENDING', 'COMPLETED', 'CANCELLED', 'RECOVERY_REQUIRED'))
    OR (OLD.status = 'ON_HOLD' AND NEW.status IN ('RELEASED', 'IN_PROGRESS', 'CANCELLED'))
    OR (OLD.status = 'COMPLETION_PENDING' AND NEW.status IN ('COMPLETED', 'IN_PROGRESS', 'RECOVERY_REQUIRED'))
    OR (OLD.status = 'RECOVERY_REQUIRED' AND NEW.status IN ('RELEASED', 'IN_PROGRESS', 'ON_HOLD'))) THEN
    RAISE EXCEPTION 'A manufacturing order cannot move from % to %.', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_orders_guard' AND tgrelid = 'tenant.manufacturing_orders'::regclass) THEN
    CREATE TRIGGER manufacturing_orders_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_orders FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_order_guard();
  END IF;
END $$;

-- Material lines: re-planned freely while the order is a draft; after release only the running quantities move (never down), and lines are
-- never removed.
CREATE OR REPLACE FUNCTION tenant.manufacturing_order_material_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  order_status text;
BEGIN
  SELECT status INTO order_status FROM tenant.manufacturing_orders WHERE id = COALESCE(NEW.manufacturing_order_id, OLD.manufacturing_order_id);
  IF order_status IN ('DRAFT', 'AWAITING_APPROVAL') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A released order keeps its material lines.' USING ERRCODE = 'check_violation';
  END IF;
  IF order_status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'The materials of a % order do not change.', lower(order_status) USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.component_item_id <> OLD.component_item_id OR NEW.planned_quantity <> OLD.planned_quantity OR NEW.uom_id <> OLD.uom_id
      OR NEW.issued_quantity < OLD.issued_quantity OR NEW.returned_quantity < OLD.returned_quantity OR NEW.consumed_quantity < OLD.consumed_quantity
      OR NEW.authorized_extra_quantity < OLD.authorized_extra_quantity) THEN
    RAISE EXCEPTION 'A released order''s planned materials are fixed and its issued, returned and consumed quantities only grow.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.origin <> 'EXTRA' THEN
    RAISE EXCEPTION 'A released order gains material only through an approved extra-material request.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_order_materials_guard' AND tgrelid = 'tenant.manufacturing_order_materials'::regclass) THEN
    CREATE TRIGGER manufacturing_order_materials_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.manufacturing_order_materials FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_order_material_guard();
  END IF;
END $$;

-- A production entry's quantities are fixed; only what awaits inspection is settled, downward.
CREATE OR REPLACE FUNCTION tenant.manufacturing_production_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A production entry is never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reported_quantity <> OLD.reported_quantity OR NEW.accepted_quantity <> OLD.accepted_quantity OR NEW.rejected_quantity <> OLD.rejected_quantity
      OR NEW.pending_quantity <> OLD.pending_quantity OR NEW.manufacturing_order_id <> OLD.manufacturing_order_id OR NEW.pending_remaining > OLD.pending_remaining THEN
    RAISE EXCEPTION 'A production entry does not change; record a quality decision for what awaits inspection.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_production_entries_guard' AND tgrelid = 'tenant.manufacturing_production_entries'::regclass) THEN
    CREATE TRIGGER manufacturing_production_entries_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_production_entries FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_production_entry_guard();
  END IF;
END $$;

-- Movements, consumption, quality decisions, receipts and events are append-only.
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['manufacturing_order_material_movements', 'manufacturing_order_consumption', 'manufacturing_quality_decisions', 'manufacturing_goods_receipts',
                             'manufacturing_order_events'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = name || '_append_only' AND tgrelid = ('tenant.' || name)::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_append_only()', name || '_append_only', name);
    END IF;
  END LOOP;
END $$;

-- ============================================================ 10. policy
-- Whether the person who submitted an order may approve its release, or the requester of extra material approve it (small manufacturers).
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS mo_self_approval_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS mo_variance_self_approval_allowed boolean NOT NULL DEFAULT false;
-- How far accepted output may exceed the planned quantity (percent; 0 = never).
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS mo_overproduction_tolerance_pct numeric(7, 4) NOT NULL DEFAULT 0;
-- Whether every unit produced waits for a quality decision before it can be accepted.
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS mo_require_inspection boolean NOT NULL DEFAULT false;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_settings_mo_tolerance_check') THEN
    ALTER TABLE tenant.manufacturing_settings ADD CONSTRAINT manufacturing_settings_mo_tolerance_check CHECK (mo_overproduction_tolerance_pct >= 0 AND mo_overproduction_tolerance_pct <= 100);
  END IF;
END $$;

-- ============================================================ 11. Finance: work in progress and manufacturing variance
DO $$
DECLARE
  ledger record;
  seed record;
  parent_id uuid;
  account_id uuid;
BEGIN
  FOR ledger IN SELECT accounting_ledger.id, accounting_ledger.organization_id FROM tenant.accounting_ledgers accounting_ledger WHERE accounting_ledger.status = 'active' LOOP
    FOR seed IN SELECT * FROM (VALUES
        ('1310', 'Work in progress', 'asset', 'inventory', 'debit', '1000', 'wip'),
        ('5100', 'Manufacturing variances', 'expense', 'cogs', 'debit', NULL, 'manufacturing_variance')
      ) AS rows(code, name, account_class, account_type, normal_balance, parent_code, mapping_key) LOOP
      SELECT id INTO parent_id FROM tenant.accounting_accounts WHERE organization_id = ledger.organization_id AND ledger_id = ledger.id AND code = seed.parent_code AND is_group;
      INSERT INTO tenant.accounting_accounts (organization_id, ledger_id, parent_id, code, name, account_class, account_type, normal_balance, is_group,
                                              allow_manual_posting, reconciliation_required, status)
      VALUES (ledger.organization_id, ledger.id, parent_id, seed.code, seed.name, seed.account_class, seed.account_type, seed.normal_balance, false, false, false, 'active')
      ON CONFLICT (organization_id, ledger_id, code) DO NOTHING;
      SELECT id INTO account_id FROM tenant.accounting_accounts
       WHERE organization_id = ledger.organization_id AND ledger_id = ledger.id AND code = seed.code AND account_class = seed.account_class AND NOT is_group AND status = 'active';
      IF account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant.accounting_account_mappings
          WHERE organization_id = ledger.organization_id AND ledger_id = ledger.id AND mapping_key = seed.mapping_key) THEN
        INSERT INTO tenant.accounting_account_mappings (organization_id, ledger_id, mapping_key, account_id, priority, status)
        VALUES (ledger.organization_id, ledger.id, seed.mapping_key, account_id, 1000, 'active');
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ============================================================ 12. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('manufacturing.mo.view', 'View manufacturing orders', 'Manufacturing', 'See manufacturing orders, their materials, production and history.'),
  ('manufacturing.mo.create', 'Create manufacturing orders', 'Manufacturing', 'Create a draft manufacturing order.'),
  ('manufacturing.mo.edit_draft', 'Edit draft manufacturing orders', 'Manufacturing', 'Change a draft order before it is submitted.'),
  ('manufacturing.mo.submit', 'Submit manufacturing orders', 'Manufacturing', 'Ask for approval to release an order.'),
  ('manufacturing.mo.approve', 'Approve manufacturing orders', 'Manufacturing', 'Approve an order for release, or send it back.'),
  ('manufacturing.mo.release', 'Release manufacturing orders', 'Manufacturing', 'Freeze the recipe and authorise production.'),
  ('manufacturing.mo.reserve_material', 'Reserve materials', 'Manufacturing', 'Reserve stock in Inventory for an order.'),
  ('manufacturing.mo.issue_material', 'Issue materials', 'Manufacturing', 'Issue materials to production (Inventory issue permission also needed).'),
  ('manufacturing.mo.return_material', 'Return materials', 'Manufacturing', 'Return unused material from production (Inventory receive permission also needed).'),
  ('manufacturing.mo.extra_material', 'Request extra material', 'Manufacturing', 'Ask for material beyond the plan.'),
  ('manufacturing.mo.approve_variance', 'Approve material variances', 'Manufacturing', 'Approve extra material, a partial start or a short close.'),
  ('manufacturing.mo.start', 'Start production', 'Manufacturing', 'Start production on a released order.'),
  ('manufacturing.mo.record_production', 'Record production', 'Manufacturing', 'Report output and material actually used.'),
  ('manufacturing.mo.quality_decide', 'Decide on produced output', 'Manufacturing', 'Accept or reject output awaiting inspection.'),
  ('manufacturing.mo.receive_goods', 'Receive finished goods', 'Manufacturing', 'Receive accepted output into stock (Inventory receive permission also needed).'),
  ('manufacturing.mo.hold', 'Hold and resume orders', 'Manufacturing', 'Put an order on hold and resume it.'),
  ('manufacturing.mo.complete', 'Complete orders', 'Manufacturing', 'Reconcile and complete an order.'),
  ('manufacturing.mo.cancel', 'Cancel orders', 'Manufacturing', 'Cancel an order with nothing unresolved.'),
  ('manufacturing.mo.cost_view', 'View manufacturing cost', 'Manufacturing', 'See estimated and actual material cost and variance.'),
  ('manufacturing.mo.export', 'Export manufacturing orders', 'Manufacturing', 'Print or export an order.')
ON CONFLICT (key) DO NOTHING;
-- A shop-floor role in every organisation that has manufacturing.
INSERT INTO public.roles (id, organization_id, name, slug, description, is_system, status, module_key, template_key, assignable, risk_level, version)
SELECT gen_random_uuid(), organization.id, 'Shop-Floor Operator', 'shop_floor_operator', 'Starts production, reports output and material used, and asks for extra material.',
       true, 'active', 'manufacturing', 'shop_floor_operator', true, 'standard', 1
  FROM public.organizations organization
 WHERE EXISTS (SELECT 1 FROM public.roles existing WHERE existing.organization_id = organization.id AND existing.slug = 'manufacturing_manager')
ON CONFLICT (organization_id, slug) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('manufacturing_manager', 'manufacturing.mo.view'), ('manufacturing_manager', 'manufacturing.mo.create'), ('manufacturing_manager', 'manufacturing.mo.edit_draft'),
    ('manufacturing_manager', 'manufacturing.mo.submit'), ('manufacturing_manager', 'manufacturing.mo.approve'), ('manufacturing_manager', 'manufacturing.mo.release'),
    ('manufacturing_manager', 'manufacturing.mo.reserve_material'), ('manufacturing_manager', 'manufacturing.mo.issue_material'), ('manufacturing_manager', 'manufacturing.mo.return_material'),
    ('manufacturing_manager', 'manufacturing.mo.extra_material'), ('manufacturing_manager', 'manufacturing.mo.approve_variance'), ('manufacturing_manager', 'manufacturing.mo.start'),
    ('manufacturing_manager', 'manufacturing.mo.record_production'), ('manufacturing_manager', 'manufacturing.mo.quality_decide'), ('manufacturing_manager', 'manufacturing.mo.receive_goods'),
    ('manufacturing_manager', 'manufacturing.mo.hold'), ('manufacturing_manager', 'manufacturing.mo.complete'), ('manufacturing_manager', 'manufacturing.mo.cancel'),
    ('manufacturing_manager', 'manufacturing.mo.cost_view'), ('manufacturing_manager', 'manufacturing.mo.export'),
    ('production_planner', 'manufacturing.mo.view'), ('production_planner', 'manufacturing.mo.create'), ('production_planner', 'manufacturing.mo.edit_draft'),
    ('production_planner', 'manufacturing.mo.submit'), ('production_planner', 'manufacturing.mo.reserve_material'), ('production_planner', 'manufacturing.mo.extra_material'),
    ('production_planner', 'manufacturing.mo.cost_view'), ('production_planner', 'manufacturing.mo.export'),
    ('manufacturing_engineer', 'manufacturing.mo.view'),
    ('shop_floor_operator', 'manufacturing.view'), ('shop_floor_operator', 'manufacturing.mo.view'), ('shop_floor_operator', 'manufacturing.mo.start'),
    ('shop_floor_operator', 'manufacturing.mo.record_production'), ('shop_floor_operator', 'manufacturing.mo.extra_material'),
    ('shop_floor_operator', 'workspace.view'), ('shop_floor_operator', 'notifications.view'), ('shop_floor_operator', 'profile.manage'), ('shop_floor_operator', 'business_data.view'),
    ('inventory_manager', 'manufacturing.view'), ('inventory_manager', 'manufacturing.mo.view'), ('inventory_manager', 'manufacturing.mo.reserve_material'),
    ('inventory_manager', 'manufacturing.mo.issue_material'), ('inventory_manager', 'manufacturing.mo.return_material'), ('inventory_manager', 'manufacturing.mo.receive_goods'),
    ('quality_manager', 'manufacturing.view'), ('quality_manager', 'manufacturing.mo.view'), ('quality_manager', 'manufacturing.mo.quality_decide')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

-- ============================================================ 13. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['manufacturing_orders', 'manufacturing_order_materials', 'manufacturing_order_material_movements', 'manufacturing_order_consumption',
                             'manufacturing_order_material_variances', 'manufacturing_production_entries', 'manufacturing_quality_decisions', 'manufacturing_goods_receipts',
                             'manufacturing_order_exceptions', 'manufacturing_order_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.manufacturing_orders, tenant.manufacturing_order_materials, tenant.manufacturing_order_material_variances, tenant.manufacturing_production_entries,
  tenant.manufacturing_order_exceptions TO vercent_app;
GRANT DELETE ON tenant.manufacturing_order_materials TO vercent_app;
GRANT SELECT, INSERT ON tenant.manufacturing_order_material_movements, tenant.manufacturing_order_consumption, tenant.manufacturing_quality_decisions, tenant.manufacturing_goods_receipts,
  tenant.manufacturing_order_events TO vercent_app;
GRANT SELECT ON tenant.manufacturing_orders, tenant.manufacturing_order_materials, tenant.manufacturing_order_material_movements, tenant.manufacturing_order_consumption,
  tenant.manufacturing_order_material_variances, tenant.manufacturing_production_entries, tenant.manufacturing_quality_decisions, tenant.manufacturing_goods_receipts,
  tenant.manufacturing_order_exceptions, tenant.manufacturing_order_events TO vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0112_manufacturing_orders.sql', 'manufacturing-orders') ON CONFLICT DO NOTHING;
