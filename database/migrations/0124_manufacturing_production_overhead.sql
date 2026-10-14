-- Manufacturing: Basic Production Overhead, on Production Costing (0123). Overhead is organised in categories (electricity, utilities, rent,
-- maintenance, indirect labor, depreciation, batch setup, other), each a cost pool of the company's own expense accounts. Every labor and
-- overhead rate is approved by someone other than who set it, in force from a date (possibly scheduled), versioned, never edited once
-- approved; a product's own rate replaces the company default of the same category — never stacking — and an explicit zero carries its
-- reason. The rates in force when an order is released are frozen for it. A batch earns its fixed charge once its setup is confirmed or it
-- reports output; an output correction below what was applied is taken back only by a linked, approved reversal. Finance compares each
-- month's actual overhead pool with what was applied. Additive: 0123's rates and applications gain the new columns (backfilled), the rate
-- status set is widened (INACTIVE becomes RETIRED), and the two single-rate unique indexes give way to per-category, per-frozen-rate ones.

-- ============================================================ 1. overhead categories (cost pools)
CREATE TABLE IF NOT EXISTS tenant.manufacturing_overhead_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text NOT NULL CHECK (length(btrim(name)) >= 2),
  description text,
  default_basis text NOT NULL DEFAULT 'PER_GOOD_UNIT' CHECK (default_basis IN ('PER_GOOD_UNIT', 'PER_BATCH')),
  -- The Finance expense accounts its actual cost is booked to (for the period reconciliation).
  cost_pool_account_ids uuid[] NOT NULL DEFAULT '{}',
  cost_pool_note text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_overhead_categories_code_uidx ON tenant.manufacturing_overhead_categories (organization_id, code);

INSERT INTO tenant.manufacturing_overhead_categories (organization_id, code, name, description, default_basis)
SELECT organization.id, category.code, category.name, category.description, category.basis FROM public.organizations organization
  CROSS JOIN (VALUES
    ('FACTORY_ELECTRICITY', 'Factory electricity', 'Power used in production', 'PER_GOOD_UNIT'),
    ('FACTORY_UTILITIES', 'Factory utilities', 'Water, gas and general utilities of the factory', 'PER_GOOD_UNIT'),
    ('FACTORY_RENT', 'Factory rent', 'Occupancy of the manufacturing facility', 'PER_GOOD_UNIT'),
    ('EQUIPMENT_MAINTENANCE', 'Equipment maintenance', 'Routine upkeep of production equipment', 'PER_GOOD_UNIT'),
    ('INDIRECT_LABOR', 'Indirect factory labor', 'Supervisors and supporting factory staff', 'PER_GOOD_UNIT'),
    ('EQUIPMENT_DEPRECIATION', 'Equipment depreciation', 'Depreciation of production equipment', 'PER_GOOD_UNIT'),
    ('BATCH_SETUP', 'Batch setup', 'Preparation and cleaning for each production batch', 'PER_BATCH'),
    ('OTHER', 'Other manufacturing overhead', 'Other approved indirect manufacturing cost', 'PER_GOOD_UNIT')
  ) AS category(code, name, description, basis)
ON CONFLICT (organization_id, code) DO NOTHING;

