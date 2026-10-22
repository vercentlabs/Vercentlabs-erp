-- Procurement Module — Implementation Plan (22 Oct 2026): fix what is broken, navigation and daily screens, indent, RFQ, returns
-- compliance, rate contracts and registers. Additive and re-runnable.

-- ------------------------------------------------------------------ Phase 0 — TDS by the law's basis
-- 1. How much of a bill a section taxes: the whole bill once a limit is crossed (full), or only the part of the year's bills above the
--    yearly limit (excess_over_annual — 194Q, 0.1% on purchases above ₹50 lakh).
ALTER TABLE tenant.withholding_tax_sections ADD COLUMN IF NOT EXISTS basis text NOT NULL DEFAULT 'full';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'withholding_tax_sections_basis_check') THEN
    ALTER TABLE tenant.withholding_tax_sections ADD CONSTRAINT withholding_tax_sections_basis_check CHECK (basis IN ('full', 'excess_over_annual'));
  END IF;
END;
$$;
UPDATE tenant.withholding_tax_sections SET basis = 'excess_over_annual' WHERE upper(code) = '194Q' AND basis = 'full';
-- 194Q's no-PAN rate is 5% (s.206AA), not the general 20%.
UPDATE tenant.withholding_tax_sections SET rate_no_pan = 5 WHERE upper(code) = '194Q' AND rate_no_pan IS NULL;

-- 2. A bill line withholds at an effective rate (194Q's excess, 194C's catch-up), kept to six decimals.
ALTER TABLE tenant.accounting_vendor_bill_lines ALTER COLUMN withholding_rate TYPE numeric(12,6);

-- 3. The standard TDS sections, so a company does not type them in (Procurement plan Phase 1). Rates and limits as from 1 April 2025;
--    each stays editable, and a code the company already has is left as it is.
CREATE OR REPLACE FUNCTION tenant.seed_tds_sections(p_organization_id uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  actor uuid := COALESCE(p_actor, (SELECT created_by FROM public.organizations WHERE id = p_organization_id));
BEGIN
  INSERT INTO tenant.withholding_tax_sections (organization_id, code, name, rate, status, threshold_single, threshold_annual, rate_individual, rate_no_pan, basis, created_by)
  SELECT p_organization_id, section.code, section.name, section.rate, 'active', section.single, section.annual, section.individual, section.no_pan, section.basis, actor
    FROM (VALUES
      ('194C', 'Payments to contractors', 2::numeric, 30000::numeric, 100000::numeric, 1::numeric, 20::numeric, 'full'),
      ('194J(a)', 'Fees for technical services', 2, 50000, NULL, NULL, 20, 'full'),
      ('194J(b)', 'Fees for professional services', 10, 50000, NULL, NULL, 20, 'full'),
      ('194I(a)', 'Rent of plant and machinery', 2, 50000, NULL, NULL, 20, 'full'),
      ('194I(b)', 'Rent of land and buildings', 10, 50000, NULL, NULL, 20, 'full'),
      ('194H', 'Commission and brokerage', 2, NULL, 20000, NULL, 20, 'full'),
      ('194Q', 'Purchase of goods (above ₹50 lakh a year)', 0.1, NULL, 5000000, NULL, 5, 'excess_over_annual')
    ) AS section (code, name, rate, single, annual, individual, no_pan, basis)
   WHERE NOT EXISTS (SELECT 1 FROM tenant.withholding_tax_sections existing WHERE existing.organization_id = p_organization_id AND upper(existing.code) = upper(section.code));
END;
$$;
GRANT EXECUTE ON FUNCTION tenant.seed_tds_sections(uuid, uuid) TO vercent_app;

DO $$
DECLARE
  organization record;
BEGIN
  FOR organization IN SELECT id, created_by FROM public.organizations LOOP
    PERFORM tenant.seed_tds_sections(organization.id, organization.created_by);
  END LOOP;
END;
$$;

-- ------------------------------------------------------------------ Phase 2 — the front of the funnel and returns compliance
-- 4. Settings: purchase indents and RFQs are optional per company (off for existing companies, on for new ones — see starter data), and
--    what a reorder opens when indents are on.
ALTER TABLE tenant.procurement_settings ADD COLUMN IF NOT EXISTS use_indents boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.procurement_settings ADD COLUMN IF NOT EXISTS use_rfqs boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.procurement_settings ADD COLUMN IF NOT EXISTS reorder_creates text NOT NULL DEFAULT 'purchase_order';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_settings_reorder_creates_check') THEN
    ALTER TABLE tenant.procurement_settings ADD CONSTRAINT procurement_settings_reorder_creates_check CHECK (reorder_creates IN ('purchase_order', 'indent'));
  END IF;
END;
$$;

-- 5. Purchase indents: a department or the store asks for items by a date; the head approves; the buyer turns approved lines into an RFQ
--    or a purchase order. What is ordered is read from the order lines that name the indent line (never stored twice).
CREATE TABLE IF NOT EXISTS tenant.purchase_indents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  indent_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'closed', 'cancelled')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'reorder', 'material_demand')),
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  department_id uuid,
  cost_center_id uuid,
  warehouse_id uuid,
  required_by date,
  purpose text,
  notes text,
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decision_note text,
  closed_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, indent_number),
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS purchase_indents_status_idx ON tenant.purchase_indents (organization_id, status, required_by);

