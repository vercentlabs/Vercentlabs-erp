-- Manufacturing: Material Consumption. The consumption note (MC) records what production actually used of the material it holds in custody:
-- a draft names the materials, quantities and the stock identity (batch, serial unit, the issue it came from); posting checks the order is
-- in production, allocates the quantity to the exact issued stock (never more than is still in custody, never a unit twice) and values it
-- at the cost Inventory gave it when it was issued. Posting policy (unchanged from Material Issue): the value went to work in progress when
-- the material was issued, so consumption allocates that value within work in progress and posts no second journal. Usage beyond the BOM's
-- expectation for the output it is recorded against needs an approval bound to the exact note. Posted notes are immutable; an erroneous
-- entry is corrected by a linked correction that restores the same stock to custody. Additive only: no table, column or constraint is dropped.

-- ============================================================ 1. the material line: corrected consumption
-- consumed_quantity is the net quantity used: a correction lowers it by exactly what consumption_corrected_quantity (the audit total of
-- corrections) rises — the guard below allows nothing else — so the existing custody constraints hold as written.
ALTER TABLE tenant.manufacturing_order_materials ADD COLUMN IF NOT EXISTS consumption_corrected_quantity numeric(20, 6) NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_order_materials_consumption_correction_check') THEN
    ALTER TABLE tenant.manufacturing_order_materials ADD CONSTRAINT manufacturing_order_materials_consumption_correction_check
      CHECK (consumption_corrected_quantity >= 0);
  END IF;
END $$;

-- The guard of 0115, extended: the corrected total only grows, and used falls only by what a correction adds to it.
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
      OR NEW.issued_quantity < OLD.issued_quantity OR NEW.returned_quantity < OLD.returned_quantity
      OR (NEW.consumed_quantity < OLD.consumed_quantity AND OLD.consumed_quantity - NEW.consumed_quantity <> NEW.consumption_corrected_quantity - OLD.consumption_corrected_quantity)
      OR NEW.authorized_extra_quantity < OLD.authorized_extra_quantity OR NEW.scrapped_quantity < OLD.scrapped_quantity OR NEW.reversed_quantity < OLD.reversed_quantity
      OR NEW.consumption_corrected_quantity < OLD.consumption_corrected_quantity) THEN
    RAISE EXCEPTION 'A released order''s planned materials are fixed; its issued, returned, scrapped, reversed and corrected quantities only grow, and used falls only by a recorded correction.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.origin <> 'EXTRA' THEN
    RAISE EXCEPTION 'A released order gains material only through an approved extra-material request.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- Scrap names the serial unit it was (a batch it already names).
ALTER TABLE tenant.manufacturing_material_scrap ADD COLUMN IF NOT EXISTS serial_id uuid;

-- Policy: usage beyond the BOM's expectation up to the warning percent is accepted with a warning; beyond the approval percent it needs an
-- approval from someone other than the person who recorded it (unless the company allows self-approval).
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS mc_variance_warning_pct numeric(7, 4) NOT NULL DEFAULT 2;
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS mc_variance_approval_pct numeric(7, 4) NOT NULL DEFAULT 5;
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS mc_self_approval_allowed boolean NOT NULL DEFAULT false;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_settings_mc_variance_check') THEN
    ALTER TABLE tenant.manufacturing_settings ADD CONSTRAINT manufacturing_settings_mc_variance_check
      CHECK (mc_variance_warning_pct >= 0 AND mc_variance_approval_pct >= mc_variance_warning_pct AND mc_variance_approval_pct <= 1000);
  END IF;
END $$;

