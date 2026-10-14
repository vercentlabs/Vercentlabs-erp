-- Manufacturing: Bill of Materials. The approved recipe a product is made from — versioned, approved, effective-dated — over the shared Item
-- Master. A BOM never moves stock, never creates a purchase order and never posts to Finance: it explodes requirements, previews availability
-- and estimated material cost, freezes a resolved recipe for production, and hands shortages to Procurement as demand.
--
--   BOMs               one master per finished item: a stable number and identity; archived, never deleted once used.
--   revisions          DRAFT → PENDING_APPROVAL → APPROVED → ACTIVE → SUPERSEDED / OBSOLETE (or REJECTED, then edited again). Output
--                      quantity and unit, expected yield, batch size, effective window, instructions; the content hash the approval binds
--                      to. An approved revision never changes; a change is a new revision. Active windows of one BOM never overlap.
--   lines              the materials of a revision: item, quantity, unit, proportional or fixed per batch, extra-material allowance, an
--                      optional pinned subassembly revision, notes. Editable only while the revision is a draft.
--   events             the append-only history of every edit, submission, decision, activation and retirement.
--   snapshots          a resolved recipe frozen for production (exploded lines, child revisions, units, policy, estimated cost): later
--                      revisions never change it.
--   material demands   shortages handed to Procurement as demand (never a purchase order), once per request key.
--
-- The earlier BOM tables (manufacturing_boms and its components) stay: production orders still read them until Manufacturing Orders are
-- rebuilt on these revisions. Additive only.