-- ============================================================ 2. rates: DRAFT -> PENDING_APPROVAL -> ACTIVE (from its date) -> RETIRED
-- A rejected submission returns to DRAFT. Labor has no category; overhead always has one.
ALTER TABLE tenant.manufacturing_cost_rates ADD COLUMN IF NOT EXISTS rate_code text;
ALTER TABLE tenant.manufacturing_cost_rates ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE tenant.manufacturing_cost_rates ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES tenant.manufacturing_overhead_categories(id);
-- An explicit zero carries its reason.
ALTER TABLE tenant.manufacturing_cost_rates ADD COLUMN IF NOT EXISTS zero_reason text;
-- The output unit a per-unit rate is per (the product's base unit).
ALTER TABLE tenant.manufacturing_cost_rates ADD COLUMN IF NOT EXISTS uom_id uuid REFERENCES tenant.units_of_measure(id);
ALTER TABLE tenant.manufacturing_cost_rates ADD COLUMN IF NOT EXISTS effective_from date;
ALTER TABLE tenant.manufacturing_cost_rates ADD COLUMN IF NOT EXISTS effective_until date;
ALTER TABLE tenant.manufacturing_cost_rates ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.users(id);
ALTER TABLE tenant.manufacturing_cost_rates ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE tenant.manufacturing_cost_rates ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id);
ALTER TABLE tenant.manufacturing_cost_rates ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE tenant.manufacturing_cost_rates ADD COLUMN IF NOT EXISTS decision_note text;
ALTER TABLE tenant.manufacturing_cost_rates ADD COLUMN IF NOT EXISTS retired_by uuid REFERENCES public.users(id);
ALTER TABLE tenant.manufacturing_cost_rates ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;

-- Rates set under 0123 were in force on setting: they keep that, dated from when they were set, in the category their basis implies.
UPDATE tenant.manufacturing_cost_rates rate SET
  rate_code = COALESCE(rate.rate_code, 'MCR-LEGACY-' || upper(substr(rate.id::text, 1, 8))),
  name = COALESCE(rate.name, CASE rate.component WHEN 'LABOR' THEN 'Direct labor' ELSE 'Manufacturing overhead' END),
  effective_from = COALESCE(rate.effective_from, (rate.created_at AT TIME ZONE 'Asia/Kolkata')::date),
  effective_until = CASE WHEN rate.status = 'INACTIVE' AND rate.effective_until IS NULL THEN GREATEST((COALESCE(rate.retired_at, rate.created_at) AT TIME ZONE 'Asia/Kolkata')::date, (rate.created_at AT TIME ZONE 'Asia/Kolkata')::date) ELSE rate.effective_until END,
  approved_at = COALESCE(rate.approved_at, rate.created_at),
  approved_by = COALESCE(rate.approved_by, rate.created_by),
  category_id = COALESCE(rate.category_id, CASE WHEN rate.component = 'OVERHEAD' THEN (SELECT category.id FROM tenant.manufacturing_overhead_categories category
    WHERE category.organization_id = rate.organization_id AND category.code = CASE rate.basis WHEN 'PER_BATCH' THEN 'BATCH_SETUP' ELSE 'OTHER' END) END),
  zero_reason = CASE WHEN rate.rate = 0 AND rate.zero_reason IS NULL THEN 'Set as zero before reasons were recorded' ELSE rate.zero_reason END
WHERE rate.rate_code IS NULL OR rate.name IS NULL OR rate.effective_from IS NULL OR rate.approved_at IS NULL OR (rate.component = 'OVERHEAD' AND rate.category_id IS NULL);

ALTER TABLE tenant.manufacturing_cost_rates ALTER COLUMN rate_code SET NOT NULL;
ALTER TABLE tenant.manufacturing_cost_rates ALTER COLUMN name SET NOT NULL;
ALTER TABLE tenant.manufacturing_cost_rates ALTER COLUMN effective_from SET NOT NULL;
ALTER TABLE tenant.manufacturing_cost_rates ALTER COLUMN effective_from SET DEFAULT current_date;
ALTER TABLE tenant.manufacturing_cost_rates ALTER COLUMN status SET DEFAULT 'DRAFT';