-- ============================================================ 2. the consumption note
CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  consumption_number text NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  production_warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  production_location_id uuid REFERENCES tenant.warehouse_locations(id),
  -- What the usage is recorded against: a production entry and/or the output quantity it made (the basis of the BOM's expectation).
  production_entry_id uuid REFERENCES tenant.manufacturing_production_entries(id),
  production_batch_reference text,
  output_basis_quantity numeric(20, 6) CHECK (output_basis_quantity IS NULL OR output_basis_quantity > 0),
  kind text NOT NULL DEFAULT 'NORMAL' CHECK (kind IN ('NORMAL', 'CLOSING')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'POSTING', 'POSTED', 'CANCELLED', 'RECOVERY_REQUIRED')),
  consumption_date date NOT NULL DEFAULT current_date,
  consumed_at timestamptz,
  notes text,
  supervisor_user_id uuid REFERENCES public.users(id),
  -- The approval of usage variance, bound to the exact content and the custody versions of its materials.
  approval_status text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (approval_status IN ('NOT_REQUIRED', 'REQUESTED', 'APPROVED', 'REJECTED')),
  approval_hash text,
  approval_versions jsonb,
  approval_reason text,
  approval_policy jsonb,
  approval_requested_by uuid REFERENCES public.users(id),
  approval_requested_at timestamptz,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  approval_note text,
  content_hash text,
  posting_key text,
  posted_by uuid REFERENCES public.users(id),
  posted_at timestamptz,
  total_cost numeric(20, 2),
  cost_status text CHECK (cost_status IS NULL OR cost_status IN ('VALUED', 'MISSING')),
  cancelled_by uuid REFERENCES public.users(id),
  cancelled_at timestamptz,
  cancel_reason text,
  print_count integer NOT NULL DEFAULT 0,
  last_printed_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text,
  CHECK (status <> 'POSTED' OR (posted_at IS NOT NULL AND posting_key IS NOT NULL)),
  CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_consumptions_number_uidx ON tenant.manufacturing_material_consumptions (organization_id, consumption_number);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_consumptions_posting_uidx ON tenant.manufacturing_material_consumptions (organization_id, posting_key) WHERE posting_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_consumptions_key_uidx ON tenant.manufacturing_material_consumptions (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS manufacturing_material_consumptions_order_idx ON tenant.manufacturing_material_consumptions (organization_id, manufacturing_order_id, created_at);
CREATE INDEX IF NOT EXISTS manufacturing_material_consumptions_status_idx ON tenant.manufacturing_material_consumptions (organization_id, status, created_at);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_consumption_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  consumption_id uuid NOT NULL REFERENCES tenant.manufacturing_material_consumptions(id),
  line_number integer NOT NULL,
  material_id uuid NOT NULL REFERENCES tenant.manufacturing_order_materials(id),
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  uom_id uuid NOT NULL REFERENCES tenant.units_of_measure(id),
  conversion_factor numeric(20, 9) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  base_quantity numeric(20, 6) NOT NULL CHECK (base_quantity > 0),
  -- The stock identity named (a batch, serial units, or the issue it came from); otherwise the oldest issued custody is used first.
  batch_id uuid REFERENCES tenant.stock_batches(id),
  serial_ids uuid[],
  source_movement_id uuid REFERENCES tenant.manufacturing_order_material_movements(id),
  -- The BOM's expectation for the output basis, and the variance against it (null without a basis; a null percent is unplanned usage).
  expected_quantity numeric(20, 6),
  variance_quantity numeric(20, 6),
  variance_pct numeric(12, 4),
  variance_band text CHECK (variance_band IS NULL OR variance_band IN ('NO_BASIS', 'WITHIN', 'UNDER', 'WARNING', 'APPROVAL', 'UNPLANNED')),
  variance_reason text,
  notes text,
  unit_cost numeric(20, 6),
  total_cost numeric(20, 2),
  corrected_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (corrected_quantity >= 0),
  CHECK (corrected_quantity <= base_quantity),
  UNIQUE (consumption_id, line_number)
);
CREATE INDEX IF NOT EXISTS manufacturing_material_consumption_lines_material_idx ON tenant.manufacturing_material_consumption_lines (organization_id, material_id);
CREATE INDEX IF NOT EXISTS manufacturing_material_consumption_lines_item_idx ON tenant.manufacturing_material_consumption_lines (organization_id, item_id);

-- Exactly which issued stock was used: the order's issue record (and through it the issue note), batch or serial unit, quantity and cost.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_consumption_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  consumption_line_id uuid NOT NULL REFERENCES tenant.manufacturing_material_consumption_lines(id),
  source_movement_id uuid NOT NULL REFERENCES tenant.manufacturing_order_material_movements(id),
  material_issue_id uuid REFERENCES tenant.manufacturing_material_issues(id),
  batch_id uuid,
  serial_id uuid,
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(20, 6),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_material_consumption_allocations_line_idx ON tenant.manufacturing_material_consumption_allocations (organization_id, consumption_line_id);
CREATE INDEX IF NOT EXISTS manufacturing_material_consumption_allocations_source_idx ON tenant.manufacturing_material_consumption_allocations (organization_id, source_movement_id);
CREATE INDEX IF NOT EXISTS manufacturing_material_consumption_allocations_serial_idx ON tenant.manufacturing_material_consumption_allocations (organization_id, serial_id) WHERE serial_id IS NOT NULL;

