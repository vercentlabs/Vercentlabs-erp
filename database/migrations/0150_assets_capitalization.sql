-- Assets — Purchase and Capitalization. Procurement owns the purchase, the Asset Register owns each asset's identity, Finance owns
-- capitalization and the ledger. A purchase line registers individual assets (0143's acquisition allocations); its eligible costs —
-- purchase price, shared freight, installation and testing, nonrecoverable tax, discounts — are allocated to them without ever
-- exceeding the source line; a capitalization request is prepared, reviewed and approved by Finance (never its requester), then posted
-- once as a reclassification from the bill line's account to the category's fixed-asset account (the supplier liability is never
-- created again). Assets not yet ready for use accumulate in capital work in progress and are transferred when commissioned. Later
-- credits, extra costs and corrections are controlled adjustments. Additive:
--
--   1. cwip           capital work in progress: accumulated cost waiting for the assets it becomes.
--   2. components     each eligible cost allocated to an asset (or a CWIP project), linked to its exact source line; guarded so a
--                     source amount is never allocated twice and posted components never change.
--   3. requests       capitalization requests with their review, approval, posting and reversal; one live request per asset.
--   4. adjustments    post-capitalization credit notes, additional costs and corrections.
--   5. events         an append-only history of every acquisition and capitalization decision.
--   6. finance policy the category's CWIP account.
--   7. permissions    acquisition view / register / bulk / allocate / view cost, capitalization request / review / approve / post /
--                     adjust, CWIP, reconcile, export, audit.

-- ============================================================ 1. capital work in progress
CREATE TABLE IF NOT EXISTS tenant.asset_cwip_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  cwip_number bigint GENERATED ALWAYS AS IDENTITY,
  name text NOT NULL CHECK (length(btrim(name)) >= 2),
  description text,
  category_id uuid REFERENCES tenant.asset_categories(id),
  cwip_account_id uuid,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'READY', 'TRANSFERRED', 'CANCELLED')),
  ready_at date,
  ready_evidence text,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT asset_cwip_ready_check CHECK (status NOT IN ('READY', 'TRANSFERRED') OR ready_at IS NOT NULL)
);
CREATE OR REPLACE FUNCTION tenant.asset_cwip_projects_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A CWIP project is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status IN ('TRANSFERRED', 'CANCELLED') THEN RAISE EXCEPTION 'A transferred or cancelled CWIP project stays as it is.' USING ERRCODE = 'check_violation'; END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_cwip_projects_guard') THEN
    CREATE TRIGGER asset_cwip_projects_guard BEFORE UPDATE OR DELETE ON tenant.asset_cwip_projects FOR EACH ROW EXECUTE FUNCTION tenant.asset_cwip_projects_guard();
  END IF;
END $$;

