-- Projects — Billable / Non-Billable Time. Every minute is recorded once (tenant.project_time_entries, 0134); this adds the separate facts
-- of whether it may be charged, on what commercial authority, and how much of it has been handed to Sales and invoiced. Classification is
-- not approval, and approval is not invoicing.
--
--   1. policy          a project's time-billing policy, versioned (each change a new version; entries keep the version they were classified
--                      under): internal, non-billable, fixed price, time and materials, or hybrid (fixed price with explicitly authorized
--                      hourly lines). It supersedes tenant.projects.billing_method (0134), which is no longer read. The company default for
--                      customer projects, whether a non-billable reason is required, and whether a billing request needs a second person.
--   2. contract lines  the hourly commercial authority: one sales order line of the project's customer, linked to the project — its service
--                      item, the agreed rate and currency (a snapshot of the order line), effective dates, an optional cap, the billing
--                      rounding, and optionally the work types or people it covers. A rate change is a new line; history stays.
--   3. task rules      a task may be held non-billable, or tied to one contract line (the extra service on a hybrid project).
--   4. classification  on each time entry: NON_BILLABLE, INCLUDED_IN_FIXED_FEE, TIME_AND_MATERIALS_ELIGIBLE or ELIGIBILITY_PENDING, the
--                      non-billable reason, the policy version and contract line it was decided on, who decided it and when.
--   5. requests        a billing request groups reserved minutes of approved eligible time on one contract line: draft (reserved),
--                      submitted to Sales, invoiced (linked to the invoice line), cancelled (released) or reversed (credited). It has no
--                      ledger effect. Allocations carry the line and rate snapshot, and why they were released or reversed.
--   6. the guards      approved time changes its classification only from pending to eligible (or by a correction); allocations never
--                      exceed the entry's approved eligible minutes nor the contract line's cap, and only eligible approved time is billed.
--   7. permissions     creating and authorizing billing requests.

-- ============================================================ 1. policy
CREATE TABLE IF NOT EXISTS tenant.project_time_billing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  policy_version integer NOT NULL,
  billing_method text NOT NULL CHECK (billing_method IN ('INTERNAL', 'NON_BILLABLE', 'FIXED_PRICE', 'TIME_AND_MATERIALS', 'HYBRID')),
  default_contract_line_id uuid,
  reference text,
  note text,
  set_by uuid REFERENCES public.users(id),
  set_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (project_id, policy_version)
);
CREATE INDEX IF NOT EXISTS project_time_billing_policies_idx ON tenant.project_time_billing_policies (organization_id, project_id, policy_version DESC);

-- The policy each project had under 0134 becomes its first version (internal projects are internal).
INSERT INTO tenant.project_time_billing_policies (organization_id, project_id, policy_version, billing_method, reference, set_by, set_at)
SELECT project.organization_id, project.id, 1,
       CASE WHEN project.classification = 'INTERNAL' THEN 'INTERNAL' ELSE COALESCE(project.billing_method, 'NON_BILLABLE') END,
       project.billing_reference, project.billing_set_by, COALESCE(project.billing_set_at, project.created_at)
  FROM tenant.projects project
 WHERE NOT EXISTS (SELECT 1 FROM tenant.project_time_billing_policies policy WHERE policy.project_id = project.id);

ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS time_billing_default_method text NOT NULL DEFAULT 'NON_BILLABLE'
  CHECK (time_billing_default_method IN ('NON_BILLABLE', 'FIXED_PRICE', 'TIME_AND_MATERIALS', 'REQUIRE_SETUP'));
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS time_nonbillable_reason_required boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS time_billing_request_approval boolean NOT NULL DEFAULT true;

