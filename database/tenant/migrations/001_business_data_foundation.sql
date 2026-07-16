BEGIN;

CREATE SCHEMA IF NOT EXISTS tenant;

CREATE OR REPLACE FUNCTION tenant.current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN current_setting('app.current_organization_id', true) IS NULL
      OR current_setting('app.current_organization_id', true) = ''
    THEN NULL
    ELSE current_setting('app.current_organization_id', true)::uuid
  END
$$;

CREATE OR REPLACE FUNCTION tenant.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS tenant.currencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code char(3) NOT NULL,
  name text NOT NULL,
  symbol text,
  decimal_places integer NOT NULL DEFAULT 2 CHECK (decimal_places BETWEEN 0 AND 6),
  is_base boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS currencies_single_base_idx
  ON tenant.currencies(organization_id)
  WHERE is_base = true;

CREATE TABLE IF NOT EXISTS tenant.exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  from_currency_code char(3) NOT NULL,
  to_currency_code char(3) NOT NULL,
  rate_date date NOT NULL,
  rate numeric(24, 10) NOT NULL CHECK (rate > 0),
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_currency_code <> to_currency_code),
  UNIQUE (
    organization_id,
    company_id,
    from_currency_code,
    to_currency_code,
    rate_date
  )
);

CREATE TABLE IF NOT EXISTS tenant.fiscal_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  fiscal_year text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'locked')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date),
  UNIQUE (organization_id, company_id, start_date, end_date)
);

CREATE TABLE IF NOT EXISTS tenant.units_of_measure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL CHECK (
    category IN (
      'quantity',
      'weight',
      'volume',
      'length',
      'area',
      'time',
      'packaging',
      'other'
    )
  ),
  decimal_places integer NOT NULL DEFAULT 3 CHECK (decimal_places BETWEEN 0 AND 6),
  is_base boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.tax_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  tax_category_id uuid NOT NULL REFERENCES tenant.tax_categories(id) ON DELETE RESTRICT,
  name text NOT NULL,
  code text NOT NULL,
  tax_type text NOT NULL CHECK (
    tax_type IN ('gst', 'igst', 'cgst', 'sgst', 'cess', 'vat', 'sales_tax', 'other')
  ),
  rate numeric(9, 4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  effective_from date,
  effective_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    effective_from IS NULL
    OR effective_to IS NULL
    OR effective_from <= effective_to
  ),
  UNIQUE (organization_id, company_id, code, effective_from)
);

CREATE TABLE IF NOT EXISTS tenant.payment_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  default_due_days integer NOT NULL DEFAULT 0 CHECK (default_due_days BETWEEN 0 AND 3650),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.payment_term_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_term_id uuid NOT NULL REFERENCES tenant.payment_terms(id) ON DELETE CASCADE,
  sequence integer NOT NULL DEFAULT 1 CHECK (sequence > 0),
  due_days integer NOT NULL DEFAULT 0 CHECK (due_days BETWEEN 0 AND 3650),
  percentage numeric(9, 4) NOT NULL DEFAULT 100 CHECK (percentage > 0 AND percentage <= 100),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, payment_term_id, sequence)
);