-- ============================================================ 2. cost components
CREATE TABLE IF NOT EXISTS tenant.asset_cost_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  component_number bigint GENERATED ALWAYS AS IDENTITY,
  asset_id uuid REFERENCES tenant.assets(id),
  cwip_id uuid REFERENCES tenant.asset_cwip_projects(id),
  component text NOT NULL CHECK (component IN ('PURCHASE_PRICE', 'FREIGHT', 'INSTALLATION', 'TESTING', 'OTHER_DIRECT', 'DISCOUNT', 'NONRECOVERABLE_TAX', 'CWIP_TRANSFER', 'CREDIT_NOTE', 'ADDITIONAL_COST', 'CORRECTION')),
  source_type text NOT NULL CHECK (source_type IN ('SUPPLIER_INVOICE_LINE', 'SUPPLIER_INVOICE_TAX', 'CWIP', 'MANUAL')),
  source_document_id uuid,
  source_line_id uuid,
  source_cwip_id uuid REFERENCES tenant.asset_cwip_projects(id),
  method text NOT NULL DEFAULT 'MANUAL' CHECK (method IN ('EQUAL', 'PROPORTIONAL', 'MANUAL', 'FULL')),
  group_id uuid,
  amount numeric(18,2) NOT NULL CHECK (amount <> 0),
  currency char(3) NOT NULL,
  exchange_rate numeric(24,10) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  reporting_amount numeric(18,2) NOT NULL,
  offset_account_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVERSED')),
  capitalization_id uuid,
  reason text,
  command_id text,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reversed_by uuid REFERENCES public.users(id),
  reversed_at timestamptz,
  reversal_reason text,
  CONSTRAINT asset_cost_components_target_check CHECK ((asset_id IS NULL) <> (cwip_id IS NULL)),
  CONSTRAINT asset_cost_components_source_check CHECK (source_type IN ('MANUAL') OR source_line_id IS NOT NULL OR source_cwip_id IS NOT NULL),
  CONSTRAINT asset_cost_components_manual_check CHECK (source_type <> 'MANUAL' OR length(btrim(COALESCE(reason, ''))) >= 3),
  CONSTRAINT asset_cost_components_reversal_check CHECK ((status = 'REVERSED') = (reversed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_cost_components_command_idx ON tenant.asset_cost_components (organization_id, command_id) WHERE command_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS asset_cost_components_asset_idx ON tenant.asset_cost_components (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS asset_cost_components_cwip_idx ON tenant.asset_cost_components (cwip_id) WHERE cwip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS asset_cost_components_line_idx ON tenant.asset_cost_components (organization_id, source_line_id) WHERE source_line_id IS NOT NULL;
-- A source amount is allocated at most once: a supplier line's net (with the purchase price already claimed by registered units), its
-- tax, or a CWIP project's accumulated cost. A posted component never changes; an unposted one is only reversed.
CREATE OR REPLACE FUNCTION tenant.asset_cost_components_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  available numeric;
  used numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A cost allocation is reversed, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.reporting_amount IS DISTINCT FROM OLD.reporting_amount OR NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.cwip_id IS DISTINCT FROM OLD.cwip_id
       OR NEW.source_line_id IS DISTINCT FROM OLD.source_line_id OR NEW.component IS DISTINCT FROM OLD.component THEN
      RAISE EXCEPTION 'A cost allocation is reversed and made again, never edited.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'REVERSED' THEN RAISE EXCEPTION 'A reversed cost allocation stays reversed.' USING ERRCODE = 'check_violation'; END IF;
    IF NEW.status = 'REVERSED' AND OLD.capitalization_id IS NOT NULL AND NULLIF(current_setting('vercent.capitalization_reversal', true), '') IS NULL THEN
      RAISE EXCEPTION 'A capitalized cost is corrected through a Finance adjustment.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.source_type = 'SUPPLIER_INVOICE_LINE' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.source_line_id::text, 0));
    SELECT abs(net_amount) INTO available FROM tenant.accounting_vendor_bill_lines WHERE organization_id = NEW.organization_id AND id = NEW.source_line_id;
    IF available IS NULL THEN RAISE EXCEPTION 'ASSET_ACQUISITION_SOURCE_INVALID: the source line is not in this Company.' USING ERRCODE = 'check_violation'; END IF;
    SELECT COALESCE(sum(abs(amount)), 0) INTO used FROM tenant.asset_cost_components WHERE source_line_id = NEW.source_line_id AND source_type = 'SUPPLIER_INVOICE_LINE' AND status = 'ACTIVE';
    used := used + COALESCE((SELECT sum(allocated_cost) FROM tenant.asset_acquisition_allocations WHERE source_line_id = NEW.source_line_id AND status = 'ACTIVE'), 0);
    IF used + abs(NEW.amount) > available + 0.005 THEN
      RAISE EXCEPTION 'ASSET_ACQUISITION_ALREADY_ALLOCATED: % of the line''s % is already allocated.', used, available USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.source_type = 'SUPPLIER_INVOICE_TAX' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.source_line_id::text, 1));
    SELECT abs(tax_amount) INTO available FROM tenant.accounting_vendor_bill_lines WHERE organization_id = NEW.organization_id AND id = NEW.source_line_id;
    IF available IS NULL THEN RAISE EXCEPTION 'ASSET_ACQUISITION_SOURCE_INVALID: the source line is not in this Company.' USING ERRCODE = 'check_violation'; END IF;
    SELECT COALESCE(sum(abs(amount)), 0) INTO used FROM tenant.asset_cost_components WHERE source_line_id = NEW.source_line_id AND source_type = 'SUPPLIER_INVOICE_TAX' AND status = 'ACTIVE';
    IF used + abs(NEW.amount) > available + 0.005 THEN
      RAISE EXCEPTION 'ASSET_ACQUISITION_ALREADY_ALLOCATED: % of the line''s tax % is already allocated.', used, available USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.source_type = 'CWIP' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.source_cwip_id::text, 2));
    SELECT COALESCE(sum(reporting_amount), 0) INTO available FROM tenant.asset_cost_components WHERE cwip_id = NEW.source_cwip_id AND status = 'ACTIVE';
    SELECT COALESCE(sum(reporting_amount), 0) INTO used FROM tenant.asset_cost_components WHERE source_cwip_id = NEW.source_cwip_id AND source_type = 'CWIP' AND status = 'ACTIVE';
    IF used + NEW.reporting_amount > available + 0.005 THEN
      RAISE EXCEPTION 'ASSET_ACQUISITION_ALREADY_ALLOCATED: % of the CWIP balance % is already transferred.', used, available USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_cost_components_guard') THEN
    CREATE TRIGGER asset_cost_components_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.asset_cost_components FOR EACH ROW EXECUTE FUNCTION tenant.asset_cost_components_guard();
  END IF;