CREATE TABLE IF NOT EXISTS tenant.purchase_indent_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  indent_id uuid NOT NULL,
  line_number integer NOT NULL,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  description text,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  uom_id uuid REFERENCES tenant.units_of_measure(id),
  required_by date,
  warehouse_id uuid,
  cost_center_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, indent_id, line_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, indent_id) REFERENCES tenant.purchase_indents(organization_id, id) ON DELETE CASCADE
);

-- 6. RFQs: one request to several suppliers; each supplier's answer is an ordinary supplier quotation linked to the RFQ (and each quoted
--    line to the RFQ line), compared side by side and awarded per line or whole.
CREATE TABLE IF NOT EXISTS tenant.purchase_rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rfq_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'awarded', 'closed', 'cancelled')),
  title text,
  response_due_date date,
  currency_code char(3) NOT NULL DEFAULT 'INR',
  warehouse_id uuid,
  notes text,
  sent_at timestamptz,
  awarded_at timestamptz,
  awarded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, rfq_number),
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS purchase_rfqs_status_idx ON tenant.purchase_rfqs (organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant.purchase_rfq_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rfq_id uuid NOT NULL,
  line_number integer NOT NULL,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  description text,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  uom_id uuid REFERENCES tenant.units_of_measure(id),
  required_by date,
  indent_line_id uuid,
  awarded_quotation_line_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, rfq_id, line_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, rfq_id) REFERENCES tenant.purchase_rfqs(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.purchase_rfq_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rfq_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'sent', 'responded', 'declined')),
  sent_at timestamptz,
  declined_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, rfq_id, supplier_id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, rfq_id) REFERENCES tenant.purchase_rfqs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, supplier_id) REFERENCES tenant.procurement_suppliers(organization_id, id)
);

ALTER TABLE tenant.supplier_quotations ADD COLUMN IF NOT EXISTS rfq_id uuid;
-- Freight and other charges the supplier adds to the quotation, so the comparison shows the landed rate.
ALTER TABLE tenant.supplier_quotations ADD COLUMN IF NOT EXISTS freight_amount numeric(20,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.supplier_quotation_lines ADD COLUMN IF NOT EXISTS rfq_line_id uuid;
CREATE INDEX IF NOT EXISTS supplier_quotations_rfq_idx ON tenant.supplier_quotations (organization_id, rfq_id) WHERE rfq_id IS NOT NULL;
-- A purchase order line ordered for an indent line.
ALTER TABLE tenant.purchase_order_lines ADD COLUMN IF NOT EXISTS source_indent_line_id uuid;
CREATE INDEX IF NOT EXISTS purchase_order_lines_indent_idx ON tenant.purchase_order_lines (organization_id, source_indent_line_id) WHERE source_indent_line_id IS NOT NULL;

-- 7. Goods going back to a supplier move under a delivery challan (rule 55) and, above 50,000 rupees, an e-way bill; goods coming in carry
--    the supplier's e-way bill, recorded on the GRN.
ALTER TABLE tenant.purchase_returns ADD COLUMN IF NOT EXISTS ewb_number text;
ALTER TABLE tenant.purchase_returns ADD COLUMN IF NOT EXISTS ewb_valid_until timestamptz;
ALTER TABLE tenant.purchase_returns ADD COLUMN IF NOT EXISTS vehicle_number text;
ALTER TABLE tenant.purchase_returns ADD COLUMN IF NOT EXISTS transporter_id text;
ALTER TABLE tenant.purchase_returns ADD COLUMN IF NOT EXISTS transporter_name text;
ALTER TABLE tenant.purchase_returns ADD COLUMN IF NOT EXISTS transport_distance_km integer;
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS ewb_number text;
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS ewb_valid_until timestamptz;
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS transporter_id text;

-- 8. TCS a supplier collects (s.206C): outside the taxable value, added to what is owed, booked as TCS receivable.
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS tcs_amount numeric(20,6) NOT NULL DEFAULT 0;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_indents', 'purchase_indent_lines', 'purchase_rfqs', 'purchase_rfq_lines', 'purchase_rfq_suppliers'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = t AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', t);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', t);
  END LOOP;
