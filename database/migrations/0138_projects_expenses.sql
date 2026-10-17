-- Projects — Project Expenses. The project-facing capture, review and allocation of what delivering a project cost: an employee's claim,
-- a cost the company already paid, a supplier bill line, a material issue from Inventory. An expense can be claimed, approved, recognized
-- as cost, reimbursed and recharged to the customer — five separate events — and its cost is counted once. Projects never posts to the
-- ledger, pays anyone, moves stock or invoices: Finance, Procurement, Inventory and Sales stay the owners of those records.
--
--   1. categories      a short company list (travel, local transport, accommodation, meals, supplies, software, equipment rental,
--                      subcontractor services, communication, other) — reporting classifications, never an accounting decision.
--   2. expenses        the claim: project and optional task, claimant, date, category, purpose, amount and currency (and the company-currency
--                      amount), who paid (employee / company / supplier), the supplier invoice's tax details as captured, the receipt rule
--                      and its exception, and three separate states — approval, reimbursement, customer billing — plus the finance review
--                      (tax treatment and the cost basis) and the recharge decision. Versioned; created once per key.
--   3. events          every submission, decision, review, payment record, handoff and correction, append-only, with the version decided.
--   4. cost allocations the project's recognized cost, each pointing at its one authoritative source (a verified claim, a supplier bill
--                      line, a goods issue) — never more than the source's value, never twice. Reversed, never deleted.
--   5. reimbursements  the handoff of an approved employee-paid claim to Finance, and the payments Finance records against it.
--   6. billing         recharge requests to Sales, their expense allocations (never more than an expense's recharge amount, never twice),
--                      and the invoice line they became.
--   7. corrections     a requested change to an approved expense: what, why, its decision, and the downstream reviews it raised.
--   8. policy          finance review, the receipt threshold, the manager's approval limit, self-approval.
--   9. permissions     view own, create, edit draft, submit, view team, approve, finance review, correct, view cost, view billing, export.

-- ============================================================ 1. categories
CREATE TABLE IF NOT EXISTS tenant.project_expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  receipt_required boolean NOT NULL DEFAULT true,
  description_required boolean NOT NULL DEFAULT false,
  budget_category text,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
INSERT INTO tenant.project_expense_categories (organization_id, code, name, description, receipt_required, description_required, budget_category, sort_order)
SELECT org.id, standard.code, standard.name, standard.description, standard.receipt, standard.explain, standard.budget, standard.sort
  FROM public.organizations org
 CROSS JOIN (VALUES
   ('TRAVEL', 'Travel', 'Train, airfare, mileage', true, false, 'TRAVEL', 10),
   ('LOCAL_TRANSPORT', 'Local transport', 'Taxi, auto, parking', true, false, 'TRAVEL', 20),
   ('ACCOMMODATION', 'Accommodation', 'Hotel', true, false, 'TRAVEL', 30),
   ('MEALS', 'Meals', 'Eligible business meals', true, false, 'TRAVEL', 40),
   ('PROJECT_SUPPLIES', 'Project supplies', 'Stationery, consumables', true, false, 'MATERIALS', 50),
   ('SOFTWARE_SERVICES', 'Software & services', 'Authorized external tools', true, false, 'SERVICES', 60),
   ('EQUIPMENT_RENTAL', 'Equipment rental', 'Temporary equipment', true, false, 'EQUIPMENT', 70),
   ('SUBCONTRACTOR', 'Subcontractor services', 'Supplier-provided work', true, false, 'SERVICES', 80),
   ('COMMUNICATION', 'Communication', 'Internet or phone', true, false, 'OTHER', 90),
   ('OTHER', 'Other', 'Describe what was bought and why', true, true, 'OTHER', 100)
 ) AS standard(code, name, description, receipt, explain, budget, sort)
ON CONFLICT (organization_id, code) DO NOTHING;

-- ============================================================ 2. expenses
CREATE TABLE IF NOT EXISTS tenant.project_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  expense_number bigint GENERATED ALWAYS AS IDENTITY,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  task_id uuid REFERENCES tenant.project_tasks(id),
  claimant_user_id uuid NOT NULL REFERENCES public.users(id),
  entered_by uuid REFERENCES public.users(id),
  expense_date date NOT NULL,
  category_id uuid NOT NULL REFERENCES tenant.project_expense_categories(id),
  description text NOT NULL CHECK (length(btrim(description)) >= 3),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  exchange_rate numeric(20,10) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  base_amount numeric(18,2) NOT NULL CHECK (base_amount > 0),
  base_currency char(3) NOT NULL,
  payment_source text NOT NULL CHECK (payment_source IN ('EMPLOYEE', 'COMPANY', 'SUPPLIER')),
  -- Company-paid: the card or bank reference Finance matches; supplier-billed: the bill line it rests on.
  payment_reference text,
  vendor_bill_id uuid REFERENCES tenant.accounting_vendor_bills(id),
  vendor_bill_line_id uuid REFERENCES tenant.accounting_vendor_bill_lines(id),
  supplier_id uuid,
  -- The supplier invoice as captured (Finance decides what is recoverable).
  supplier_invoice_number text,
  supplier_invoice_date date,
  supplier_gstin text,
  taxable_amount numeric(18,2) CHECK (taxable_amount IS NULL OR taxable_amount >= 0),
  cgst_amount numeric(18,2) CHECK (cgst_amount IS NULL OR cgst_amount >= 0),
  sgst_amount numeric(18,2) CHECK (sgst_amount IS NULL OR sgst_amount >= 0),
  igst_amount numeric(18,2) CHECK (igst_amount IS NULL OR igst_amount >= 0),
  reimbursable boolean NOT NULL DEFAULT false,
  receipt_required boolean NOT NULL DEFAULT true,
  receipt_exception_reason text,
  receipt_exception_by uuid REFERENCES public.users(id),
  receipt_exception_at timestamptz,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CORRECTION_REQUIRED')),
  submitted_version integer,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  approved_by uuid REFERENCES public.users(id),
  approved_version integer,
  over_limit boolean NOT NULL DEFAULT false,
  duplicate_reviewed boolean NOT NULL DEFAULT false,
  -- Finance: documents and tax verified, the cost basis decided (recoverable GST is not project cost).
  finance_status text NOT NULL DEFAULT 'NOT_REVIEWED' CHECK (finance_status IN ('NOT_REVIEWED', 'VERIFIED', 'RETURNED')),
  tax_treatment text NOT NULL DEFAULT 'PENDING' CHECK (tax_treatment IN ('PENDING', 'NO_TAX', 'RECOVERABLE', 'NON_RECOVERABLE')),
  cost_basis numeric(18,2) CHECK (cost_basis IS NULL OR cost_basis >= 0),
  finance_note text,
  finance_reviewed_by uuid REFERENCES public.users(id),
  finance_reviewed_at timestamptz,
  recognition_date date,
  reimbursement_status text NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK (reimbursement_status IN ('NOT_APPLICABLE', 'NOT_REQUESTED', 'PENDING_PAYMENT', 'PARTIALLY_PAID', 'PAID', 'ADJUSTMENT_REQUIRED')),
  billing_classification text NOT NULL DEFAULT 'NON_BILLABLE' CHECK (billing_classification IN ('NON_BILLABLE', 'INCLUDED_IN_FIXED_FEE', 'RECHARGE_ELIGIBLE', 'ELIGIBILITY_PENDING')),
  billing_status text NOT NULL DEFAULT 'NON_BILLABLE' CHECK (billing_status IN ('NON_BILLABLE', 'INCLUDED_IN_FIXED_FEE', 'ELIGIBILITY_PENDING', 'ELIGIBLE_UNBILLED', 'RESERVED_FOR_BILLING', 'INVOICED', 'ADJUSTMENT_REQUIRED')),
  recharge_amount numeric(18,2) CHECK (recharge_amount IS NULL OR recharge_amount >= 0),
  recharge_sales_order_line_id uuid REFERENCES tenant.sales_order_lines(id),
  billing_decided_by uuid REFERENCES public.users(id),
  billing_decided_at timestamptz,
  withdrawn_reason text,
  row_version integer NOT NULL DEFAULT 1,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id),
  -- A supplier-billed expense rests on the supplier bill line before Finance verifies it.
  CONSTRAINT project_expenses_supplier_check CHECK (payment_source <> 'SUPPLIER' OR vendor_bill_line_id IS NOT NULL OR finance_status <> 'VERIFIED'),
  CONSTRAINT project_expenses_reimbursable_check CHECK (NOT reimbursable OR payment_source = 'EMPLOYEE'),
  CONSTRAINT project_expenses_recharge_check CHECK (recharge_amount IS NULL OR recharge_amount <= base_amount),
  CONSTRAINT project_expenses_receipt_exception_check CHECK (receipt_exception_reason IS NULL OR length(btrim(receipt_exception_reason)) >= 5)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_expenses_key_idx ON tenant.project_expenses (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_expenses_project_idx ON tenant.project_expenses (organization_id, project_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS project_expenses_claimant_idx ON tenant.project_expenses (organization_id, claimant_user_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS project_expenses_status_idx ON tenant.project_expenses (organization_id, status, finance_status);
CREATE INDEX IF NOT EXISTS project_expenses_duplicate_idx ON tenant.project_expenses (organization_id, claimant_user_id, expense_date, amount);

-- ============================================================ 3. events
CREATE TABLE IF NOT EXISTS tenant.project_expense_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  expense_id uuid NOT NULL REFERENCES tenant.project_expenses(id),
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  action text NOT NULL,
  from_status text,
  to_status text,
  expense_version integer,
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  idempotency_key text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS project_expense_events_idx ON tenant.project_expense_events (organization_id, expense_id, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS project_expense_events_key_idx ON tenant.project_expense_events (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================ 4. cost allocations
CREATE TABLE IF NOT EXISTS tenant.project_expense_cost_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  task_id uuid REFERENCES tenant.project_tasks(id),
  expense_id uuid REFERENCES tenant.project_expenses(id),
  category_id uuid REFERENCES tenant.project_expense_categories(id),
  source_module text NOT NULL CHECK (source_module IN ('EXPENSE_CLAIM', 'SUPPLIER_BILL', 'GOODS_ISSUE')),
  source_id uuid NOT NULL,
  source_line_id uuid,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  recognition_date date NOT NULL,
  source_version text,
  status text NOT NULL DEFAULT 'RECOGNIZED' CHECK (status IN ('PENDING', 'RECOGNIZED', 'REVERSED')),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES public.users(id),
  reversal_reason text,
  command_id text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT project_expense_cost_allocations_reversal_check CHECK ((status = 'REVERSED') = (reversed_at IS NOT NULL))
);
-- A source (line) is allocated to a project once while active; a verified claim once.
CREATE UNIQUE INDEX IF NOT EXISTS project_expense_cost_allocations_source_idx ON tenant.project_expense_cost_allocations (organization_id, source_module, source_id, COALESCE(source_line_id, source_id), project_id)
  WHERE status <> 'REVERSED';
CREATE UNIQUE INDEX IF NOT EXISTS project_expense_cost_allocations_command_idx ON tenant.project_expense_cost_allocations (organization_id, command_id) WHERE command_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_expense_cost_allocations_project_idx ON tenant.project_expense_cost_allocations (organization_id, project_id, status);

-- An allocation keeps its source and amount; it is only ever reversed.
CREATE OR REPLACE FUNCTION tenant.project_expense_allocations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A cost allocation is reversed, never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount <> OLD.amount OR NEW.source_module <> OLD.source_module OR NEW.source_id <> OLD.source_id OR NEW.source_line_id IS DISTINCT FROM OLD.source_line_id
     OR NEW.project_id <> OLD.project_id OR NEW.organization_id <> OLD.organization_id THEN
    RAISE EXCEPTION 'A cost allocation keeps its source, project and amount; reverse it and allocate again.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'REVERSED' AND NEW.status <> 'REVERSED' THEN
    RAISE EXCEPTION 'A reversed allocation stays reversed.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_expense_cost_allocations_guard') THEN
    CREATE TRIGGER project_expense_cost_allocations_guard BEFORE UPDATE OR DELETE ON tenant.project_expense_cost_allocations FOR EACH ROW EXECUTE FUNCTION tenant.project_expense_allocations_guard();
  END IF;
END $$;

-- ============================================================ 5. reimbursements
CREATE TABLE IF NOT EXISTS tenant.project_expense_reimbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  expense_id uuid NOT NULL REFERENCES tenant.project_expenses(id),
  claimant_user_id uuid NOT NULL REFERENCES public.users(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  paid_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status text NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN ('PENDING_PAYMENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'ADJUSTMENT_REQUIRED')),
  requested_by uuid REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cancelled_reason text,
  CONSTRAINT project_expense_reimbursements_paid_check CHECK (paid_amount <= amount OR status = 'ADJUSTMENT_REQUIRED')
);
CREATE UNIQUE INDEX IF NOT EXISTS project_expense_reimbursements_active_idx ON tenant.project_expense_reimbursements (expense_id) WHERE status <> 'CANCELLED';
CREATE TABLE IF NOT EXISTS tenant.project_expense_reimbursement_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  reimbursement_id uuid NOT NULL REFERENCES tenant.project_expense_reimbursements(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  paid_on date NOT NULL,
  reference text NOT NULL CHECK (length(btrim(reference)) >= 2),
  recorded_by uuid REFERENCES public.users(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  command_id text
);
CREATE UNIQUE INDEX IF NOT EXISTS project_expense_reimbursement_payments_command_idx ON tenant.project_expense_reimbursement_payments (organization_id, command_id) WHERE command_id IS NOT NULL;

-- ============================================================ 6. billing
CREATE TABLE IF NOT EXISTS tenant.project_expense_billing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  request_number bigint GENERATED ALWAYS AS IDENTITY,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  customer_id uuid,
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'INVOICED', 'CANCELLED')),
  total_amount numeric(18,2) NOT NULL DEFAULT 0,
  currency char(3) NOT NULL,
  customer_invoice_id uuid REFERENCES tenant.accounting_customer_invoices(id),
  customer_invoice_line_id uuid REFERENCES tenant.accounting_customer_invoice_lines(id),
  note text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  invoiced_by uuid REFERENCES public.users(id),
  invoiced_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id),
  cancelled_at timestamptz,
  cancel_reason text,
  idempotency_key text,
  row_version integer NOT NULL DEFAULT 1,
  CHECK (status <> 'CANCELLED' OR length(btrim(COALESCE(cancel_reason, ''))) >= 3),
  CHECK (status <> 'INVOICED' OR customer_invoice_line_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_expense_billing_requests_key_idx ON tenant.project_expense_billing_requests (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS tenant.project_expense_billing_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES tenant.project_expense_billing_requests(id),
  expense_id uuid NOT NULL REFERENCES tenant.project_expenses(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'INVOICED', 'RELEASED')),
  released_at timestamptz,
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- An expense is in one live recharge at a time.
CREATE UNIQUE INDEX IF NOT EXISTS project_expense_billing_allocations_live_idx ON tenant.project_expense_billing_allocations (expense_id) WHERE status <> 'RELEASED';

-- ============================================================ 7. corrections
CREATE TABLE IF NOT EXISTS tenant.project_expense_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  correction_number bigint GENERATED ALWAYS AS IDENTITY,
  expense_id uuid NOT NULL REFERENCES tenant.project_expenses(id),
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  kind text NOT NULL CHECK (kind IN ('AMOUNT', 'CATEGORY', 'PROJECT', 'TASK', 'DUPLICATE', 'REFUND', 'TAX', 'OTHER')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  original jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPLIED', 'REJECTED')),
  -- What the change touches downstream, reviewed by its owners (Finance for reimbursement, Sales for billing).
  impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by uuid REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_note text,
  idempotency_key text
);
CREATE UNIQUE INDEX IF NOT EXISTS project_expense_corrections_open_idx ON tenant.project_expense_corrections (expense_id) WHERE status = 'REQUESTED';
CREATE UNIQUE INDEX IF NOT EXISTS project_expense_corrections_key_idx ON tenant.project_expense_corrections (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================ 8. policy
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS expense_finance_review_required boolean NOT NULL DEFAULT true;
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS expense_receipt_threshold numeric(18,2) NOT NULL DEFAULT 0 CHECK (expense_receipt_threshold >= 0);
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS expense_manager_limit numeric(18,2) CHECK (expense_manager_limit IS NULL OR expense_manager_limit > 0);
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS expense_claim_deadline_days integer NOT NULL DEFAULT 90 CHECK (expense_claim_deadline_days BETWEEN 1 AND 730);

-- ============================================================ append-only and isolation
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_expense_events_append_only') THEN
    CREATE TRIGGER project_expense_events_append_only BEFORE UPDATE OR DELETE ON tenant.project_expense_events FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_expense_reimbursement_payments_append_only') THEN
    CREATE TRIGGER project_expense_reimbursement_payments_append_only BEFORE UPDATE OR DELETE ON tenant.project_expense_reimbursement_payments FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_expenses_no_delete') THEN
    CREATE TRIGGER project_expenses_no_delete BEFORE DELETE ON tenant.project_expenses FOR EACH ROW EXECUTE FUNCTION tenant.projects_no_delete();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_expense_billing_allocations_no_delete') THEN
    CREATE TRIGGER project_expense_billing_allocations_no_delete BEFORE DELETE ON tenant.project_expense_billing_allocations FOR EACH ROW EXECUTE FUNCTION tenant.projects_no_delete();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_expense_corrections_no_delete') THEN
    CREATE TRIGGER project_expense_corrections_no_delete BEFORE DELETE ON tenant.project_expense_corrections FOR EACH ROW EXECUTE FUNCTION tenant.projects_no_delete();
  END IF;
END $$;
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['project_expense_categories', 'project_expenses', 'project_expense_events', 'project_expense_cost_allocations', 'project_expense_reimbursements',
      'project_expense_reimbursement_payments', 'project_expense_billing_requests', 'project_expense_billing_allocations', 'project_expense_corrections'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.project_expense_categories, tenant.project_expenses, tenant.project_expense_cost_allocations, tenant.project_expense_reimbursements,
  tenant.project_expense_billing_requests, tenant.project_expense_billing_allocations, tenant.project_expense_corrections TO vercent_app;
GRANT SELECT, INSERT ON tenant.project_expense_events, tenant.project_expense_reimbursement_payments TO vercent_app;
GRANT SELECT ON tenant.project_expense_categories, tenant.project_expenses, tenant.project_expense_events, tenant.project_expense_cost_allocations, tenant.project_expense_reimbursements,
  tenant.project_expense_reimbursement_payments, tenant.project_expense_billing_requests, tenant.project_expense_billing_allocations, tenant.project_expense_corrections TO vercent_worker;

-- ============================================================ 9. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('projects.expenses.view_own', 'View own project expenses', 'Projects', 'See the expense claims you made or that were made for you.'),
  ('projects.expenses.create', 'Create project expenses', 'Projects', 'Record an expense against a project you work on.'),
  ('projects.expenses.edit_draft', 'Edit draft expenses', 'Projects', 'Change your draft or returned expense claims.'),
  ('projects.expenses.submit', 'Submit expenses', 'Projects', 'Send your expense claims for approval.'),
  ('projects.expenses.view_team', 'View project expenses', 'Projects', 'See the expenses of the projects you lead.'),
  ('projects.expenses.approve', 'Approve project expenses', 'Projects', 'Approve, return or reject expense claims on the projects you lead.'),
  ('projects.expenses.finance_review', 'Review expenses for Finance', 'Projects', 'Verify documents and tax, decide the cost basis, record reimbursements and link supplier bills.'),
  ('projects.expenses.correct', 'Correct approved expenses', 'Projects', 'Request and decide corrections of approved expenses.'),
  ('projects.expenses.view_cost', 'View project expense cost', 'Projects', 'See recognized project cost, commitments and the cost basis.'),
  ('projects.expenses.view_billing', 'View expense recharges', 'Projects', 'See customer recharge eligibility and recharge requests.'),
  ('projects.expenses.export', 'Export project expenses', 'Projects', 'Export expenses and the expense reports.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('employee', 'projects.expenses.view_own'), ('employee', 'projects.expenses.create'), ('employee', 'projects.expenses.edit_draft'), ('employee', 'projects.expenses.submit'),
    ('project_manager', 'projects.expenses.view_own'), ('project_manager', 'projects.expenses.create'), ('project_manager', 'projects.expenses.edit_draft'),
    ('project_manager', 'projects.expenses.submit'), ('project_manager', 'projects.expenses.view_team'), ('project_manager', 'projects.expenses.approve'),
    ('project_manager', 'projects.expenses.correct'), ('project_manager', 'projects.expenses.view_cost'), ('project_manager', 'projects.expenses.view_billing'),
    ('project_manager', 'projects.expenses.export'),
    ('finance_manager', 'projects.expenses.view_own'), ('finance_manager', 'projects.expenses.create'), ('finance_manager', 'projects.expenses.edit_draft'),
    ('finance_manager', 'projects.expenses.submit'), ('finance_manager', 'projects.expenses.view_team'), ('finance_manager', 'projects.expenses.finance_review'),
    ('finance_manager', 'projects.expenses.correct'), ('finance_manager', 'projects.expenses.view_cost'), ('finance_manager', 'projects.expenses.view_billing'),
    ('finance_manager', 'projects.expenses.export'),
    ('accountant', 'projects.expenses.view_own'), ('accountant', 'projects.expenses.view_team'), ('accountant', 'projects.expenses.finance_review'),
    ('accountant', 'projects.expenses.view_cost'), ('accountant', 'projects.expenses.view_billing'), ('accountant', 'projects.expenses.export'),
    ('sales_head', 'projects.expenses.view_billing'), ('sales_manager', 'projects.expenses.view_billing')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0138_projects_expenses.sql', 'projects-expenses') ON CONFLICT DO NOTHING;
