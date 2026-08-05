BEGIN;

CREATE TABLE IF NOT EXISTS tenant.project_settings (
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  require_time_approval boolean NOT NULL DEFAULT true,
  require_expense_approval boolean NOT NULL DEFAULT true,
  prohibit_self_approval boolean NOT NULL DEFAULT true,
  default_currency_code text NOT NULL DEFAULT 'INR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,company_id)
);

CREATE TABLE IF NOT EXISTS tenant.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid,
  project_number text NOT NULL,
  name text NOT NULL,
  description text,
  customer_id uuid,
  sales_order_id uuid,
  contract_reference text,
  project_manager_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','planned','active','on_hold','completed','cancelled')),
  billing_method text NOT NULL DEFAULT 'non_billable'
    CHECK (billing_method IN ('fixed_price','time_and_material','milestone','non_billable')),
  currency_code text NOT NULL,
  planned_start_date date,
  planned_end_date date,
  actual_start_date date,
  actual_end_date date,
  percent_complete numeric(7,4) NOT NULL DEFAULT 0
    CHECK (percent_complete >= 0 AND percent_complete <= 100),
  approved_budget numeric(20,6) NOT NULL DEFAULT 0 CHECK (approved_budget >= 0),
  contracted_revenue numeric(20,6) NOT NULL DEFAULT 0 CHECK (contracted_revenue >= 0),
  billable boolean NOT NULL DEFAULT false,
  content_hash text,
  approved_by uuid,
  approved_at timestamptz,
  closed_by uuid,
  closed_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,project_number)
);

CREATE TABLE IF NOT EXISTS tenant.project_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  name text NOT NULL,
  description text,
  planned_date date,
  completed_date date,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','in_progress','completed','cancelled')),
  billing_trigger boolean NOT NULL DEFAULT false,
  billing_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (billing_amount >= 0),
  owner_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id,sequence)
);

CREATE TABLE IF NOT EXISTS tenant.project_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES tenant.project_milestones(id) ON DELETE SET NULL,
  parent_task_id uuid REFERENCES tenant.project_tasks(id) ON DELETE SET NULL,
  task_number text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','in_progress','blocked','review','done','cancelled')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  assignee_user_id uuid,
  planned_start_date date,
  planned_end_date date,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  estimated_hours numeric(20,6) NOT NULL DEFAULT 0 CHECK (estimated_hours >= 0),
  percent_complete numeric(7,4) NOT NULL DEFAULT 0
    CHECK (percent_complete >= 0 AND percent_complete <= 100),
  billable boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id,task_number)
);

CREATE TABLE IF NOT EXISTS tenant.project_task_dependencies (
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id) ON DELETE CASCADE,
  predecessor_task_id uuid NOT NULL REFERENCES tenant.project_tasks(id) ON DELETE CASCADE,
  successor_task_id uuid NOT NULL REFERENCES tenant.project_tasks(id) ON DELETE CASCADE,
  dependency_type text NOT NULL DEFAULT 'finish_to_start'
    CHECK (dependency_type IN ('finish_to_start','start_to_start','finish_to_finish','start_to_finish')),
  lag_days integer NOT NULL DEFAULT 0,
  PRIMARY KEY (predecessor_task_id,successor_task_id),
  CHECK (predecessor_task_id <> successor_task_id)
);

CREATE TABLE IF NOT EXISTS tenant.project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role_name text NOT NULL,
  allocation_percent numeric(7,4) NOT NULL DEFAULT 100
    CHECK (allocation_percent > 0 AND allocation_percent <= 100),
  cost_rate numeric(20,6) NOT NULL DEFAULT 0 CHECK (cost_rate >= 0),
  bill_rate numeric(20,6) NOT NULL DEFAULT 0 CHECK (bill_rate >= 0),
  start_date date,
  end_date date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id,user_id)
);

