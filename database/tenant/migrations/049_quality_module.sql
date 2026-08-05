BEGIN;

CREATE TABLE IF NOT EXISTS tenant.quality_settings (
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  require_release_approval boolean NOT NULL DEFAULT true,
  prohibit_self_release boolean NOT NULL DEFAULT true,
  auto_hold_on_failure boolean NOT NULL DEFAULT true,
  require_capa_verification boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,company_id)
);

CREATE TABLE IF NOT EXISTS tenant.quality_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  plan_type text NOT NULL
    CHECK (plan_type IN ('incoming','in_process','final','stock_audit','supplier','customer_return')),
  item_id uuid,
  item_group_id uuid,
  supplier_id uuid,
  warehouse_id uuid,
  manufacturing_operation_sequence integer,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','inactive','obsolete')),
  effective_from date,
  effective_to date,
  sampling_method text NOT NULL DEFAULT 'full'
    CHECK (sampling_method IN ('full','fixed_quantity','percentage','aql')),
  sampling_value numeric(20,6) NOT NULL DEFAULT 100 CHECK (sampling_value >= 0),
  created_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,code,version)
);

CREATE TABLE IF NOT EXISTS tenant.quality_inspection_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES tenant.quality_plans(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  characteristic text NOT NULL,
  inspection_method text NOT NULL,
  result_type text NOT NULL
    CHECK (result_type IN ('numeric','boolean','text','selection')),
  lower_limit numeric(20,6),
  target_value numeric(20,6),
  upper_limit numeric(20,6),
  unit text,
  allowed_values jsonb NOT NULL DEFAULT '[]'::jsonb,
  critical boolean NOT NULL DEFAULT false,
  destructive boolean NOT NULL DEFAULT false,
  instructions text,
  UNIQUE (plan_id,sequence)
);

CREATE TABLE IF NOT EXISTS tenant.quality_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  inspection_number text NOT NULL,
  plan_id uuid NOT NULL REFERENCES tenant.quality_plans(id),
  inspection_type text NOT NULL,
  source_type text NOT NULL
    CHECK (source_type IN ('procurement_receipt','stock_batch','stock_serial','manufacturing_work_order','manufacturing_posting','sales_return','pos_return','manual')),
  source_id uuid,
  item_id uuid,
  supplier_id uuid,
  warehouse_id uuid,
  batch_id uuid,
  serial_id uuid,
  lot_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (lot_quantity >= 0),
  sample_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (sample_quantity >= 0),
  accepted_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0),
  rejected_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','in_progress','passed','failed','conditionally_accepted','cancelled')),
  overall_result text,
  inspected_by uuid,
  inspected_at timestamptz,
  released_by uuid,
  released_at timestamptz,
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,inspection_number)
);

CREATE TABLE IF NOT EXISTS tenant.quality_inspection_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  inspection_id uuid NOT NULL REFERENCES tenant.quality_inspections(id) ON DELETE CASCADE,
  inspection_point_id uuid NOT NULL REFERENCES tenant.quality_inspection_points(id),
  sample_number integer NOT NULL DEFAULT 1 CHECK (sample_number > 0),
  numeric_value numeric(20,6),
  boolean_value boolean,
  text_value text,
  result_status text NOT NULL
    CHECK (result_status IN ('pass','fail','not_applicable')),
  remarks text,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inspection_id,inspection_point_id,sample_number)
);

CREATE TABLE IF NOT EXISTS tenant.quality_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  hold_number text NOT NULL,
  hold_type text NOT NULL
    CHECK (hold_type IN ('inventory','batch','serial','receipt','work_order','shipment','return')),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  item_id uuid,
  warehouse_id uuid,
  batch_id uuid,
  serial_id uuid,
  quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','released','cancelled')),
  placed_by uuid NOT NULL,
  placed_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid,
  released_at timestamptz,
  release_reason text,
  UNIQUE (organization_id,hold_number)
);

