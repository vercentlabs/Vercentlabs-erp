-- Projects — Project Revenue. A reconciled reading of what a project is contracted for, invoiced, recognized and collected, taken from the
-- records that already own each figure: confirmed Sales Orders and their versions (contract), Sales invoices and credit notes and their
-- lines (invoiced), Finance's posted revenue journal lines, deferred-revenue schedules and project-tagged journals (recognized), and
-- Finance's receipt and credit allocations (collected). Nothing here creates an order, an invoice, a revenue posting or a receipt
-- allocation. This adds only what those sources do not hold:
--
--   1. contract allocations  how much of one Sales Order line belongs to a project, when one line serves several projects — keyed by the
--                            order and the line's position so an amendment keeps it; superseded or cancelled, never edited; the total
--                            for a line can never exceed the line's authorized value.
--   2. invoice allocations   how much of one issued invoice line belongs to a project, when the line cannot be attributed by its order
--                            line alone; reversed, never edited; never more than the line's tax-exclusive value across projects.
--   3. forecasts             an optional, versioned manual forecast of further revenue, labelled as a forecast, with its assumptions.
--   4. permissions           view summary, contracts, invoices, recognition, collections, profitability; manage links; edit the
--                            forecast; reconcile; export.

-- ============================================================ 1. contract allocations
CREATE TABLE IF NOT EXISTS tenant.project_revenue_contract_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  allocation_number bigint GENERATED ALWAYS AS IDENTITY,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  customer_id uuid NOT NULL,
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id),
  -- The order line as it was when allocated; the allocation follows the line's position (sequence) across amendments.
  sales_order_line_id uuid NOT NULL,
  line_sequence integer NOT NULL,
  contract_version integer NOT NULL CHECK (contract_version > 0),
  allocated_amount numeric(18,2) NOT NULL CHECK (allocated_amount > 0),
  allocated_quantity numeric(18,4) CHECK (allocated_quantity IS NULL OR allocated_quantity > 0),
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'CANCELLED')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  superseded_by uuid REFERENCES tenant.project_revenue_contract_allocations(id),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_by uuid REFERENCES public.users(id),
  ended_at timestamptz,
  end_reason text,
  idempotency_key text,
  CONSTRAINT project_revenue_contract_allocations_end_check CHECK ((status = 'ACTIVE') = (ended_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS project_revenue_contract_allocations_live_idx ON tenant.project_revenue_contract_allocations (project_id, sales_order_id, line_sequence) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS project_revenue_contract_allocations_line_idx ON tenant.project_revenue_contract_allocations (sales_order_id, line_sequence) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS project_revenue_contract_allocations_key_idx ON tenant.project_revenue_contract_allocations (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================ 2. invoice allocations
CREATE TABLE IF NOT EXISTS tenant.project_revenue_invoice_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  allocation_number bigint GENERATED ALWAYS AS IDENTITY,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  customer_invoice_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id),
  -- No foreign key: Sales rewrites a draft's lines when it posts; an allocation is made on an issued invoice's line and checked on read.
  customer_invoice_line_id uuid NOT NULL,
  contract_allocation_id uuid REFERENCES tenant.project_revenue_contract_allocations(id),
  allocated_net_amount numeric(18,2) NOT NULL CHECK (allocated_net_amount > 0),
  currency char(3) NOT NULL,
  -- The invoice's content hash when allocated: a later change to the invoice is detectable.
  source_version text,
  status text NOT NULL DEFAULT 'CURRENT' CHECK (status IN ('CURRENT', 'REVERSED')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  command_id text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reversed_by uuid REFERENCES public.users(id),
  reversed_at timestamptz,
  reversal_reason text,
  CONSTRAINT project_revenue_invoice_allocations_reversal_check CHECK ((status = 'REVERSED') = (reversed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS project_revenue_invoice_allocations_live_idx ON tenant.project_revenue_invoice_allocations (project_id, customer_invoice_line_id) WHERE status = 'CURRENT';
CREATE INDEX IF NOT EXISTS project_revenue_invoice_allocations_line_idx ON tenant.project_revenue_invoice_allocations (customer_invoice_line_id) WHERE status = 'CURRENT';
CREATE UNIQUE INDEX IF NOT EXISTS project_revenue_invoice_allocations_key_idx ON tenant.project_revenue_invoice_allocations (organization_id, command_id) WHERE command_id IS NOT NULL;

CREATE OR REPLACE FUNCTION tenant.project_revenue_allocations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A revenue allocation is ended or reversed, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF TG_TABLE_NAME = 'project_revenue_contract_allocations' THEN
    IF NEW.allocated_amount <> OLD.allocated_amount OR NEW.project_id <> OLD.project_id OR NEW.sales_order_id <> OLD.sales_order_id OR NEW.line_sequence <> OLD.line_sequence
       OR NEW.allocated_quantity IS DISTINCT FROM OLD.allocated_quantity THEN
      RAISE EXCEPTION 'A contract allocation keeps its amount; supersede it with a new one.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'ACTIVE' AND NEW.status <> OLD.status THEN RAISE EXCEPTION 'An ended contract allocation stays ended.' USING ERRCODE = 'check_violation'; END IF;
  ELSE
    IF NEW.allocated_net_amount <> OLD.allocated_net_amount OR NEW.project_id <> OLD.project_id OR NEW.customer_invoice_line_id <> OLD.customer_invoice_line_id THEN
      RAISE EXCEPTION 'An invoice allocation keeps its amount; reverse it and allocate again.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'REVERSED' AND NEW.status <> 'REVERSED' THEN RAISE EXCEPTION 'A reversed invoice allocation stays reversed.' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_revenue_contract_allocations_guard') THEN
    CREATE TRIGGER project_revenue_contract_allocations_guard BEFORE UPDATE OR DELETE ON tenant.project_revenue_contract_allocations FOR EACH ROW EXECUTE FUNCTION tenant.project_revenue_allocations_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_revenue_invoice_allocations_guard') THEN
    CREATE TRIGGER project_revenue_invoice_allocations_guard BEFORE UPDATE OR DELETE ON tenant.project_revenue_invoice_allocations FOR EACH ROW EXECUTE FUNCTION tenant.project_revenue_allocations_guard();
  END IF;
END $$;

-- ============================================================ 3. forecasts
CREATE TABLE IF NOT EXISTS tenant.project_revenue_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  version integer NOT NULL CHECK (version > 0),
  expected_further_revenue numeric(18,2) NOT NULL CHECK (expected_further_revenue >= 0),
  currency char(3) NOT NULL,
  as_of_date date NOT NULL,
  assumptions text NOT NULL CHECK (length(btrim(assumptions)) >= 3),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text,
  UNIQUE (project_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_revenue_forecasts_key_idx ON tenant.project_revenue_forecasts (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_revenue_forecasts_append_only') THEN
    CREATE TRIGGER project_revenue_forecasts_append_only BEFORE UPDATE OR DELETE ON tenant.project_revenue_forecasts FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only();
  END IF;
END $$;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['project_revenue_contract_allocations', 'project_revenue_invoice_allocations', 'project_revenue_forecasts'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.project_revenue_contract_allocations, tenant.project_revenue_invoice_allocations TO vercent_app;
GRANT SELECT, INSERT ON tenant.project_revenue_forecasts TO vercent_app;
GRANT SELECT ON tenant.project_revenue_contract_allocations, tenant.project_revenue_invoice_allocations, tenant.project_revenue_forecasts TO vercent_worker;

-- ============================================================ 4. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('projects.revenue.view_summary', 'View project revenue totals', 'Projects', 'See a project''s contract value, net invoiced, unbilled and forecast figures.'),
  ('projects.revenue.view_contracts', 'View project contracts', 'Projects', 'See the Sales Order lines, prices and amendments behind a project''s contract value.'),
  ('projects.revenue.view_invoices', 'View project invoices', 'Projects', 'See the invoice and credit note lines attributed to a project.'),
  ('projects.revenue.view_recognition', 'View recognized revenue', 'Projects', 'See the revenue Finance recognized for a project, with its journal references.'),
  ('projects.revenue.view_collections', 'View project collections', 'Projects', 'See customer settlements, outstanding and overdue balances and advances for a project.'),
  ('projects.revenue.view_profitability', 'View project revenue against cost', 'Projects', 'Compare recognized revenue with project cost.'),
  ('projects.revenue.manage_links', 'Manage project revenue allocations', 'Projects', 'Allocate Sales Order lines and invoice lines to projects.'),
  ('projects.revenue.forecast_edit', 'Maintain the revenue forecast', 'Projects', 'Record an explicitly labelled forecast of a project''s further revenue.'),
  ('projects.revenue.reconcile', 'Reconcile project revenue', 'Projects', 'Review revenue reconciliation and its exceptions across projects.'),
  ('projects.revenue.export', 'Export project revenue', 'Projects', 'Export project revenue figures and reports.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('project_manager', 'projects.revenue.view_summary'), ('project_manager', 'projects.revenue.view_contracts'), ('project_manager', 'projects.revenue.view_invoices'),
    ('project_manager', 'projects.revenue.view_profitability'), ('project_manager', 'projects.revenue.forecast_edit'), ('project_manager', 'projects.revenue.export'),
    ('sales_head', 'projects.revenue.view_summary'), ('sales_head', 'projects.revenue.view_contracts'), ('sales_head', 'projects.revenue.view_invoices'),
    ('sales_head', 'projects.revenue.view_collections'), ('sales_head', 'projects.revenue.manage_links'), ('sales_head', 'projects.revenue.export'),
    ('finance_manager', 'projects.revenue.view_summary'), ('finance_manager', 'projects.revenue.view_contracts'), ('finance_manager', 'projects.revenue.view_invoices'),
    ('finance_manager', 'projects.revenue.view_recognition'), ('finance_manager', 'projects.revenue.view_collections'), ('finance_manager', 'projects.revenue.view_profitability'),
    ('finance_manager', 'projects.revenue.manage_links'), ('finance_manager', 'projects.revenue.reconcile'), ('finance_manager', 'projects.revenue.export'),
    ('accountant', 'projects.revenue.view_summary'), ('accountant', 'projects.revenue.view_contracts'), ('accountant', 'projects.revenue.view_invoices'),
    ('accountant', 'projects.revenue.view_recognition'), ('accountant', 'projects.revenue.view_collections'), ('accountant', 'projects.revenue.view_profitability'),
    ('accountant', 'projects.revenue.manage_links'), ('accountant', 'projects.revenue.reconcile'), ('accountant', 'projects.revenue.export')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0141_projects_revenue.sql', 'projects-revenue') ON CONFLICT DO NOTHING;
