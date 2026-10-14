-- Manufacturing: Material Consumption Variance. The order's expected material use — from its frozen BOM revision, for the output actually
-- reported (good and rejected attempts), with yield, batches and the BOM's allowance — against what was actually used: posted consumption
-- net of corrections, plus material scrap as a separately classified loss. Issued, returned and in-custody material is shown, never counted
-- as use. Evaluations are derived on demand and kept as snapshots only when someone acts on them (an exception opened, submitted, decided,
-- resolved; the order completed), so an approval binds to exactly the figures and policy it saw. Exceptions carry the investigation, the
-- reason, the review and the resolution (an authorized variance, a source correction, extra material, a hold, a BOM review). Tolerances are
-- the company's, overridden per item group or item. Nothing here moves stock or posts to Finance. Additive only: nothing is dropped.

-- ============================================================ 1. tolerance overrides
-- The company default stays in manufacturing_settings (mc_variance_warning_pct / mc_variance_approval_pct and the mv_* columns below).
CREATE TABLE IF NOT EXISTS tenant.manufacturing_variance_tolerances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('ITEM', 'GROUP')),
  item_id uuid REFERENCES tenant.items(id),
  item_group_id uuid REFERENCES tenant.item_groups(id),
  warning_pct numeric(9, 4) NOT NULL CHECK (warning_pct >= 0),
  approval_pct numeric(9, 4) NOT NULL CHECK (approval_pct >= 0),
  saving_review_pct numeric(9, 4) CHECK (saving_review_pct IS NULL OR saving_review_pct >= 0),
  approval_value_above numeric(20, 2) CHECK (approval_value_above IS NULL OR approval_value_above >= 0),
  approval_quantity_above numeric(20, 6) CHECK (approval_quantity_above IS NULL OR approval_quantity_above >= 0),
  -- A critical material: any variance beyond the warning band needs approval, and an unapproved one blocks completion.
  critical boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version integer NOT NULL DEFAULT 1,
  notes text,
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (approval_pct >= warning_pct),
  CHECK ((scope = 'ITEM' AND item_id IS NOT NULL AND item_group_id IS NULL) OR (scope = 'GROUP' AND item_group_id IS NOT NULL AND item_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_variance_tolerances_item_uidx ON tenant.manufacturing_variance_tolerances (organization_id, item_id) WHERE scope = 'ITEM' AND status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_variance_tolerances_group_uidx ON tenant.manufacturing_variance_tolerances (organization_id, item_group_id) WHERE scope = 'GROUP' AND status = 'ACTIVE';

ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS mv_saving_review_pct numeric(9, 4) NOT NULL DEFAULT 5 CHECK (mv_saving_review_pct >= 0);
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS mv_approval_value_above numeric(20, 2) CHECK (mv_approval_value_above IS NULL OR mv_approval_value_above >= 0);
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS mv_block_completion boolean NOT NULL DEFAULT false;

-- ============================================================ 2. evaluation snapshots (append-only)
CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_variance_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  material_id uuid NOT NULL REFERENCES tenant.manufacturing_order_materials(id),
  component_item_id uuid NOT NULL REFERENCES tenant.items(id),
  bom_revision_id uuid,
  bom_snapshot_id uuid,
  basis text NOT NULL DEFAULT 'REPORTED_OUTPUT' CHECK (basis IN ('REPORTED_OUTPUT', 'GOOD_OUTPUT', 'ORIGINAL_PLAN', 'AUTHORIZED_PLAN')),
  output_basis_quantity numeric(20, 6),
  expected_quantity numeric(20, 6),
  expected_productive_quantity numeric(20, 6),
  consumed_quantity numeric(20, 6) NOT NULL,
  scrap_quantity numeric(20, 6) NOT NULL,
  variance_quantity numeric(20, 6),
  variance_pct numeric(14, 4),
  reference_unit_cost numeric(20, 6),
  usage_cost_variance numeric(20, 2),
  actual_cost numeric(20, 2),
  expected_cost numeric(20, 2),
  calculation_status text NOT NULL CHECK (calculation_status IN ('NOT_CALCULABLE', 'PROVISIONAL', 'FINAL')),
  band text NOT NULL,
  policy jsonb NOT NULL,
  policy_hash text NOT NULL,
  source_versions jsonb NOT NULL,
  content_hash text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('EXCEPTION', 'SUBMITTED', 'DECIDED', 'RESOLVED', 'FINAL')),
  created_by uuid REFERENCES public.users(id),
  calculated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_material_variance_evaluations_idx ON tenant.manufacturing_material_variance_evaluations (organization_id, manufacturing_order_id, material_id, calculated_at);

-- ============================================================ 3. exceptions
CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_variance_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  exception_number text NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  material_id uuid NOT NULL REFERENCES tenant.manufacturing_order_materials(id),
  component_item_id uuid NOT NULL REFERENCES tenant.items(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RESOLVED')),
  reason_code text CHECK (reason_code IS NULL OR reason_code IN ('PROCESS_WASTE', 'MATERIAL_DAMAGE', 'QUALITY_REJECTION', 'REWORK', 'OPERATOR_ERROR', 'MEASUREMENT_ERROR',
    'BOM_STANDARD_INACCURATE', 'PRODUCTION_PLAN_CHANGE', 'MISSING_CONSUMPTION', 'OTHER')),
  explanation text,
  evidence text,
  assigned_to uuid REFERENCES public.users(id),
  opened_evaluation_id uuid REFERENCES tenant.manufacturing_material_variance_evaluations(id),
  submitted_evaluation_id uuid REFERENCES tenant.manufacturing_material_variance_evaluations(id),
  submitted_hash text,
  submitted_by uuid REFERENCES public.users(id),
  submitted_at timestamptz,
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_note text,
  resolution_type text CHECK (resolution_type IS NULL OR resolution_type IN ('AUTHORIZED_VARIANCE', 'SOURCE_CORRECTED', 'WITHIN_TOLERANCE', 'EXTRA_MATERIAL', 'PRODUCTION_HOLD', 'BOM_REVIEW', 'OTHER')),
  resolution_reference_id uuid,
  resolution_note text,
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  bom_review_requested boolean NOT NULL DEFAULT false,
  hold_recommended boolean NOT NULL DEFAULT false,
  row_version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text,
  CHECK (status NOT IN ('SUBMITTED', 'APPROVED', 'REJECTED') OR (submitted_hash IS NOT NULL AND reason_code IS NOT NULL)),
  CHECK (status NOT IN ('APPROVED', 'REJECTED') OR decided_at IS NOT NULL),
  CHECK (status <> 'RESOLVED' OR (resolved_at IS NOT NULL AND resolution_type IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_variance_exceptions_number_uidx ON tenant.manufacturing_material_variance_exceptions (organization_id, exception_number);
-- One investigation in progress per material line.
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_variance_exceptions_open_uidx ON tenant.manufacturing_material_variance_exceptions (organization_id, material_id) WHERE status IN ('OPEN', 'SUBMITTED');
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_material_variance_exceptions_key_uidx ON tenant.manufacturing_material_variance_exceptions (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS manufacturing_material_variance_exceptions_order_idx ON tenant.manufacturing_material_variance_exceptions (organization_id, manufacturing_order_id, status);

-- Requests to engineering to review a BOM standard that keeps missing: they never change a revision (that stays the BOM workflow).
CREATE TABLE IF NOT EXISTS tenant.manufacturing_bom_review_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  finished_item_id uuid NOT NULL REFERENCES tenant.items(id),
  component_item_id uuid NOT NULL REFERENCES tenant.items(id),
  bom_revision_id uuid,
  manufacturing_order_id uuid REFERENCES tenant.manufacturing_orders(id),
  exception_id uuid REFERENCES tenant.manufacturing_material_variance_exceptions(id),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  requested_by uuid REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_by uuid REFERENCES public.users(id),
  closed_at timestamptz,
  close_note text
);
CREATE INDEX IF NOT EXISTS manufacturing_bom_review_requests_idx ON tenant.manufacturing_bom_review_requests (organization_id, status, requested_at);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_variance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  exception_id uuid REFERENCES tenant.manufacturing_material_variance_exceptions(id),
  evaluation_id uuid REFERENCES tenant.manufacturing_material_variance_evaluations(id),
  action text NOT NULL,
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_material_variance_events_idx ON tenant.manufacturing_material_variance_events (organization_id, manufacturing_order_id, occurred_at);

-- ============================================================ 4. guards
-- A decided exception keeps its decision; a resolved one does not change at all.
CREATE OR REPLACE FUNCTION tenant.manufacturing_material_variance_exception_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A variance exception is never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'RESOLVED' THEN
    RAISE EXCEPTION 'A resolved variance exception does not change.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.material_id <> OLD.material_id OR NEW.manufacturing_order_id <> OLD.manufacturing_order_id OR NEW.exception_number <> OLD.exception_number THEN
    RAISE EXCEPTION 'A variance exception keeps its order and material.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('APPROVED', 'REJECTED') AND (NEW.status NOT IN (OLD.status, 'RESOLVED', 'OPEN')
      OR (NEW.status = OLD.status AND (NEW.decided_by IS DISTINCT FROM OLD.decided_by OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
        OR NEW.decision_note IS DISTINCT FROM OLD.decision_note OR NEW.submitted_hash IS DISTINCT FROM OLD.submitted_hash OR NEW.reason_code IS DISTINCT FROM OLD.reason_code))) THEN
    RAISE EXCEPTION 'A decided variance exception is resolved or reopened, never re-decided in place.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$
DECLARE
  name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_material_variance_exceptions_guard') THEN
    CREATE TRIGGER manufacturing_material_variance_exceptions_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_material_variance_exceptions FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_material_variance_exception_guard();
  END IF;
  FOREACH name IN ARRAY ARRAY['manufacturing_material_variance_evaluations', 'manufacturing_material_variance_events'] LOOP
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
  FOREACH name IN ARRAY ARRAY['manufacturing_variance_tolerances', 'manufacturing_material_variance_evaluations', 'manufacturing_material_variance_exceptions',
                             'manufacturing_bom_review_requests', 'manufacturing_material_variance_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.manufacturing_variance_tolerances, tenant.manufacturing_material_variance_exceptions, tenant.manufacturing_bom_review_requests TO vercent_app;
GRANT SELECT, INSERT ON tenant.manufacturing_material_variance_evaluations, tenant.manufacturing_material_variance_events TO vercent_app;
GRANT SELECT ON tenant.manufacturing_variance_tolerances, tenant.manufacturing_material_variance_evaluations, tenant.manufacturing_material_variance_exceptions,
  tenant.manufacturing_bom_review_requests, tenant.manufacturing_material_variance_events TO vercent_worker;

-- ============================================================ 6. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('manufacturing.variance.view', 'View material usage variance', 'Manufacturing', 'See expected against actual material use on manufacturing orders.'),
  ('manufacturing.variance.investigate', 'Investigate material variance', 'Manufacturing', 'Open variance exceptions and record reasons and evidence.'),
  ('manufacturing.variance.submit', 'Submit material variance', 'Manufacturing', 'Submit a variance exception for review.'),
  ('manufacturing.variance.approve', 'Approve material variance', 'Manufacturing', 'Approve or reject submitted variance exceptions.'),
  ('manufacturing.variance.resolve', 'Resolve material variance', 'Manufacturing', 'Close variance exceptions with their resolution and request BOM reviews.'),
  ('manufacturing.variance.cost_view', 'View material variance cost', 'Manufacturing', 'See the cost of material usage variance.'),
  ('manufacturing.variance.export', 'Export material variance', 'Manufacturing', 'Export material usage variance reports.'),
  ('manufacturing.variance.policy', 'Manage variance tolerances', 'Manufacturing', 'Set material variance tolerances per item and item group.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('manufacturing_manager', 'manufacturing.variance.view'), ('manufacturing_manager', 'manufacturing.variance.investigate'), ('manufacturing_manager', 'manufacturing.variance.submit'),
    ('manufacturing_manager', 'manufacturing.variance.approve'), ('manufacturing_manager', 'manufacturing.variance.resolve'), ('manufacturing_manager', 'manufacturing.variance.cost_view'),
    ('manufacturing_manager', 'manufacturing.variance.export'), ('manufacturing_manager', 'manufacturing.variance.policy'),
    ('production_planner', 'manufacturing.variance.view'), ('production_planner', 'manufacturing.variance.investigate'), ('production_planner', 'manufacturing.variance.submit'),
    ('production_planner', 'manufacturing.variance.export'),
    ('shop_floor_operator', 'manufacturing.variance.view'), ('shop_floor_operator', 'manufacturing.variance.investigate'), ('shop_floor_operator', 'manufacturing.variance.submit'),
    ('inventory_manager', 'manufacturing.variance.view'), ('quality_manager', 'manufacturing.variance.view'), ('manufacturing_engineer', 'manufacturing.variance.view'),
    ('accountant', 'manufacturing.variance.view'), ('accountant', 'manufacturing.variance.cost_view'), ('accountant', 'manufacturing.variance.export')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0122_manufacturing_material_variance.sql', 'manufacturing-material-variance') ON CONFLICT DO NOTHING;