CREATE TABLE IF NOT EXISTS tenant.business_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  party_type text NOT NULL CHECK (
    party_type IN ('customer', 'supplier', 'both', 'prospect')
  ),
  display_name text NOT NULL,
  legal_name text,
  gstin text,
  pan text,
  msme_number text,
  currency_code char(3),
  credit_limit numeric(18, 2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  payment_term_id uuid REFERENCES tenant.payment_terms(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS business_parties_gstin_idx
  ON tenant.business_parties(organization_id, gstin)
  WHERE gstin IS NOT NULL AND gstin <> '';

CREATE INDEX IF NOT EXISTS business_parties_search_idx
  ON tenant.business_parties(organization_id, lower(display_name), party_type, status);

CREATE TABLE IF NOT EXISTS tenant.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES tenant.business_parties(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text,
  designation text,
  email text,
  phone text,
  mobile text,
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS contacts_primary_party_idx
  ON tenant.contacts(organization_id, party_id)
  WHERE is_primary = true AND status = 'active';

CREATE INDEX IF NOT EXISTS contacts_email_idx
  ON tenant.contacts(organization_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';

CREATE TABLE IF NOT EXISTS tenant.addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES tenant.business_parties(id) ON DELETE CASCADE,
  address_type text NOT NULL CHECK (
    address_type IN ('registered', 'billing', 'shipping', 'office', 'plant', 'other')
  ),
  line1 text NOT NULL,
  line2 text,
  city text NOT NULL,
  district text,
  state text NOT NULL,
  state_code text,
  postal_code text NOT NULL,
  country_code char(2) NOT NULL,
  gstin text,
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS addresses_primary_party_type_idx
  ON tenant.addresses(organization_id, party_id, address_type)
  WHERE is_primary = true AND status = 'active';

CREATE TABLE IF NOT EXISTS tenant.item_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES tenant.item_groups(id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  item_type text NOT NULL CHECK (
    item_type IN ('product', 'service', 'consumable', 'asset')
  ),
  group_id uuid REFERENCES tenant.item_groups(id) ON DELETE SET NULL,
  uom_id uuid NOT NULL REFERENCES tenant.units_of_measure(id) ON DELETE RESTRICT,
  hsn_sac_code text,
  barcode text,
  track_inventory boolean NOT NULL DEFAULT true,
  allow_negative_stock boolean NOT NULL DEFAULT false,
  valuation_method text NOT NULL DEFAULT 'moving_average' CHECK (
    valuation_method IN ('moving_average', 'fifo', 'standard')
  ),
  standard_cost numeric(18, 4) NOT NULL DEFAULT 0 CHECK (standard_cost >= 0),
  sales_price numeric(18, 4) NOT NULL DEFAULT 0 CHECK (sales_price >= 0),
  purchase_price numeric(18, 4) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  tax_category_id uuid REFERENCES tenant.tax_categories(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS items_barcode_idx
  ON tenant.items(organization_id, barcode)
  WHERE barcode IS NOT NULL AND barcode <> '';

CREATE INDEX IF NOT EXISTS items_search_idx
  ON tenant.items(organization_id, lower(name), item_type, status);

CREATE TABLE IF NOT EXISTS tenant.item_uom_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES tenant.items(id) ON DELETE CASCADE,
  from_uom_id uuid NOT NULL REFERENCES tenant.units_of_measure(id) ON DELETE RESTRICT,
  to_uom_id uuid NOT NULL REFERENCES tenant.units_of_measure(id) ON DELETE RESTRICT,
  conversion_factor numeric(24, 10) NOT NULL CHECK (conversion_factor > 0),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_uom_id <> to_uom_id),
  UNIQUE (organization_id, item_id, from_uom_id, to_uom_id)
);

CREATE TABLE IF NOT EXISTS tenant.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  name text NOT NULL,
  code text NOT NULL,
  warehouse_type text NOT NULL DEFAULT 'stores' CHECK (
    warehouse_type IN (
      'stores',
      'raw_material',
      'work_in_progress',
      'finished_goods',
      'transit',
      'returns',
      'virtual'
    )
  ),
  allow_negative_stock boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.warehouse_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id) ON DELETE CASCADE,
  parent_location_id uuid REFERENCES tenant.warehouse_locations(id) ON DELETE SET NULL,
  name text NOT NULL,
  code text NOT NULL,
  location_type text NOT NULL DEFAULT 'zone' CHECK (
    location_type IN ('zone', 'aisle', 'rack', 'bin', 'staging', 'quality', 'other')
  ),
  capacity numeric(18, 4) CHECK (capacity IS NULL OR capacity >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, warehouse_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  price_list_type text NOT NULL CHECK (price_list_type IN ('sales', 'purchase')),
  currency_code char(3) NOT NULL,
  tax_inclusive boolean NOT NULL DEFAULT false,
  valid_from date,
  valid_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to),
  UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.price_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  price_list_id uuid NOT NULL REFERENCES tenant.price_lists(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES tenant.items(id) ON DELETE CASCADE,
  uom_id uuid REFERENCES tenant.units_of_measure(id) ON DELETE SET NULL,
  minimum_quantity numeric(18, 4) NOT NULL DEFAULT 1 CHECK (minimum_quantity > 0),
  rate numeric(18, 4) NOT NULL CHECK (rate >= 0),
  valid_from date,
  valid_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to),
  UNIQUE (
    organization_id,
    price_list_id,
    item_id,
    uom_id,
    minimum_quantity,
    valid_from
  )
);

CREATE TABLE IF NOT EXISTS tenant.master_data_external_ids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  source_system text NOT NULL,
  external_id text NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entity_type, source_system, external_id)
);