END $$;

-- ============================================================ 3. capitalization requests
CREATE TABLE IF NOT EXISTS tenant.asset_capitalizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  capitalization_number bigint GENERATED ALWAYS AS IDENTITY,
  asset_id uuid REFERENCES tenant.assets(id),
  cwip_id uuid REFERENCES tenant.asset_cwip_projects(id),
  status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'POSTING', 'POSTED', 'REJECTED', 'REVERSED', 'RECOVERY_REQUIRED')),
  treatment text NOT NULL DEFAULT 'CAPITALIZE' CHECK (treatment IN ('CAPITALIZE', 'CWIP', 'TRACKED_EXPENSED', 'NOT_ELIGIBLE')),
  proposed_amount numeric(18,2) NOT NULL CHECK (proposed_amount >= 0),
  currency char(3) NOT NULL,
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  journal_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  debit_account_id uuid,
  capitalization_date date NOT NULL,
  available_for_use_date date,
  depreciation_start_date date,
  tax_review boolean NOT NULL DEFAULT false,
  tax_reviewed boolean NOT NULL DEFAULT false,
  note text,
  review_note text,
  requested_by uuid NOT NULL REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewed_by uuid REFERENCES public.users(id),
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  posted_by uuid REFERENCES public.users(id),
  posted_at timestamptz,
  posting_key text,
  journal_entry_id uuid,
  accounting_outcome text CHECK (accounting_outcome IS NULL OR accounting_outcome IN ('POSTED', 'ALREADY_IN_ASSET_ACCOUNT', 'NOT_REQUIRED')),
  rejection_reason text,
  reversed_by uuid REFERENCES public.users(id),
  reversed_at timestamptz,
  reversal_reason text,
  reversal_journal_entry_id uuid,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT asset_capitalizations_target_check CHECK ((asset_id IS NULL) <> (cwip_id IS NULL)),
  CONSTRAINT asset_capitalizations_approval_check CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT asset_capitalizations_posted_check CHECK (status NOT IN ('POSTED', 'REVERSED') OR posted_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_capitalizations_live_asset_idx ON tenant.asset_capitalizations (asset_id) WHERE asset_id IS NOT NULL AND status NOT IN ('REJECTED', 'REVERSED');
CREATE UNIQUE INDEX IF NOT EXISTS asset_capitalizations_live_cwip_idx ON tenant.asset_capitalizations (cwip_id) WHERE cwip_id IS NOT NULL AND status NOT IN ('REJECTED', 'REVERSED');
CREATE UNIQUE INDEX IF NOT EXISTS asset_capitalizations_posting_idx ON tenant.asset_capitalizations (organization_id, posting_key) WHERE posting_key IS NOT NULL;
CREATE OR REPLACE FUNCTION tenant.asset_capitalizations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A capitalization request is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status IN ('REJECTED', 'REVERSED') THEN RAISE EXCEPTION 'A rejected or reversed capitalization stays as it is.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status = 'POSTED' AND (NEW.status <> 'REVERSED' OR NEW.proposed_amount <> OLD.proposed_amount OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id OR NEW.components <> OLD.components) THEN
    RAISE EXCEPTION 'A posted capitalization is corrected by an adjustment or a Finance reversal.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_capitalizations_guard') THEN
    CREATE TRIGGER asset_capitalizations_guard BEFORE UPDATE OR DELETE ON tenant.asset_capitalizations FOR EACH ROW EXECUTE FUNCTION tenant.asset_capitalizations_guard();
  END IF;