-- ============================================================ 2. contract lines
CREATE TABLE IF NOT EXISTS tenant.project_time_contract_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  line_number bigint GENERATED ALWAYS AS IDENTITY,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id),
  sales_order_line_id uuid NOT NULL REFERENCES tenant.sales_order_lines(id),
  service_item_id uuid,
  label text NOT NULL,
  hourly_rate numeric(20,6) NOT NULL CHECK (hourly_rate >= 0),
  currency text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  max_minutes integer CHECK (max_minutes IS NULL OR max_minutes > 0),
  rounding_minutes integer NOT NULL DEFAULT 1 CHECK (rounding_minutes IN (1, 5, 6, 10, 15, 30, 60)),
  allowed_task_types text[],
  allowed_user_ids uuid[],
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid REFERENCES public.users(id),
  closed_at timestamptz,
  close_reason text,
  row_version integer NOT NULL DEFAULT 1,
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (status <> 'CLOSED' OR closed_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_time_contract_lines_active_idx ON tenant.project_time_contract_lines (organization_id, project_id, sales_order_line_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS project_time_contract_lines_project_idx ON tenant.project_time_contract_lines (organization_id, project_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_time_billing_policies_line_fk' AND conrelid = 'tenant.project_time_billing_policies'::regclass) THEN
    ALTER TABLE tenant.project_time_billing_policies ADD CONSTRAINT project_time_billing_policies_line_fk FOREIGN KEY (default_contract_line_id) REFERENCES tenant.project_time_contract_lines(id);
  END IF;
END $$;

-- ============================================================ 3. task rules
CREATE TABLE IF NOT EXISTS tenant.project_time_task_billing (
  task_id uuid PRIMARY KEY REFERENCES tenant.project_tasks(id),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  rule text NOT NULL CHECK (rule IN ('NON_BILLABLE', 'CONTRACT_LINE')),
  contract_line_id uuid REFERENCES tenant.project_time_contract_lines(id),
  reason_code text,
  note text,
  set_by uuid REFERENCES public.users(id),
  set_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  CHECK ((rule = 'CONTRACT_LINE') = (contract_line_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS project_time_task_billing_project_idx ON tenant.project_time_task_billing (organization_id, project_id);

-- ============================================================ 4. classification
ALTER TABLE tenant.project_time_entries ADD COLUMN IF NOT EXISTS billing_classification text NOT NULL DEFAULT 'NON_BILLABLE'
  CHECK (billing_classification IN ('NON_BILLABLE', 'INCLUDED_IN_FIXED_FEE', 'TIME_AND_MATERIALS_ELIGIBLE', 'ELIGIBILITY_PENDING'));
ALTER TABLE tenant.project_time_entries ADD COLUMN IF NOT EXISTS billing_reason_code text
  CHECK (billing_reason_code IS NULL OR billing_reason_code IN ('INTERNAL_WORK', 'INCLUDED_IN_CONTRACT', 'INTERNAL_MEETING', 'TRAINING', 'REWORK_INTERNAL', 'GOODWILL_SUPPORT', 'NON_BILLABLE_CONTRACT', 'OTHER'));
ALTER TABLE tenant.project_time_entries ADD COLUMN IF NOT EXISTS billing_reason_note text;
ALTER TABLE tenant.project_time_entries ADD COLUMN IF NOT EXISTS billing_policy_version integer;
ALTER TABLE tenant.project_time_entries ADD COLUMN IF NOT EXISTS contract_line_id uuid REFERENCES tenant.project_time_contract_lines(id);
ALTER TABLE tenant.project_time_entries ADD COLUMN IF NOT EXISTS classification_updated_by uuid REFERENCES public.users(id);
ALTER TABLE tenant.project_time_entries ADD COLUMN IF NOT EXISTS classification_updated_at timestamptz;
CREATE INDEX IF NOT EXISTS project_time_entries_classification_idx ON tenant.project_time_entries (organization_id, project_id, billing_classification) WHERE entry_status <> 'VOIDED';
CREATE INDEX IF NOT EXISTS project_time_entries_line_idx ON tenant.project_time_entries (organization_id, contract_line_id) WHERE contract_line_id IS NOT NULL;

-- Time recorded under 0134 is classified by the policy it was recorded under: billable time waits for its contract line (there were none).
UPDATE tenant.project_time_entries entry
   SET billing_classification = CASE WHEN entry.billable THEN 'ELIGIBILITY_PENDING' WHEN policy.billing_method IN ('FIXED_PRICE', 'HYBRID') THEN 'INCLUDED_IN_FIXED_FEE' ELSE 'NON_BILLABLE' END,
       billing_reason_code = CASE WHEN entry.billable THEN NULL WHEN policy.billing_method IN ('FIXED_PRICE', 'HYBRID') THEN 'INCLUDED_IN_CONTRACT' WHEN policy.billing_method = 'INTERNAL' THEN 'INTERNAL_WORK' ELSE NULL END,
       billing_policy_version = policy.policy_version
  FROM tenant.project_time_billing_policies policy
 WHERE policy.project_id = entry.project_id AND policy.policy_version = 1 AND entry.billing_policy_version IS NULL;

-- ============================================================ 5. billing requests
CREATE TABLE IF NOT EXISTS tenant.project_time_billing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  request_number bigint GENERATED ALWAYS AS IDENTITY,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  customer_id uuid,
  contract_line_id uuid REFERENCES tenant.project_time_contract_lines(id),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'INVOICED', 'CANCELLED', 'REVERSED')),
  total_minutes integer NOT NULL DEFAULT 0,
  credited_minutes integer NOT NULL DEFAULT 0,
  hourly_rate numeric(20,6),
  currency text,
  estimated_amount numeric(20,6),
  invoiced_amount numeric(20,6),
  customer_invoice_id uuid REFERENCES tenant.accounting_customer_invoices(id),
  customer_invoice_line_id uuid REFERENCES tenant.accounting_customer_invoice_lines(id),
  note text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_by uuid REFERENCES public.users(id),
  submitted_at timestamptz,
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
CREATE UNIQUE INDEX IF NOT EXISTS project_time_billing_requests_key_idx ON tenant.project_time_billing_requests (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_time_billing_requests_project_idx ON tenant.project_time_billing_requests (organization_id, project_id, status);

-- The handoffs made under 0134 become requests (submitted, or invoiced where an invoice line was recorded).
INSERT INTO tenant.project_time_billing_requests (id, organization_id, project_id, customer_id, status, total_minutes, customer_invoice_id, customer_invoice_line_id, created_by, created_at,
    submitted_by, submitted_at, invoiced_at)
SELECT allocation.billing_request_id, min(allocation.organization_id::text)::uuid, min(allocation.project_id::text)::uuid, min(project.customer_id::text)::uuid,
       CASE WHEN bool_and(allocation.status = 'REVERSED') THEN 'REVERSED' WHEN bool_or(allocation.status = 'INVOICED') THEN 'INVOICED' ELSE 'SUBMITTED' END,
       COALESCE(sum(allocation.allocated_minutes), 0)::int, min(allocation.customer_invoice_id::text)::uuid, min(allocation.customer_invoice_line_id::text)::uuid,
       min(allocation.requested_by::text)::uuid, min(allocation.requested_at), min(allocation.requested_by::text)::uuid, min(allocation.requested_at), min(allocation.invoiced_at)
  FROM tenant.project_time_billing_allocations allocation JOIN tenant.projects project ON project.id = allocation.project_id
 WHERE NOT EXISTS (SELECT 1 FROM tenant.project_time_billing_requests request WHERE request.id = allocation.billing_request_id)
 GROUP BY allocation.billing_request_id
HAVING NOT bool_or(allocation.status = 'INVOICED') OR min(allocation.customer_invoice_line_id::text) IS NOT NULL;

ALTER TABLE tenant.project_time_billing_allocations ADD COLUMN IF NOT EXISTS contract_line_id uuid REFERENCES tenant.project_time_contract_lines(id);
ALTER TABLE tenant.project_time_billing_allocations ADD COLUMN IF NOT EXISTS hourly_rate numeric(20,6);
ALTER TABLE tenant.project_time_billing_allocations ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE tenant.project_time_billing_allocations ADD COLUMN IF NOT EXISTS reversal_kind text
  CHECK (reversal_kind IS NULL OR reversal_kind IN ('RELEASED', 'CREDITED', 'INVOICE_CANCELLED', 'CORRECTED', 'CARRIED'));
CREATE INDEX IF NOT EXISTS project_time_billing_allocations_line_idx ON tenant.project_time_billing_allocations (organization_id, contract_line_id) WHERE status <> 'REVERSED';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_time_billing_allocations_request_fk' AND conrelid = 'tenant.project_time_billing_allocations'::regclass) THEN
    ALTER TABLE tenant.project_time_billing_allocations ADD CONSTRAINT project_time_billing_allocations_request_fk FOREIGN KEY (billing_request_id) REFERENCES tenant.project_time_billing_requests(id) NOT VALID;
  END IF;
END $$;

-- ============================================================ 6. the guards
-- 0134's entry guard, plus: submitted and approved time keeps its classification, reason and contract line — except that approved time moves
-- between eligible and waiting for its contract line (resolved to a valid line; or set back to waiting, while none of it is billed, when its
-- line no longer applies). Any other change is a correction, which voids and replaces the entry.
CREATE OR REPLACE FUNCTION tenant.project_time_entries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.entry_status <> 'DRAFT' OR EXISTS (SELECT 1 FROM tenant.project_timesheet_submission_entries link WHERE link.entry_id = OLD.id) THEN
      RAISE EXCEPTION 'Submitted time is never deleted.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.employee_user_id <> OLD.employee_user_id OR NEW.organization_id <> OLD.organization_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Time stays with the person who worked it.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.entry_status = 'VOIDED' THEN
    RAISE EXCEPTION 'Voided time stays voided.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.entry_status IN ('SUBMITTED', 'APPROVED') AND (NEW.project_id <> OLD.project_id OR NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.work_date <> OLD.work_date
      OR NEW.duration_minutes <> OLD.duration_minutes OR NEW.billable <> OLD.billable OR NEW.description <> OLD.description
      OR NEW.start_at IS DISTINCT FROM OLD.start_at OR NEW.end_at IS DISTINCT FROM OLD.end_at) THEN
    RAISE EXCEPTION 'Submitted or approved time is changed through its review or a correction.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.entry_status IN ('SUBMITTED', 'APPROVED') AND NEW.entry_status <> 'VOIDED'
     AND (NEW.billing_classification <> OLD.billing_classification OR NEW.contract_line_id IS DISTINCT FROM OLD.contract_line_id
          OR NEW.billing_reason_code IS DISTINCT FROM OLD.billing_reason_code)
     AND NOT (NEW.entry_status = 'APPROVED' AND OLD.billing_classification IN ('TIME_AND_MATERIALS_ELIGIBLE', 'ELIGIBILITY_PENDING')
              AND NEW.billing_classification IN ('TIME_AND_MATERIALS_ELIGIBLE', 'ELIGIBILITY_PENDING') AND NEW.billing_reason_code IS NOT DISTINCT FROM OLD.billing_reason_code
              AND (NEW.billing_classification = 'TIME_AND_MATERIALS_ELIGIBLE' OR NOT EXISTS (SELECT 1 FROM tenant.project_time_billing_allocations allocation
                   WHERE allocation.entry_id = OLD.id AND allocation.status <> 'REVERSED'))) THEN
    RAISE EXCEPTION 'Submitted or approved time keeps its billing classification; request a correction.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.entry_status = 'APPROVED' AND NEW.entry_status NOT IN ('APPROVED', 'VOIDED') THEN
    RAISE EXCEPTION 'Approved time is corrected, never reopened.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.entry_status = 'APPROVED' AND OLD.cost_recorded_at IS NOT NULL AND (NEW.cost_rate IS DISTINCT FROM OLD.cost_rate OR NEW.cost_amount IS DISTINCT FROM OLD.cost_amount) THEN
    RAISE EXCEPTION 'Approved time keeps the rate it was costed at.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- A billing allocation takes only approved, eligible time on its own contract line; never more minutes than the entry's approved minutes
-- (every allocation not reversed counts), nor more than the contract line's cap. A reversed allocation stays reversed; minutes never change.
CREATE OR REPLACE FUNCTION tenant.project_time_billing_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entry record;
  line record;
  used integer;
BEGIN
  SELECT * INTO entry FROM tenant.project_time_entries WHERE id = NEW.entry_id FOR UPDATE;
  IF TG_OP = 'UPDATE' AND OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'A reversed billing allocation stays reversed.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.allocated_minutes <> OLD.allocated_minutes OR NEW.entry_id <> OLD.entry_id OR NEW.contract_line_id IS DISTINCT FROM OLD.contract_line_id) THEN
    RAISE EXCEPTION 'A billing allocation keeps its minutes and line; reverse it instead.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'REVERSED' THEN
    IF entry.entry_status <> 'APPROVED' OR entry.billing_classification <> 'TIME_AND_MATERIALS_ELIGIBLE' THEN
      RAISE EXCEPTION 'Only approved time eligible for hourly billing is billed.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.contract_line_id IS DISTINCT FROM entry.contract_line_id THEN
      RAISE EXCEPTION 'Time is billed on the contract line it was classified under.' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(sum(allocated_minutes), 0) INTO used FROM tenant.project_time_billing_allocations
     WHERE entry_id = NEW.entry_id AND status <> 'REVERSED' AND id <> NEW.id;
    IF used + NEW.allocated_minutes > entry.duration_minutes THEN
      RAISE EXCEPTION 'These minutes are already allocated to billing.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.contract_line_id IS NOT NULL THEN
      SELECT * INTO line FROM tenant.project_time_contract_lines WHERE id = NEW.contract_line_id FOR UPDATE;
      IF line.max_minutes IS NOT NULL THEN
        SELECT COALESCE(sum(allocated_minutes), 0) INTO used FROM tenant.project_time_billing_allocations
         WHERE contract_line_id = NEW.contract_line_id AND status <> 'REVERSED' AND id <> NEW.id;
        IF used + NEW.allocated_minutes > line.max_minutes THEN
          RAISE EXCEPTION 'The requested hours exceed the contract allowance.' USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_time_billing_policies_append_only' AND tgrelid = 'tenant.project_time_billing_policies'::regclass) THEN
    CREATE TRIGGER project_time_billing_policies_append_only BEFORE UPDATE OR DELETE ON tenant.project_time_billing_policies FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_time_contract_lines_no_delete' AND tgrelid = 'tenant.project_time_contract_lines'::regclass) THEN
    CREATE TRIGGER project_time_contract_lines_no_delete BEFORE DELETE ON tenant.project_time_contract_lines FOR EACH ROW EXECUTE FUNCTION tenant.projects_no_delete();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_time_billing_requests_no_delete' AND tgrelid = 'tenant.project_time_billing_requests'::regclass) THEN
    CREATE TRIGGER project_time_billing_requests_no_delete BEFORE DELETE ON tenant.project_time_billing_requests FOR EACH ROW EXECUTE FUNCTION tenant.projects_no_delete();
  END IF;
END $$;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['project_time_billing_policies', 'project_time_contract_lines', 'project_time_task_billing', 'project_time_billing_requests'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT ON tenant.project_time_billing_policies TO vercent_app;
GRANT SELECT, INSERT, UPDATE ON tenant.project_time_contract_lines, tenant.project_time_billing_requests TO vercent_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.project_time_task_billing TO vercent_app;
GRANT SELECT ON tenant.project_time_billing_policies, tenant.project_time_contract_lines, tenant.project_time_task_billing, tenant.project_time_billing_requests TO vercent_worker;

-- ============================================================ 7. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('projects.time.billing_request', 'Request time billing', 'Projects', 'Reserve approved billable time in a billing request for Sales.'),
  ('projects.time.billing_approve', 'Authorize time billing', 'Projects', 'Authorize a time billing request to Sales, confirm its invoice and reconcile credits.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('project_manager', 'projects.time.billing_request'),
    ('sales_head', 'projects.time.billing_request'), ('sales_head', 'projects.time.billing_approve'),
    ('sales_manager', 'projects.time.billing_request'), ('sales_manager', 'projects.time.billing_approve'),
    ('finance_manager', 'projects.time.billing_approve')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0135_projects_billable_time.sql', 'projects-billable-time') ON CONFLICT DO NOTHING;
