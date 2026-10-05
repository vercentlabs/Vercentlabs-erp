-- Discounts (Sales).
--
-- Two levels: a line discount and a document discount, each a percentage or
-- a fixed amount. The document discount is shared across the lines in
-- proportion to their value, so every line carries its own taxable value
-- (tax, partial invoices and returns all work from the line).
--
-- 1. Lines keep the gross amount, the document discount allocated to them
--    and the taxable value.
-- 2. Documents keep how the document discount was entered, its amount, the
--    gross / line discount / taxable totals and why the discount was given.
-- 3. Sales settings: which discounts are allowed, when a reason is needed
--    and how much discount a user may give.
-- 4. Permissions.

-- ============================================================ 1. lines

ALTER TABLE tenant.sales_quotation_lines
  ADD COLUMN IF NOT EXISTS gross_amount numeric(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS document_discount_amount numeric(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_amount numeric(20, 6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.sales_order_lines
  ADD COLUMN IF NOT EXISTS gross_amount numeric(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS document_discount_amount numeric(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_amount numeric(20, 6) NOT NULL DEFAULT 0;

-- Existing lines: line total = net - document discount share + tax.
UPDATE tenant.sales_quotation_lines
   SET gross_amount = round(quantity * unit_price, 2),
       taxable_amount = greatest(line_total - tax_amount, 0),
       document_discount_amount = greatest(net_amount - (line_total - tax_amount), 0)
 WHERE gross_amount = 0 AND taxable_amount = 0;
UPDATE tenant.sales_order_lines
   SET gross_amount = round(quantity * unit_price, 2),
       taxable_amount = greatest(line_total - tax_amount, 0),
       document_discount_amount = greatest(net_amount - (line_total - tax_amount), 0)
 WHERE gross_amount = 0 AND taxable_amount = 0;

ALTER TABLE tenant.sales_quotation_lines
  ADD CONSTRAINT sales_quotation_lines_discount_amounts_check CHECK (gross_amount >= 0 AND document_discount_amount >= 0 AND taxable_amount >= 0);
ALTER TABLE tenant.sales_order_lines
  ADD CONSTRAINT sales_order_lines_discount_amounts_check CHECK (gross_amount >= 0 AND document_discount_amount >= 0 AND taxable_amount >= 0);

-- ============================================================ 2. documents

ALTER TABLE tenant.sales_quotation_versions
  ADD COLUMN IF NOT EXISTS document_discount_type text NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS document_discount_value numeric(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS document_discount_amount numeric(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_total numeric(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_discount_total numeric(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_total numeric(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_reason_code text,
  ADD COLUMN IF NOT EXISTS discount_reason_text text;
ALTER TABLE tenant.sales_order_versions
  ADD COLUMN IF NOT EXISTS document_discount_type text NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS document_discount_value numeric(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS document_discount_amount numeric(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_total numeric(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_discount_total numeric(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_total numeric(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_reason_code text,
  ADD COLUMN IF NOT EXISTS discount_reason_text text;

-- Existing documents: the document discount was a percentage.
UPDATE tenant.sales_quotation_versions version
   SET document_discount_value = version.header_discount_percent,
       document_discount_amount = totals.document_discount, gross_total = totals.gross, line_discount_total = totals.line_discount, taxable_total = totals.taxable
  FROM (SELECT quotation_version_id, sum(document_discount_amount) AS document_discount, sum(gross_amount) AS gross, sum(discount_amount) AS line_discount, sum(taxable_amount) AS taxable
          FROM tenant.sales_quotation_lines GROUP BY quotation_version_id) totals
 WHERE totals.quotation_version_id = version.id AND version.gross_total = 0;
UPDATE tenant.sales_order_versions version
   SET document_discount_value = version.header_discount_percent,
       document_discount_amount = totals.document_discount, gross_total = totals.gross, line_discount_total = totals.line_discount, taxable_total = totals.taxable
  FROM (SELECT sales_order_version_id, sum(document_discount_amount) AS document_discount, sum(gross_amount) AS gross, sum(discount_amount) AS line_discount, sum(taxable_amount) AS taxable
          FROM tenant.sales_order_lines GROUP BY sales_order_version_id) totals
 WHERE totals.sales_order_version_id = version.id AND version.gross_total = 0;

ALTER TABLE tenant.sales_quotation_versions
  ADD CONSTRAINT sales_quotation_versions_document_discount_check CHECK (document_discount_type IN ('percent', 'amount') AND document_discount_value >= 0 AND document_discount_amount >= 0
    AND (document_discount_type <> 'percent' OR document_discount_value <= 100)),
  ADD CONSTRAINT sales_quotation_versions_discount_reason_check CHECK (discount_reason_code IS NULL OR discount_reason_code IN
    ('volume', 'negotiation', 'competitive_match', 'existing_customer', 'management_decision', 'launch_offer', 'other'));
ALTER TABLE tenant.sales_order_versions
  ADD CONSTRAINT sales_order_versions_document_discount_check CHECK (document_discount_type IN ('percent', 'amount') AND document_discount_value >= 0 AND document_discount_amount >= 0
    AND (document_discount_type <> 'percent' OR document_discount_value <= 100)),
  ADD CONSTRAINT sales_order_versions_discount_reason_check CHECK (discount_reason_code IS NULL OR discount_reason_code IN
    ('volume', 'negotiation', 'competitive_match', 'existing_customer', 'management_decision', 'launch_offer', 'other'));

-- ============================================================ 3. settings

-- A limit left empty means no limit; "reason above" left empty means a reason is never required.
ALTER TABLE tenant.sales_settings
  ADD COLUMN IF NOT EXISTS allow_line_discounts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_document_discounts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_percent_discounts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_amount_discounts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS discount_reason_above_percent numeric(9, 6),
  ADD COLUMN IF NOT EXISTS discount_limit_percent numeric(9, 6),
  ADD COLUMN IF NOT EXISTS discount_limit_elevated_percent numeric(9, 6);
ALTER TABLE tenant.sales_settings
  ADD CONSTRAINT sales_settings_discount_bounds_check CHECK (
    (discount_reason_above_percent IS NULL OR discount_reason_above_percent BETWEEN 0 AND 100)
    AND (discount_limit_percent IS NULL OR discount_limit_percent BETWEEN 0 AND 100)
    AND (discount_limit_elevated_percent IS NULL OR discount_limit_elevated_percent BETWEEN 0 AND 100)
    AND (allow_percent_discounts OR allow_amount_discounts));

-- ============================================================ 4. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('sales.discount.apply_document', 'Apply document discounts', 'Sales', 'Give a discount on the whole quotation or sales order.'),
  ('sales.discount.apply_above_limit', 'Apply discounts up to the higher limit', 'Sales', 'Give discounts up to the manager limit in Sales settings.'),
  ('sales.discount.override_limit', 'Override the discount limit', 'Sales', 'Give a discount of any size.'),
  ('sales.discount.manage_settings', 'Manage discount settings', 'Sales', 'Change which discounts are allowed, the limits and when a reason is needed.')
ON CONFLICT (key) DO NOTHING;

-- A discount now needs its own permission. Whoever could discount before
-- (through the discount or the price override permission) still can.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.discount.apply', 'sales.discount.apply_document'])
 WHERE existing.permission_key IN ('sales.discount.apply', 'sales.price.override')
ON CONFLICT DO NOTHING;

-- Approvers discount up to the higher limit.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.discount.apply_above_limit'
  FROM public.role_permissions existing
 WHERE existing.permission_key = 'sales.quotation.approve'
ON CONFLICT DO NOTHING;

-- Sales administrators set the rules and are not limited by them.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.discount.override_limit', 'sales.discount.manage_settings', 'sales.discount.apply_above_limit'])
 WHERE existing.permission_key = 'sales.settings.manage'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0027_sales_discounts.sql', 'sales-discounts');