END $$;

-- 9. A reorder that opens an indent records it as the action taken.
ALTER TABLE tenant.inventory_replenishment_recommendations DROP CONSTRAINT IF EXISTS inventory_replenishment_recommendati_action_document_type_check;
ALTER TABLE tenant.inventory_replenishment_recommendations ADD CONSTRAINT inventory_replenishment_recommendati_action_document_type_check
  CHECK (action_document_type IS NULL OR action_document_type IN ('purchase_order', 'inventory_transfer', 'purchase_indent'));

-- 10. The TCS receivable account (1425) every ledger books the TCS its suppliers collect to, mapped as tcs_receivable.
DO $$
DECLARE
  ledger record;
  parent_id uuid;
  account_id uuid;
BEGIN
  FOR ledger IN SELECT accounting_ledger.id, accounting_ledger.organization_id FROM tenant.accounting_ledgers accounting_ledger WHERE accounting_ledger.status = 'active' LOOP
    SELECT id INTO parent_id FROM tenant.accounting_accounts WHERE organization_id = ledger.organization_id AND ledger_id = ledger.id AND code = '1000' AND is_group;
    INSERT INTO tenant.accounting_accounts (organization_id, ledger_id, parent_id, code, name, account_class, account_type, normal_balance, is_group,
                                            allow_manual_posting, reconciliation_required, status)
    VALUES (ledger.organization_id, ledger.id, parent_id, '1425', 'TCS receivable (collected by suppliers)', 'asset', 'current_asset', 'debit', false, false, true, 'active')
    ON CONFLICT (organization_id, ledger_id, code) DO NOTHING;
    SELECT id INTO account_id FROM tenant.accounting_accounts
     WHERE organization_id = ledger.organization_id AND ledger_id = ledger.id AND code = '1425' AND account_class = 'asset' AND NOT is_group AND status = 'active';
    IF account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant.accounting_account_mappings
        WHERE organization_id = ledger.organization_id AND ledger_id = ledger.id AND mapping_key = 'tcs_receivable') THEN
      INSERT INTO tenant.accounting_account_mappings (organization_id, ledger_id, mapping_key, account_id, priority, status)
      VALUES (ledger.organization_id, ledger.id, 'tcs_receivable', account_id, 1000, 'active');
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------------ Phase 3 — contracts, landed cost, registers and compliance
-- 11. Rate contracts: a supplier's agreed rate for items over a period, optionally capped by quantity or value. An order line for a
--     contracted item takes the contract rate and records the contract line it draws from; what was drawn is read from those lines.
CREATE TABLE IF NOT EXISTS tenant.purchase_rate_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_number text NOT NULL,
  supplier_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'expired', 'cancelled')),
  valid_from date NOT NULL,
  valid_to date NOT NULL,
  currency_code char(3) NOT NULL DEFAULT 'INR',
  supplier_reference text,
  notes text,
  activated_at timestamptz,
  activated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to >= valid_from),
  UNIQUE (organization_id, contract_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES tenant.procurement_suppliers(organization_id, id)
);
CREATE INDEX IF NOT EXISTS purchase_rate_contracts_supplier_idx ON tenant.purchase_rate_contracts (organization_id, supplier_id, status, valid_to);