CREATE TABLE IF NOT EXISTS tenant.quality_nonconformances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  nonconformance_number text NOT NULL,
  inspection_id uuid REFERENCES tenant.quality_inspections(id),
  source_type text NOT NULL,
  source_id uuid,
  item_id uuid,
  supplier_id uuid,
  batch_id uuid,
  serial_id uuid,
  severity text NOT NULL
    CHECK (severity IN ('minor','major','critical')),
  category text NOT NULL,
  description text NOT NULL,
  detected_quantity numeric(20,6) NOT NULL DEFAULT 0,
  affected_quantity numeric(20,6) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','under_review','contained','corrective_action','verified','closed','cancelled')),
  containment_action text,
  disposition text
    CHECK (disposition IN ('accept','accept_with_deviation','rework','repair','return_to_supplier','scrap','use_as_is')),
  disposition_quantity numeric(20,6),
  owner_user_id uuid,
  due_date date,
  created_by uuid NOT NULL,
  closed_by uuid,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,nonconformance_number)
);

CREATE TABLE IF NOT EXISTS tenant.quality_capa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  capa_number text NOT NULL,
  nonconformance_id uuid REFERENCES tenant.quality_nonconformances(id),
  title text NOT NULL,
  root_cause_method text,
  root_cause text,
  correction text,
  corrective_action text,
  preventive_action text,
  owner_user_id uuid NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','analysis','implementation','verification','effective','ineffective','closed','cancelled')),
  effectiveness_criteria text,
  verification_result text,
  verified_by uuid,
  verified_at timestamptz,
  closed_by uuid,
  closed_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,capa_number)
);

CREATE TABLE IF NOT EXISTS tenant.quality_supplier_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  receipts_count integer NOT NULL DEFAULT 0,
  inspected_count integer NOT NULL DEFAULT 0,
  accepted_quantity numeric(20,6) NOT NULL DEFAULT 0,
  rejected_quantity numeric(20,6) NOT NULL DEFAULT 0,
  nonconformance_count integer NOT NULL DEFAULT 0,
  critical_nonconformance_count integer NOT NULL DEFAULT 0,
  quality_score numeric(7,4) NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'qualified'
    CHECK (status IN ('qualified','conditional','blocked','under_review')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,supplier_id,period_start,period_end)
);

CREATE TABLE IF NOT EXISTS tenant.quality_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  audit_number text NOT NULL,
  audit_type text NOT NULL
    CHECK (audit_type IN ('internal','supplier','process','product','system','compliance')),
  title text NOT NULL,
  scope text NOT NULL,
  planned_date date,
  completed_date date,
  lead_auditor_user_id uuid,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','in_progress','completed','cancelled')),
  summary text,
  findings_count integer NOT NULL DEFAULT 0,
  major_findings_count integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,audit_number)
);

CREATE TABLE IF NOT EXISTS tenant.quality_audit_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  audit_id uuid NOT NULL REFERENCES tenant.quality_audits(id) ON DELETE CASCADE,
  finding_number text NOT NULL,
  finding_type text NOT NULL
    CHECK (finding_type IN ('observation','minor','major','opportunity')),
  clause_reference text,
  description text NOT NULL,
  owner_user_id uuid,
  due_date date,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','action_in_progress','verified','closed')),
  capa_id uuid REFERENCES tenant.quality_capa(id),
  UNIQUE (audit_id,finding_number)
);

CREATE TABLE IF NOT EXISTS tenant.quality_events (
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

CREATE INDEX IF NOT EXISTS quality_inspections_status_idx
  ON tenant.quality_inspections(organization_id,company_id,status,created_at);
CREATE INDEX IF NOT EXISTS quality_holds_active_idx
  ON tenant.quality_holds(organization_id,company_id,status,source_type,source_id);
CREATE INDEX IF NOT EXISTS quality_nc_status_idx
  ON tenant.quality_nonconformances(organization_id,company_id,status,severity,due_date);
CREATE INDEX IF NOT EXISTS quality_capa_status_idx
  ON tenant.quality_capa(organization_id,company_id,status,due_date);
CREATE INDEX IF NOT EXISTS quality_events_aggregate_idx
  ON tenant.quality_events(organization_id,aggregate_type,aggregate_id,occurred_at);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'quality_settings',
    'quality_plans',
    'quality_inspection_points',
    'quality_inspections',
    'quality_inspection_results',
    'quality_holds',
    'quality_nonconformances',
    'quality_capa',
    'quality_supplier_records',
    'quality_audits',
    'quality_audit_findings',
    'quality_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON tenant.%I',
      table_name || '_organization_isolation',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON tenant.%I USING (organization_id=tenant.current_organization_id()) WITH CHECK (organization_id=tenant.current_organization_id())',
      table_name || '_organization_isolation',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
