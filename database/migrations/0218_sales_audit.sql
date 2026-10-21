-- Sales audit (Vercentlabs Sales — Full Audit Report, 21 Oct 2026).

-- 1. Charges are billed, with GST (B1). A taxable charge (freight, packing, installation…) is taxed like the goods it goes with — at the
--    rate of the document's main line — and keeps that tax; an order keeps its charges one by one (it kept only their total), and the
--    order's first invoice carries every charge not yet billed as a taxed line tied to the charge.
ALTER TABLE tenant.sales_quotation_charges ADD COLUMN IF NOT EXISTS tax_amount numeric(24,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.sales_quotation_charges ADD COLUMN IF NOT EXISTS tax_rate numeric(10,4) NOT NULL DEFAULT 0;
ALTER TABLE tenant.sales_quotation_charges ADD COLUMN IF NOT EXISTS hsn_sac_code text;
ALTER TABLE tenant.sales_quotation_charges ADD COLUMN IF NOT EXISTS tax_lines jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS tenant.sales_order_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_order_version_id uuid NOT NULL REFERENCES tenant.sales_order_versions(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  charge_type text NOT NULL CHECK (charge_type IN ('freight', 'handling', 'insurance', 'packing', 'installation', 'other')),
  label text NOT NULL CHECK (char_length(label) <= 120),
  calculation_type text NOT NULL CHECK (calculation_type IN ('fixed', 'percentage')),
  value numeric(24,10) NOT NULL CHECK (value >= 0),
  amount numeric(24,6) NOT NULL CHECK (amount >= 0),
  taxable boolean NOT NULL DEFAULT true,
  tax_amount numeric(24,6) NOT NULL DEFAULT 0,
  tax_rate numeric(10,4) NOT NULL DEFAULT 0,
  hsn_sac_code text,
  tax_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sales_order_version_id, sequence)
);
CREATE INDEX IF NOT EXISTS sales_order_charges_version_idx ON tenant.sales_order_charges (organization_id, sales_order_version_id);
ALTER TABLE tenant.sales_quotation_charges DROP CONSTRAINT IF EXISTS sales_quotation_charges_charge_type_check;
ALTER TABLE tenant.sales_quotation_charges ADD CONSTRAINT sales_quotation_charges_charge_type_check CHECK (charge_type IN ('freight', 'handling', 'insurance', 'packing', 'installation', 'other'));

