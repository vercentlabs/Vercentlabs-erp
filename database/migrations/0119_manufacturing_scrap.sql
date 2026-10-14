-- Manufacturing: Scrap. The scrap note (MS) as a controlled document over a manufacturing order: what became unusable — issued material still
-- in production custody (by line, batch and serial unit) or rejected output not yet disposed of (by production entry) — how much, why, whether
-- it is recoverable (segregated into a damaged-stock bin at its source cost) or irrecoverable (disposed of), and whether the loss is normal
-- (absorbed by the order) or abnormal (written off to manufacturing variance). A draft moves nothing; an approval, where the company's policy
-- asks for one, binds to the exact content; posting revalidates under the order's lock and records the disposition once — custody or
-- output claimed, stock received into the scrap bin only for recoverable scrap, the value out of work in progress only where it leaves it —
-- in one database transaction under a posting identity fixed by the note and its version. Posted notes are immutable; a recording error is
-- corrected by an approved reversal that never brings destroyed stock back to usable inventory. Additive only: nothing is dropped.

-- ============================================================ 1. the scrap note
CREATE TABLE IF NOT EXISTS tenant.manufacturing_scraps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  scrap_number text NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  scrap_type text NOT NULL CHECK (scrap_type IN ('ISSUED_MATERIAL', 'REJECTED_OUTPUT')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTING', 'POSTED', 'CANCELLED', 'RECOVERY_REQUIRED')),
  reason_code text NOT NULL CHECK (reason_code IN ('DAMAGED_DURING_PRODUCTION', 'MANUFACTURING_DEFECT', 'CONTAMINATION', 'PROCESS_LOSS', 'MACHINE_FAILURE', 'HANDLING_DAMAGE',
    'EXPIRED', 'QUALITY_REJECTION', 'OTHER')),
  description text,
  disposition text NOT NULL DEFAULT 'IRRECOVERABLE' CHECK (disposition IN ('IRRECOVERABLE', 'RECOVERABLE')),
  loss_class text NOT NULL DEFAULT 'NORMAL' CHECK (loss_class IN ('NORMAL', 'ABNORMAL')),
  -- Where it physically is (the order's manufacturing warehouse) and, for recoverable scrap, the damaged-stock bin it is segregated into.
  source_warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  source_location_id uuid REFERENCES tenant.warehouse_locations(id),
  destination_warehouse_id uuid REFERENCES tenant.warehouses(id),
  destination_location_id uuid REFERENCES tenant.warehouse_locations(id),
  recovery_value numeric(20, 2) CHECK (recovery_value IS NULL OR recovery_value >= 0),
  scrap_date date NOT NULL DEFAULT current_date,
  -- The approval the company's policy asks for, bound to the exact content (hash of the lines, quantities, identities, disposition and bin).
  approval_required boolean NOT NULL DEFAULT false,
  approval_status text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (approval_status IN ('NOT_REQUIRED', 'REQUESTED', 'APPROVED', 'REJECTED')),
  approval_hash text,
  approval_reasons jsonb,
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
  finance_status text CHECK (finance_status IS NULL OR finance_status IN ('POSTED', 'NOT_REQUIRED', 'PENDING')),
  journal_entry_id uuid,
  correction_status text NOT NULL DEFAULT 'NONE' CHECK (correction_status IN ('NONE', 'REQUESTED', 'REVERSED', 'REJECTED')),
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
  CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL),
  CHECK (disposition <> 'RECOVERABLE' OR destination_location_id IS NOT NULL),
  CHECK (reason_code <> 'OTHER' OR length(btrim(COALESCE(description, ''))) >= 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_scraps_number_uidx ON tenant.manufacturing_scraps (organization_id, scrap_number);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_scraps_posting_uidx ON tenant.manufacturing_scraps (organization_id, posting_key) WHERE posting_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_scraps_key_uidx ON tenant.manufacturing_scraps (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS manufacturing_scraps_order_idx ON tenant.manufacturing_scraps (organization_id, manufacturing_order_id, created_at);
CREATE INDEX IF NOT EXISTS manufacturing_scraps_status_idx ON tenant.manufacturing_scraps (organization_id, status, created_at);

-- One line per source: an order material line (issued material, with its batch or serial units) or a production entry (rejected output).
CREATE TABLE IF NOT EXISTS tenant.manufacturing_scrap_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  scrap_id uuid NOT NULL REFERENCES tenant.manufacturing_scraps(id),
  line_number integer NOT NULL,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  material_id uuid REFERENCES tenant.manufacturing_order_materials(id),
  production_entry_id uuid REFERENCES tenant.manufacturing_production_entries(id),
  quality_decision_id uuid REFERENCES tenant.manufacturing_quality_decisions(id),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  uom_id uuid NOT NULL REFERENCES tenant.units_of_measure(id),
  conversion_factor numeric(20, 9) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  base_quantity numeric(20, 6) NOT NULL CHECK (base_quantity > 0),
  batch_id uuid REFERENCES tenant.stock_batches(id),
  serial_ids uuid[],
  notes text,
  -- Posting results: the value it carried (from Inventory's valuation at issue, or the recipe's material per unit for output) and, for
  -- recoverable scrap, Inventory's movements into the scrap bin.
  unit_cost numeric(20, 6),
  total_cost numeric(20, 2),
  stock_movement_ids uuid[] NOT NULL DEFAULT '{}',
  CHECK ((material_id IS NOT NULL) <> (production_entry_id IS NOT NULL)),
  UNIQUE (scrap_id, line_number)
);
CREATE INDEX IF NOT EXISTS manufacturing_scrap_lines_material_idx ON tenant.manufacturing_scrap_lines (organization_id, material_id) WHERE material_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS manufacturing_scrap_lines_entry_idx ON tenant.manufacturing_scrap_lines (organization_id, production_entry_id) WHERE production_entry_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.manufacturing_scrap_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  scrap_id uuid NOT NULL REFERENCES tenant.manufacturing_scraps(id),
  command_key text NOT NULL,
  document_version integer NOT NULL,
  kind text NOT NULL DEFAULT 'SCRAP' CHECK (kind IN ('SCRAP', 'REVERSAL')),
  inventory_status text NOT NULL CHECK (inventory_status IN ('CONFIRMED', 'NOT_REQUIRED', 'FAILED')),
  stock_movement_ids uuid[] NOT NULL DEFAULT '{}',
  finance_status text NOT NULL CHECK (finance_status IN ('POSTED', 'NOT_REQUIRED', 'PENDING')),
  journal_entry_id uuid,
  amount numeric(20, 2),
  last_error_code text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_scrap_postings_key_uidx ON tenant.manufacturing_scrap_postings (organization_id, command_key);
CREATE INDEX IF NOT EXISTS manufacturing_scrap_postings_scrap_idx ON tenant.manufacturing_scrap_postings (organization_id, scrap_id);

-- A correction of a posted note: requested with a reason (and, for irrecoverable scrap, the attestation that the units still physically exist),
-- decided by someone else; an approved one reverses the whole note.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_scrap_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  correction_number text NOT NULL,
  scrap_id uuid NOT NULL REFERENCES tenant.manufacturing_scraps(id),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  evidence text,
  physically_present boolean NOT NULL DEFAULT false,
  requested_by uuid REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_note text,
  stock_movement_ids uuid[] NOT NULL DEFAULT '{}',
  total_cost numeric(20, 2),
  journal_entry_id uuid,
  idempotency_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_scrap_corrections_number_uidx ON tenant.manufacturing_scrap_corrections (organization_id, correction_number);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_scrap_corrections_key_uidx ON tenant.manufacturing_scrap_corrections (organization_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_scrap_corrections_open_uidx ON tenant.manufacturing_scrap_corrections (organization_id, scrap_id) WHERE status = 'REQUESTED';

CREATE TABLE IF NOT EXISTS tenant.manufacturing_scrap_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  scrap_id uuid NOT NULL REFERENCES tenant.manufacturing_scraps(id),
  action text NOT NULL,
  from_status text,
  to_status text,
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_scrap_events_scrap_idx ON tenant.manufacturing_scrap_events (organization_id, scrap_id, occurred_at);

-- ============================================================ 2. custody and output: scrap and its reversal
-- The custody record of 0115 names the note it came from; a reversal of a posted note gives the identity back to custody in its own rows
-- (both append-only), so the per-batch and per-serial custody of Material Consumption stays exact.
ALTER TABLE tenant.manufacturing_material_scrap ADD COLUMN IF NOT EXISTS scrap_id uuid REFERENCES tenant.manufacturing_scraps(id);
CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_scrap_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  material_id uuid NOT NULL REFERENCES tenant.manufacturing_order_materials(id),
  scrap_id uuid NOT NULL REFERENCES tenant.manufacturing_scraps(id),
  correction_id uuid NOT NULL REFERENCES tenant.manufacturing_scrap_corrections(id),
  batch_id uuid,
  serial_id uuid,
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_material_scrap_reversals_material_idx ON tenant.manufacturing_material_scrap_reversals (organization_id, material_id);

-- A material line: scrapped falls only by an approved scrap reversal (scrap_reversed grows by exactly as much), so scrapped stays the net
-- figure every custody check already uses.
ALTER TABLE tenant.manufacturing_order_materials ADD COLUMN IF NOT EXISTS scrap_reversed_quantity numeric(20, 6) NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_order_materials_scrap_reversed_check') THEN
    ALTER TABLE tenant.manufacturing_order_materials ADD CONSTRAINT manufacturing_order_materials_scrap_reversed_check CHECK (scrap_reversed_quantity >= 0);
  END IF;
END $$;
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
      OR (NEW.scrapped_quantity < OLD.scrapped_quantity AND OLD.scrapped_quantity - NEW.scrapped_quantity <> NEW.scrap_reversed_quantity - OLD.scrap_reversed_quantity)
      OR NEW.authorized_extra_quantity < OLD.authorized_extra_quantity OR NEW.reversed_quantity < OLD.reversed_quantity
      OR NEW.consumption_corrected_quantity < OLD.consumption_corrected_quantity OR NEW.scrap_reversed_quantity < OLD.scrap_reversed_quantity) THEN
    RAISE EXCEPTION 'A released order''s planned materials are fixed; its issued, returned, reversed and corrected quantities only grow, and used or scrapped fall only by a recorded correction.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.origin <> 'EXTRA' THEN
    RAISE EXCEPTION 'A released order gains material only through an approved extra-material request.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- A production entry: rejected output disposed of as scrap, and what reversals gave back (both only grow); net scrapped never exceeds rejected.
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS output_scrapped_quantity numeric(20, 6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS output_scrap_reversed_quantity numeric(20, 6) NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_production_entries_output_scrap_check') THEN
    ALTER TABLE tenant.manufacturing_production_entries ADD CONSTRAINT manufacturing_production_entries_output_scrap_check
      CHECK (output_scrap_reversed_quantity >= 0 AND output_scrap_reversed_quantity <= output_scrapped_quantity);
  END IF;
END $$;
CREATE OR REPLACE FUNCTION tenant.manufacturing_production_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A production entry is never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'CANCELLED' THEN
    IF NEW.status <> 'CANCELLED' OR NEW.reported_quantity <> OLD.reported_quantity THEN
      RAISE EXCEPTION 'A cancelled production entry does not change.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.reported_quantity <> OLD.reported_quantity OR NEW.accepted_quantity <> OLD.accepted_quantity OR NEW.rejected_quantity <> OLD.rejected_quantity
      OR NEW.pending_quantity <> OLD.pending_quantity OR NEW.manufacturing_order_id <> OLD.manufacturing_order_id OR NEW.pending_remaining > OLD.pending_remaining
      OR NEW.received_quantity < OLD.received_quantity OR NEW.receipt_reversed_quantity < OLD.receipt_reversed_quantity
      OR NEW.output_scrapped_quantity < OLD.output_scrapped_quantity OR NEW.output_scrap_reversed_quantity < OLD.output_scrap_reversed_quantity
      OR NEW.corrected_pending_quantity < OLD.corrected_pending_quantity
      OR NEW.corrected_accepted_quantity < OLD.corrected_accepted_quantity OR NEW.production_batch_id IS DISTINCT FROM OLD.production_batch_id
      OR NEW.posting_key IS DISTINCT FROM OLD.posting_key OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
      OR (NEW.status <> OLD.status AND NOT (OLD.status = 'REPORTED' AND NEW.status = 'RECOVERY_REQUIRED') AND NOT (OLD.status = 'RECOVERY_REQUIRED' AND NEW.status = 'REPORTED')) THEN
    RAISE EXCEPTION 'A reported production entry does not change; record a quality decision, a receipt, a scrap or a correction.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- The order: value that left work in progress through scrap (abnormal loss written off, or recoverable scrap moved to the scrap bin).
ALTER TABLE tenant.manufacturing_orders ADD COLUMN IF NOT EXISTS wip_scrap_cost numeric(20, 2) NOT NULL DEFAULT 0;

-- Policy: when a scrap note needs an approval — above a value, for rejected output, for an abnormal loss.
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS scrap_approval_value_above numeric(20, 2);
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS scrap_output_requires_approval boolean NOT NULL DEFAULT true;
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS scrap_abnormal_requires_approval boolean NOT NULL DEFAULT true;

-- ============================================================ 3. guards
CREATE OR REPLACE FUNCTION tenant.manufacturing_scrap_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A scrap note is never deleted; cancel a draft instead.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('POSTED', 'CANCELLED', 'RECOVERY_REQUIRED') THEN
    IF (NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'POSTED' AND NEW.status = 'RECOVERY_REQUIRED') AND NOT (OLD.status = 'RECOVERY_REQUIRED' AND NEW.status = 'POSTED'))
       OR NEW.manufacturing_order_id <> OLD.manufacturing_order_id OR NEW.scrap_type <> OLD.scrap_type OR NEW.disposition <> OLD.disposition OR NEW.loss_class <> OLD.loss_class
       OR NEW.destination_location_id IS DISTINCT FROM OLD.destination_location_id OR NEW.posting_key IS DISTINCT FROM OLD.posting_key OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
       OR NEW.total_cost IS DISTINCT FROM OLD.total_cost OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.scrap_number <> OLD.scrap_number THEN
      RAISE EXCEPTION 'A % scrap note does not change.', lower(OLD.status) USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION tenant.manufacturing_scrap_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  scrap_status text;
BEGIN
  SELECT status INTO scrap_status FROM tenant.manufacturing_scraps WHERE id = COALESCE(NEW.scrap_id, OLD.scrap_id);
  IF scrap_status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTING') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'The lines of a posted or cancelled scrap note are fixed.' USING ERRCODE = 'check_violation';
END $$;
CREATE OR REPLACE FUNCTION tenant.manufacturing_scrap_correction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A scrap correction is never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'REQUESTED' OR NEW.scrap_id <> OLD.scrap_id OR NEW.reason <> OLD.reason OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.physically_present <> OLD.physically_present THEN
    RAISE EXCEPTION 'A decided scrap correction does not change.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE
  name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_scraps_guard') THEN
    CREATE TRIGGER manufacturing_scraps_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_scraps FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_scrap_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_scrap_lines_guard') THEN
    CREATE TRIGGER manufacturing_scrap_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.manufacturing_scrap_lines FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_scrap_line_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_scrap_corrections_guard') THEN
    CREATE TRIGGER manufacturing_scrap_corrections_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_scrap_corrections FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_scrap_correction_guard();
  END IF;
  FOREACH name IN ARRAY ARRAY['manufacturing_scrap_postings', 'manufacturing_scrap_events', 'manufacturing_material_scrap_reversals'] LOOP
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
  FOREACH name IN ARRAY ARRAY['manufacturing_scraps', 'manufacturing_scrap_lines', 'manufacturing_scrap_postings', 'manufacturing_scrap_corrections', 'manufacturing_scrap_events',
                             'manufacturing_material_scrap_reversals'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.manufacturing_scraps, tenant.manufacturing_scrap_lines, tenant.manufacturing_scrap_corrections TO vercent_app;
GRANT DELETE ON tenant.manufacturing_scrap_lines TO vercent_app;
GRANT SELECT, INSERT ON tenant.manufacturing_scrap_postings, tenant.manufacturing_scrap_events, tenant.manufacturing_material_scrap_reversals TO vercent_app;
GRANT SELECT ON tenant.manufacturing_scraps, tenant.manufacturing_scrap_lines, tenant.manufacturing_scrap_postings, tenant.manufacturing_scrap_corrections, tenant.manufacturing_scrap_events,
  tenant.manufacturing_material_scrap_reversals TO vercent_worker;

-- ============================================================ 5. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('manufacturing.scrap.view', 'View scrap', 'Manufacturing', 'See scrap notes, what can be scrapped and their history.'),
  ('manufacturing.scrap.create', 'Record scrap', 'Manufacturing', 'Create draft scrap notes.'),
  ('manufacturing.scrap.edit_draft', 'Edit draft scrap', 'Manufacturing', 'Change or cancel a scrap note that never posted.'),
  ('manufacturing.scrap.submit', 'Submit scrap for approval', 'Manufacturing', 'Ask for the approval a scrap note needs.'),
  ('manufacturing.scrap.approve', 'Approve scrap', 'Manufacturing', 'Approve or reject scrap, and decide scrap corrections.'),
  ('manufacturing.scrap.post', 'Post scrap', 'Manufacturing', 'Record the authorized disposition of scrap.'),
  ('manufacturing.scrap.correct', 'Request scrap corrections', 'Manufacturing', 'Ask for a posted scrap note to be reversed.'),
  ('manufacturing.scrap.export', 'Print and export scrap', 'Manufacturing', 'Print scrap notes and export scrap reports.'),
  ('manufacturing.scrap.cost_view', 'View scrap cost', 'Manufacturing', 'See the value of scrap.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('manufacturing_manager', 'manufacturing.scrap.view'), ('manufacturing_manager', 'manufacturing.scrap.create'), ('manufacturing_manager', 'manufacturing.scrap.edit_draft'),
    ('manufacturing_manager', 'manufacturing.scrap.submit'), ('manufacturing_manager', 'manufacturing.scrap.approve'), ('manufacturing_manager', 'manufacturing.scrap.post'),
    ('manufacturing_manager', 'manufacturing.scrap.correct'), ('manufacturing_manager', 'manufacturing.scrap.export'), ('manufacturing_manager', 'manufacturing.scrap.cost_view'),
    ('shop_floor_operator', 'manufacturing.scrap.view'), ('shop_floor_operator', 'manufacturing.scrap.create'), ('shop_floor_operator', 'manufacturing.scrap.edit_draft'),
    ('shop_floor_operator', 'manufacturing.scrap.submit'),
    ('production_planner', 'manufacturing.scrap.view'), ('production_planner', 'manufacturing.scrap.create'), ('production_planner', 'manufacturing.scrap.edit_draft'),
    ('production_planner', 'manufacturing.scrap.submit'), ('production_planner', 'manufacturing.scrap.export'),
    ('quality_manager', 'manufacturing.scrap.view'), ('quality_manager', 'manufacturing.scrap.create'), ('quality_manager', 'manufacturing.scrap.edit_draft'),
    ('quality_manager', 'manufacturing.scrap.submit'), ('quality_manager', 'manufacturing.scrap.export'),
    ('inventory_manager', 'manufacturing.scrap.view'), ('inventory_manager', 'manufacturing.scrap.create'), ('inventory_manager', 'manufacturing.scrap.edit_draft'),
    ('inventory_manager', 'manufacturing.scrap.submit'), ('inventory_manager', 'manufacturing.scrap.post'), ('inventory_manager', 'manufacturing.scrap.correct'),
    ('inventory_manager', 'manufacturing.scrap.approve'), ('inventory_manager', 'manufacturing.scrap.export'),
    ('accountant', 'manufacturing.scrap.view'), ('accountant', 'manufacturing.scrap.export'), ('accountant', 'manufacturing.scrap.cost_view')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0119_manufacturing_scrap.sql', 'manufacturing-scrap') ON CONFLICT DO NOTHING;