-- A correction of posted consumption: what was recorded but never used goes back to custody, from the very allocations it came from.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_consumption_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  correction_number text NOT NULL,
  consumption_id uuid NOT NULL REFERENCES tenant.manufacturing_material_consumptions(id),
  consumption_line_id uuid NOT NULL REFERENCES tenant.manufacturing_material_consumption_lines(id),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  evidence text,
  allocations jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_cost numeric(20, 2),
  idempotency_key text NOT NULL,
  corrected_by uuid REFERENCES public.users(id),
  corrected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_consumption_corrections_number_uidx ON tenant.manufacturing_material_consumption_corrections (organization_id, correction_number);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_consumption_corrections_key_uidx ON tenant.manufacturing_material_consumption_corrections (organization_id, idempotency_key, consumption_line_id);

-- One row per committed posting (consumption or correction): its identity, the document version, the custody outcome and the Finance status.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_consumption_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  consumption_id uuid NOT NULL REFERENCES tenant.manufacturing_material_consumptions(id),
  command_key text NOT NULL,
  document_version integer NOT NULL,
  kind text NOT NULL DEFAULT 'CONSUMPTION' CHECK (kind IN ('CONSUMPTION', 'CORRECTION')),
  custody_status text NOT NULL CHECK (custody_status IN ('CONFIRMED')),
  finance_status text NOT NULL CHECK (finance_status IN ('IN_WIP_AT_ISSUE', 'COST_MISSING')),
  quantity numeric(20, 6) NOT NULL,
  amount numeric(20, 2),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_consumption_postings_key_uidx ON tenant.manufacturing_material_consumption_postings (organization_id, command_key);
CREATE INDEX IF NOT EXISTS manufacturing_material_consumption_postings_note_idx ON tenant.manufacturing_material_consumption_postings (organization_id, consumption_id);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_consumption_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  consumption_id uuid NOT NULL REFERENCES tenant.manufacturing_material_consumptions(id),
  action text NOT NULL,
  from_status text,
  to_status text,
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_material_consumption_events_note_idx ON tenant.manufacturing_material_consumption_events (organization_id, consumption_id, occurred_at);

-- The order's usage record names the note line it came from.
ALTER TABLE tenant.manufacturing_order_consumption ADD COLUMN IF NOT EXISTS consumption_line_id uuid REFERENCES tenant.manufacturing_material_consumption_lines(id);

-- ============================================================ 3. guards
CREATE OR REPLACE FUNCTION tenant.manufacturing_material_consumption_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A consumption note is never deleted; cancel a draft instead.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('POSTED', 'CANCELLED') THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'POSTED' AND NEW.status = 'RECOVERY_REQUIRED')
       OR NEW.manufacturing_order_id <> OLD.manufacturing_order_id OR NEW.posting_key IS DISTINCT FROM OLD.posting_key OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
       OR NEW.total_cost IS DISTINCT FROM OLD.total_cost OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.consumption_number <> OLD.consumption_number
       OR NEW.output_basis_quantity IS DISTINCT FROM OLD.output_basis_quantity THEN
      RAISE EXCEPTION 'A % consumption note does not change.', lower(OLD.status) USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION tenant.manufacturing_material_consumption_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  note_status text;
