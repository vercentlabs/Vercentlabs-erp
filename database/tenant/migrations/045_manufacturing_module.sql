BEGIN;

CREATE TABLE IF NOT EXISTS tenant.manufacturing_settings (
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  default_wip_warehouse_id uuid,
  default_finished_goods_warehouse_id uuid,
  default_scrap_warehouse_id uuid,
  backflush_materials boolean NOT NULL DEFAULT false,
  require_operation_completion boolean NOT NULL DEFAULT true,
  allow_overproduction boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, company_id)
);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_work_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','maintenance')),
  capacity_per_day numeric(20,6) NOT NULL DEFAULT 0 CHECK (capacity_per_day >= 0),
  efficiency_percent numeric(7,4) NOT NULL DEFAULT 100 CHECK (efficiency_percent > 0),
  hourly_rate numeric(20,6) NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
  overhead_rate numeric(20,6) NOT NULL DEFAULT 0 CHECK (overhead_rate >= 0),
  calendar jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_boms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  item_id uuid NOT NULL,
  code text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','inactive','obsolete')),
  output_quantity numeric(20,6) NOT NULL DEFAULT 1 CHECK (output_quantity > 0),
  output_uom_id uuid,
  effective_from date,
  effective_to date,
  is_default boolean NOT NULL DEFAULT false,
  notes text,
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_boms_default_uidx
ON tenant.manufacturing_boms (organization_id, company_id, item_id)
WHERE is_default = true AND status = 'active';