CREATE TABLE IF NOT EXISTS tenant.purchase_rate_contract_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL,
  line_number integer NOT NULL,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  uom_id uuid REFERENCES tenant.units_of_measure(id),
  rate numeric(20,6) NOT NULL CHECK (rate >= 0),
  max_quantity numeric(20,6) CHECK (max_quantity IS NULL OR max_quantity > 0),
  max_value numeric(20,2) CHECK (max_value IS NULL OR max_value > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, contract_id, line_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, contract_id) REFERENCES tenant.purchase_rate_contracts(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS purchase_rate_contract_lines_item_idx ON tenant.purchase_rate_contract_lines (organization_id, item_id);
ALTER TABLE tenant.purchase_order_lines ADD COLUMN IF NOT EXISTS source_rate_contract_line_id uuid;
CREATE INDEX IF NOT EXISTS purchase_order_lines_contract_idx ON tenant.purchase_order_lines (organization_id, source_rate_contract_line_id) WHERE source_rate_contract_line_id IS NOT NULL;

-- 12. Landed cost: freight, loading or insurance on a posted bill shared over goods receipt lines by value or quantity; the part of the
--     goods still in stock raises their value (a valuation restatement and a journal from the charge's account to Inventory).
CREATE TABLE IF NOT EXISTS tenant.procurement_bill_landed_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_bill_id uuid NOT NULL,
  vendor_bill_line_id uuid NOT NULL,
  basis text NOT NULL CHECK (basis IN ('value', 'quantity')),
  amount numeric(20,2) NOT NULL CHECK (amount > 0),
  stock_amount numeric(20,2) NOT NULL DEFAULT 0,
  journal_entry_id uuid,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS procurement_bill_landed_costs_bill_idx ON tenant.procurement_bill_landed_costs (organization_id, vendor_bill_id);
CREATE TABLE IF NOT EXISTS tenant.procurement_bill_landed_cost_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  landed_cost_id uuid NOT NULL,
  goods_receipt_line_id uuid NOT NULL,
  amount numeric(20,2) NOT NULL,
  stock_amount numeric(20,2) NOT NULL DEFAULT 0,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, landed_cost_id) REFERENCES tenant.procurement_bill_landed_costs(organization_id, id) ON DELETE CASCADE
);

-- 13. Reverse charge: the self-invoice the buyer raises for a supply taxed on them (s.31(3)(f)), numbered in its own series.
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS rcm_self_invoice_number text;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS rcm_self_invoice_date date;

-- 14. How much more than ordered a goods receipt may take, per item group (0 = never more than ordered).
ALTER TABLE tenant.item_groups ADD COLUMN IF NOT EXISTS excess_receipt_tolerance_percent numeric(6,3) NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_groups_excess_receipt_tolerance_check') THEN
    ALTER TABLE tenant.item_groups ADD CONSTRAINT item_groups_excess_receipt_tolerance_check CHECK (excess_receipt_tolerance_percent >= 0 AND excess_receipt_tolerance_percent <= 100);
  END IF;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_rate_contracts', 'purchase_rate_contract_lines', 'procurement_bill_landed_costs', 'procurement_bill_landed_cost_allocations'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = t AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', t);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', t);
  END LOOP;
END $$;

-- 15. A supplier's link to a purchase order's PDF, shared on WhatsApp: the token is the only credential (kept hashed for lookup and
--     encrypted so the same link is given every time); revoking it ends it.
CREATE TABLE IF NOT EXISTS tenant.procurement_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('purchase_order')),
  document_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_encrypted jsonb NOT NULL,
  view_count integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS procurement_share_links_live_uidx ON tenant.procurement_share_links (organization_id, document_type, document_id) WHERE revoked_at IS NULL;
ALTER TABLE tenant.procurement_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_share_links FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'procurement_share_links' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.procurement_share_links USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.procurement_share_links TO vercent_app;
GRANT SELECT ON tenant.procurement_share_links TO vercent_worker;
CREATE OR REPLACE FUNCTION tenant.procurement_resolve_document_link(token_hash_in text)
RETURNS TABLE(organization_id uuid, document_type text, document_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'tenant', 'public', 'pg_temp'
AS $$
  SELECT link.organization_id, link.document_type, link.document_id FROM tenant.procurement_share_links link WHERE link.token_hash = token_hash_in AND link.revoked_at IS NULL LIMIT 1
$$;
REVOKE ALL ON FUNCTION tenant.procurement_resolve_document_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant.procurement_resolve_document_link(text) TO vercent_app, vercent_worker;
