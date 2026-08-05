BEGIN;

CREATE TABLE IF NOT EXISTS tenant.asset_settings (
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  require_capitalization_approval boolean NOT NULL DEFAULT true,
  require_disposal_approval boolean NOT NULL DEFAULT true,
  prohibit_self_approval boolean NOT NULL DEFAULT true,
  default_depreciation_method text NOT NULL DEFAULT 'straight_line',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,company_id)
);

CREATE TABLE IF NOT EXISTS tenant.asset_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  capitalization_threshold numeric(20,6) NOT NULL DEFAULT 0,
  useful_life_months integer NOT NULL DEFAULT 60 CHECK (useful_life_months > 0),
  depreciation_method text NOT NULL DEFAULT 'straight_line'
    CHECK (depreciation_method IN ('straight_line','declining_balance','units_of_production','none')),
  residual_value_percent numeric(7,4) NOT NULL DEFAULT 0
    CHECK (residual_value_percent >= 0 AND residual_value_percent <= 100),
  asset_account_id uuid,
  accumulated_depreciation_account_id uuid,
  depreciation_expense_account_id uuid,
  gain_loss_account_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,code)
);

CREATE TABLE IF NOT EXISTS tenant.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid,
  asset_number text NOT NULL,
  name text NOT NULL,
  description text,
  category_id uuid NOT NULL REFERENCES tenant.asset_categories(id),
  item_id uuid,
  serial_number text,
  manufacturer text,
  model text,
  purchase_order_id uuid,
  procurement_receipt_id uuid,
  vendor_bill_id uuid,
  acquisition_date date,
  capitalization_date date,
  placed_in_service_date date,
  acquisition_cost numeric(20,6) NOT NULL DEFAULT 0 CHECK (acquisition_cost >= 0),
  capitalized_cost numeric(20,6) NOT NULL DEFAULT 0 CHECK (capitalized_cost >= 0),
  residual_value numeric(20,6) NOT NULL DEFAULT 0 CHECK (residual_value >= 0),
  accumulated_depreciation numeric(20,6) NOT NULL DEFAULT 0 CHECK (accumulated_depreciation >= 0),
  net_book_value numeric(20,6) NOT NULL DEFAULT 0 CHECK (net_book_value >= 0),
  currency_code text NOT NULL,
  useful_life_months integer NOT NULL CHECK (useful_life_months > 0),
  depreciation_method text NOT NULL
    CHECK (depreciation_method IN ('straight_line','declining_balance','units_of_production','none')),
  depreciation_start_date date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','available','assigned','in_maintenance','retired','disposed')),
  current_user_id uuid,
  current_department_id uuid,
  current_cost_center_id uuid,
  current_location_text text,
  warranty_start_date date,
  warranty_end_date date,
  content_hash text,
  capitalized_by uuid,
  capitalized_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,asset_number),
  UNIQUE (organization_id,serial_number)
);

CREATE TABLE IF NOT EXISTS tenant.asset_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  assigned_to_user_id uuid,
  assigned_to_department_id uuid,
  assigned_to_cost_center_id uuid,
  location_text text,
  assigned_from timestamptz NOT NULL DEFAULT now(),
  assigned_until timestamptz,
  returned_at timestamptz,
  assignment_status text NOT NULL DEFAULT 'active'
    CHECK (assignment_status IN ('active','returned','cancelled')),
  condition_out text,
  condition_in text,
  assigned_by uuid NOT NULL,
  returned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS asset_active_assignment_uidx
ON tenant.asset_assignments(asset_id)
WHERE assignment_status='active';

CREATE TABLE IF NOT EXISTS tenant.asset_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  transfer_number text NOT NULL,
  from_branch_id uuid,
  to_branch_id uuid,
  from_department_id uuid,
  to_department_id uuid,
  from_cost_center_id uuid,
  to_cost_center_id uuid,
  from_location_text text,
  to_location_text text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','completed','cancelled')),
  requested_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,transfer_number)
);