-- An invoice line that bills an order charge (its own description, no product).
ALTER TABLE tenant.sales_invoice_lines ADD COLUMN IF NOT EXISTS order_charge_id uuid REFERENCES tenant.sales_order_charges(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sales_invoice_lines_charge_idx ON tenant.sales_invoice_lines (organization_id, order_charge_id) WHERE order_charge_id IS NOT NULL;

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['sales_order_charges'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app, vercent_worker', name);
  END LOOP;
END $$;

-- 2. The company's day (B2): today in the organization's time zone, for every document date default and check (current_date is the server's,
--    UTC: between 00:00 and 05:30 IST it is still yesterday).
CREATE OR REPLACE FUNCTION tenant.company_today() RETURNS date
LANGUAGE sql STABLE SET search_path = pg_catalog, public, tenant AS $$
  SELECT (now() AT TIME ZONE COALESCE((SELECT organization.timezone FROM public.organizations organization WHERE organization.id = tenant.current_organization_id()), 'Asia/Kolkata'))::date
$$;
GRANT EXECUTE ON FUNCTION tenant.company_today() TO vercent_app, vercent_worker;

-- 3. Credit control (M1/B5/B13). A customer's credit limit (business_parties.credit_limit, in the company's base currency) is checked when
--    an order is confirmed: what the customer owes, less advances and credit, plus confirmed orders not yet invoiced, plus this order.
--    Over the limit — or with an invoice overdue more than the set number of days — the order is held (block), only warned about (warn),
--    or not checked (off). Someone allowed to release credit confirms it anyway, with a reason that stays on the order's history.
ALTER TABLE tenant.sales_settings ADD COLUMN IF NOT EXISTS credit_control text NOT NULL DEFAULT 'block';
ALTER TABLE tenant.sales_settings DROP CONSTRAINT IF EXISTS sales_settings_credit_control_check;
ALTER TABLE tenant.sales_settings ADD CONSTRAINT sales_settings_credit_control_check CHECK (credit_control IN ('off', 'warn', 'block'));
ALTER TABLE tenant.sales_settings ADD COLUMN IF NOT EXISTS credit_overdue_days integer;
ALTER TABLE tenant.sales_settings DROP CONSTRAINT IF EXISTS sales_settings_credit_overdue_days_check;
ALTER TABLE tenant.sales_settings ADD CONSTRAINT sales_settings_credit_overdue_days_check CHECK (credit_overdue_days IS NULL OR credit_overdue_days BETWEEN 0 AND 3650);

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('sales.customers.change_credit_limit', 'Change customer credit limit', 'Sales', 'Set or change a customer''s credit limit.'),
  ('sales.order.credit_release', 'Release orders held for credit', 'Sales', 'Confirm an order over the customer''s credit limit, or with invoices overdue, giving a reason.')
ON CONFLICT (key) DO NOTHING;
-- Whoever changes a customer's payment terms sets its credit limit; whoever reopens confirmed orders (a Sales manager) releases credit.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.customers.change_credit_limit' FROM public.role_permissions existing WHERE existing.permission_key = 'sales.customers.change_payment_terms'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.order.credit_release' FROM public.role_permissions existing WHERE existing.permission_key = 'sales.order.reopen'
ON CONFLICT DO NOTHING;

-- 4. Schemes and special rates (M3). The pricing engine already applied tenant.sales_pricing_rules (a customer's or a group's discount or
--    fixed rate, quantity slabs); Sales › Schemes & Rates now creates them. A free-goods scheme (buy 10, get 1 free) gives a zero-priced line
--    of the free product, tied to the scheme; the engine checks the document earns it.
ALTER TABLE tenant.sales_pricing_rules DROP CONSTRAINT IF EXISTS sales_pricing_rules_adjustment_type_check;
ALTER TABLE tenant.sales_pricing_rules ADD CONSTRAINT sales_pricing_rules_adjustment_type_check
  CHECK (adjustment_type IN ('discount_percent', 'discount_amount', 'fixed_rate', 'free_goods'));
ALTER TABLE tenant.sales_pricing_rules ADD COLUMN IF NOT EXISTS free_item_id uuid REFERENCES tenant.items(id) ON DELETE RESTRICT;
ALTER TABLE tenant.sales_pricing_rules ADD COLUMN IF NOT EXISTS free_quantity numeric(24,10);
ALTER TABLE tenant.sales_pricing_rules DROP CONSTRAINT IF EXISTS sales_pricing_rules_free_goods_check;
ALTER TABLE tenant.sales_pricing_rules ADD CONSTRAINT sales_pricing_rules_free_goods_check
  CHECK (adjustment_type <> 'free_goods' OR (free_quantity > 0 AND minimum_quantity > 0 AND (free_item_id IS NOT NULL OR item_id IS NOT NULL)));
ALTER TABLE tenant.sales_quotation_lines ADD COLUMN IF NOT EXISTS scheme_rule_id uuid REFERENCES tenant.sales_pricing_rules(id) ON DELETE RESTRICT;
ALTER TABLE tenant.sales_order_lines ADD COLUMN IF NOT EXISTS scheme_rule_id uuid REFERENCES tenant.sales_pricing_rules(id) ON DELETE RESTRICT;

-- 5. An e-way bill from a sales invoice (M2). Most businesses generate it from the tax invoice, and a company billing goods without the
--    Stock app has no delivery to generate it from. source_id is the invoice (accounting_customer_invoices.id).
ALTER TABLE tenant.eway_bills DROP CONSTRAINT IF EXISTS eway_bills_source_type_check;
ALTER TABLE tenant.eway_bills ADD CONSTRAINT eway_bills_source_type_check CHECK (source_type IN ('sales_delivery', 'stock_transfer', 'purchase_return', 'sales_invoice'));

-- 6. Payments recorded from Sales (B7): the invoice's Record Payment writes and applies the receipt even without the Accounting app.
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('sales.invoice.record_payment', 'Record payments on invoices', 'Sales', 'Record a customer''s payment against a posted invoice, into a bank or cash account.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.invoice.record_payment' FROM public.role_permissions existing
 WHERE existing.permission_key IN ('sales.invoice.post', 'accounting.receipts.manage')
ON CONFLICT DO NOTHING;

-- 7. Shared pricing: price lists serve Sales and Point of Sale, so a POS-only company sets its own selling prices. Whoever manages POS settings
--    maintains price lists; whoever operates a POS sees them.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.price_lists.view', 'sales.price_lists.create', 'sales.price_lists.edit', 'sales.price_lists.manage_prices',
    'sales.price_lists.activate', 'sales.price_lists.set_default', 'sales.price_lists.change_tax_mode', 'sales.price_lists.import', 'sales.price_lists.export'])
 WHERE existing.permission_key = 'pos.settings.manage'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.price_lists.view' FROM public.role_permissions existing WHERE existing.permission_key = 'pos.operate'