CREATE TABLE IF NOT EXISTS tenant.master_data_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource text NOT NULL,
  file_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'completed', 'completed_with_errors', 'failed')
  ),
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  processed_rows integer NOT NULL DEFAULT 0 CHECK (processed_rows >= 0),
  succeeded_rows integer NOT NULL DEFAULT 0 CHECK (succeeded_rows >= 0),
  failed_rows integer NOT NULL DEFAULT 0 CHECK (failed_rows >= 0),
  error_report jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS exchange_rates_lookup_idx
  ON tenant.exchange_rates(
    organization_id,
    company_id,
    from_currency_code,
    to_currency_code,
    rate_date DESC
  );

CREATE INDEX IF NOT EXISTS fiscal_periods_lookup_idx
  ON tenant.fiscal_periods(organization_id, company_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS tax_rates_lookup_idx
  ON tenant.tax_rates(organization_id, company_id, tax_category_id, effective_from DESC);

CREATE INDEX IF NOT EXISTS contacts_party_idx
  ON tenant.contacts(organization_id, party_id, status);

CREATE INDEX IF NOT EXISTS addresses_party_idx
  ON tenant.addresses(organization_id, party_id, status);

CREATE INDEX IF NOT EXISTS items_group_idx
  ON tenant.items(organization_id, group_id, status);

CREATE INDEX IF NOT EXISTS warehouses_company_idx
  ON tenant.warehouses(organization_id, company_id, branch_id, status);

CREATE INDEX IF NOT EXISTS warehouse_locations_tree_idx
  ON tenant.warehouse_locations(organization_id, warehouse_id, parent_location_id);

CREATE INDEX IF NOT EXISTS price_list_items_lookup_idx
  ON tenant.price_list_items(organization_id, price_list_id, item_id, valid_from DESC);

CREATE INDEX IF NOT EXISTS import_jobs_org_idx
  ON tenant.master_data_import_jobs(organization_id, created_at DESC);

DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT column_catalog.table_name
    FROM information_schema.columns AS column_catalog
    WHERE column_catalog.table_schema = 'tenant'
      AND column_catalog.column_name = 'updated_at'
    ORDER BY column_catalog.table_name
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON tenant.%I',
      table_name || '_touch_updated_at',
      table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON tenant.%I
       FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at()',
      table_name || '_touch_updated_at',
      table_name
    );
  END LOOP;
END $$;

WITH currency_seed(code, name, symbol, decimal_places) AS (
  VALUES
    ('INR', 'Indian Rupee', '₹', 2),
    ('USD', 'US Dollar', '$', 2),
    ('EUR', 'Euro', '€', 2),
    ('GBP', 'Pound Sterling', '£', 2),
    ('AED', 'UAE Dirham', 'د.إ', 2)
)
INSERT INTO tenant.currencies (
  organization_id,
  code,
  name,
  symbol,
  decimal_places,
  is_base,
  created_by,
  updated_by
)
SELECT
  o.id,
  seed.code,
  seed.name,
  seed.symbol,
  seed.decimal_places,
  seed.code = o.base_currency,
  o.created_by,
  o.created_by