-- The guard: a draft is edited freely; an approved rate only retires, or is given its end date once (when a newer rate takes over); a
-- retired one never changes; a rate waiting for approval is decided before it changes.
CREATE OR REPLACE FUNCTION tenant.manufacturing_cost_rate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A cost rate is never deleted; retire it.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'RETIRED' THEN
    RAISE EXCEPTION 'A retired cost rate does not change.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'ACTIVE' AND (NEW.status NOT IN ('ACTIVE', 'RETIRED') OR (NEW.effective_until IS DISTINCT FROM OLD.effective_until AND OLD.effective_until IS NOT NULL) OR NEW.rate <> OLD.rate
      OR NEW.basis <> OLD.basis OR NEW.component <> OLD.component OR NEW.version <> OLD.version OR NEW.finished_item_id IS DISTINCT FROM OLD.finished_item_id
      OR NEW.category_id IS DISTINCT FROM OLD.category_id OR NEW.effective_from <> OLD.effective_from OR NEW.uom_id IS DISTINCT FROM OLD.uom_id OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
    RAISE EXCEPTION 'An approved cost rate does not change; set a new rate.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'PENDING_APPROVAL' AND (NEW.rate <> OLD.rate OR NEW.basis <> OLD.basis OR NEW.effective_from <> OLD.effective_from) THEN
    RAISE EXCEPTION 'A rate waiting for approval is decided first; it is edited only as a draft.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- INACTIVE (0123) is RETIRED now.
ALTER TABLE tenant.manufacturing_cost_rates DROP CONSTRAINT IF EXISTS manufacturing_cost_rates_status_check;
UPDATE tenant.manufacturing_cost_rates SET status = 'RETIRED' WHERE status = 'INACTIVE';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_cost_rates_lifecycle_check') THEN
    ALTER TABLE tenant.manufacturing_cost_rates ADD CONSTRAINT manufacturing_cost_rates_lifecycle_check CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'RETIRED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_cost_rates_overhead_rules_check') THEN
    ALTER TABLE tenant.manufacturing_cost_rates ADD CONSTRAINT manufacturing_cost_rates_overhead_rules_check CHECK (
      (component = 'LABOR' OR category_id IS NOT NULL) AND (component = 'OVERHEAD' OR category_id IS NULL)
      AND (rate > 0 OR length(btrim(COALESCE(zero_reason, ''))) >= 3)
      AND (effective_until IS NULL OR effective_until >= effective_from)
      AND (status <> 'ACTIVE' OR approved_at IS NOT NULL)
      AND length(btrim(name)) >= 2);
  END IF;
END $$;
-- 0123 allowed one rate in force per component and product; overhead now has one per category, and a successor may be approved ahead of
-- its date — overlaps are refused when a rate is approved (serialized per slot).
DROP INDEX IF EXISTS tenant.manufacturing_cost_rates_active_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_cost_rates_code_uidx ON tenant.manufacturing_cost_rates (organization_id, rate_code);
CREATE INDEX IF NOT EXISTS manufacturing_cost_rates_lookup_idx ON tenant.manufacturing_cost_rates (organization_id, component, category_id, finished_item_id, status, effective_from);

