-- Manufacturing: Production Quality Inspection. The inspection (MQI) as a controlled document over a production entry's output awaiting
-- inspection: product-specific checklists kept as revised templates (each inspection freezes the revision it used), measured and observed
-- results evaluated on the server, defects with severity and affected quantity (never summed into rejected units), and one authoritative
-- decision — accepted, rejected (with what happens to it: quarantine, rework or scrap), or held — that posts the quality decision of 0112/0117
-- and moves no stock. Holds keep output from being decided or received; a finalized inspection is immutable; a later quality review moves
-- output between accepted (not yet received) and rejected (not yet scrapped) by its own recorded correction. Additive only: nothing is dropped.

-- ============================================================ 1. templates and their revisions
CREATE TABLE IF NOT EXISTS tenant.manufacturing_quality_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  template_number text NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) >= 2),
  finished_item_id uuid REFERENCES tenant.items(id),
  inspection_stage text NOT NULL DEFAULT 'FINAL' CHECK (inspection_stage IN ('FINAL', 'IN_PROCESS')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_quality_templates_number_uidx ON tenant.manufacturing_quality_templates (organization_id, template_number);
CREATE INDEX IF NOT EXISTS manufacturing_quality_templates_item_idx ON tenant.manufacturing_quality_templates (organization_id, finished_item_id, inspection_stage, status);

-- A revision's criteria never change: a new tolerance is a new revision, and inspections keep the one they used.
-- criteria: [{ key, name, type: PASS_FAIL | NUMERIC | TEXT | CHOICE, unit?, lower?, upper?, choices?, acceptedChoices?, required, critical, instructions? }]
CREATE TABLE IF NOT EXISTS tenant.manufacturing_quality_template_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  template_id uuid NOT NULL REFERENCES tenant.manufacturing_quality_templates(id),
  revision_number integer NOT NULL CHECK (revision_number > 0),
  criteria jsonb NOT NULL CHECK (jsonb_typeof(criteria) = 'array'),
  notes text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUPERSEDED')),
  effective_from timestamptz NOT NULL DEFAULT clock_timestamp(),
  content_hash text NOT NULL,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  superseded_at timestamptz,
  UNIQUE (template_id, revision_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_quality_template_revisions_active_uidx ON tenant.manufacturing_quality_template_revisions (organization_id, template_id) WHERE status = 'ACTIVE';

-- ============================================================ 2. the inspection
CREATE TABLE IF NOT EXISTS tenant.manufacturing_quality_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  inspection_number text NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  production_entry_id uuid NOT NULL REFERENCES tenant.manufacturing_production_entries(id),
  production_batch_id uuid REFERENCES tenant.manufacturing_production_batches(id),
  finished_item_id uuid NOT NULL REFERENCES tenant.items(id),
  bom_revision_id uuid,
  production_location_id uuid REFERENCES tenant.warehouse_locations(id),
  inspection_stage text NOT NULL DEFAULT 'FINAL' CHECK (inspection_stage IN ('FINAL', 'IN_PROCESS')),
  -- The checklist it used, frozen (null with criteria [] for a basic inspection where the company allows one).
  template_revision_id uuid REFERENCES tenant.manufacturing_quality_template_revisions(id),
  criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What it covers (in the finished item's base unit, and as entered), how many units were actually examined, and on what basis a sample
  -- decides more than it examined (only where the company's policy allows it).
  scope_quantity numeric(20, 6) NOT NULL CHECK (scope_quantity > 0),
  entered_quantity numeric(20, 6) NOT NULL CHECK (entered_quantity > 0),
  uom_id uuid NOT NULL REFERENCES tenant.units_of_measure(id),
  examined_quantity numeric(20, 6) NOT NULL CHECK (examined_quantity > 0),
  sampling_basis text NOT NULL DEFAULT 'FULL' CHECK (sampling_basis IN ('FULL', 'SAMPLE', 'BATCH_POLICY')),
  -- The decision.
  accepted_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0),
  rejected_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  hold_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (hold_quantity >= 0),
  rejection_reason text,
  rejection_disposition text CHECK (rejection_disposition IS NULL OR rejection_disposition IN ('QUARANTINE', 'SCRAP', 'REWORK')),
  rework_assigned_to text,
  hold_reason text,
  notes text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_PROGRESS', 'PENDING_REVIEW', 'FINALIZED', 'CANCELLED', 'RECOVERY_REQUIRED')),
  inspector_id uuid REFERENCES public.users(id),
  inspected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- A review the company's policy (or a deviation on a critical failure) asks for, bound to the exact content.
  review_reasons jsonb,
  review_hash text,
  deviation_requested boolean NOT NULL DEFAULT false,
  submitted_by uuid REFERENCES public.users(id),
  submitted_at timestamptz,
  reviewer_id uuid REFERENCES public.users(id),
  reviewed_at timestamptz,
  review_decision text CHECK (review_decision IS NULL OR review_decision IN ('APPROVED', 'RETURNED')),
  review_note text,
  content_hash text,
  -- Finalization: the quality decision it posted, the hold it placed, the command identity.
  finalize_key text,
  quality_decision_id uuid REFERENCES tenant.manufacturing_quality_decisions(id),
  hold_id uuid,
  finalized_by uuid REFERENCES public.users(id),
  finalized_at timestamptz,
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
  CHECK (examined_quantity <= scope_quantity),
  CHECK (accepted_quantity + rejected_quantity + hold_quantity <= scope_quantity),
  CHECK (rejected_quantity = 0 OR rejection_disposition IS NOT NULL),
  CHECK (status <> 'FINALIZED' OR (finalized_at IS NOT NULL AND finalize_key IS NOT NULL)),
  CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_quality_inspections_number_uidx ON tenant.manufacturing_quality_inspections (organization_id, inspection_number);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_quality_inspections_finalize_uidx ON tenant.manufacturing_quality_inspections (organization_id, finalize_key) WHERE finalize_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_quality_inspections_key_uidx ON tenant.manufacturing_quality_inspections (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS manufacturing_quality_inspections_order_idx ON tenant.manufacturing_quality_inspections (organization_id, manufacturing_order_id, created_at);
CREATE INDEX IF NOT EXISTS manufacturing_quality_inspections_entry_idx ON tenant.manufacturing_quality_inspections (organization_id, production_entry_id);
CREATE INDEX IF NOT EXISTS manufacturing_quality_inspections_status_idx ON tenant.manufacturing_quality_inspections (organization_id, status, created_at);

-- One result per checklist criterion: the value as observed, the number where it is a measurement, and the server's evaluation.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_quality_inspection_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  inspection_id uuid NOT NULL REFERENCES tenant.manufacturing_quality_inspections(id),
  criterion_key text NOT NULL,
  sequence integer NOT NULL DEFAULT 0,
  value text,
  numeric_value numeric(20, 6),
  result text CHECK (result IS NULL OR result IN ('PASS', 'FAIL', 'NA')),
  notes text,
  UNIQUE (inspection_id, criterion_key)
);

-- Defects: what was found, how serious, on how many units. Two defects on one chair are two defects, one rejected chair.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_quality_defects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  inspection_id uuid NOT NULL REFERENCES tenant.manufacturing_quality_inspections(id),
  reason_code text NOT NULL CHECK (length(btrim(reason_code)) >= 2),
  severity text NOT NULL CHECK (severity IN ('MINOR', 'MAJOR', 'CRITICAL')),
  affected_quantity numeric(20, 6) NOT NULL CHECK (affected_quantity > 0),
  observation text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_quality_defects_inspection_idx ON tenant.manufacturing_quality_defects (organization_id, inspection_id);

-- Quality holds: output awaiting inspection that may be neither decided nor received until released (placed by an inspection or directly).
CREATE TABLE IF NOT EXISTS tenant.manufacturing_quality_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  production_entry_id uuid NOT NULL REFERENCES tenant.manufacturing_production_entries(id),
  inspection_id uuid REFERENCES tenant.manufacturing_quality_inspections(id),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED')),
  placed_by uuid REFERENCES public.users(id),
  placed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  released_by uuid REFERENCES public.users(id),
  released_at timestamptz,
  release_note text,
  idempotency_key text
);
CREATE INDEX IF NOT EXISTS manufacturing_quality_holds_entry_idx ON tenant.manufacturing_quality_holds (organization_id, production_entry_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_quality_holds_key_uidx ON tenant.manufacturing_quality_holds (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Quality corrections after finalization: output moved between accepted (not yet received) and rejected (not yet scrapped), by quality review or
-- after documented rework. The original decision stays as it was.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_quality_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  correction_number text NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  production_entry_id uuid NOT NULL REFERENCES tenant.manufacturing_production_entries(id),
  inspection_id uuid REFERENCES tenant.manufacturing_quality_inspections(id),
  direction text NOT NULL CHECK (direction IN ('ACCEPTED_TO_REJECTED', 'REJECTED_TO_ACCEPTED')),
  kind text NOT NULL DEFAULT 'REVIEW' CHECK (kind IN ('REVIEW', 'REWORK')),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  evidence text,
  rejection_disposition text CHECK (rejection_disposition IS NULL OR rejection_disposition IN ('QUARANTINE', 'SCRAP', 'REWORK')),
  idempotency_key text NOT NULL,
  corrected_by uuid REFERENCES public.users(id),
  corrected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_quality_corrections_number_uidx ON tenant.manufacturing_quality_corrections (organization_id, correction_number);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_quality_corrections_key_uidx ON tenant.manufacturing_quality_corrections (organization_id, idempotency_key);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_quality_inspection_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  inspection_id uuid NOT NULL REFERENCES tenant.manufacturing_quality_inspections(id),
  action text NOT NULL,
  from_status text,
  to_status text,
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_quality_inspection_events_idx ON tenant.manufacturing_quality_inspection_events (organization_id, inspection_id, occurred_at);

-- ============================================================ 3. the output: holds and corrections on the entry; decisions name their inspection
-- Held output is a part of what awaits inspection (never a fourth quantity); output moved by a correction only grows in each direction.
ALTER TABLE tenant.manufacturing_quality_decisions ADD COLUMN IF NOT EXISTS inspection_id uuid REFERENCES tenant.manufacturing_quality_inspections(id);
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS quality_hold_quantity numeric(20, 6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS quality_moved_to_rejected numeric(20, 6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS quality_moved_to_accepted numeric(20, 6) NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_production_entries_quality_hold_check') THEN
    ALTER TABLE tenant.manufacturing_production_entries ADD CONSTRAINT manufacturing_production_entries_quality_hold_check
      CHECK (quality_hold_quantity >= 0 AND quality_hold_quantity <= pending_remaining AND quality_moved_to_rejected >= 0 AND quality_moved_to_accepted >= 0);
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
      OR NEW.quality_moved_to_rejected < OLD.quality_moved_to_rejected OR NEW.quality_moved_to_accepted < OLD.quality_moved_to_accepted
      OR NEW.corrected_pending_quantity < OLD.corrected_pending_quantity
      OR NEW.corrected_accepted_quantity < OLD.corrected_accepted_quantity OR NEW.production_batch_id IS DISTINCT FROM OLD.production_batch_id
      OR NEW.posting_key IS DISTINCT FROM OLD.posting_key OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
      OR (NEW.status <> OLD.status AND NOT (OLD.status = 'REPORTED' AND NEW.status = 'RECOVERY_REQUIRED') AND NOT (OLD.status = 'RECOVERY_REQUIRED' AND NEW.status = 'REPORTED')) THEN
    RAISE EXCEPTION 'A reported production entry does not change; record a quality decision, a hold, a receipt, a scrap or a correction.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- Policy: a checklist required for every final inspection; every inspection reviewed before it is final; acceptance under a documented
-- deviation after a critical failure (off by default — and never for what law or safety requires); a sample deciding the units it covers.
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS qi_template_required boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS qi_review_required boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS qi_deviation_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS qi_sample_decides_batch boolean NOT NULL DEFAULT false;

-- ============================================================ 4. guards
CREATE OR REPLACE FUNCTION tenant.manufacturing_quality_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A checklist revision is never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.criteria IS DISTINCT FROM OLD.criteria OR NEW.content_hash <> OLD.content_hash OR NEW.revision_number <> OLD.revision_number OR NEW.template_id <> OLD.template_id
     OR (OLD.status = 'SUPERSEDED' AND NEW.status <> 'SUPERSEDED') THEN
    RAISE EXCEPTION 'A checklist revision does not change; create a new revision.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION tenant.manufacturing_quality_inspection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'An inspection is never deleted; cancel a draft instead.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('FINALIZED', 'CANCELLED', 'RECOVERY_REQUIRED') THEN
    IF (NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'FINALIZED' AND NEW.status = 'RECOVERY_REQUIRED') AND NOT (OLD.status = 'RECOVERY_REQUIRED' AND NEW.status = 'FINALIZED'))
       OR NEW.accepted_quantity <> OLD.accepted_quantity OR NEW.rejected_quantity <> OLD.rejected_quantity OR NEW.hold_quantity <> OLD.hold_quantity
       OR NEW.scope_quantity <> OLD.scope_quantity OR NEW.criteria IS DISTINCT FROM OLD.criteria OR NEW.production_entry_id <> OLD.production_entry_id
       OR NEW.finalize_key IS DISTINCT FROM OLD.finalize_key OR NEW.quality_decision_id IS DISTINCT FROM OLD.quality_decision_id OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.inspection_number <> OLD.inspection_number THEN
      RAISE EXCEPTION 'A % inspection does not change.', lower(OLD.status) USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
-- Results and defects change only while the inspection is open.
CREATE OR REPLACE FUNCTION tenant.manufacturing_quality_inspection_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  inspection_status text;
BEGIN
  SELECT status INTO inspection_status FROM tenant.manufacturing_quality_inspections WHERE id = COALESCE(NEW.inspection_id, OLD.inspection_id);
  IF inspection_status IN ('DRAFT', 'IN_PROGRESS', 'PENDING_REVIEW') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'The results and defects of a finalized or cancelled inspection are fixed.' USING ERRCODE = 'check_violation';
END $$;
CREATE OR REPLACE FUNCTION tenant.manufacturing_quality_hold_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A quality hold is never deleted; release it.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'RELEASED' OR NEW.quantity <> OLD.quantity OR NEW.production_entry_id <> OLD.production_entry_id OR NEW.reason <> OLD.reason THEN
    RAISE EXCEPTION 'A quality hold is only released.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE
  name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_quality_template_revisions_guard') THEN
    CREATE TRIGGER manufacturing_quality_template_revisions_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_quality_template_revisions FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_quality_revision_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_quality_inspections_guard') THEN
    CREATE TRIGGER manufacturing_quality_inspections_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_quality_inspections FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_quality_inspection_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_quality_inspection_results_guard') THEN
    CREATE TRIGGER manufacturing_quality_inspection_results_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.manufacturing_quality_inspection_results FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_quality_inspection_child_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_quality_defects_guard') THEN
    CREATE TRIGGER manufacturing_quality_defects_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.manufacturing_quality_defects FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_quality_inspection_child_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_quality_holds_guard') THEN
    CREATE TRIGGER manufacturing_quality_holds_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_quality_holds FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_quality_hold_guard();
  END IF;
  FOREACH name IN ARRAY ARRAY['manufacturing_quality_corrections', 'manufacturing_quality_inspection_events'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = name || '_append_only' AND tgrelid = ('tenant.' || name)::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_append_only()', name || '_append_only', name);
    END IF;
  END LOOP;
END $$;

-- ============================================================ 5. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['manufacturing_quality_templates', 'manufacturing_quality_template_revisions', 'manufacturing_quality_inspections', 'manufacturing_quality_inspection_results',
                             'manufacturing_quality_defects', 'manufacturing_quality_holds', 'manufacturing_quality_corrections', 'manufacturing_quality_inspection_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.manufacturing_quality_templates, tenant.manufacturing_quality_template_revisions, tenant.manufacturing_quality_inspections,
  tenant.manufacturing_quality_inspection_results, tenant.manufacturing_quality_defects, tenant.manufacturing_quality_holds TO vercent_app;
GRANT DELETE ON tenant.manufacturing_quality_inspection_results, tenant.manufacturing_quality_defects TO vercent_app;
GRANT SELECT, INSERT ON tenant.manufacturing_quality_corrections, tenant.manufacturing_quality_inspection_events TO vercent_app;
GRANT SELECT ON tenant.manufacturing_quality_templates, tenant.manufacturing_quality_template_revisions, tenant.manufacturing_quality_inspections, tenant.manufacturing_quality_inspection_results,
  tenant.manufacturing_quality_defects, tenant.manufacturing_quality_holds, tenant.manufacturing_quality_corrections, tenant.manufacturing_quality_inspection_events TO vercent_worker;

-- ============================================================ 6. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('manufacturing.qi.view', 'View production inspections', 'Manufacturing', 'See production quality inspections, the inspection queue, holds and checklists.'),
  ('manufacturing.qi.create', 'Start production inspections', 'Manufacturing', 'Create draft inspections of production output.'),
  ('manufacturing.qi.edit_draft', 'Record inspection results', 'Manufacturing', 'Record results, measurements and defects on an open inspection, or cancel it.'),
  ('manufacturing.qi.submit', 'Submit inspections for review', 'Manufacturing', 'Submit an inspection for the review it needs.'),
  ('manufacturing.qi.finalize', 'Finalize production inspections', 'Manufacturing', 'Post the quality decision of an inspection.'),
  ('manufacturing.qi.approve_exception', 'Review inspections and deviations', 'Manufacturing', 'Approve or return inspections waiting for review, including permitted deviations.'),
  ('manufacturing.qi.hold', 'Place quality holds', 'Manufacturing', 'Hold production output for investigation.'),
  ('manufacturing.qi.release_hold', 'Release quality holds', 'Manufacturing', 'Release held production output.'),
  ('manufacturing.qi.reinspect', 'Reinspect production output', 'Manufacturing', 'Start a reinspection of held or pending output.'),
  ('manufacturing.qi.correct', 'Correct quality decisions', 'Manufacturing', 'Move output between accepted and rejected after review or rework.'),
  ('manufacturing.qi.template_manage', 'Manage inspection checklists', 'Manufacturing', 'Create checklists and their revisions.'),
  ('manufacturing.qi.export', 'Print and export inspections', 'Manufacturing', 'Print inspection reports and export quality reports.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('quality_manager', 'manufacturing.qi.view'), ('quality_manager', 'manufacturing.qi.create'), ('quality_manager', 'manufacturing.qi.edit_draft'), ('quality_manager', 'manufacturing.qi.submit'),
    ('quality_manager', 'manufacturing.qi.finalize'), ('quality_manager', 'manufacturing.qi.approve_exception'), ('quality_manager', 'manufacturing.qi.hold'),
    ('quality_manager', 'manufacturing.qi.release_hold'), ('quality_manager', 'manufacturing.qi.reinspect'), ('quality_manager', 'manufacturing.qi.correct'),
    ('quality_manager', 'manufacturing.qi.template_manage'), ('quality_manager', 'manufacturing.qi.export'),
    ('manufacturing_manager', 'manufacturing.qi.view'), ('manufacturing_manager', 'manufacturing.qi.create'), ('manufacturing_manager', 'manufacturing.qi.edit_draft'),
    ('manufacturing_manager', 'manufacturing.qi.submit'), ('manufacturing_manager', 'manufacturing.qi.finalize'), ('manufacturing_manager', 'manufacturing.qi.approve_exception'),
    ('manufacturing_manager', 'manufacturing.qi.hold'), ('manufacturing_manager', 'manufacturing.qi.release_hold'), ('manufacturing_manager', 'manufacturing.qi.reinspect'),
    ('manufacturing_manager', 'manufacturing.qi.correct'), ('manufacturing_manager', 'manufacturing.qi.template_manage'), ('manufacturing_manager', 'manufacturing.qi.export'),
    ('shop_floor_operator', 'manufacturing.qi.view'), ('production_planner', 'manufacturing.qi.view'), ('production_planner', 'manufacturing.qi.export'),
    ('inventory_manager', 'manufacturing.qi.view'), ('accountant', 'manufacturing.qi.view'), ('accountant', 'manufacturing.qi.export')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0120_manufacturing_quality_inspection.sql', 'manufacturing-quality-inspection') ON CONFLICT DO NOTHING;