-- ============================================================ 1. BOM masters
CREATE TABLE IF NOT EXISTS tenant.manufacturing_bom_masters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  bom_number text NOT NULL,
  finished_item_id uuid NOT NULL REFERENCES tenant.items(id),
  bom_type text NOT NULL DEFAULT 'MANUFACTURING' CHECK (bom_type = 'MANUFACTURING'),
  name text,
  archived_at timestamptz,
  archived_by uuid REFERENCES public.users(id),
  archive_reason text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (archived_at IS NULL OR archive_reason IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_bom_masters_number_uidx ON tenant.manufacturing_bom_masters (organization_id, bom_number);
-- One live BOM per finished item: its revisions carry every change, so the effective recipe is never ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_bom_masters_item_uidx ON tenant.manufacturing_bom_masters (organization_id, finished_item_id) WHERE archived_at IS NULL;

-- ============================================================ 2. revisions
CREATE TABLE IF NOT EXISTS tenant.manufacturing_bom_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  bom_id uuid NOT NULL REFERENCES tenant.manufacturing_bom_masters(id),
  revision_number integer NOT NULL CHECK (revision_number > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'OBSOLETE', 'REJECTED')),
  output_quantity numeric(20, 6) NOT NULL CHECK (output_quantity > 0),
  output_uom_id uuid NOT NULL REFERENCES tenant.units_of_measure(id),
  expected_yield_pct numeric(7, 4) NOT NULL DEFAULT 100 CHECK (expected_yield_pct > 0 AND expected_yield_pct <= 100),
  batch_size numeric(20, 6) CHECK (batch_size IS NULL OR batch_size > 0),
  effective_from timestamptz,
  effective_to timestamptz,
  description text,
  default_warehouse_id uuid REFERENCES tenant.warehouses(id),
  change_reason text,
  based_on_revision_id uuid REFERENCES tenant.manufacturing_bom_revisions(id),
  content_hash text,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  approved_by uuid REFERENCES public.users(id),
  approval_note text,
  approved_content_hash text,
  rejected_at timestamptz,
  rejected_by uuid REFERENCES public.users(id),
  rejection_reason text,
  activated_at timestamptz,
  activated_by uuid REFERENCES public.users(id),
  superseded_at timestamptz,
  superseded_by_revision_id uuid REFERENCES tenant.manufacturing_bom_revisions(id),
  obsoleted_at timestamptz,
  obsoleted_by uuid REFERENCES public.users(id),
  obsolete_reason text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from),
  CHECK (status NOT IN ('APPROVED', 'ACTIVE', 'SUPERSEDED') OR (approved_by IS NOT NULL AND approved_content_hash IS NOT NULL)),
  CHECK (status NOT IN ('ACTIVE', 'SUPERSEDED') OR effective_from IS NOT NULL),
  CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL),
  CHECK (status <> 'OBSOLETE' OR obsolete_reason IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_bom_revisions_number_uidx ON tenant.manufacturing_bom_revisions (bom_id, revision_number);
-- One revision of a BOM in progress at a time (a draft, under review, or sent back).
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_bom_revisions_open_uidx ON tenant.manufacturing_bom_revisions (bom_id) WHERE status IN ('DRAFT', 'PENDING_APPROVAL', 'REJECTED');
CREATE INDEX IF NOT EXISTS manufacturing_bom_revisions_status_idx ON tenant.manufacturing_bom_revisions (organization_id, status);

-- ============================================================ 3. lines
CREATE TABLE IF NOT EXISTS tenant.manufacturing_bom_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  revision_id uuid NOT NULL REFERENCES tenant.manufacturing_bom_revisions(id),
  line_number integer NOT NULL CHECK (line_number > 0),
  component_item_id uuid NOT NULL REFERENCES tenant.items(id),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  uom_id uuid NOT NULL REFERENCES tenant.units_of_measure(id),
  consumption_mode text NOT NULL DEFAULT 'PROPORTIONAL' CHECK (consumption_mode IN ('PROPORTIONAL', 'FIXED_PER_BATCH')),
  scrap_allowance_pct numeric(7, 4) NOT NULL DEFAULT 0 CHECK (scrap_allowance_pct >= 0 AND scrap_allowance_pct <= 500),
  child_bom_revision_id uuid REFERENCES tenant.manufacturing_bom_revisions(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (revision_id, line_number)
);
CREATE INDEX IF NOT EXISTS manufacturing_bom_lines_component_idx ON tenant.manufacturing_bom_lines (organization_id, component_item_id);

-- ============================================================ 4. events (history)
CREATE TABLE IF NOT EXISTS tenant.manufacturing_bom_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  bom_id uuid NOT NULL REFERENCES tenant.manufacturing_bom_masters(id),
  -- No foreign key: a discarded draft leaves, its history stays (with the revision number in details).
  revision_id uuid,
  action text NOT NULL,
  from_status text,
  to_status text,
  reason text,
  content_hash text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_bom_events_bom_idx ON tenant.manufacturing_bom_events (organization_id, bom_id, occurred_at);

-- ============================================================ 5. snapshots (frozen recipes for production)
CREATE TABLE IF NOT EXISTS tenant.manufacturing_bom_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  bom_id uuid NOT NULL REFERENCES tenant.manufacturing_bom_masters(id),
  revision_id uuid NOT NULL REFERENCES tenant.manufacturing_bom_revisions(id),
  finished_item_id uuid NOT NULL REFERENCES tenant.items(id),
  planned_quantity numeric(20, 6) NOT NULL CHECK (planned_quantity > 0),
  planned_uom_id uuid NOT NULL REFERENCES tenant.units_of_measure(id),
  as_of timestamptz NOT NULL,
  policy jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  cost_estimate jsonb,
  content_hash text NOT NULL,
  source_type text,
  source_id uuid,
  source_reference text,
  idempotency_key text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_bom_snapshots_key_uidx ON tenant.manufacturing_bom_snapshots (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS manufacturing_bom_snapshots_revision_idx ON tenant.manufacturing_bom_snapshots (organization_id, revision_id);

-- ============================================================ 6. material demand (Procurement handoff)
CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  demand_number text NOT NULL,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  uom_id uuid NOT NULL REFERENCES tenant.units_of_measure(id),
  warehouse_id uuid REFERENCES tenant.warehouses(id),
  required_by date,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'FULFILLED', 'CANCELLED')),
  bom_id uuid REFERENCES tenant.manufacturing_bom_masters(id),
  revision_id uuid REFERENCES tenant.manufacturing_bom_revisions(id),
  snapshot_id uuid REFERENCES tenant.manufacturing_bom_snapshots(id),
  finished_item_id uuid REFERENCES tenant.items(id),
  planned_quantity numeric(20, 6),
  request_key text NOT NULL,
  notes text,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES public.users(id),
  closed_at timestamptz,
  closed_by uuid REFERENCES public.users(id),
  close_note text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_demands_number_uidx ON tenant.manufacturing_material_demands (organization_id, demand_number);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_demands_key_uidx ON tenant.manufacturing_material_demands (organization_id, request_key, item_id);
