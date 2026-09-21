BEGIN;

-- Expands the Projects foundation (migration 046) into the full desk: project types, templates,
-- WBS numbering and baselines, weekly timesheets, materials consumed from Stock, budget revisions,
-- billing lines with an approval step, issues, risks, documents, comments and status reports. User,
-- customer, item and warehouse ids stay loosely typed uuids (no FK), the convention every other module
-- uses for shared master data.

ALTER TABLE tenant.project_settings
  ADD COLUMN IF NOT EXISTS hours_per_day numeric(5,2) NOT NULL DEFAULT 8 CHECK (hours_per_day > 0 AND hours_per_day <= 24),
  ADD COLUMN IF NOT EXISTS require_membership_for_time boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_baseline_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_budget_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_billing_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_close_checks boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS default_billing_method text NOT NULL DEFAULT 'non_billable'
    CHECK (default_billing_method IN ('fixed_price','time_and_material','milestone','non_billable'));

ALTER TABLE tenant.projects
  ADD COLUMN IF NOT EXISTS project_type text NOT NULL DEFAULT 'customer' CHECK (project_type IN ('customer','internal')),
  ADD COLUMN IF NOT EXISTS template_id uuid,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  ADD COLUMN IF NOT EXISTS health text NOT NULL DEFAULT 'on_track' CHECK (health IN ('on_track','at_risk','off_track')),
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS baseline_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reopened_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS close_note text;

-- F196: reusable structure a new project is built from.
CREATE TABLE IF NOT EXISTS tenant.project_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  project_type text NOT NULL DEFAULT 'customer' CHECK (project_type IN ('customer','internal')),
  billing_method text NOT NULL DEFAULT 'non_billable' CHECK (billing_method IN ('fixed_price','time_and_material','milestone','non_billable')),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,code)
);
CREATE TABLE IF NOT EXISTS tenant.project_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  template_id uuid NOT NULL REFERENCES tenant.project_templates(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  item_type text NOT NULL DEFAULT 'task' CHECK (item_type IN ('task','milestone')),
  parent_sequence integer,
  name text NOT NULL,
  description text,
  offset_days integer NOT NULL DEFAULT 0 CHECK (offset_days >= 0),
  duration_days integer NOT NULL DEFAULT 1 CHECK (duration_days >= 0),
  estimated_hours numeric(20,6) NOT NULL DEFAULT 0 CHECK (estimated_hours >= 0),
  billable boolean NOT NULL DEFAULT false,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  predecessor_sequences integer[] NOT NULL DEFAULT '{}',
  billing_percent numeric(7,4) NOT NULL DEFAULT 0 CHECK (billing_percent >= 0 AND billing_percent <= 100),
  UNIQUE (template_id,sequence)
);

-- F197-F201: WBS numbering, duration and the frozen baseline the current plan is compared to.
ALTER TABLE tenant.project_tasks
  ADD COLUMN IF NOT EXISTS wbs_code text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duration_days integer CHECK (duration_days IS NULL OR duration_days >= 0),
  ADD COLUMN IF NOT EXISTS baseline_start date,
  ADD COLUMN IF NOT EXISTS baseline_end date,
  ADD COLUMN IF NOT EXISTS baseline_hours numeric(20,6),
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid;
CREATE INDEX IF NOT EXISTS project_tasks_parent_idx ON tenant.project_tasks(organization_id,project_id,parent_task_id);
CREATE INDEX IF NOT EXISTS project_tasks_assignee_idx ON tenant.project_tasks(organization_id,assignee_user_id,status);

CREATE TABLE IF NOT EXISTS tenant.project_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','superseded','rejected')),
  snapshot jsonb NOT NULL,
  reason text,
  created_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id,version)
);

ALTER TABLE tenant.project_milestones
  ADD COLUMN IF NOT EXISTS baseline_date date;

-- F210: weekly timesheets group entries for submission; billed and approved entries lock.
CREATE TABLE IF NOT EXISTS tenant.project_timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  week_start date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  total_hours numeric(20,6) NOT NULL DEFAULT 0,
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,user_id,week_start)
);
ALTER TABLE tenant.project_time_entries
  ADD COLUMN IF NOT EXISTS timesheet_id uuid REFERENCES tenant.project_timesheets(id),
  ADD COLUMN IF NOT EXISTS billed_billing_id uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid;
CREATE INDEX IF NOT EXISTS project_time_entries_project_idx ON tenant.project_time_entries(organization_id,project_id,status,work_date);