FROM public.organizations o
CROSS JOIN currency_seed seed
ON CONFLICT (organization_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  symbol = EXCLUDED.symbol,
  decimal_places = EXCLUDED.decimal_places,
  is_base = EXCLUDED.is_base,
  updated_at = now();

WITH uom_seed(code, name, category, decimal_places, is_base) AS (
  VALUES
    ('EA', 'Each', 'quantity', 0, true),
    ('NOS', 'Numbers', 'quantity', 0, false),
    ('KG', 'Kilogram', 'weight', 3, true),
    ('G', 'Gram', 'weight', 3, false),
    ('L', 'Litre', 'volume', 3, true),
    ('ML', 'Millilitre', 'volume', 3, false),
    ('M', 'Metre', 'length', 3, true),
    ('CM', 'Centimetre', 'length', 3, false),
    ('SQM', 'Square metre', 'area', 3, true),
    ('HOUR', 'Hour', 'time', 2, true),
    ('DAY', 'Day', 'time', 2, false),
    ('BOX', 'Box', 'packaging', 0, false)
)
INSERT INTO tenant.units_of_measure (
  organization_id,
  code,
  name,
  category,
  decimal_places,
  is_base,
  created_by,
  updated_by
)
SELECT
  o.id,
  seed.code,
  seed.name,
  seed.category,
  seed.decimal_places,
  seed.is_base,
  o.created_by,
  o.created_by
FROM public.organizations o
CROSS JOIN uom_seed seed
ON CONFLICT (organization_id, code) DO NOTHING;

WITH category_seed(code, name, description) AS (
  VALUES
    ('GST-TAXABLE', 'GST taxable', 'Standard taxable supply under GST.'),
    ('GST-EXEMPT', 'GST exempt', 'Exempt supply under GST.'),
    ('NON-GST', 'Non-GST', 'Supply outside GST scope.')
)
INSERT INTO tenant.tax_categories (
  organization_id,
  code,
  name,
  description,
  created_by,
  updated_by
)
SELECT
  o.id,
  seed.code,
  seed.name,
  seed.description,
  o.created_by,
  o.created_by
FROM public.organizations o
CROSS JOIN category_seed seed
ON CONFLICT (organization_id, code) DO NOTHING;

WITH term_seed(code, name, description, due_days) AS (
  VALUES
    ('IMMEDIATE', 'Immediate', 'Payment is due immediately.', 0),
    ('NET-7', 'Net 7', 'Payment is due within 7 days.', 7),
    ('NET-15', 'Net 15', 'Payment is due within 15 days.', 15),
    ('NET-30', 'Net 30', 'Payment is due within 30 days.', 30),
    ('NET-45', 'Net 45', 'Payment is due within 45 days.', 45),
    ('NET-60', 'Net 60', 'Payment is due within 60 days.', 60)
)
INSERT INTO tenant.payment_terms (
  organization_id,
  code,
  name,
  description,
  default_due_days,
  created_by,
  updated_by
)
SELECT
  o.id,
  seed.code,
  seed.name,
  seed.description,
  seed.due_days,
  o.created_by,
  o.created_by
FROM public.organizations o
CROSS JOIN term_seed seed
ON CONFLICT (organization_id, code) DO NOTHING;

INSERT INTO tenant.payment_term_lines (
  organization_id,
  payment_term_id,
  sequence,
  due_days,
  percentage,
  created_by,
  updated_by
)
SELECT
  term.organization_id,
  term.id,
  1,
  term.default_due_days,
  100,
  term.created_by,
  term.updated_by
FROM tenant.payment_terms term
ON CONFLICT (organization_id, payment_term_id, sequence) DO NOTHING;

INSERT INTO tenant.price_lists (
  organization_id,
  code,
  name,
  price_list_type,
  currency_code,
  tax_inclusive,
  created_by,
  updated_by
)
SELECT
  o.id,
  seed.code,
  seed.name,
  seed.kind,
  o.base_currency,
  false,
  o.created_by,
  o.created_by
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('STANDARD-SALES', 'Standard sales price', 'sales'),
    ('STANDARD-PURCHASE', 'Standard purchase price', 'purchase')
) AS seed(code, name, kind)
ON CONFLICT (organization_id, code) DO NOTHING;