CREATE INDEX IF NOT EXISTS manufacturing_material_demands_open_idx ON tenant.manufacturing_material_demands (organization_id, status, item_id);

-- ============================================================ 7. guards
-- A revision's content is fixed once it leaves draft; statuses move only forward; nothing approved is ever deleted.
CREATE OR REPLACE FUNCTION tenant.manufacturing_bom_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status NOT IN ('DRAFT', 'REJECTED') OR OLD.approved_by IS NOT NULL THEN
      RAISE EXCEPTION 'A BOM revision that was approved is never deleted.' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM tenant.manufacturing_bom_snapshots WHERE revision_id = OLD.id) THEN
      RAISE EXCEPTION 'A BOM revision used by production is never deleted.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.bom_id <> OLD.bom_id OR NEW.revision_number <> OLD.revision_number OR NEW.organization_id <> OLD.organization_id THEN
    RAISE EXCEPTION 'A BOM revision keeps its identity.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status NOT IN ('DRAFT', 'REJECTED') AND (NEW.output_quantity <> OLD.output_quantity OR NEW.output_uom_id <> OLD.output_uom_id
      OR NEW.expected_yield_pct <> OLD.expected_yield_pct OR NEW.batch_size IS DISTINCT FROM OLD.batch_size OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.approved_content_hash IS DISTINCT FROM OLD.approved_content_hash AND OLD.approved_content_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'An approved or submitted BOM revision does not change; create a new revision.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status = 'PENDING_APPROVAL')
    OR (OLD.status = 'PENDING_APPROVAL' AND NEW.status IN ('APPROVED', 'REJECTED', 'DRAFT'))
    OR (OLD.status = 'REJECTED' AND NEW.status IN ('DRAFT', 'PENDING_APPROVAL'))
    OR (OLD.status = 'APPROVED' AND NEW.status IN ('ACTIVE', 'OBSOLETE'))
    OR (OLD.status = 'ACTIVE' AND NEW.status IN ('SUPERSEDED', 'OBSOLETE'))
    OR (OLD.status = 'SUPERSEDED' AND NEW.status = 'OBSOLETE')) THEN
    RAISE EXCEPTION 'A BOM revision cannot move from % to %.', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('SUPERSEDED', 'OBSOLETE') AND (NEW.effective_from IS DISTINCT FROM OLD.effective_from) THEN
    RAISE EXCEPTION 'A retired BOM revision keeps its effective dates.' USING ERRCODE = 'check_violation';
  END IF;
  -- Active windows of one BOM never overlap (checked under a lock on the BOM, so two activations cannot both pass).
  IF NEW.status = 'ACTIVE' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('manufacturing_bom:' || NEW.bom_id::text, 0));
    IF EXISTS (SELECT 1 FROM tenant.manufacturing_bom_revisions other
                WHERE other.bom_id = NEW.bom_id AND other.id <> NEW.id AND other.status = 'ACTIVE'
                  AND tstzrange(other.effective_from, other.effective_to) && tstzrange(NEW.effective_from, NEW.effective_to)) THEN
      RAISE EXCEPTION 'Another revision of this BOM is already active for this period.' USING ERRCODE = 'exclusion_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_bom_revisions_guard' AND tgrelid = 'tenant.manufacturing_bom_revisions'::regclass) THEN
    CREATE TRIGGER manufacturing_bom_revisions_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_bom_revisions FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_revision_guard();
  END IF;