CREATE TABLE IF NOT EXISTS tenant.manufacturing_bom_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  bom_id uuid NOT NULL REFERENCES tenant.manufacturing_boms(id) ON DELETE CASCADE,
  line_number integer NOT NULL CHECK (line_number > 0),
  item_id uuid NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  uom_id uuid,
  scrap_percent numeric(7,4) NOT NULL DEFAULT 0 CHECK (scrap_percent >= 0),
  issue_method text NOT NULL DEFAULT 'manual' CHECK (issue_method IN ('manual','backflush')),
  warehouse_id uuid,
  operation_sequence integer,
  notes text,
  UNIQUE (bom_id, line_number)
);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_routings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','inactive','obsolete')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code, version)
);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_routing_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  routing_id uuid NOT NULL REFERENCES tenant.manufacturing_routings(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  name text NOT NULL,
  work_center_id uuid REFERENCES tenant.manufacturing_work_centers(id),
  setup_minutes numeric(20,6) NOT NULL DEFAULT 0 CHECK (setup_minutes >= 0),
  run_minutes_per_unit numeric(20,6) NOT NULL DEFAULT 0 CHECK (run_minutes_per_unit >= 0),
  queue_minutes numeric(20,6) NOT NULL DEFAULT 0 CHECK (queue_minutes >= 0),
  move_minutes numeric(20,6) NOT NULL DEFAULT 0 CHECK (move_minutes >= 0),
  subcontracted boolean NOT NULL DEFAULT false,
  instructions text,
  UNIQUE (routing_id, sequence)
);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid,
  work_order_number text NOT NULL,
  item_id uuid NOT NULL,
  bom_id uuid NOT NULL REFERENCES tenant.manufacturing_boms(id),
  routing_id uuid REFERENCES tenant.manufacturing_routings(id),
  quantity_planned numeric(20,6) NOT NULL CHECK (quantity_planned > 0),
  quantity_completed numeric(20,6) NOT NULL DEFAULT 0 CHECK (quantity_completed >= 0),
  quantity_scrapped numeric(20,6) NOT NULL DEFAULT 0 CHECK (quantity_scrapped >= 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','planned','released','in_progress','completed','cancelled')),
  source_type text,
  source_id uuid,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  wip_warehouse_id uuid NOT NULL,
  finished_goods_warehouse_id uuid NOT NULL,
  content_hash text,
  released_by uuid,
  released_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, work_order_number)
);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_work_order_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  work_order_id uuid NOT NULL REFERENCES tenant.manufacturing_work_orders(id) ON DELETE CASCADE,
  bom_component_id uuid REFERENCES tenant.manufacturing_bom_components(id),
  item_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  warehouse_location_id uuid,
  required_quantity numeric(20,6) NOT NULL CHECK (required_quantity >= 0),
  issued_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (issued_quantity >= 0),
  returned_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  batch_id uuid,
  issue_method text NOT NULL DEFAULT 'manual' CHECK (issue_method IN ('manual','backflush'))
);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_work_order_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  work_order_id uuid NOT NULL REFERENCES tenant.manufacturing_work_orders(id) ON DELETE CASCADE,
  routing_operation_id uuid REFERENCES tenant.manufacturing_routing_operations(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  name text NOT NULL,
  work_center_id uuid REFERENCES tenant.manufacturing_work_centers(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','ready','in_progress','completed','blocked','skipped')),
  planned_minutes numeric(20,6) NOT NULL DEFAULT 0 CHECK (planned_minutes >= 0),
  actual_minutes numeric(20,6) NOT NULL DEFAULT 0 CHECK (actual_minutes >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  completed_by uuid,
  UNIQUE (work_order_id, sequence)
);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_production_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  work_order_id uuid NOT NULL REFERENCES tenant.manufacturing_work_orders(id),
  posting_number text NOT NULL,
  posting_type text NOT NULL
    CHECK (posting_type IN ('material_issue','material_return','production_receipt','scrap')),
  item_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  warehouse_location_id uuid,
  batch_id uuid,
  serial_id uuid,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(20,6) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  stock_movement_id uuid REFERENCES tenant.stock_movements(id),
  idempotency_key text NOT NULL,
  posted_by uuid NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, posting_number),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_cost_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  work_order_id uuid NOT NULL REFERENCES tenant.manufacturing_work_orders(id),
  material_cost numeric(20,6) NOT NULL DEFAULT 0,
  labor_cost numeric(20,6) NOT NULL DEFAULT 0,
  overhead_cost numeric(20,6) NOT NULL DEFAULT 0,
  subcontract_cost numeric(20,6) NOT NULL DEFAULT 0,
  scrap_cost numeric(20,6) NOT NULL DEFAULT 0,
  total_cost numeric(20,6) NOT NULL DEFAULT 0,
  cost_per_unit numeric(20,6) NOT NULL DEFAULT 0,
  snapshot_type text NOT NULL CHECK (snapshot_type IN ('planned','actual','completion')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_planning_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  run_number text NOT NULL,
  horizon_start date NOT NULL,
  horizon_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','completed','failed')),
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_by uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, run_number)
);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_material_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  planning_run_id uuid NOT NULL REFERENCES tenant.manufacturing_planning_runs(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  warehouse_id uuid,
  required_date date NOT NULL,
  gross_requirement numeric(20,6) NOT NULL DEFAULT 0,
  available_quantity numeric(20,6) NOT NULL DEFAULT 0,
  reserved_quantity numeric(20,6) NOT NULL DEFAULT 0,
  net_requirement numeric(20,6) NOT NULL DEFAULT 0,
  recommended_action text NOT NULL
    CHECK (recommended_action IN ('none','purchase','manufacture','transfer','expedite')),
  source_type text,
  source_id uuid
);

CREATE TABLE IF NOT EXISTS tenant.manufacturing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manufacturing_work_orders_status_idx
  ON tenant.manufacturing_work_orders (organization_id, company_id, status, planned_start_at);
CREATE INDEX IF NOT EXISTS manufacturing_materials_item_idx
  ON tenant.manufacturing_work_order_materials (organization_id, item_id, warehouse_id);
CREATE INDEX IF NOT EXISTS manufacturing_postings_work_order_idx
  ON tenant.manufacturing_production_postings (organization_id, work_order_id, posted_at);
CREATE INDEX IF NOT EXISTS manufacturing_events_aggregate_idx
  ON tenant.manufacturing_events (organization_id, aggregate_type, aggregate_id, occurred_at);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'manufacturing_settings',
    'manufacturing_work_centers',
    'manufacturing_boms',
    'manufacturing_bom_components',
    'manufacturing_routings',
    'manufacturing_routing_operations',
    'manufacturing_work_orders',
    'manufacturing_work_order_materials',
    'manufacturing_work_order_operations',
    'manufacturing_production_postings',
    'manufacturing_cost_snapshots',
    'manufacturing_planning_runs',
    'manufacturing_material_requirements',
    'manufacturing_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON tenant.%I',
      table_name || '_organization_isolation',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())',
      table_name || '_organization_isolation',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