ALTER TABLE tenant.project_expenses
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(20,8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  ADD COLUMN IF NOT EXISTS billed_billing_id uuid,
  ADD COLUMN IF NOT EXISTS reimbursed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reimbursed_by uuid;

-- F212: stock issued to a project, with the movement it created in Stock.
CREATE TABLE IF NOT EXISTS tenant.project_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  task_id uuid REFERENCES tenant.project_tasks(id),
  item_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(20,6) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total_cost numeric(20,6) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','returned')),
  stock_movement_id uuid,
  return_movement_id uuid,
  consumed_on date NOT NULL DEFAULT current_date,
  billable boolean NOT NULL DEFAULT false,
  billed_billing_id uuid,
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_materials_project_idx ON tenant.project_materials(organization_id,project_id,status);

ALTER TABLE tenant.project_procurement_links
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- F214/F215: revisions carry their reason and the version they were cloned from.
ALTER TABLE tenant.project_budgets
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS base_version integer,
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_reason text;

-- F218-F221: billing lines gain a type, a billed period, an approval step and the invoice reference.
ALTER TABLE tenant.project_billing_milestones
  ADD COLUMN IF NOT EXISTS billing_type text NOT NULL DEFAULT 'fixed' CHECK (billing_type IN ('fixed','time_material','milestone')),
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoiced_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS cancelled_reason text,
  ADD COLUMN IF NOT EXISTS detail jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS project_billing_milestone_uidx
  ON tenant.project_billing_milestones(milestone_id) WHERE milestone_id IS NOT NULL AND status<>'cancelled';

-- F224: issues.
CREATE TABLE IF NOT EXISTS tenant.project_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id) ON DELETE CASCADE,
  issue_number text NOT NULL,
  title text NOT NULL,
  description text,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  owner_user_id uuid,
  task_id uuid REFERENCES tenant.project_tasks(id) ON DELETE SET NULL,
  milestone_id uuid REFERENCES tenant.project_milestones(id) ON DELETE SET NULL,
  risk_id uuid,
  due_date date,
  resolution text,
  resolved_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,issue_number)
);
-- F225: risks with a probability x impact score.
CREATE TABLE IF NOT EXISTS tenant.project_risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id) ON DELETE CASCADE,
  risk_number text NOT NULL,
  title text NOT NULL,
  description text,
  probability integer NOT NULL CHECK (probability BETWEEN 1 AND 5),
  impact integer NOT NULL CHECK (impact BETWEEN 1 AND 5),
  score integer GENERATED ALWAYS AS (probability * impact) STORED,
  status text NOT NULL DEFAULT 'identified' CHECK (status IN ('identified','assessed','mitigating','realized','closed')),
  owner_user_id uuid,
  mitigation text,
  contingency text,
  review_date date,
  task_id uuid REFERENCES tenant.project_tasks(id) ON DELETE SET NULL,
  realized_issue_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,risk_number)
);
-- F226: documents by reference, with confidentiality.
CREATE TABLE IF NOT EXISTS tenant.project_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tenant.project_tasks(id) ON DELETE SET NULL,
  title text NOT NULL,
  document_type text NOT NULL DEFAULT 'other' CHECK (document_type IN ('contract','scope','plan','deliverable','report','minutes','change_request','other')),
  reference_url text,
  version text NOT NULL DEFAULT '1',
  confidential boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- F227: comments on any project entity, with mentions.
CREATE TABLE IF NOT EXISTS tenant.project_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('project','task','milestone','issue','risk','document')),
  entity_id uuid NOT NULL,
  body text NOT NULL,
  mentions uuid[] NOT NULL DEFAULT '{}',
  internal boolean NOT NULL DEFAULT true,
  author_user_id uuid NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_comments_entity_idx ON tenant.project_comments(organization_id,entity_type,entity_id,created_at);
-- F228/F229: periodic status reports.
CREATE TABLE IF NOT EXISTS tenant.project_status_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  health text NOT NULL CHECK (health IN ('on_track','at_risk','off_track')),
  percent_complete numeric(7,4) NOT NULL DEFAULT 0,
  summary text NOT NULL,
  accomplishments text,
  next_steps text,
  blockers text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'project_templates','project_template_items','project_baselines','project_timesheets','project_materials',
    'project_issues','project_risks','project_documents','project_comments','project_status_reports'
  ]
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON tenant.%I',table_name || '_organization_isolation',table_name);
    EXECUTE format(
      'CREATE POLICY %I ON tenant.%I USING (organization_id=tenant.current_organization_id()) WITH CHECK (organization_id=tenant.current_organization_id())',
      table_name || '_organization_isolation',table_name
    );
  END LOOP;
END $$;

COMMIT;
