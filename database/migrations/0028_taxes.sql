-- Taxes (shared by Sales, POS, Procurement and Finance).
--
-- 1. Tax category: what a product or service points at. It carries the tax
--    type (GST splits into CGST + SGST or IGST by place of supply), the
--    treatment (taxable, zero rated, exempt, outside tax) and reverse charge.
-- 2. Tax rate: one rate per category at a time, dated. A rate change ends
--    the current rate and starts a new one; history is never edited. A rate
--    may carry a CESS on top.
--
--    Until now one "GST taxable" category held several rates at once (0, 5,
--    12, 18, 28) and the highest was charged. Each rate gets its own
--    category (GST-0 … GST-28); a category that holds several current rates
--    keeps the one it has been charging and the others are made inactive.
-- 3. Company tax registrations: a company may be registered in more than
--    one state; a document names the registration that issues it.
-- 4. Tax defaults per organization, and an audit trail of tax configuration.
-- 5. Documents keep the tax they were calculated with: the seller
--    registration, how the place of supply was arrived at, the treatment,
--    and per line the rate and one row per tax component.
-- 6. Permissions.

-- ============================================================ 1. categories

ALTER TABLE tenant.tax_categories
  ADD COLUMN IF NOT EXISTS tax_type text NOT NULL DEFAULT 'gst',
  ADD COLUMN IF NOT EXISTS treatment text NOT NULL DEFAULT 'taxable',
  ADD COLUMN IF NOT EXISTS applies_to text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS country_code char(2),
  ADD COLUMN IF NOT EXISTS reverse_charge boolean NOT NULL DEFAULT false;

UPDATE tenant.tax_categories category SET country_code = organization.country_code
  FROM public.organizations organization WHERE organization.id = category.organization_id AND category.country_code IS NULL;
UPDATE tenant.tax_categories SET treatment = 'exempt' WHERE code = 'GST-EXEMPT' AND treatment = 'taxable';
UPDATE tenant.tax_categories SET treatment = 'non_taxable', tax_type = 'none' WHERE code = 'NON-GST' AND treatment = 'taxable';
-- A category whose rates are not GST keeps their type.
UPDATE tenant.tax_categories category SET tax_type = rate.tax_type
  FROM (SELECT DISTINCT ON (tax_category_id) tax_category_id, tax_type FROM tenant.tax_rates WHERE tax_type IN ('vat', 'sales_tax', 'other') ORDER BY tax_category_id, effective_from DESC NULLS LAST) rate
 WHERE rate.tax_category_id = category.id AND category.tax_type = 'gst'
   AND NOT EXISTS (SELECT 1 FROM tenant.tax_rates gst WHERE gst.tax_category_id = category.id AND gst.tax_type = 'gst');

ALTER TABLE tenant.tax_categories
  ADD CONSTRAINT tax_categories_tax_type_check CHECK (tax_type IN ('gst', 'vat', 'sales_tax', 'other', 'none')),
  ADD CONSTRAINT tax_categories_treatment_check CHECK (treatment IN ('taxable', 'zero_rated', 'exempt', 'non_taxable')),
  ADD CONSTRAINT tax_categories_applies_to_check CHECK (applies_to IN ('all', 'goods', 'services'));

-- ============================================================ 2. rates