ON CONFLICT DO NOTHING;

-- 8. Documents sent on WhatsApp (M6): a quotation records WhatsApp as how it was sent.
ALTER TABLE tenant.sales_quotations DROP CONSTRAINT IF EXISTS sales_quotations_sent_channel_check;
ALTER TABLE tenant.sales_quotations ADD CONSTRAINT sales_quotations_sent_channel_check CHECK (sent_channel IS NULL OR sent_channel IN ('email', 'manual', 'link', 'whatsapp'));

-- 9. A new company starts with no discount approval for quotations (it was 10%: approvals on day one surprised new companies). Companies
--    that already have Sales settings keep theirs.
ALTER TABLE tenant.sales_settings ALTER COLUMN quotation_approval_discount SET DEFAULT 0;

-- 10. Salesperson targets on invoiced value (should-have): the monthly targets CRM keeps, with a measure for what was billed (company currency).
ALTER TABLE tenant.crm_sales_targets DROP CONSTRAINT IF EXISTS crm_sales_targets_metric_check;
ALTER TABLE tenant.crm_sales_targets ADD CONSTRAINT crm_sales_targets_metric_check CHECK (metric IN ('won_value', 'won_count', 'new_leads', 'activities', 'invoiced_value'));

-- 11. MRP and price lists by channel and region (should-have). Indian FMCG invoices print the MRP; a product keeps its MRP (per base unit,
--     tax included) and every quotation, order and invoice line carries it for its unit, so the retailer's margin can be shown. A customer
--     belongs to a sales channel (general trade, modern trade, HoReCa…); a price list can be for a channel and/or a state, and a customer
--     without a list of its own is priced from the list for its channel and state before the company default.
ALTER TABLE tenant.items ADD COLUMN IF NOT EXISTS mrp numeric(18,4);
ALTER TABLE tenant.items DROP CONSTRAINT IF EXISTS items_mrp_check;
ALTER TABLE tenant.items ADD CONSTRAINT items_mrp_check CHECK (mrp IS NULL OR mrp > 0);
ALTER TABLE tenant.sales_quotation_lines ADD COLUMN IF NOT EXISTS mrp numeric(18,4);
ALTER TABLE tenant.sales_order_lines ADD COLUMN IF NOT EXISTS mrp numeric(18,4);
ALTER TABLE tenant.sales_invoice_lines ADD COLUMN IF NOT EXISTS mrp numeric(18,4);
ALTER TABLE tenant.business_parties ADD COLUMN IF NOT EXISTS sales_channel text;
ALTER TABLE tenant.business_parties DROP CONSTRAINT IF EXISTS business_parties_sales_channel_check;
ALTER TABLE tenant.business_parties ADD CONSTRAINT business_parties_sales_channel_check
  CHECK (sales_channel IS NULL OR sales_channel IN ('general_trade', 'modern_trade', 'horeca', 'institutional', 'ecommerce', 'distributor', 'export', 'other'));
ALTER TABLE tenant.price_lists ADD COLUMN IF NOT EXISTS applies_to_channel text;
ALTER TABLE tenant.price_lists DROP CONSTRAINT IF EXISTS price_lists_applies_to_channel_check;
ALTER TABLE tenant.price_lists ADD CONSTRAINT price_lists_applies_to_channel_check
  CHECK (applies_to_channel IS NULL OR applies_to_channel IN ('general_trade', 'modern_trade', 'horeca', 'institutional', 'ecommerce', 'distributor', 'export', 'other'));
ALTER TABLE tenant.price_lists ADD COLUMN IF NOT EXISTS applies_to_state_code text;
ALTER TABLE tenant.price_lists DROP CONSTRAINT IF EXISTS price_lists_applies_to_state_code_check;
ALTER TABLE tenant.price_lists ADD CONSTRAINT price_lists_applies_to_state_code_check CHECK (applies_to_state_code IS NULL OR applies_to_state_code ~ '^[0-9]{2}$');