INSERT INTO tenant.warehouses (
  organization_id,
  company_id,
  branch_id,
  name,
  code,
  warehouse_type,
  created_by,
  updated_by
)
SELECT
  branch.organization_id,
  branch.company_id,
  branch.id,
  branch.name || ' Main Warehouse',
  branch.code || '-MAIN',
  'stores',
  organization.created_by,
  organization.created_by
FROM public.branches branch
JOIN public.organizations organization
  ON organization.id = branch.organization_id
WHERE branch.is_primary = true
ON CONFLICT (organization_id, code) DO NOTHING;

INSERT INTO tenant.warehouse_locations (
  organization_id,
  warehouse_id,
  name,
  code,
  location_type,
  created_by,
  updated_by
)
SELECT
  warehouse.organization_id,
  warehouse.id,
  'Main',
  'MAIN',
  'zone',
  warehouse.created_by,
  warehouse.updated_by
FROM tenant.warehouses warehouse
ON CONFLICT (organization_id, warehouse_id, code) DO NOTHING;

WITH organization_period AS (
  SELECT
    organization.id AS organization_id,
    company.id AS company_id,
    organization.created_by,
    make_date(
      CASE
        WHEN extract(month FROM current_date)::integer
          >= organization.fiscal_year_start_month
        THEN extract(year FROM current_date)::integer
        ELSE extract(year FROM current_date)::integer - 1
      END,
      organization.fiscal_year_start_month,
      1
    ) AS start_date
  FROM public.organizations organization
  JOIN public.companies company
    ON company.organization_id = organization.id
   AND company.is_primary = true
)
INSERT INTO tenant.fiscal_periods (
  organization_id,
  company_id,
  name,
  fiscal_year,
  start_date,
  end_date,
  created_by,
  updated_by
)
SELECT
  period.organization_id,
  period.company_id,
  'FY ' || to_char(period.start_date, 'YYYY')
    || '-' || to_char(period.start_date + interval '1 year', 'YY'),
  to_char(period.start_date, 'YYYY')
    || '-' || to_char(period.start_date + interval '1 year', 'YY'),
  period.start_date,
  (period.start_date + interval '1 year - 1 day')::date,
  period.created_by,
  period.created_by
FROM organization_period period
ON CONFLICT (organization_id, company_id, start_date, end_date) DO NOTHING;

WITH gst_rates(code, name, rate) AS (
  VALUES
    ('GST-0', 'GST 0%', 0::numeric),
    ('GST-5', 'GST 5%', 5::numeric),
    ('GST-12', 'GST 12%', 12::numeric),
    ('GST-18', 'GST 18%', 18::numeric),
    ('GST-28', 'GST 28%', 28::numeric)
)
INSERT INTO tenant.tax_rates (
  organization_id,
  company_id,
  tax_category_id,
  name,
  code,
  tax_type,
  rate,
  effective_from,
  created_by,
  updated_by
)
SELECT
  organization.id,
  company.id,
  category.id,
  rate_seed.name,
  rate_seed.code,
  'gst',
  rate_seed.rate,
  current_date,
  organization.created_by,
  organization.created_by
FROM public.organizations organization
JOIN public.companies company
  ON company.organization_id = organization.id
 AND company.is_primary = true
JOIN tenant.tax_categories category
  ON category.organization_id = organization.id
 AND category.code = 'GST-TAXABLE'
CROSS JOIN gst_rates rate_seed
WHERE organization.country_code = 'IN'
ON CONFLICT (organization_id, company_id, code, effective_from) DO NOTHING;

DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'tenant'
    ORDER BY tablename
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY tenant_organization_isolation ON tenant.%I
       USING (organization_id = tenant.current_organization_id())
       WITH CHECK (organization_id = tenant.current_organization_id())',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