ALTER TABLE tenant.tax_rates
  ADD COLUMN IF NOT EXISTS cess_rate numeric(9, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE tenant.tax_rates ADD CONSTRAINT tax_rates_cess_rate_check CHECK (cess_rate >= 0 AND cess_rate <= 1000);

-- A separate CESS rate row becomes the CESS on the category's main rate.
UPDATE tenant.tax_rates main SET cess_rate = cess.rate
  FROM tenant.tax_rates cess
 WHERE cess.organization_id = main.organization_id AND cess.tax_category_id = main.tax_category_id AND cess.tax_type = 'cess' AND cess.status = 'active'
   AND main.tax_type <> 'cess' AND main.status = 'active' AND main.cess_rate = 0;
UPDATE tenant.tax_rates SET status = 'inactive' WHERE tax_type = 'cess' AND status = 'active';

-- One category per GST rate, for organizations in India.
INSERT INTO tenant.tax_categories (organization_id, code, name, description, tax_type, treatment, country_code)
SELECT organization.id, 'GST-' || slab.rate, 'GST ' || slab.rate || '%', 'Goods and services taxed at ' || slab.rate || '% GST.', 'gst', 'taxable', 'IN'
  FROM public.organizations organization
 CROSS JOIN (VALUES (0), (5), (12), (18), (28)) AS slab(rate)
 WHERE trim(organization.country_code) = 'IN'
ON CONFLICT (organization_id, code) DO NOTHING;

INSERT INTO tenant.tax_rates (organization_id, tax_category_id, name, code, tax_type, rate, effective_from)
SELECT category.organization_id, category.id, category.name, category.code || '-V1', 'gst', substring(category.code FROM 5)::numeric, DATE '2017-07-01'
  FROM tenant.tax_categories category
 WHERE category.code IN ('GST-0', 'GST-5', 'GST-12', 'GST-18', 'GST-28')
   AND NOT EXISTS (SELECT 1 FROM tenant.tax_rates rate WHERE rate.organization_id = category.organization_id AND rate.tax_category_id = category.id)
ON CONFLICT (organization_id, code, effective_from) DO NOTHING;

-- A category charges one rate at a time: it keeps the rate it has been
-- charging (the latest, then the highest), and the others are made inactive.
UPDATE tenant.tax_rates rate SET status = 'inactive'
 WHERE rate.status = 'active'
   AND rate.id <> (SELECT keep.id FROM tenant.tax_rates keep
                    WHERE keep.organization_id = rate.organization_id AND keep.tax_category_id = rate.tax_category_id AND keep.status = 'active'
                      AND (keep.effective_from IS NULL OR keep.effective_from <= current_date) AND (keep.effective_to IS NULL OR keep.effective_to >= current_date)
                    ORDER BY keep.effective_from DESC NULLS LAST, keep.rate DESC LIMIT 1)
   AND (rate.effective_from IS NULL OR rate.effective_from <= current_date) AND (rate.effective_to IS NULL OR rate.effective_to >= current_date);
UPDATE tenant.tax_rates SET effective_from = DATE '2017-07-01' WHERE effective_from IS NULL;
-- A category's first rate was dated the day it was set up, not the day the tax
-- began: it applies to earlier dates too, so a back-dated document finds its rate.
UPDATE tenant.tax_rates rate SET effective_from = DATE '2017-07-01'
 WHERE rate.status = 'active' AND rate.effective_from > DATE '2017-07-01'
   AND NOT EXISTS (SELECT 1 FROM tenant.tax_rates earlier WHERE earlier.organization_id = rate.organization_id AND earlier.tax_category_id = rate.tax_category_id
                      AND earlier.status = 'active' AND earlier.id <> rate.id AND earlier.effective_from <= rate.effective_from)
   AND NOT EXISTS (SELECT 1 FROM tenant.tax_rates clash WHERE clash.organization_id = rate.organization_id AND clash.code = rate.code AND clash.effective_from = DATE '2017-07-01');
ALTER TABLE tenant.tax_rates ALTER COLUMN effective_from SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tax_rates_one_open_rate_uidx
  ON tenant.tax_rates (organization_id, tax_category_id) WHERE status = 'active' AND effective_to IS NULL;
CREATE INDEX IF NOT EXISTS tax_rates_category_date_idx ON tenant.tax_rates (organization_id, tax_category_id, effective_from DESC);

-- ============================================================ 3. company registrations

CREATE TABLE IF NOT EXISTS tenant.tax_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  legal_name text,
  registration_number text,
  country_code char(2) NOT NULL DEFAULT 'IN',
  state_code text,
  state_name text,
  address_line1 text,
  address_line2 text,
  city text,
  postal_code text,
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, code),
  CHECK (NOT is_default OR status = 'active')
);
CREATE UNIQUE INDEX IF NOT EXISTS tax_registrations_default_uidx ON tenant.tax_registrations (organization_id) WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS tax_registrations_number_uidx ON tenant.tax_registrations (organization_id, upper(registration_number)) WHERE registration_number IS NOT NULL;