END $$;

-- Materials change only while their revision is a draft (or sent back).
CREATE OR REPLACE FUNCTION tenant.manufacturing_bom_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status FROM tenant.manufacturing_bom_revisions WHERE id = COALESCE(NEW.revision_id, OLD.revision_id);
  IF parent_status NOT IN ('DRAFT', 'REJECTED') THEN
    RAISE EXCEPTION 'The materials of a submitted or approved BOM revision do not change; create a new revision.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_bom_lines_guard' AND tgrelid = 'tenant.manufacturing_bom_lines'::regclass) THEN
    CREATE TRIGGER manufacturing_bom_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.manufacturing_bom_lines FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_line_guard();
  END IF;
END $$;

-- History and frozen recipes are append-only.
CREATE OR REPLACE FUNCTION tenant.manufacturing_bom_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only.', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_bom_events_append_only' AND tgrelid = 'tenant.manufacturing_bom_events'::regclass) THEN
    CREATE TRIGGER manufacturing_bom_events_append_only BEFORE UPDATE OR DELETE ON tenant.manufacturing_bom_events FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_bom_snapshots_append_only' AND tgrelid = 'tenant.manufacturing_bom_snapshots'::regclass) THEN
    CREATE TRIGGER manufacturing_bom_snapshots_append_only BEFORE UPDATE OR DELETE ON tenant.manufacturing_bom_snapshots FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_append_only();
  END IF;
END $$;

-- A BOM master is archived, never deleted, once it has an approved revision.
CREATE OR REPLACE FUNCTION tenant.manufacturing_bom_master_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM tenant.manufacturing_bom_revisions WHERE bom_id = OLD.id AND approved_by IS NOT NULL) THEN
      RAISE EXCEPTION 'A BOM with an approved revision is archived, never deleted.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.finished_item_id <> OLD.finished_item_id OR NEW.bom_number <> OLD.bom_number THEN
    RAISE EXCEPTION 'A BOM keeps its number and finished item.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_bom_masters_guard' AND tgrelid = 'tenant.manufacturing_bom_masters'::regclass) THEN
    CREATE TRIGGER manufacturing_bom_masters_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_bom_masters FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_master_guard();
  END IF;
END $$;

-- ============================================================ 8. policy
-- Whether a manager may approve a revision they submitted themselves (small manufacturers); off unless the company documents that it may.
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS bom_self_approval_allowed boolean NOT NULL DEFAULT false;
-- When an item's cost counts as stale for a BOM estimate.
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS bom_cost_stale_after_days integer NOT NULL DEFAULT 90;

-- ============================================================ 9. permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('manufacturing.bom.create', 'Create BOMs', 'Manufacturing', 'Create a bill of materials and its first draft.'),
  ('manufacturing.bom.edit_draft', 'Edit draft BOMs', 'Manufacturing', 'Change the materials and quantities of a draft revision.'),
  ('manufacturing.bom.submit', 'Submit BOMs for approval', 'Manufacturing', 'Send a draft revision for review.'),
  ('manufacturing.bom.approve', 'Approve BOMs', 'Manufacturing', 'Approve or reject a submitted revision.'),
  ('manufacturing.bom.activate', 'Activate BOMs', 'Manufacturing', 'Make an approved revision effective for production.'),
  ('manufacturing.bom.revise', 'Revise BOMs', 'Manufacturing', 'Start a new draft revision from an existing one.'),
  ('manufacturing.bom.obsolete', 'Retire BOMs', 'Manufacturing', 'Retire a revision or archive a BOM.'),
  ('manufacturing.bom.cost_view', 'View BOM material cost', 'Manufacturing', 'See estimated material cost.'),
  ('manufacturing.bom.export', 'Export BOMs', 'Manufacturing', 'Print or export a BOM revision.'),
  ('manufacturing.bom.mo_use', 'Use BOMs for production', 'Manufacturing', 'Freeze a BOM recipe for production and hand shortages to Procurement.')