CREATE TABLE IF NOT EXISTS tenant.asset_maintenance_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id) ON DELETE CASCADE,
  name text NOT NULL,
  maintenance_type text NOT NULL
    CHECK (maintenance_type IN ('preventive','predictive','inspection','calibration','statutory')),
  frequency_unit text NOT NULL
    CHECK (frequency_unit IN ('days','weeks','months','years','meter')),
  frequency_value integer NOT NULL CHECK (frequency_value > 0),
  next_due_date date,
  next_due_meter numeric(20,6),
  instructions text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.asset_maintenance_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  maintenance_plan_id uuid REFERENCES tenant.asset_maintenance_plans(id),
  work_order_number text NOT NULL,
  maintenance_type text NOT NULL,
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','scheduled','in_progress','completed','cancelled')),
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  internal_owner_user_id uuid,
  supplier_id uuid,
  procurement_document_id uuid,
  downtime_hours numeric(20,6) NOT NULL DEFAULT 0 CHECK (downtime_hours >= 0),
  labor_cost numeric(20,6) NOT NULL DEFAULT 0 CHECK (labor_cost >= 0),
  parts_cost numeric(20,6) NOT NULL DEFAULT 0 CHECK (parts_cost >= 0),
  external_cost numeric(20,6) NOT NULL DEFAULT 0 CHECK (external_cost >= 0),
  findings text,
  resolution text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,work_order_number)
);

CREATE TABLE IF NOT EXISTS tenant.asset_maintenance_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  maintenance_order_id uuid NOT NULL REFERENCES tenant.asset_maintenance_orders(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  warehouse_id uuid,
  stock_movement_id uuid REFERENCES tenant.stock_movements(id),
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(20,6) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.asset_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  inspection_number text NOT NULL,
  inspection_type text NOT NULL
    CHECK (inspection_type IN ('condition','custody','safety','compliance','calibration')),
  inspection_date date NOT NULL,
  condition_rating text NOT NULL
    CHECK (condition_rating IN ('excellent','good','fair','poor','critical')),
  location_verified boolean NOT NULL DEFAULT false,
  custodian_verified boolean NOT NULL DEFAULT false,
  findings text,
  corrective_action_required boolean NOT NULL DEFAULT false,
  corrective_action_due_date date,
  inspected_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,inspection_number)
);

CREATE TABLE IF NOT EXISTS tenant.asset_depreciation_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  opening_book_value numeric(20,6) NOT NULL DEFAULT 0,
  depreciation_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (depreciation_amount >= 0),
  closing_book_value numeric(20,6) NOT NULL DEFAULT 0 CHECK (closing_book_value >= 0),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','ready','posted','reversed')),
  accounting_journal_id uuid,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id,period_end)
);

CREATE TABLE IF NOT EXISTS tenant.asset_depreciation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  run_number text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','calculated','approved','posted','reversed')),
  total_depreciation numeric(20,6) NOT NULL DEFAULT 0,
  asset_count integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  accounting_batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,period_end)
);

CREATE TABLE IF NOT EXISTS tenant.asset_disposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  disposal_number text NOT NULL,
  disposal_date date NOT NULL,
  disposal_method text NOT NULL
    CHECK (disposal_method IN ('sale','scrap','write_off','donation','return_to_vendor')),
  proceeds_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (proceeds_amount >= 0),
  disposal_cost numeric(20,6) NOT NULL DEFAULT 0 CHECK (disposal_cost >= 0),
  net_book_value numeric(20,6) NOT NULL DEFAULT 0 CHECK (net_book_value >= 0),
  gain_loss_amount numeric(20,6) NOT NULL DEFAULT 0,
  buyer_party_id uuid,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','approved','completed','cancelled')),
  requested_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  completed_by uuid,
  completed_at timestamptz,
  accounting_journal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,disposal_number)
);

CREATE TABLE IF NOT EXISTS tenant.asset_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assets_status_idx
  ON tenant.assets(organization_id,company_id,status,current_user_id);
CREATE INDEX IF NOT EXISTS asset_maintenance_due_idx
  ON tenant.asset_maintenance_plans(organization_id,company_id,next_due_date)
  WHERE active=true;
CREATE INDEX IF NOT EXISTS asset_orders_status_idx
  ON tenant.asset_maintenance_orders(organization_id,company_id,status,scheduled_start_at);
CREATE INDEX IF NOT EXISTS asset_events_asset_idx
  ON tenant.asset_events(organization_id,asset_id,occurred_at);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'asset_settings',
    'asset_categories',
    'assets',
    'asset_assignments',
    'asset_transfers',
    'asset_maintenance_plans',
    'asset_maintenance_orders',
    'asset_maintenance_parts',
    'asset_inspections',
    'asset_depreciation_schedules',
    'asset_depreciation_runs',
    'asset_disposals',
    'asset_events'
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