CREATE TABLE IF NOT EXISTS tenant.project_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  task_id uuid REFERENCES tenant.project_tasks(id),
  user_id uuid NOT NULL,
  work_date date NOT NULL,
  hours numeric(20,6) NOT NULL CHECK (hours > 0 AND hours <= 24),
  description text,
  billable boolean NOT NULL DEFAULT false,
  cost_rate numeric(20,6) NOT NULL DEFAULT 0 CHECK (cost_rate >= 0),
  bill_rate numeric(20,6) NOT NULL DEFAULT 0 CHECK (bill_rate >= 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','rejected')),
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.project_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  task_id uuid REFERENCES tenant.project_tasks(id),
  incurred_by uuid NOT NULL,
  expense_date date NOT NULL,
  category text NOT NULL,
  description text,
  currency_code text NOT NULL,
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  base_amount numeric(20,6) NOT NULL CHECK (base_amount > 0),
  billable boolean NOT NULL DEFAULT false,
  supplier_id uuid,
  procurement_document_type text,
  procurement_document_id uuid,
  receipt_reference text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','rejected','reimbursed')),
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.project_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','approved','active','superseded','rejected')),
  labor_budget numeric(20,6) NOT NULL DEFAULT 0 CHECK (labor_budget >= 0),
  expense_budget numeric(20,6) NOT NULL DEFAULT 0 CHECK (expense_budget >= 0),
  procurement_budget numeric(20,6) NOT NULL DEFAULT 0 CHECK (procurement_budget >= 0),
  contingency_budget numeric(20,6) NOT NULL DEFAULT 0 CHECK (contingency_budget >= 0),
  revenue_budget numeric(20,6) NOT NULL DEFAULT 0 CHECK (revenue_budget >= 0),
  notes text,
  created_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id,version)
);

CREATE UNIQUE INDEX IF NOT EXISTS project_budget_active_uidx
ON tenant.project_budgets(project_id)
WHERE status='active';

CREATE TABLE IF NOT EXISTS tenant.project_billing_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  milestone_id uuid REFERENCES tenant.project_milestones(id),
  billing_number text NOT NULL,
  description text NOT NULL,
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  currency_code text NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','ready','requested','invoiced','cancelled')),
  sales_invoice_request_id uuid,
  accounting_customer_invoice_id uuid,
  idempotency_key text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,billing_number),
  UNIQUE (organization_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS tenant.project_procurement_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  task_id uuid REFERENCES tenant.project_tasks(id),
  document_type text NOT NULL
    CHECK (document_type IN ('requisition','sourcing_event','purchase_order','receipt','vendor_bill')),
  document_id uuid NOT NULL,
  committed_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (committed_amount >= 0),
  actual_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (actual_amount >= 0),
  currency_code text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,project_id,document_type,document_id)
);

CREATE TABLE IF NOT EXISTS tenant.project_profitability_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  snapshot_date date NOT NULL,
  contracted_revenue numeric(20,6) NOT NULL DEFAULT 0,
  billed_revenue numeric(20,6) NOT NULL DEFAULT 0,
  recognized_revenue numeric(20,6) NOT NULL DEFAULT 0,
  labor_cost numeric(20,6) NOT NULL DEFAULT 0,
  expense_cost numeric(20,6) NOT NULL DEFAULT 0,
  procurement_cost numeric(20,6) NOT NULL DEFAULT 0,
  total_cost numeric(20,6) NOT NULL DEFAULT 0,
  gross_margin numeric(20,6) NOT NULL DEFAULT 0,
  gross_margin_percent numeric(20,6) NOT NULL DEFAULT 0,
  estimate_at_completion numeric(20,6) NOT NULL DEFAULT 0,
  variance_at_completion numeric(20,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id,snapshot_date)
);

CREATE TABLE IF NOT EXISTS tenant.project_events (
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

CREATE INDEX IF NOT EXISTS projects_status_idx
  ON tenant.projects(organization_id,company_id,status,planned_end_date);
CREATE INDEX IF NOT EXISTS project_tasks_status_idx
  ON tenant.project_tasks(organization_id,project_id,status,planned_end_date);
CREATE INDEX IF NOT EXISTS project_time_entries_user_idx
  ON tenant.project_time_entries(organization_id,user_id,work_date,status);
CREATE INDEX IF NOT EXISTS project_expenses_status_idx
  ON tenant.project_expenses(organization_id,project_id,status,expense_date);
CREATE INDEX IF NOT EXISTS project_events_aggregate_idx
  ON tenant.project_events(organization_id,aggregate_type,aggregate_id,occurred_at);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'project_settings',
    'projects',
    'project_milestones',
    'project_tasks',
    'project_task_dependencies',
    'project_members',
    'project_time_entries',
    'project_expenses',
    'project_budgets',
    'project_billing_milestones',
    'project_procurement_links',
    'project_profitability_snapshots',
    'project_events'
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
