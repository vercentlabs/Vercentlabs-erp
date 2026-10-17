-- Assets — Purchase Invoice-to-Asset Creation. An entry point into Purchase and Capitalization: from an eligible supplier invoice, its
-- asset lines are registered as individual assets (each unit its own identity, the invoice line its acquisition source) in one idempotent
-- request, partially if some lines need work, and handed to Finance's capitalization. It never creates another purchase, payable, tax
-- posting or capitalization. Additive:
--
--   1. batches        one registration request against one invoice: its key, outcome and results (a repeat returns the same batch).
--   2. lines          what each invoice line asked for, what it registered, and why a line was refused; immutable once written.
--   3. permissions    view sources, create, bulk create, view cost, reconcile, history, export.

-- ============================================================ 1. batches
CREATE TABLE IF NOT EXISTS tenant.asset_invoice_registration_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  batch_number bigint GENERATED ALWAYS AS IDENTITY,
  vendor_bill_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED', 'RECOVERY_REQUIRED')),
  idempotency_key text NOT NULL,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  assets_created integer NOT NULL DEFAULT 0,
  requested_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT asset_invoice_batches_key_unique UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS asset_invoice_batches_bill_idx ON tenant.asset_invoice_registration_batches (organization_id, vendor_bill_id, created_at DESC);
CREATE OR REPLACE FUNCTION tenant.asset_invoice_batches_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A registration batch is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status IN ('COMPLETED', 'PARTIAL', 'FAILED') THEN RAISE EXCEPTION 'A finished registration batch stays as it is.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.vendor_bill_id <> OLD.vendor_bill_id OR NEW.idempotency_key <> OLD.idempotency_key THEN RAISE EXCEPTION 'A registration batch keeps its invoice and key.' USING ERRCODE = 'check_violation'; END IF;
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_invoice_batches_guard') THEN
    CREATE TRIGGER asset_invoice_batches_guard BEFORE UPDATE OR DELETE ON tenant.asset_invoice_registration_batches FOR EACH ROW EXECUTE FUNCTION tenant.asset_invoice_batches_guard();
  END IF;
END $$;

-- ============================================================ 2. lines
CREATE TABLE IF NOT EXISTS tenant.asset_invoice_registration_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  batch_id uuid NOT NULL REFERENCES tenant.asset_invoice_registration_batches(id),
  source_line_id uuid NOT NULL,
  requested_quantity integer NOT NULL CHECK (requested_quantity > 0),
  registered_quantity integer NOT NULL DEFAULT 0 CHECK (registered_quantity >= 0 AND registered_quantity <= requested_quantity),
  units_per_quantity integer NOT NULL DEFAULT 1 CHECK (units_per_quantity BETWEEN 1 AND 10000),
  category_id uuid,
  registration_batch_id uuid,
  status text NOT NULL CHECK (status IN ('REGISTERED', 'FAILED')),
  eligibility_reason text,
  receipt_evidence text,
  validation jsonb NOT NULL DEFAULT '[]'::jsonb,
  asset_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_invoice_lines_batch_idx ON tenant.asset_invoice_registration_lines (batch_id);
CREATE INDEX IF NOT EXISTS asset_invoice_lines_source_idx ON tenant.asset_invoice_registration_lines (organization_id, source_line_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_invoice_lines_append_only') THEN
    CREATE TRIGGER asset_invoice_lines_append_only BEFORE UPDATE OR DELETE ON tenant.asset_invoice_registration_lines FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['asset_invoice_registration_batches', 'asset_invoice_registration_lines'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_invoice_registration_batches TO vercent_app;
GRANT SELECT, INSERT ON tenant.asset_invoice_registration_lines TO vercent_app;
GRANT SELECT ON tenant.asset_invoice_registration_batches, tenant.asset_invoice_registration_lines TO vercent_worker;

-- ============================================================ 3. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('assets.invoice.view_source', 'View invoices for asset creation', 'Assets', 'See supplier invoices and lines that can create assets.'),
  ('assets.invoice.create', 'Create assets from invoices', 'Assets', 'Register assets from an eligible supplier invoice line.'),
  ('assets.invoice.bulk_create', 'Create many assets from invoices', 'Assets', 'Register several units or lines of an invoice at once.'),
  ('assets.invoice.view_cost', 'View invoice amounts for assets', 'Assets', 'See invoice prices, discounts and per-unit amounts.'),
  ('assets.invoice.reconcile', 'Reconcile invoice registrations', 'Assets', 'Review invoice-to-asset exceptions and reconciliation.'),
  ('assets.invoice.view_history', 'View invoice registration history', 'Assets', 'See registration batches and their results.'),
  ('assets.invoice.export', 'Export invoice registrations', 'Assets', 'Download invoice-to-asset registration results.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('asset_manager', 'assets.invoice.view_source'), ('asset_manager', 'assets.invoice.create'), ('asset_manager', 'assets.invoice.bulk_create'), ('asset_manager', 'assets.invoice.reconcile'),
    ('asset_manager', 'assets.invoice.view_history'), ('asset_manager', 'assets.invoice.export'),
    ('accountant', 'assets.invoice.view_source'), ('accountant', 'assets.invoice.view_cost'), ('accountant', 'assets.invoice.reconcile'), ('accountant', 'assets.invoice.view_history'), ('accountant', 'assets.invoice.export'),
    ('finance_manager', 'assets.invoice.view_source'), ('finance_manager', 'assets.invoice.create'), ('finance_manager', 'assets.invoice.bulk_create'), ('finance_manager', 'assets.invoice.view_cost'),
    ('finance_manager', 'assets.invoice.reconcile'), ('finance_manager', 'assets.invoice.view_history'), ('finance_manager', 'assets.invoice.export'),
    ('accounts_payable_executive', 'assets.invoice.view_source'), ('accounts_payable_executive', 'assets.invoice.view_cost'),
    ('purchase_manager', 'assets.invoice.view_source'), ('buyer', 'assets.invoice.view_source'), ('goods_receipt_user', 'assets.invoice.view_source')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0151_assets_invoice_registration.sql', 'assets-invoice-registration') ON CONFLICT DO NOTHING;