BEGIN
  SELECT status INTO note_status FROM tenant.manufacturing_material_consumptions WHERE id = COALESCE(NEW.consumption_id, OLD.consumption_id);
  IF note_status IN ('DRAFT', 'PENDING_APPROVAL', 'POSTING') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' OR TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'The lines of a posted or cancelled consumption note are fixed.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.material_id <> OLD.material_id OR NEW.quantity <> OLD.quantity OR NEW.base_quantity <> OLD.base_quantity OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.serial_ids IS DISTINCT FROM OLD.serial_ids OR NEW.unit_cost IS DISTINCT FROM OLD.unit_cost OR NEW.total_cost IS DISTINCT FROM OLD.total_cost
     OR NEW.expected_quantity IS DISTINCT FROM OLD.expected_quantity OR NEW.corrected_quantity < OLD.corrected_quantity THEN
    RAISE EXCEPTION 'A posted consumption line keeps its quantity, stock and cost; a correction is recorded, never an edit.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE
  name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_material_consumptions_guard') THEN
    CREATE TRIGGER manufacturing_material_consumptions_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_material_consumptions FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_material_consumption_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_material_consumption_lines_guard') THEN
    CREATE TRIGGER manufacturing_material_consumption_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.manufacturing_material_consumption_lines FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_material_consumption_line_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_material_consumption_lines_serials') THEN
    CREATE TRIGGER manufacturing_material_consumption_lines_serials BEFORE INSERT OR UPDATE ON tenant.manufacturing_material_consumption_lines FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_material_issue_serial_guard();
  END IF;
  FOREACH name IN ARRAY ARRAY['manufacturing_material_consumption_allocations', 'manufacturing_material_consumption_corrections', 'manufacturing_material_consumption_postings',
                             'manufacturing_material_consumption_events'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = name || '_append_only' AND tgrelid = ('tenant.' || name)::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_append_only()', name || '_append_only', name);
    END IF;
  END LOOP;
END $$;
-- A serial unit is consumed once: the domain checks its net use (allocations less corrections) under the order's lock before posting.

-- ============================================================ 4. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['manufacturing_material_consumptions', 'manufacturing_material_consumption_lines', 'manufacturing_material_consumption_allocations',
                             'manufacturing_material_consumption_corrections', 'manufacturing_material_consumption_postings', 'manufacturing_material_consumption_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.manufacturing_material_consumptions, tenant.manufacturing_material_consumption_lines TO vercent_app;
GRANT DELETE ON tenant.manufacturing_material_consumption_lines TO vercent_app;
GRANT SELECT, INSERT ON tenant.manufacturing_material_consumption_allocations, tenant.manufacturing_material_consumption_corrections, tenant.manufacturing_material_consumption_postings,
  tenant.manufacturing_material_consumption_events TO vercent_app;
GRANT SELECT ON tenant.manufacturing_material_consumptions, tenant.manufacturing_material_consumption_lines, tenant.manufacturing_material_consumption_allocations,
  tenant.manufacturing_material_consumption_corrections, tenant.manufacturing_material_consumption_postings, tenant.manufacturing_material_consumption_events TO vercent_worker;

-- ============================================================ 5. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('manufacturing.consumption.view', 'View material consumption', 'Manufacturing', 'See consumption notes, usage against the BOM and material custody.'),
  ('manufacturing.consumption.create', 'Record material consumption', 'Manufacturing', 'Prepare consumption notes of material production used.'),
  ('manufacturing.consumption.post', 'Post material consumption', 'Manufacturing', 'Confirm actual usage out of production custody.'),
  ('manufacturing.consumption.approve_variance', 'Approve usage variance', 'Manufacturing', 'Approve usage beyond the BOM''s expectation.'),
  ('manufacturing.consumption.reverse', 'Correct material consumption', 'Manufacturing', 'Correct posted consumption that never happened (back to custody).'),
  ('manufacturing.consumption.export', 'Print and export consumption', 'Manufacturing', 'Print consumption notes and export consumption reports.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('manufacturing_manager', 'manufacturing.consumption.view'), ('manufacturing_manager', 'manufacturing.consumption.create'), ('manufacturing_manager', 'manufacturing.consumption.post'),
    ('manufacturing_manager', 'manufacturing.consumption.approve_variance'), ('manufacturing_manager', 'manufacturing.consumption.reverse'), ('manufacturing_manager', 'manufacturing.consumption.export'),
    ('shop_floor_operator', 'manufacturing.consumption.view'), ('shop_floor_operator', 'manufacturing.consumption.create'), ('shop_floor_operator', 'manufacturing.consumption.post'),
    ('production_planner', 'manufacturing.consumption.view'), ('production_planner', 'manufacturing.consumption.export'),
    ('inventory_manager', 'manufacturing.consumption.view'), ('inventory_manager', 'manufacturing.consumption.export'),
    ('accountant', 'manufacturing.consumption.view'), ('accountant', 'manufacturing.consumption.export')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0116_manufacturing_material_consumption.sql', 'manufacturing-material-consumption') ON CONFLICT DO NOTHING;
