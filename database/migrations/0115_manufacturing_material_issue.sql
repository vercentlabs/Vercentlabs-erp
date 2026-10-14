-- Manufacturing: Material Issue. The issue note (MI) as a controlled document over a manufacturing order's frozen materials: a draft names the
-- materials, quantities and stock (batch, serial units, location); excess over what the order may still issue waits for an approval bound
-- to that exact content; posting revalidates and moves the stock through Inventory's own movements (the order's reservation first, at its
-- own location and batch) and the value to work in progress through Finance — all in one database transaction, under a posting identity
-- fixed by the document and its version, so a retry or a resent request never issues twice. Posted notes are immutable; a physical error is
-- corrected by an explicit reversal (back to the source stock, at the original cost) or, for unused material, the ordinary return. Scrap of
-- issued material is its own disposition, never returnable. Additive only: no table, column or constraint is dropped.

-- ============================================================ 1. the material line: scrap and reversal
-- Scrapped: issued material declared unusable (stays in work in progress, closed to variance at completion). Reversed: the part of returned
-- that undid a posting error (a subset of returned_quantity, so every existing custody figure stays correct).
ALTER TABLE tenant.manufacturing_order_materials ADD COLUMN IF NOT EXISTS scrapped_quantity numeric(20, 6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.manufacturing_order_materials ADD COLUMN IF NOT EXISTS reversed_quantity numeric(20, 6) NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_order_materials_scrap_check') THEN
    ALTER TABLE tenant.manufacturing_order_materials ADD CONSTRAINT manufacturing_order_materials_scrap_check
      CHECK (scrapped_quantity >= 0 AND consumed_quantity + scrapped_quantity <= issued_quantity - returned_quantity);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_order_materials_reversal_check') THEN
    ALTER TABLE tenant.manufacturing_order_materials ADD CONSTRAINT manufacturing_order_materials_reversal_check CHECK (reversed_quantity >= 0 AND reversed_quantity <= returned_quantity);
  END IF;
END $$;

-- The guard of 0112, extended: scrapped and reversed only grow too.
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
      OR NEW.authorized_extra_quantity < OLD.authorized_extra_quantity OR NEW.scrapped_quantity < OLD.scrapped_quantity OR NEW.reversed_quantity < OLD.reversed_quantity) THEN
    RAISE EXCEPTION 'A released order''s planned materials are fixed and its issued, returned, consumed, scrapped and reversed quantities only grow.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.origin <> 'EXTRA' THEN
    RAISE EXCEPTION 'A released order gains material only through an approved extra-material request.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- Extra material: why it is needed (EXCESS_USAGE, DAMAGED_DURING_PRODUCTION, QUALITY_REPLACEMENT, PLANNING_CORRECTION, OTHER) and, when it
-- came from an issue note's approval, which note.
ALTER TABLE tenant.manufacturing_order_material_variances ADD COLUMN IF NOT EXISTS variance_type text NOT NULL DEFAULT 'OTHER';
ALTER TABLE tenant.manufacturing_order_material_variances ADD COLUMN IF NOT EXISTS material_issue_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_order_material_variances_type_check') THEN
    ALTER TABLE tenant.manufacturing_order_material_variances ADD CONSTRAINT manufacturing_order_material_variances_type_check
      CHECK (variance_type IN ('EXCESS_USAGE', 'DAMAGED_DURING_PRODUCTION', 'QUALITY_REPLACEMENT', 'PLANNING_CORRECTION', 'OTHER'));
  END IF;
END $$;

-- Policy: whether an issue may take free (unreserved) stock beyond the order's reservation, and how far (percent of a line's requirement)
-- an issue may exceed what the order may still issue before an approval is needed (0 = any excess needs one).
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS mi_unreserved_issue_allowed boolean NOT NULL DEFAULT true;
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS mi_excess_tolerance_pct numeric(7, 4) NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_settings_mi_tolerance_check') THEN
    ALTER TABLE tenant.manufacturing_settings ADD CONSTRAINT manufacturing_settings_mi_tolerance_check CHECK (mi_excess_tolerance_pct >= 0 AND mi_excess_tolerance_pct <= 100);
  END IF;
END $$;