ALTER TABLE tenant.tax_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.tax_registrations FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.tax_registrations
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE ON tenant.tax_registrations TO vercent_app;
GRANT SELECT ON tenant.tax_registrations TO vercent_worker;

-- The seller's GST state kept in Sales settings becomes the company's first registration.
INSERT INTO tenant.tax_registrations (organization_id, code, name, legal_name, registration_number, country_code, state_code, is_default)
SELECT organization.id, 'MAIN', COALESCE(NULLIF(organization.legal_name, ''), organization.name), NULLIF(organization.legal_name, ''),
       NULLIF(upper(trim(organization.tax_id)), ''), COALESCE(NULLIF(trim(organization.country_code), ''), 'IN'), trim(settings.seller_state_code), true
  FROM tenant.sales_settings settings
  JOIN public.organizations organization ON organization.id = settings.organization_id
 WHERE NULLIF(trim(settings.seller_state_code), '') IS NOT NULL
ON CONFLICT (organization_id, code) DO NOTHING;

-- ============================================================ 4. defaults and audit

CREATE TABLE IF NOT EXISTS tenant.tax_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  tax_enabled boolean NOT NULL DEFAULT true,
  default_tax_category_id uuid REFERENCES tenant.tax_categories(id),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant.tax_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.tax_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.tax_settings
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE ON tenant.tax_settings TO vercent_app;
GRANT SELECT ON tenant.tax_settings TO vercent_worker;