END $$;

-- ============================================================ 4. adjustments after capitalization
CREATE TABLE IF NOT EXISTS tenant.asset_capitalization_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  adjustment_number bigint GENERATED ALWAYS AS IDENTITY,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  capitalization_id uuid NOT NULL REFERENCES tenant.asset_capitalizations(id),
  kind text NOT NULL CHECK (kind IN ('CREDIT_NOTE', 'ADDITIONAL_COST', 'CORRECTION')),
  source_type text NOT NULL CHECK (source_type IN ('SUPPLIER_INVOICE_LINE', 'MANUAL')),
  source_line_id uuid,
  amount numeric(18,2) NOT NULL CHECK (amount <> 0),
  offset_account_id uuid,
  status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW', 'POSTED', 'REJECTED')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  evidence text,
  requested_by uuid NOT NULL REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_note text,
  journal_entry_id uuid,
  command_id text,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT asset_cap_adjustments_decider_check CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT asset_cap_adjustments_source_check CHECK (source_type <> 'SUPPLIER_INVOICE_LINE' OR source_line_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_cap_adjustments_command_idx ON tenant.asset_capitalization_adjustments (organization_id, command_id) WHERE command_id IS NOT NULL;
CREATE OR REPLACE FUNCTION tenant.asset_cap_adjustments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'An adjustment is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status <> 'PENDING_REVIEW' THEN RAISE EXCEPTION 'A decided adjustment stays as it is.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.amount <> OLD.amount OR NEW.asset_id <> OLD.asset_id OR NEW.source_line_id IS DISTINCT FROM OLD.source_line_id THEN RAISE EXCEPTION 'An adjustment is rejected and requested again, never edited.' USING ERRCODE = 'check_violation'; END IF;
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_cap_adjustments_guard') THEN
    CREATE TRIGGER asset_cap_adjustments_guard BEFORE UPDATE OR DELETE ON tenant.asset_capitalization_adjustments FOR EACH ROW EXECUTE FUNCTION tenant.asset_cap_adjustments_guard();
  END IF;
END $$;

-- ============================================================ 5. events
CREATE TABLE IF NOT EXISTS tenant.asset_capitalization_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid,
  cwip_id uuid,
  capitalization_id uuid,
  adjustment_id uuid,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_capitalization_events_asset_idx ON tenant.asset_capitalization_events (asset_id, occurred_at DESC) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS asset_capitalization_events_org_idx ON tenant.asset_capitalization_events (organization_id, occurred_at DESC);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_capitalization_events_append_only') THEN
    CREATE TRIGGER asset_capitalization_events_append_only BEFORE UPDATE OR DELETE ON tenant.asset_capitalization_events FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ 6. finance policy
ALTER TABLE tenant.asset_categories ADD COLUMN IF NOT EXISTS cwip_account_id uuid;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['asset_cwip_projects', 'asset_cost_components', 'asset_capitalizations', 'asset_capitalization_adjustments', 'asset_capitalization_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_cwip_projects, tenant.asset_cost_components, tenant.asset_capitalizations, tenant.asset_capitalization_adjustments TO vercent_app;
GRANT SELECT, INSERT ON tenant.asset_capitalization_events TO vercent_app;
GRANT SELECT ON tenant.asset_cwip_projects, tenant.asset_cost_components, tenant.asset_capitalizations, tenant.asset_capitalization_adjustments, tenant.asset_capitalization_events TO vercent_worker;

-- ============================================================ 7. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('assets.acquisition.view', 'View asset acquisitions', 'Assets', 'See purchases eligible for asset registration and their registration progress.'),
  ('assets.acquisition.register', 'Register assets from purchases', 'Assets', 'Register individual assets from an eligible purchase line.'),
  ('assets.acquisition.bulk_register', 'Register assets in bulk', 'Assets', 'Register many units of one purchase line at once.'),
  ('assets.acquisition.allocate_cost', 'Allocate acquisition costs', 'Assets', 'Allocate freight, installation, nonrecoverable tax and discounts to assets.'),
  ('assets.acquisition.view_cost', 'View acquisition costs', 'Assets', 'See purchase costs, allocations and proposed capitalization amounts.'),
  ('assets.capitalization.request', 'Request capitalization', 'Assets', 'Submit an asset for Finance capitalization review.'),
  ('assets.capitalization.review', 'Review capitalization', 'Assets', 'Review capitalization requests and ask for changes.'),
  ('assets.capitalization.approve', 'Approve capitalization', 'Assets', 'Authorize the capitalization treatment (Finance).'),
  ('assets.capitalization.post', 'Post capitalization', 'Assets', 'Post approved capitalizations and adjustments through Finance.'),
  ('assets.capitalization.adjust', 'Request capitalization adjustments', 'Assets', 'Request credit-note, additional-cost and correction adjustments.'),
  ('assets.cwip.manage', 'Manage capital work in progress', 'Assets', 'Accumulate CWIP costs, record readiness and transfer CWIP to assets.'),
  ('assets.acquisition.reconcile', 'Reconcile acquisitions', 'Assets', 'Review acquisition reconciliation and resolve exceptions.'),
  ('assets.acquisition.export', 'Export acquisitions', 'Assets', 'Download acquisition and capitalization records.'),
  ('assets.acquisition.view_audit', 'View acquisition history', 'Assets', 'See every acquisition, allocation, approval and posting event.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('asset_manager', 'assets.acquisition.view'), ('asset_manager', 'assets.acquisition.register'), ('asset_manager', 'assets.acquisition.bulk_register'),
    ('asset_manager', 'assets.capitalization.request'), ('asset_manager', 'assets.cwip.manage'), ('asset_manager', 'assets.acquisition.reconcile'),
    ('asset_manager', 'assets.acquisition.export'), ('asset_manager', 'assets.acquisition.view_audit'),
    ('accountant', 'assets.acquisition.view'), ('accountant', 'assets.acquisition.allocate_cost'), ('accountant', 'assets.acquisition.view_cost'),
    ('accountant', 'assets.capitalization.request'), ('accountant', 'assets.capitalization.review'), ('accountant', 'assets.capitalization.adjust'), ('accountant', 'assets.cwip.manage'),
    ('accountant', 'assets.acquisition.reconcile'), ('accountant', 'assets.acquisition.export'), ('accountant', 'assets.acquisition.view_audit'),
    ('finance_manager', 'assets.acquisition.view'), ('finance_manager', 'assets.acquisition.allocate_cost'), ('finance_manager', 'assets.acquisition.view_cost'),
    ('finance_manager', 'assets.capitalization.request'), ('finance_manager', 'assets.capitalization.review'), ('finance_manager', 'assets.capitalization.approve'),
    ('finance_manager', 'assets.capitalization.post'), ('finance_manager', 'assets.capitalization.adjust'), ('finance_manager', 'assets.cwip.manage'),
    ('finance_manager', 'assets.acquisition.reconcile'), ('finance_manager', 'assets.acquisition.export'), ('finance_manager', 'assets.acquisition.view_audit'),
    ('purchase_manager', 'assets.acquisition.view'), ('buyer', 'assets.acquisition.view'), ('goods_receipt_user', 'assets.acquisition.view'),
    ('manufacturing_manager', 'assets.acquisition.view'), ('manufacturing_manager', 'assets.cwip.manage')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0150_assets_capitalization.sql', 'assets-capitalization') ON CONFLICT DO NOTHING;
