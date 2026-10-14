-- Manufacturing: Production Costing. On the company's issue-based work-in-progress model (material issued to an order is work in progress at
-- its Inventory issue cost; returns, scrap, finished-goods receipts and completion take it out), this adds: labor and manufacturing overhead
-- applied to work in progress at configured rates (per accepted unit, per real production batch, or a percent of consumed material cost) —
-- each application posted once to work in progress against its applied (absorption) account; finished-goods receipts capitalising that
-- applied cost alongside the material, spread over the accepted units not yet received; the planned-cost baseline frozen at release (later
-- estimates are new versions); controlled, approved cost adjustments; the order's costing finalized once its work in progress is zero and
-- reconciled with Finance; and an append-only cost history. Inventory keeps its valuation method; Finance keeps the ledger. Additive only.

-- ============================================================ 1. labor and overhead rates
CREATE TABLE IF NOT EXISTS tenant.manufacturing_cost_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  component text NOT NULL CHECK (component IN ('LABOR', 'OVERHEAD')),
  basis text NOT NULL CHECK (basis IN ('PER_GOOD_UNIT', 'PER_BATCH', 'PCT_OF_MATERIAL')),
  rate numeric(20, 6) NOT NULL CHECK (rate >= 0),
  -- A product's own rate comes before the company-wide one.
  finished_item_id uuid REFERENCES tenant.items(id),
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  notes text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retired_at timestamptz,
  CHECK (basis <> 'PCT_OF_MATERIAL' OR rate <= 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_cost_rates_active_uidx ON tenant.manufacturing_cost_rates (organization_id, component, COALESCE(finished_item_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'ACTIVE';

ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS mc_labor_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS mc_overhead_enabled boolean NOT NULL DEFAULT false;

-- ============================================================ 2. the order's cost figures
-- Applied labor and overhead (in work in progress), the part of it finished goods capitalised, net cost adjustments to variance, and the
-- costing's own state (never the order's lifecycle).
ALTER TABLE tenant.manufacturing_orders ADD COLUMN IF NOT EXISTS wip_applied_labor_cost numeric(20, 2) NOT NULL DEFAULT 0;
ALTER TABLE tenant.manufacturing_orders ADD COLUMN IF NOT EXISTS wip_applied_overhead_cost numeric(20, 2) NOT NULL DEFAULT 0;
ALTER TABLE tenant.manufacturing_orders ADD COLUMN IF NOT EXISTS wip_conversion_capitalised_cost numeric(20, 2) NOT NULL DEFAULT 0;
ALTER TABLE tenant.manufacturing_orders ADD COLUMN IF NOT EXISTS wip_adjusted_cost numeric(20, 2) NOT NULL DEFAULT 0;
ALTER TABLE tenant.manufacturing_orders ADD COLUMN IF NOT EXISTS cost_finalized_at timestamptz;
ALTER TABLE tenant.manufacturing_orders ADD COLUMN IF NOT EXISTS cost_finalized_by uuid REFERENCES public.users(id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_orders_applied_cost_check') THEN
    ALTER TABLE tenant.manufacturing_orders ADD CONSTRAINT manufacturing_orders_applied_cost_check
      CHECK (wip_applied_labor_cost >= 0 AND wip_applied_overhead_cost >= 0 AND wip_conversion_capitalised_cost >= 0
             AND wip_conversion_capitalised_cost <= wip_applied_labor_cost + wip_applied_overhead_cost + 0.01);
  END IF;
END $$;

-- ============================================================ 3. applications (append-only)
CREATE TABLE IF NOT EXISTS tenant.manufacturing_cost_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  component text NOT NULL CHECK (component IN ('LABOR', 'OVERHEAD')),
  basis text NOT NULL CHECK (basis IN ('PER_GOOD_UNIT', 'PER_BATCH', 'PCT_OF_MATERIAL')),
  rate_id uuid NOT NULL REFERENCES tenant.manufacturing_cost_rates(id),
  rate_version integer NOT NULL,
  rate numeric(20, 6) NOT NULL,
  -- What it was applied for: accepted units, one production batch, or a slice of consumed material cost.
  production_batch_id uuid REFERENCES tenant.manufacturing_production_batches(id),
  basis_quantity numeric(20, 6) NOT NULL CHECK (basis_quantity > 0),
  amount numeric(20, 2) NOT NULL CHECK (amount >= 0),
  posting_key text NOT NULL,
  journal_entry_id uuid,
  finance_status text NOT NULL DEFAULT 'POSTED' CHECK (finance_status IN ('POSTED', 'NOT_REQUIRED')),
  applied_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_cost_applications_key_uidx ON tenant.manufacturing_cost_applications (organization_id, posting_key);
-- A batch's fixed cost is applied once per real batch, however many entries it reported.
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_cost_applications_batch_uidx ON tenant.manufacturing_cost_applications (organization_id, manufacturing_order_id, component, production_batch_id)
  WHERE production_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS manufacturing_cost_applications_order_idx ON tenant.manufacturing_cost_applications (organization_id, manufacturing_order_id, created_at);

-- ============================================================ 4. estimates (append-only; version 1 is the release baseline)
CREATE TABLE IF NOT EXISTS tenant.manufacturing_cost_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  version integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('RELEASE_BASELINE', 'REESTIMATE')),
  bom_revision_id uuid,
  bom_snapshot_id uuid,
  planned_output_quantity numeric(20, 6) NOT NULL,
  planned_batches integer,
  material_cost numeric(20, 2),
  labor_cost numeric(20, 2),
  overhead_cost numeric(20, 2),
  total_cost numeric(20, 2),
  unit_cost numeric(20, 6),
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy jsonb NOT NULL,
  policy_hash text NOT NULL,
  currency_code text NOT NULL DEFAULT 'INR',
  complete boolean NOT NULL DEFAULT true,
  missing jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (manufacturing_order_id, version)
);

-- ============================================================ 5. adjustments
-- A controlled correction of the order's work in progress against manufacturing variance, requested and approved by someone else, posted
-- once; the original postings stay as they were.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_cost_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  adjustment_number text NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  direction text NOT NULL CHECK (direction IN ('WIP_TO_VARIANCE', 'VARIANCE_TO_WIP')),
  amount numeric(20, 2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  evidence text,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED')),
  requested_by uuid REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  requested_version integer NOT NULL,
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_note text,
  journal_entry_id uuid,
  posting_key text,
  idempotency_key text,
  CHECK (status = 'REQUESTED' OR decided_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_cost_adjustments_number_uidx ON tenant.manufacturing_cost_adjustments (organization_id, adjustment_number);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_cost_adjustments_key_uidx ON tenant.manufacturing_cost_adjustments (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_cost_adjustments_posting_uidx ON tenant.manufacturing_cost_adjustments (organization_id, posting_key) WHERE posting_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.manufacturing_cost_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  action text NOT NULL,
  amount numeric(20, 2),
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_cost_events_idx ON tenant.manufacturing_cost_events (organization_id, manufacturing_order_id, occurred_at);

-- ============================================================ 6. guards
CREATE OR REPLACE FUNCTION tenant.manufacturing_cost_adjustment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A cost adjustment is never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'REQUESTED' OR NEW.amount <> OLD.amount OR NEW.direction <> OLD.direction OR NEW.manufacturing_order_id <> OLD.manufacturing_order_id THEN
    RAISE EXCEPTION 'A decided cost adjustment does not change.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION tenant.manufacturing_cost_rate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A cost rate is never deleted; retire it.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.rate <> OLD.rate OR NEW.basis <> OLD.basis OR NEW.component <> OLD.component OR NEW.version <> OLD.version OR NEW.finished_item_id IS DISTINCT FROM OLD.finished_item_id
     OR (OLD.status = 'INACTIVE' AND NEW.status <> 'INACTIVE') THEN
    RAISE EXCEPTION 'A cost rate does not change; set a new rate.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE
  name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_cost_adjustments_guard') THEN
    CREATE TRIGGER manufacturing_cost_adjustments_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_cost_adjustments FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_cost_adjustment_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_cost_rates_guard') THEN
    CREATE TRIGGER manufacturing_cost_rates_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_cost_rates FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_cost_rate_guard();
  END IF;
  FOREACH name IN ARRAY ARRAY['manufacturing_cost_applications', 'manufacturing_cost_estimates', 'manufacturing_cost_events'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = name || '_append_only' AND tgrelid = ('tenant.' || name)::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_append_only()', name || '_append_only', name);
    END IF;
  END LOOP;
END $$;

-- The order guard of 0112, letting a completed or cancelled order record only its costing finalization.
CREATE OR REPLACE FUNCTION tenant.manufacturing_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A manufacturing order is cancelled, never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('COMPLETED', 'CANCELLED') THEN
    -- The one thing that may still happen to a completed or cancelled order: its costing is finalized (once).
    IF OLD.cost_finalized_at IS NULL AND NEW.cost_finalized_at IS NOT NULL
       AND (to_jsonb(NEW) - 'cost_finalized_at' - 'cost_finalized_by' - 'updated_at') = (to_jsonb(OLD) - 'cost_finalized_at' - 'cost_finalized_by' - 'updated_at') THEN
      NEW.updated_at := now();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'A % manufacturing order does not change.', lower(OLD.status) USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.mo_number <> OLD.mo_number OR NEW.organization_id <> OLD.organization_id OR NEW.finished_item_id <> OLD.finished_item_id THEN
    RAISE EXCEPTION 'A manufacturing order keeps its number and product.' USING ERRCODE = 'check_violation';
  END IF;
  -- The plan is fixed once released: quantity, recipe and warehouses change only while a draft.
  IF OLD.status NOT IN ('DRAFT', 'AWAITING_APPROVAL') AND (NEW.planned_quantity <> OLD.planned_quantity OR NEW.output_uom_id <> OLD.output_uom_id
      OR NEW.bom_revision_id IS DISTINCT FROM OLD.bom_revision_id OR NEW.bom_snapshot_id IS DISTINCT FROM OLD.bom_snapshot_id
      OR NEW.material_warehouse_id <> OLD.material_warehouse_id OR NEW.finished_goods_warehouse_id <> OLD.finished_goods_warehouse_id) THEN
    RAISE EXCEPTION 'A released manufacturing order keeps its plan; amend it through material variances.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status IN ('AWAITING_APPROVAL', 'CANCELLED'))
    OR (OLD.status = 'AWAITING_APPROVAL' AND NEW.status IN ('DRAFT', 'RELEASED', 'CANCELLED'))
    OR (OLD.status = 'RELEASED' AND NEW.status IN ('IN_PROGRESS', 'ON_HOLD', 'CANCELLED', 'RECOVERY_REQUIRED'))
    OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('ON_HOLD', 'COMPLETION_PENDING', 'COMPLETED', 'CANCELLED', 'RECOVERY_REQUIRED'))
    OR (OLD.status = 'ON_HOLD' AND NEW.status IN ('RELEASED', 'IN_PROGRESS', 'CANCELLED'))
    OR (OLD.status = 'COMPLETION_PENDING' AND NEW.status IN ('COMPLETED', 'IN_PROGRESS', 'RECOVERY_REQUIRED'))
    OR (OLD.status = 'RECOVERY_REQUIRED' AND NEW.status IN ('RELEASED', 'IN_PROGRESS', 'ON_HOLD'))) THEN
    RAISE EXCEPTION 'A manufacturing order cannot move from % to %.', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ============================================================ 7. Finance: the applied (absorption) accounts
-- Labor and overhead applied to work in progress are credited here; the actual payroll and factory expenses are booked where they always are,
-- and the two together show what was under- or over-absorbed.
DO $$
DECLARE
  ledger record;
  seed record;
  parent_id uuid;
  account_id uuid;
BEGIN
  FOR ledger IN SELECT accounting_ledger.id, accounting_ledger.organization_id FROM tenant.accounting_ledgers accounting_ledger WHERE accounting_ledger.status = 'active' LOOP
    FOR seed IN SELECT * FROM (VALUES
        ('5110', 'Manufacturing labor applied', 'expense', 'cogs', 'credit', NULL, 'manufacturing_labor_applied'),
        ('5120', 'Manufacturing overhead applied', 'expense', 'cogs', 'credit', NULL, 'manufacturing_overhead_applied')
      ) AS rows(code, name, account_class, account_type, normal_balance, parent_code, mapping_key) LOOP
      SELECT id INTO parent_id FROM tenant.accounting_accounts WHERE organization_id = ledger.organization_id AND ledger_id = ledger.id AND code = seed.parent_code AND is_group;
      INSERT INTO tenant.accounting_accounts (organization_id, ledger_id, parent_id, code, name, account_class, account_type, normal_balance, is_group,
                                              allow_manual_posting, reconciliation_required, status)
      VALUES (ledger.organization_id, ledger.id, parent_id, seed.code, seed.name, seed.account_class, seed.account_type, seed.normal_balance, false, false, false, 'active')
      ON CONFLICT (organization_id, ledger_id, code) DO NOTHING;
      SELECT id INTO account_id FROM tenant.accounting_accounts
       WHERE organization_id = ledger.organization_id AND ledger_id = ledger.id AND code = seed.code AND account_class = seed.account_class AND NOT is_group AND status = 'active';
      IF account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant.accounting_account_mappings
          WHERE organization_id = ledger.organization_id AND ledger_id = ledger.id AND mapping_key = seed.mapping_key) THEN
        INSERT INTO tenant.accounting_account_mappings (organization_id, ledger_id, mapping_key, account_id, priority, status)
        VALUES (ledger.organization_id, ledger.id, seed.mapping_key, account_id, 1000, 'active');
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ============================================================ 8. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['manufacturing_cost_rates', 'manufacturing_cost_applications', 'manufacturing_cost_estimates', 'manufacturing_cost_adjustments', 'manufacturing_cost_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.manufacturing_cost_rates, tenant.manufacturing_cost_adjustments TO vercent_app;
GRANT SELECT, INSERT ON tenant.manufacturing_cost_applications, tenant.manufacturing_cost_estimates, tenant.manufacturing_cost_events TO vercent_app;
GRANT SELECT ON tenant.manufacturing_cost_rates, tenant.manufacturing_cost_applications, tenant.manufacturing_cost_estimates, tenant.manufacturing_cost_adjustments, tenant.manufacturing_cost_events TO vercent_worker;

-- ============================================================ 9. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('manufacturing.cost.view', 'View production costing', 'Manufacturing', 'See an order''s planned and actual production cost, work in progress and finished-goods value.'),
  ('manufacturing.cost.view_detail', 'View detailed cost rates', 'Manufacturing', 'See component valuation rates and the labor and overhead rates applied.'),
  ('manufacturing.cost.estimate', 'Estimate production cost', 'Manufacturing', 'Re-estimate an order''s planned cost (a new version; the release baseline stays).'),
  ('manufacturing.cost.rate_manage', 'Manage labor and overhead rates', 'Manufacturing', 'Set the rates labor and overhead are applied at.'),
  ('manufacturing.cost.apply', 'Apply labor and overhead', 'Manufacturing', 'Apply configured labor and overhead to an order''s work in progress.'),
  ('manufacturing.cost.reconcile', 'Reconcile production cost', 'Manufacturing', 'Review work in progress and receipt accounting against Finance.'),
  ('manufacturing.cost.adjust_request', 'Request cost adjustments', 'Manufacturing', 'Request a correction of an order''s work in progress.'),
  ('manufacturing.cost.adjust_approve', 'Approve cost adjustments', 'Manufacturing', 'Approve a requested cost adjustment (posted once).'),
  ('manufacturing.cost.finalize', 'Finalize production costing', 'Manufacturing', 'Close an order''s costing once its work in progress is zero and reconciled.'),
  ('manufacturing.cost.export', 'Export production costing', 'Manufacturing', 'Export production costing reports.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('manufacturing_manager', 'manufacturing.cost.view'), ('manufacturing_manager', 'manufacturing.cost.view_detail'), ('manufacturing_manager', 'manufacturing.cost.estimate'),
    ('manufacturing_manager', 'manufacturing.cost.apply'), ('manufacturing_manager', 'manufacturing.cost.reconcile'), ('manufacturing_manager', 'manufacturing.cost.adjust_request'),
    ('manufacturing_manager', 'manufacturing.cost.finalize'), ('manufacturing_manager', 'manufacturing.cost.export'),
    ('accountant', 'manufacturing.cost.view'), ('accountant', 'manufacturing.cost.view_detail'), ('accountant', 'manufacturing.cost.estimate'), ('accountant', 'manufacturing.cost.rate_manage'),
    ('accountant', 'manufacturing.cost.apply'), ('accountant', 'manufacturing.cost.reconcile'), ('accountant', 'manufacturing.cost.adjust_request'), ('accountant', 'manufacturing.cost.adjust_approve'),
    ('accountant', 'manufacturing.cost.finalize'), ('accountant', 'manufacturing.cost.export'),
    ('finance_manager', 'manufacturing.cost.view'), ('finance_manager', 'manufacturing.cost.view_detail'), ('finance_manager', 'manufacturing.cost.estimate'), ('finance_manager', 'manufacturing.cost.rate_manage'),
    ('finance_manager', 'manufacturing.cost.apply'), ('finance_manager', 'manufacturing.cost.reconcile'), ('finance_manager', 'manufacturing.cost.adjust_request'),
    ('finance_manager', 'manufacturing.cost.adjust_approve'), ('finance_manager', 'manufacturing.cost.finalize'), ('finance_manager', 'manufacturing.cost.export'),
    ('production_planner', 'manufacturing.cost.view'), ('production_planner', 'manufacturing.cost.estimate'), ('inventory_manager', 'manufacturing.cost.view')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0123_manufacturing_production_costing.sql', 'manufacturing-production-costing') ON CONFLICT DO NOTHING;