-- ============================================================ 2. the issue note
CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  issue_number text NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  source_warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  source_location_id uuid REFERENCES tenant.warehouse_locations(id),
  production_warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  production_location_id uuid REFERENCES tenant.warehouse_locations(id),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'READY_TO_POST', 'POSTING', 'POSTED', 'CANCELLED', 'RECOVERY_REQUIRED')),
  issue_reason text NOT NULL DEFAULT 'NORMAL' CHECK (issue_reason IN ('NORMAL', 'EXTRA_MATERIAL', 'REPLACEMENT', 'CORRECTION')),
  issue_date date NOT NULL DEFAULT current_date,
  notes text,
  received_by text,
  -- The approval of excess, bound to the exact content (hash of lines, quantities, stock and source) and the order's frozen recipe.
  approval_status text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (approval_status IN ('NOT_REQUIRED', 'REQUESTED', 'APPROVED', 'REJECTED')),
  approval_hash text,
  approval_snapshot_id uuid,
  approval_reason text,
  variance_type text CHECK (variance_type IS NULL OR variance_type IN ('EXCESS_USAGE', 'DAMAGED_DURING_PRODUCTION', 'QUALITY_REPLACEMENT', 'PLANNING_CORRECTION', 'OTHER')),
  approval_policy jsonb,
  approval_requested_by uuid REFERENCES public.users(id),
  approval_requested_at timestamptz,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  approval_note text,
  content_hash text,
  -- Posting results.
  posting_key text,
  posted_mo_version integer,
  posted_by uuid REFERENCES public.users(id),
  posted_at timestamptz,
  total_cost numeric(20, 2),
  cost_status text CHECK (cost_status IS NULL OR cost_status IN ('VALUED', 'MISSING')),
  journal_entry_id uuid,
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
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_issues_number_uidx ON tenant.manufacturing_material_issues (organization_id, issue_number);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_issues_posting_uidx ON tenant.manufacturing_material_issues (organization_id, posting_key) WHERE posting_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_issues_key_uidx ON tenant.manufacturing_material_issues (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS manufacturing_material_issues_order_idx ON tenant.manufacturing_material_issues (organization_id, manufacturing_order_id, created_at);
CREATE INDEX IF NOT EXISTS manufacturing_material_issues_status_idx ON tenant.manufacturing_material_issues (organization_id, status, created_at);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_issue_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  material_issue_id uuid NOT NULL REFERENCES tenant.manufacturing_material_issues(id),
  line_number integer NOT NULL,
  material_id uuid NOT NULL REFERENCES tenant.manufacturing_order_materials(id),
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  -- As entered, and in the item's base unit.
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  uom_id uuid NOT NULL REFERENCES tenant.units_of_measure(id),
  conversion_factor numeric(20, 9) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  base_quantity numeric(20, 6) NOT NULL CHECK (base_quantity > 0),
  batch_id uuid REFERENCES tenant.stock_batches(id),
  serial_ids uuid[],
  source_location_id uuid REFERENCES tenant.warehouse_locations(id),
  excess_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (excess_quantity >= 0),
  notes text,
  -- Posting results: the order's movement record, the cost Inventory valued, and how much a later reversal undid.
  movement_id uuid REFERENCES tenant.manufacturing_order_material_movements(id),
  from_reservation_quantity numeric(20, 6),
  unit_cost numeric(20, 6),
  total_cost numeric(20, 2),
  reversed_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (reversed_quantity >= 0),
  CHECK (reversed_quantity <= base_quantity),
  UNIQUE (material_issue_id, line_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_issue_lines_material_uidx ON tenant.manufacturing_material_issue_lines (material_issue_id, material_id, COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS manufacturing_material_issue_lines_item_idx ON tenant.manufacturing_material_issue_lines (organization_id, item_id);

-- Exactly what Inventory gave, per batch, serial unit and location — and whether it came out of the order's own reservation.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_issue_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  issue_line_id uuid NOT NULL REFERENCES tenant.manufacturing_material_issue_lines(id),
  stock_movement_id uuid NOT NULL,
  warehouse_location_id uuid,
  batch_id uuid,
  serial_id uuid,
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  reservation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manufacturing_material_issue_allocations_line_idx ON tenant.manufacturing_material_issue_allocations (organization_id, issue_line_id);
CREATE INDEX IF NOT EXISTS manufacturing_material_issue_allocations_batch_idx ON tenant.manufacturing_material_issue_allocations (organization_id, batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS manufacturing_material_issue_allocations_serial_idx ON tenant.manufacturing_material_issue_allocations (organization_id, serial_id) WHERE serial_id IS NOT NULL;

-- One row per posting: the identity, the document version it posted, Inventory's and Finance's outcome. Inventory, Finance and
-- Manufacturing share one database transaction here, so a row exists only for a committed posting; the reconciliation compares it with
-- Inventory's movements and Finance's journal and lists anything that disagrees.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_issue_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  material_issue_id uuid NOT NULL REFERENCES tenant.manufacturing_material_issues(id),
  command_key text NOT NULL,
  document_version integer NOT NULL,
  kind text NOT NULL DEFAULT 'ISSUE' CHECK (kind IN ('ISSUE', 'REVERSAL')),
  inventory_status text NOT NULL CHECK (inventory_status IN ('CONFIRMED', 'FAILED')),
  stock_movement_ids uuid[] NOT NULL DEFAULT '{}',
  finance_status text NOT NULL CHECK (finance_status IN ('POSTED', 'NOT_REQUIRED', 'COST_MISSING')),
  journal_entry_id uuid,
  amount numeric(20, 2),
  last_error_code text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_issue_postings_key_uidx ON tenant.manufacturing_material_issue_postings (organization_id, command_key);
CREATE INDEX IF NOT EXISTS manufacturing_material_issue_postings_issue_idx ON tenant.manufacturing_material_issue_postings (organization_id, material_issue_id);

-- A reversal of a posting error (physical handover never happened, wrong batch): back to the source stock at the original cost.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_issue_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  reversal_number text NOT NULL,
  material_issue_id uuid NOT NULL REFERENCES tenant.manufacturing_material_issues(id),
  issue_line_id uuid NOT NULL REFERENCES tenant.manufacturing_material_issue_lines(id),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  evidence text,
  movement_id uuid REFERENCES tenant.manufacturing_order_material_movements(id),
  stock_movement_ids uuid[] NOT NULL DEFAULT '{}',
  total_cost numeric(20, 2),
  journal_entry_id uuid,
  idempotency_key text NOT NULL,
  reversed_by uuid REFERENCES public.users(id),
  reversed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_issue_reversals_number_uidx ON tenant.manufacturing_material_issue_reversals (organization_id, reversal_number);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_issue_reversals_key_uidx ON tenant.manufacturing_material_issue_reversals (organization_id, idempotency_key, issue_line_id);

-- Scrap of issued material: a disposition of custody, never returnable.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_scrap (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  material_id uuid NOT NULL REFERENCES tenant.manufacturing_order_materials(id),
  batch_id uuid,
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  idempotency_key text NOT NULL,
  recorded_by uuid REFERENCES public.users(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_scrap_key_uidx ON tenant.manufacturing_material_scrap (organization_id, idempotency_key, material_id);
CREATE INDEX IF NOT EXISTS manufacturing_material_scrap_order_idx ON tenant.manufacturing_material_scrap (organization_id, manufacturing_order_id);

-- The note's timeline: append-only.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_issue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  material_issue_id uuid NOT NULL REFERENCES tenant.manufacturing_material_issues(id),
  action text NOT NULL,
  from_status text,
  to_status text,
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_material_issue_events_issue_idx ON tenant.manufacturing_material_issue_events (organization_id, material_issue_id, occurred_at);

-- The order's movement record names the note it came from.
ALTER TABLE tenant.manufacturing_order_material_movements ADD COLUMN IF NOT EXISTS material_issue_id uuid REFERENCES tenant.manufacturing_material_issues(id);
CREATE INDEX IF NOT EXISTS manufacturing_order_material_movements_issue_idx ON tenant.manufacturing_order_material_movements (organization_id, material_issue_id) WHERE material_issue_id IS NOT NULL;

-- ============================================================ 3. guards
-- A posted (or cancelled) note is history: its content never changes; only printing is counted and a reversal recorded against its lines.
CREATE OR REPLACE FUNCTION tenant.manufacturing_material_issue_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A material issue note is never deleted; cancel a draft instead.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('POSTED', 'CANCELLED') THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'POSTED' AND NEW.status = 'RECOVERY_REQUIRED')
       OR NEW.manufacturing_order_id <> OLD.manufacturing_order_id OR NEW.source_warehouse_id <> OLD.source_warehouse_id
       OR NEW.posting_key IS DISTINCT FROM OLD.posting_key OR NEW.posted_at IS DISTINCT FROM OLD.posted_at OR NEW.total_cost IS DISTINCT FROM OLD.total_cost
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.issue_number <> OLD.issue_number THEN
      RAISE EXCEPTION 'A % material issue note does not change.', lower(OLD.status) USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'POSTED' AND OLD.status NOT IN ('READY_TO_POST', 'POSTING', 'DRAFT', 'POSTED', 'RECOVERY_REQUIRED') THEN
    RAISE EXCEPTION 'A material issue note posts from a draft that passed its checks.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION tenant.manufacturing_material_issue_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  issue_status text;
BEGIN
  SELECT status INTO issue_status FROM tenant.manufacturing_material_issues WHERE id = COALESCE(NEW.material_issue_id, OLD.material_issue_id);
  IF issue_status IN ('DRAFT', 'PENDING_APPROVAL', 'READY_TO_POST', 'POSTING') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' OR TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'The lines of a posted or cancelled material issue note are fixed.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.material_id <> OLD.material_id OR NEW.quantity <> OLD.quantity OR NEW.base_quantity <> OLD.base_quantity OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.serial_ids IS DISTINCT FROM OLD.serial_ids OR NEW.unit_cost IS DISTINCT FROM OLD.unit_cost OR NEW.total_cost IS DISTINCT FROM OLD.total_cost
     OR NEW.movement_id IS DISTINCT FROM OLD.movement_id OR NEW.reversed_quantity < OLD.reversed_quantity THEN
    RAISE EXCEPTION 'A posted material issue line keeps its quantity, stock and cost; a reversal is recorded, never an edit.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
-- The same serial unit is never issued twice by live issue lines (and appears once per line).
CREATE OR REPLACE FUNCTION tenant.manufacturing_material_issue_serial_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.serial_ids IS NOT NULL AND cardinality(NEW.serial_ids) <> (SELECT count(DISTINCT value) FROM unnest(NEW.serial_ids) value) THEN
    RAISE EXCEPTION 'A serial number appears twice on one issue line.' USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE
  name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_material_issues_guard') THEN
    CREATE TRIGGER manufacturing_material_issues_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_material_issues FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_material_issue_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_material_issue_lines_guard') THEN
    CREATE TRIGGER manufacturing_material_issue_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.manufacturing_material_issue_lines FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_material_issue_line_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_material_issue_lines_serials') THEN
    CREATE TRIGGER manufacturing_material_issue_lines_serials BEFORE INSERT OR UPDATE ON tenant.manufacturing_material_issue_lines FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_material_issue_serial_guard();
  END IF;
  FOREACH name IN ARRAY ARRAY['manufacturing_material_issue_allocations', 'manufacturing_material_issue_postings', 'manufacturing_material_issue_reversals', 'manufacturing_material_scrap',
                             'manufacturing_material_issue_events'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = name || '_append_only' AND tgrelid = ('tenant.' || name)::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_append_only()', name || '_append_only', name);
    END IF;
  END LOOP;
END $$;

-- ============================================================ 4. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['manufacturing_material_issues', 'manufacturing_material_issue_lines', 'manufacturing_material_issue_allocations', 'manufacturing_material_issue_postings',
                             'manufacturing_material_issue_reversals', 'manufacturing_material_scrap', 'manufacturing_material_issue_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.manufacturing_material_issues, tenant.manufacturing_material_issue_lines TO vercent_app;
GRANT DELETE ON tenant.manufacturing_material_issue_lines TO vercent_app;
GRANT SELECT, INSERT ON tenant.manufacturing_material_issue_allocations, tenant.manufacturing_material_issue_postings, tenant.manufacturing_material_issue_reversals,
  tenant.manufacturing_material_scrap, tenant.manufacturing_material_issue_events TO vercent_app;
GRANT SELECT ON tenant.manufacturing_material_issues, tenant.manufacturing_material_issue_lines, tenant.manufacturing_material_issue_allocations, tenant.manufacturing_material_issue_postings,
  tenant.manufacturing_material_issue_reversals, tenant.manufacturing_material_scrap, tenant.manufacturing_material_issue_events TO vercent_worker;

-- ============================================================ 5. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('manufacturing.issue.view', 'View material issues', 'Manufacturing', 'See material issue notes, their stock and history.'),
  ('manufacturing.issue.reverse', 'Reverse material issues', 'Manufacturing', 'Reverse a posted issue that never physically happened (back to the source stock).'),
  ('manufacturing.issue.export', 'Print and export material issues', 'Manufacturing', 'Print material issue notes and export issue reports.'),
  ('manufacturing.issue.scrap', 'Scrap issued material', 'Manufacturing', 'Declare issued material unusable (never returnable to stock).')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('manufacturing_manager', 'manufacturing.issue.view'), ('manufacturing_manager', 'manufacturing.issue.reverse'), ('manufacturing_manager', 'manufacturing.issue.export'),
    ('manufacturing_manager', 'manufacturing.issue.scrap'),
    ('production_planner', 'manufacturing.issue.view'), ('production_planner', 'manufacturing.issue.export'),
    ('inventory_manager', 'manufacturing.issue.view'), ('inventory_manager', 'manufacturing.issue.reverse'), ('inventory_manager', 'manufacturing.issue.export'),
    ('shop_floor_operator', 'manufacturing.issue.view'),
    ('accountant', 'manufacturing.view'), ('accountant', 'manufacturing.mo.view'), ('accountant', 'manufacturing.mo.cost_view'), ('accountant', 'manufacturing.issue.view'),
    ('accountant', 'manufacturing.issue.export')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0115_manufacturing_material_issue.sql', 'manufacturing-material-issue') ON CONFLICT DO NOTHING;