ON CONFLICT (key) DO NOTHING;
-- Roles that manage BOMs today get every BOM action; roles that may see BOMs keep only that.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key LIKE 'manufacturing.bom.%' AND permission.key NOT IN ('manufacturing.bom.view', 'manufacturing.bom.manage')
 WHERE existing.permission_key = 'manufacturing.bom.manage'
ON CONFLICT DO NOTHING;
-- Two new role templates in every organisation: an engineer who prepares recipes, a planner who uses them.
INSERT INTO public.roles (id, organization_id, name, slug, description, is_system, status, module_key, template_key, assignable, risk_level, version)
SELECT gen_random_uuid(), organization.id, template.name, template.slug, template.description, true, 'active', 'manufacturing', template.slug, true, 'sensitive', 1
  FROM public.organizations organization
 CROSS JOIN (VALUES
   ('Manufacturing Engineer', 'manufacturing_engineer', 'Creates, edits and revises bills of materials and submits them for approval.'),
   ('Production Planner', 'production_planner', 'Previews material requirements, uses approved BOMs for production and hands shortages to Procurement.')
 ) AS template(name, slug, description)
 WHERE EXISTS (SELECT 1 FROM public.roles existing WHERE existing.organization_id = organization.id AND existing.slug = 'manufacturing_manager')
ON CONFLICT (organization_id, slug) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('manufacturing_engineer', 'manufacturing.view'), ('manufacturing_engineer', 'manufacturing.bom.view'), ('manufacturing_engineer', 'manufacturing.bom.create'),
    ('manufacturing_engineer', 'manufacturing.bom.edit_draft'), ('manufacturing_engineer', 'manufacturing.bom.submit'), ('manufacturing_engineer', 'manufacturing.bom.revise'),
    ('manufacturing_engineer', 'manufacturing.bom.cost_view'), ('manufacturing_engineer', 'manufacturing.bom.export'),
    ('production_planner', 'manufacturing.view'), ('production_planner', 'manufacturing.bom.view'), ('production_planner', 'manufacturing.bom.mo_use'),
    ('production_planner', 'manufacturing.bom.export'),
    ('manufacturing_engineer', 'workspace.view'), ('manufacturing_engineer', 'notifications.view'), ('manufacturing_engineer', 'profile.manage'),
    ('manufacturing_engineer', 'business_data.view'), ('production_planner', 'workspace.view'), ('production_planner', 'notifications.view'),
    ('production_planner', 'profile.manage'), ('production_planner', 'business_data.view')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

-- ============================================================ 10. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['manufacturing_bom_masters', 'manufacturing_bom_revisions', 'manufacturing_bom_lines', 'manufacturing_bom_events', 'manufacturing_bom_snapshots',
                             'manufacturing_material_demands'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.manufacturing_bom_masters, tenant.manufacturing_bom_revisions, tenant.manufacturing_material_demands TO vercent_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.manufacturing_bom_lines TO vercent_app;
GRANT DELETE ON tenant.manufacturing_bom_revisions TO vercent_app;
GRANT SELECT, INSERT ON tenant.manufacturing_bom_events, tenant.manufacturing_bom_snapshots TO vercent_app;
GRANT SELECT ON tenant.manufacturing_bom_masters, tenant.manufacturing_bom_revisions, tenant.manufacturing_bom_lines, tenant.manufacturing_bom_events, tenant.manufacturing_bom_snapshots,
  tenant.manufacturing_material_demands TO vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0110_manufacturing_bom.sql', 'manufacturing-bom') ON CONFLICT DO NOTHING;
