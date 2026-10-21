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