CREATE TABLE IF NOT EXISTS tenant.tax_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('tax_category', 'tax_rate', 'tax_registration', 'tax_settings')),
  entity_id uuid,
  event_type text NOT NULL,
  summary text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tax_history_idx ON tenant.tax_history (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tax_history_entity_idx ON tenant.tax_history (organization_id, entity_type, entity_id, created_at DESC);
ALTER TABLE tenant.tax_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.tax_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.tax_history
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT ON tenant.tax_history TO vercent_app;
GRANT SELECT ON tenant.tax_history TO vercent_worker;

-- ============================================================ 5. documents

ALTER TABLE tenant.sales_quotation_versions
  ADD COLUMN IF NOT EXISTS seller_registration_id uuid,
  ADD COLUMN IF NOT EXISTS seller_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS tax_treatment text NOT NULL DEFAULT 'taxable',
  ADD COLUMN IF NOT EXISTS tax_override_reason text,
  ADD COLUMN IF NOT EXISTS place_of_supply_name text,
  ADD COLUMN IF NOT EXISTS place_of_supply_source text NOT NULL DEFAULT 'derived',
  ADD COLUMN IF NOT EXISTS place_of_supply_reason text,
  ADD COLUMN IF NOT EXISTS supply_nature text;
ALTER TABLE tenant.sales_order_versions
  ADD COLUMN IF NOT EXISTS seller_registration_id uuid,
  ADD COLUMN IF NOT EXISTS seller_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS tax_treatment text NOT NULL DEFAULT 'taxable',
  ADD COLUMN IF NOT EXISTS tax_override_reason text,
  ADD COLUMN IF NOT EXISTS place_of_supply_name text,
  ADD COLUMN IF NOT EXISTS place_of_supply_source text NOT NULL DEFAULT 'derived',
  ADD COLUMN IF NOT EXISTS place_of_supply_reason text,
  ADD COLUMN IF NOT EXISTS supply_nature text;

UPDATE tenant.sales_quotation_versions SET tax_treatment = CASE supply_type WHEN 'export' THEN 'zero_rated' WHEN 'exempt' THEN 'exempt' WHEN 'non_gst' THEN 'non_taxable' ELSE 'taxable' END
 WHERE supply_type IN ('export', 'exempt', 'non_gst');
UPDATE tenant.sales_order_versions SET tax_treatment = CASE supply_type WHEN 'export' THEN 'zero_rated' WHEN 'exempt' THEN 'exempt' WHEN 'non_gst' THEN 'non_taxable' ELSE 'taxable' END
 WHERE supply_type IN ('export', 'exempt', 'non_gst');

ALTER TABLE tenant.sales_quotation_versions
  ADD CONSTRAINT sales_quotation_versions_seller_registration_fkey FOREIGN KEY (organization_id, seller_registration_id) REFERENCES tenant.tax_registrations (organization_id, id),
  ADD CONSTRAINT sales_quotation_versions_tax_treatment_check CHECK (tax_treatment IN ('taxable', 'zero_rated', 'exempt', 'non_taxable')),
  ADD CONSTRAINT sales_quotation_versions_place_source_check CHECK (place_of_supply_source IN ('derived', 'override')),
  ADD CONSTRAINT sales_quotation_versions_supply_nature_check CHECK (supply_nature IS NULL OR supply_nature IN ('intra_state', 'inter_state'));
ALTER TABLE tenant.sales_order_versions
  ADD CONSTRAINT sales_order_versions_seller_registration_fkey FOREIGN KEY (organization_id, seller_registration_id) REFERENCES tenant.tax_registrations (organization_id, id),
  ADD CONSTRAINT sales_order_versions_tax_treatment_check CHECK (tax_treatment IN ('taxable', 'zero_rated', 'exempt', 'non_taxable')),
  ADD CONSTRAINT sales_order_versions_place_source_check CHECK (place_of_supply_source IN ('derived', 'override')),
  ADD CONSTRAINT sales_order_versions_supply_nature_check CHECK (supply_nature IS NULL OR supply_nature IN ('intra_state', 'inter_state'));

-- Lines: the rate and classification the tax was calculated with.
ALTER TABLE tenant.sales_quotation_lines
  ADD COLUMN IF NOT EXISTS tax_rate numeric(9, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate_id uuid,
  ADD COLUMN IF NOT EXISTS tax_category_code text,
  ADD COLUMN IF NOT EXISTS tax_treatment text,
  ADD COLUMN IF NOT EXISTS hsn_sac_kind text CHECK (hsn_sac_kind IS NULL OR hsn_sac_kind IN ('hsn', 'sac'));
ALTER TABLE tenant.sales_order_lines
  ADD COLUMN IF NOT EXISTS tax_rate numeric(9, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate_id uuid,
  ADD COLUMN IF NOT EXISTS tax_category_code text,
  ADD COLUMN IF NOT EXISTS tax_treatment text,
  ADD COLUMN IF NOT EXISTS hsn_sac_kind text CHECK (hsn_sac_kind IS NULL OR hsn_sac_kind IN ('hsn', 'sac'));

UPDATE tenant.sales_quotation_lines line
   SET tax_rate = COALESCE((SELECT sum((component->>'rate')::numeric) FROM jsonb_array_elements(line.tax_trace) component), 0),
       tax_category_code = category.code,
       hsn_sac_kind = CASE WHEN line.hsn_sac_snapshot IS NULL THEN NULL WHEN item.item_type = 'service' THEN 'sac' ELSE 'hsn' END
  FROM tenant.items item LEFT JOIN tenant.tax_categories category ON category.id = item.tax_category_id
 WHERE item.id = line.item_id AND line.tax_category_code IS NULL AND jsonb_typeof(line.tax_trace) = 'array';
UPDATE tenant.sales_order_lines line
   SET tax_rate = COALESCE((SELECT sum((component->>'rate')::numeric) FROM jsonb_array_elements(line.tax_trace) component), 0),
       tax_category_code = category.code,
       hsn_sac_kind = CASE WHEN line.hsn_sac_snapshot IS NULL THEN NULL WHEN item.item_type = 'service' THEN 'sac' ELSE 'hsn' END
  FROM tenant.items item LEFT JOIN tenant.tax_categories category ON category.id = item.tax_category_id
 WHERE item.id = line.item_id AND line.tax_category_code IS NULL AND jsonb_typeof(line.tax_trace) = 'array';

-- One row per tax component per line (CGST, SGST, IGST, CESS, …).
ALTER TABLE tenant.sales_quotation_tax_lines
  ADD COLUMN IF NOT EXISTS tax_category_id uuid,
  ADD COLUMN IF NOT EXISTS tax_rate_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS tenant.sales_order_tax_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_order_version_id uuid NOT NULL REFERENCES tenant.sales_order_versions(id) ON DELETE CASCADE,
  sales_order_line_id uuid NOT NULL REFERENCES tenant.sales_order_lines(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  tax_type text NOT NULL,
  label text NOT NULL,
  rate numeric(9, 6) NOT NULL,
  taxable_amount numeric(20, 6) NOT NULL,
  tax_amount numeric(20, 6) NOT NULL,
  tax_category_id uuid,
  tax_rate_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sales_order_line_id, sequence)
);
CREATE INDEX IF NOT EXISTS sales_order_tax_lines_version_idx ON tenant.sales_order_tax_lines (organization_id, sales_order_version_id);
ALTER TABLE tenant.sales_order_tax_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_order_tax_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.sales_order_tax_lines
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT ON tenant.sales_order_tax_lines TO vercent_app;
GRANT SELECT ON tenant.sales_order_tax_lines TO vercent_worker;

-- Existing orders: their components were kept only inside the line.
INSERT INTO tenant.sales_order_tax_lines (organization_id, sales_order_version_id, sales_order_line_id, sequence, tax_type, label, rate, taxable_amount, tax_amount)
SELECT line.organization_id, line.sales_order_version_id, line.id, component.position::int,
       COALESCE(component.value->>'taxType', 'other'), COALESCE(component.value->>'label', upper(COALESCE(component.value->>'taxType', 'Tax'))),
       COALESCE((component.value->>'rate')::numeric, 0), COALESCE((component.value->>'taxableAmount')::numeric, 0), COALESCE((component.value->>'taxAmount')::numeric, 0)
  FROM tenant.sales_order_lines line
 CROSS JOIN LATERAL jsonb_array_elements(line.tax_trace) WITH ORDINALITY AS component(value, position)
 WHERE jsonb_typeof(line.tax_trace) = 'array'
ON CONFLICT (sales_order_line_id, sequence) DO NOTHING;

-- ============================================================ 6. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('tax.view', 'View tax configuration', 'Taxes', 'See tax categories, rates and company tax registrations.'),
  ('tax.categories.manage', 'Manage tax categories', 'Taxes', 'Create, change, activate and deactivate tax categories.'),
  ('tax.rates.manage', 'Manage tax rates', 'Taxes', 'Change a tax category''s rate from a date.'),
  ('tax.registrations.manage', 'Manage company tax registrations', 'Taxes', 'Add and change the company''s GST registrations and tax defaults.'),
  ('tax.transaction.override', 'Override transaction tax treatment', 'Taxes', 'Mark a document exempt, zero rated or outside tax, with a reason.'),
  ('tax.place_of_supply.override', 'Override place of supply', 'Taxes', 'Change the place of supply worked out for a document, with a reason.'),
  ('tax.audit.view', 'View tax audit trail', 'Taxes', 'See who changed tax configuration and when.')
ON CONFLICT (key) DO NOTHING;

-- Everyone who works with products, sales, the till or the books sees how tax is set up.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'tax.view'
  FROM public.role_permissions existing
 WHERE existing.permission_key IN ('sales.view', 'products.view', 'pos.view', 'accounting.view')
ON CONFLICT DO NOTHING;

-- Finance, which looked after tax until now, manages it and may override a document.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['tax.categories.manage', 'tax.rates.manage', 'tax.registrations.manage', 'tax.transaction.override',
    'tax.place_of_supply.override', 'tax.audit.view'])
 WHERE existing.permission_key IN ('accounting.tax.manage', 'accounting.settings.manage')
ON CONFLICT DO NOTHING;

-- Sales administrators may override the tax on a sales document.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['tax.transaction.override', 'tax.place_of_supply.override', 'tax.audit.view'])
 WHERE existing.permission_key = 'sales.settings.manage'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0028_taxes.sql', 'taxes');