-- ============================================================ 3. the rates an order was released under, frozen
CREATE TABLE IF NOT EXISTS tenant.manufacturing_order_cost_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  rate_id uuid NOT NULL REFERENCES tenant.manufacturing_cost_rates(id),
  rate_code text NOT NULL,
  rate_version integer NOT NULL,
  component text NOT NULL CHECK (component IN ('LABOR', 'OVERHEAD')),
  category_id uuid REFERENCES tenant.manufacturing_overhead_categories(id),
  category_name text,
  basis text NOT NULL CHECK (basis IN ('PER_GOOD_UNIT', 'PER_BATCH', 'PCT_OF_MATERIAL')),
  rate numeric(20, 6) NOT NULL,
  product_specific boolean NOT NULL DEFAULT false,
  frozen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Frozen after release (the order was released before rates were frozen): the rates in force when its costs were first applied.
  frozen_late boolean NOT NULL DEFAULT false,
  UNIQUE (manufacturing_order_id, rate_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_order_cost_rates_slot_uidx ON tenant.manufacturing_order_cost_rates (manufacturing_order_id, component, COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- A production batch earns its fixed charge once its setup is confirmed (or it reports output): an empty draft batch never does.
ALTER TABLE tenant.manufacturing_production_batches ADD COLUMN IF NOT EXISTS setup_confirmed_at timestamptz;
ALTER TABLE tenant.manufacturing_production_batches ADD COLUMN IF NOT EXISTS setup_confirmed_by uuid REFERENCES public.users(id);

-- ============================================================ 4. applications against the frozen rates; linked reversals
ALTER TABLE tenant.manufacturing_cost_applications ADD COLUMN IF NOT EXISTS order_rate_id uuid REFERENCES tenant.manufacturing_order_cost_rates(id);
ALTER TABLE tenant.manufacturing_cost_applications ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES tenant.manufacturing_overhead_categories(id);
ALTER TABLE tenant.manufacturing_cost_applications ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'APPLY';
ALTER TABLE tenant.manufacturing_cost_applications ADD COLUMN IF NOT EXISTS reversal_of uuid REFERENCES tenant.manufacturing_cost_applications(id);
ALTER TABLE tenant.manufacturing_cost_applications ADD COLUMN IF NOT EXISTS reason text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_cost_applications_direction_check') THEN
    ALTER TABLE tenant.manufacturing_cost_applications ADD CONSTRAINT manufacturing_cost_applications_direction_check
      CHECK (direction IN ('APPLY', 'REVERSE') AND (direction = 'APPLY' OR length(btrim(COALESCE(reason, ''))) >= 3));
  END IF;
  -- Every application belongs to a frozen rate (0123's applications, if any, predate frozen rates and keep none).
  IF NOT EXISTS (SELECT 1 FROM tenant.manufacturing_cost_applications WHERE order_rate_id IS NULL) THEN
    ALTER TABLE tenant.manufacturing_cost_applications ALTER COLUMN order_rate_id SET NOT NULL;
  END IF;
END $$;
-- A batch's fixed charge, per frozen rate, once per real batch (0123 keyed it by component, which two per-batch categories would share).
DROP INDEX IF EXISTS tenant.manufacturing_cost_applications_batch_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_cost_applications_rate_batch_uidx ON tenant.manufacturing_cost_applications (organization_id, order_rate_id, production_batch_id)
  WHERE production_batch_id IS NOT NULL AND direction = 'APPLY';

-- ============================================================ 5. the period reconciliation (as Finance reviewed it; no automatic journal)
CREATE TABLE IF NOT EXISTS tenant.manufacturing_overhead_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  category_id uuid NOT NULL REFERENCES tenant.manufacturing_overhead_categories(id),
  actual_pool numeric(20, 2) NOT NULL,
  applied numeric(20, 2) NOT NULL,
  difference numeric(20, 2) NOT NULL,
  status text NOT NULL CHECK (status IN ('RECONCILED', 'EXCEPTION')),
  note text NOT NULL CHECK (length(btrim(note)) >= 3),
  finance_reference text,
  reconciled_by uuid REFERENCES public.users(id),
  reconciled_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_overhead_reconciliations_idx ON tenant.manufacturing_overhead_reconciliations (organization_id, period, category_id, reconciled_at);

-- ============================================================ 6. append-only, isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['manufacturing_order_cost_rates', 'manufacturing_overhead_reconciliations'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = name || '_append_only' AND tgrelid = ('tenant.' || name)::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_append_only()', name || '_append_only', name);
    END IF;
  END LOOP;
  FOREACH name IN ARRAY ARRAY['manufacturing_overhead_categories', 'manufacturing_order_cost_rates', 'manufacturing_overhead_reconciliations'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.manufacturing_overhead_categories TO vercent_app;
GRANT SELECT, INSERT ON tenant.manufacturing_order_cost_rates, tenant.manufacturing_overhead_reconciliations TO vercent_app;
GRANT SELECT ON tenant.manufacturing_overhead_categories, tenant.manufacturing_order_cost_rates, tenant.manufacturing_overhead_reconciliations TO vercent_worker;

-- ============================================================ 7. permission and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('manufacturing.cost.rate_approve', 'Approve labor and overhead rates', 'Manufacturing', 'Approve a submitted rate (someone other than the person who set it).')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES ('accountant', 'manufacturing.cost.rate_approve'), ('finance_manager', 'manufacturing.cost.rate_approve')) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0124_manufacturing_production_overhead.sql', 'manufacturing-production-overhead') ON CONFLICT DO NOTHING;
