-- Shared Platform plan, step 1.
--
-- 1. Plan rows. Enterprise is "contact sales, all apps": its module list had 4 apps with duplicates, fewer than Free. The plans' text
--    follows the pricing decided for launch (the Free single-app rule and the yearly prices arrive with step 2's billing work).
--    The companies/branches limits are read by nothing (no multi-company or branch feature) and are removed from every plan.
UPDATE public.billing_plans
   SET name = 'Enterprise',
       description = 'All apps, contracted users and limits, onboarding and support for larger organisations. Contact sales.',
       modules = '["*"]'::jsonb,
       features = '["All apps", "Contracted users and limits", "Custom onboarding and support"]'::jsonb,
       updated_at = now()
 WHERE code = 'enterprise';

UPDATE public.billing_plans
   SET description = 'For one person getting started: 1 user at no charge.',
       features = '["1 user included", "Email support"]'::jsonb,
       updated_at = now()
 WHERE code = 'free';

UPDATE public.billing_plans
   SET limits = limits - 'companies' - 'branches', updated_at = now()
 WHERE limits ? 'companies' OR limits ? 'branches';

-- 2. GST rates (rate rationalisation from 22 Sep 2025: the main slabs are 5% and 18%, plus 40% for demerit goods; 12% and 28% stay
--    for the items still on them; 3% for gold and silver and 0.25% for rough precious stones were there all along). Each GST category
--    is one rate, so nothing already in use changes: existing Indian companies get the categories they are missing, and the 12% and
--    28% categories say they are only for the items still at those rates. Past documents keep the tax they were issued with.
WITH missing(rate, code, name, description, effective_from) AS (VALUES
  (40::numeric,  'GST-40',   'GST 40%',   'Demerit goods (luxury, sin goods) taxed at 40% GST from 22 Sep 2025.', DATE '2025-09-22'),
  (3::numeric,   'GST-3',    'GST 3%',    'Gold, silver and jewellery taxed at 3% GST.', DATE '2017-07-01'),
  (0.25::numeric,'GST-0.25', 'GST 0.25%', 'Rough precious and semi-precious stones taxed at 0.25% GST.', DATE '2017-07-01')
), companies AS (
  SELECT DISTINCT organization_id FROM tenant.tax_categories WHERE code = 'GST-18' AND tax_type = 'gst'
), inserted AS (
  INSERT INTO tenant.tax_categories (organization_id, code, name, description, tax_type, treatment, country_code)
  SELECT companies.organization_id, missing.code, missing.name, missing.description, 'gst', 'taxable', 'IN'
    FROM companies CROSS JOIN missing
  ON CONFLICT (organization_id, code) DO NOTHING
  RETURNING id, organization_id, code
)
INSERT INTO tenant.tax_rates (organization_id, tax_category_id, name, code, tax_type, rate, effective_from)
SELECT inserted.organization_id, inserted.id, missing.name, missing.code || '-V1', 'gst', missing.rate, missing.effective_from
  FROM inserted JOIN missing ON missing.code = inserted.code
ON CONFLICT (organization_id, code, effective_from) DO NOTHING;

UPDATE tenant.tax_categories
   SET description = 'Only for items still taxed at 12% after the 22 Sep 2025 rate change (most moved to 5% or 18%).', updated_at = now()
 WHERE code = 'GST-12' AND tax_type = 'gst' AND description = 'Goods and services taxed at 12% GST.';
UPDATE tenant.tax_categories
   SET description = 'Only for items still taxed at 28% after the 22 Sep 2025 rate change (most moved to 18% or 40%).', updated_at = now()
 WHERE code = 'GST-28' AND tax_type = 'gst' AND description = 'Goods and services taxed at 28% GST.';

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0185_platform_plans_gst_rates.sql', 'platform-plans-gst-rates') ON CONFLICT DO NOTHING;
