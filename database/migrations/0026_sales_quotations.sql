-- Quotations (Sales).
--
-- 1. Quotation: a quotation date (pricing, validity and tax are decided on
--    it), who confirmed it and when, and revision lineage. A revision is a
--    quotation of its own (QT-2026-000124-R1) that points at the quotation
--    it revises; when the revision goes to the customer the earlier one is
--    superseded.
--
--    Status codes keep the values the table already allows: Confirmed is
--    stored as 'approved' and Superseded as 'withdrawn'. Expired is never
--    stored: it is derived from Valid Until. Rows left in states that no
--    longer exist are moved to their equivalent.
-- 2. Lines: a discount is a percentage or a fixed amount; the line keeps
--    which one was entered.
-- 3. Sales settings: default terms and conditions for new quotations.
-- 4. Permissions for record visibility, confirmation, the quotation date
--    and printing, granted to the roles that work with quotations today.

-- ============================================================ 1. quotation

ALTER TABLE tenant.sales_quotations
  ADD COLUMN IF NOT EXISTS quotation_date date,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS revision_of_quotation_id uuid,
  ADD COLUMN IF NOT EXISTS revision_root_id uuid,
  ADD COLUMN IF NOT EXISTS revision_number integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_quotation_id uuid;

UPDATE tenant.sales_quotations SET quotation_date = created_at::date WHERE quotation_date IS NULL;
ALTER TABLE tenant.sales_quotations ALTER COLUMN quotation_date SET DEFAULT current_date;
ALTER TABLE tenant.sales_quotations ALTER COLUMN quotation_date SET NOT NULL;

ALTER TABLE tenant.sales_quotations
  ADD CONSTRAINT sales_quotations_revision_of_fkey FOREIGN KEY (organization_id, revision_of_quotation_id) REFERENCES tenant.sales_quotations (organization_id, id),
  ADD CONSTRAINT sales_quotations_revision_root_fkey FOREIGN KEY (organization_id, revision_root_id) REFERENCES tenant.sales_quotations (organization_id, id),
  ADD CONSTRAINT sales_quotations_superseded_by_fkey FOREIGN KEY (organization_id, superseded_by_quotation_id) REFERENCES tenant.sales_quotations (organization_id, id),
  ADD CONSTRAINT sales_quotations_revision_check CHECK ((revision_of_quotation_id IS NULL) = (revision_number = 0)),
  ADD CONSTRAINT sales_quotations_valid_until_check CHECK (valid_until IS NULL OR valid_until >= quotation_date) NOT VALID;

-- A quotation is revised once; the next revision revises the revision.
CREATE UNIQUE INDEX IF NOT EXISTS sales_quotations_one_revision_uidx
  ON tenant.sales_quotations (organization_id, revision_of_quotation_id) WHERE revision_of_quotation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_quotations_root_idx ON tenant.sales_quotations (organization_id, revision_root_id) WHERE revision_root_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_quotations_date_idx ON tenant.sales_quotations (organization_id, quotation_date DESC);

-- States the lifecycle no longer has.
UPDATE tenant.sales_quotations SET lifecycle_status = 'sent' WHERE lifecycle_status = 'viewed';
UPDATE tenant.sales_quotations SET lifecycle_status = 'accepted' WHERE lifecycle_status = 'converted';
UPDATE tenant.sales_quotations SET lifecycle_status = CASE WHEN sent_at IS NOT NULL THEN 'sent' ELSE 'approved' END WHERE lifecycle_status = 'expired';
UPDATE tenant.sales_quotations SET confirmed_at = updated_at WHERE confirmed_at IS NULL AND lifecycle_status IN ('approved', 'sent', 'accepted', 'rejected');

-- ============================================================ 2. lines

ALTER TABLE tenant.sales_quotation_lines
  ADD COLUMN IF NOT EXISTS discount_type text NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS discount_value numeric(20, 6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.sales_order_lines
  ADD COLUMN IF NOT EXISTS discount_type text NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS discount_value numeric(20, 6) NOT NULL DEFAULT 0;

UPDATE tenant.sales_quotation_lines SET discount_value = discount_percent WHERE discount_value = 0 AND discount_percent > 0;
UPDATE tenant.sales_order_lines SET discount_value = discount_percent WHERE discount_value = 0 AND discount_percent > 0;

ALTER TABLE tenant.sales_quotation_lines
  ADD CONSTRAINT sales_quotation_lines_discount_type_check CHECK (discount_type IN ('percent', 'amount')),
  ADD CONSTRAINT sales_quotation_lines_discount_value_check CHECK (discount_value >= 0);
ALTER TABLE tenant.sales_order_lines
  ADD CONSTRAINT sales_order_lines_discount_type_check CHECK (discount_type IN ('percent', 'amount')),
  ADD CONSTRAINT sales_order_lines_discount_value_check CHECK (discount_value >= 0);

-- The document discount is kept on the version, so a sales order made from
-- the quotation carries it.
ALTER TABLE tenant.sales_quotation_versions ADD COLUMN IF NOT EXISTS header_discount_percent numeric(9, 6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.sales_order_versions ADD COLUMN IF NOT EXISTS header_discount_percent numeric(9, 6) NOT NULL DEFAULT 0;

-- ============================================================ 3. settings

ALTER TABLE tenant.sales_settings ADD COLUMN IF NOT EXISTS default_quotation_terms text;

-- ============================================================ 4. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('sales.quotation.view', 'View quotations', 'Sales', 'Open the quotations the user owns.'),
  ('sales.quotation.view_team', 'View team quotations', 'Sales', 'See quotations owned by the user''s sales team.'),
  ('sales.quotation.view_all', 'View all quotations', 'Sales', 'See every quotation of the organization.'),
  ('sales.quotation.confirm', 'Confirm quotations', 'Sales', 'Confirm a draft quotation so it can be sent.'),
  ('sales.quotation.change_date', 'Change quotation date', 'Sales', 'Give a quotation a date other than today.'),
  ('sales.quotation.export', 'Print and export quotations', 'Sales', 'Download, print and export quotations.')
ON CONFLICT (key) DO NOTHING;

-- Everyone who opens Sales keeps seeing every quotation and printing it, as before.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.quotation.view', 'sales.quotation.view_all', 'sales.quotation.export'])
 WHERE existing.permission_key = 'sales.view'
ON CONFLICT DO NOTHING;

-- Whoever writes quotations confirms them; approvals still apply above the thresholds.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.quotation.confirm'
  FROM public.role_permissions existing
 WHERE existing.permission_key = 'sales.quotation.create'
ON CONFLICT DO NOTHING;

-- Approvers see their team's quotations and may date a quotation.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.quotation.view_team', 'sales.quotation.change_date', 'sales.quotation.confirm'])
 WHERE existing.permission_key IN ('sales.quotation.approve', 'sales.settings.manage')
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0026_sales_quotations.sql', 'sales-quotations');
