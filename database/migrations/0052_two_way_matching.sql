-- 2-Way Matching: a supplier bill against its confirmed purchase order — supplier, buying company, currency, the order's status, each line's
-- product, unit, quantity within the remaining commitment, and its net value against the agreed price and discounts. Not a new document: the
-- result belongs to the supplier bill.
--
--  * supplier_bill_match_evaluations: each evaluation of a bill (draft previews, and the one that authorised posting — posting evidence, which
--    can never change). It records the order revision it was checked against.
--  * supplier_bill_match_line_results: per bill line, the order's figures and the bill's, the difference and the discrepancy codes.
--  * supplier_bill_match_exceptions: a supported commercial variance (price, discount, an extra charge) accepted by someone allowed to, with the
--    reason, the expected and actual values and the accounting treatment. It holds only while the line stays as approved: any change expires it.
--  * the bill keeps its current result (Matched / Mismatch / Approved exception / Not checked / Not applicable) and what the supplier invoiced
--    in its own unit of measure and discount.

CREATE TABLE IF NOT EXISTS tenant.supplier_bill_match_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_bill_id uuid NOT NULL,
  purchase_order_id uuid,
  purchase_order_revision integer,
  matching_type text NOT NULL DEFAULT 'two_way' CHECK (matching_type IN ('two_way')),
  result text NOT NULL CHECK (result IN ('matched', 'mismatch', 'approved_exception', 'not_applicable')),
  expected_amount numeric(24,6) NOT NULL DEFAULT 0,
  actual_amount numeric(24,6) NOT NULL DEFAULT 0,
  variance_amount numeric(24,6) NOT NULL DEFAULT 0,
  header_checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  discrepancies jsonb NOT NULL DEFAULT '[]'::jsonb,
  posted_evidence boolean NOT NULL DEFAULT false,
  evaluated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, vendor_bill_id) REFERENCES tenant.accounting_vendor_bills(organization_id, id)
);
CREATE INDEX IF NOT EXISTS supplier_bill_match_evaluations_bill_idx ON tenant.supplier_bill_match_evaluations (organization_id, vendor_bill_id, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS tenant.supplier_bill_match_line_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  evaluation_id uuid NOT NULL,
  line_sequence integer NOT NULL,
  vendor_bill_line_id uuid,
  purchase_order_line_id uuid,
  billing_basis text NOT NULL DEFAULT 'quantity',
  po_ordered_quantity numeric(24,10),
  po_cancelled_quantity numeric(24,10),
  previously_billed_quantity numeric(24,10),
  remaining_eligible_quantity numeric(24,10),
  bill_quantity numeric(24,10),
  agreed_amount numeric(24,6),
  previously_billed_amount numeric(24,6),
  remaining_eligible_amount numeric(24,6),
  expected_unit_price numeric(24,10),
  actual_unit_price numeric(24,10),
  expected_net_amount numeric(24,6),
  actual_net_amount numeric(24,6),
  variance_amount numeric(24,6),
  expected_tax_amount numeric(24,6),
  actual_tax_amount numeric(24,6),
  discrepancy_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  result text NOT NULL CHECK (result IN ('matched', 'mismatch', 'approved_exception')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (organization_id, evaluation_id) REFERENCES tenant.supplier_bill_match_evaluations(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS supplier_bill_match_line_results_evaluation_idx ON tenant.supplier_bill_match_line_results (organization_id, evaluation_id, line_sequence);

CREATE TABLE IF NOT EXISTS tenant.supplier_bill_match_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_bill_id uuid NOT NULL,
  evaluation_id uuid,
  line_sequence integer,
  purchase_order_line_id uuid,
  discrepancy_code text NOT NULL,
  expected_value numeric(24,6),
  actual_value numeric(24,6),
  variance_amount numeric(24,6),
  fingerprint text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 10),
  accounting_treatment text NOT NULL CHECK (accounting_treatment IN ('purchase_price_variance', 'line_cost', 'charge_expense')),
  account_id uuid,
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'expired')),
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  expired_at timestamptz,
  FOREIGN KEY (organization_id, vendor_bill_id) REFERENCES tenant.accounting_vendor_bills(organization_id, id)
);
CREATE INDEX IF NOT EXISTS supplier_bill_match_exceptions_bill_idx ON tenant.supplier_bill_match_exceptions (organization_id, vendor_bill_id, status);

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['supplier_bill_match_evaluations', 'supplier_bill_match_line_results', 'supplier_bill_match_exceptions'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', name);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;

-- The evaluation that authorised a posting is evidence: it and its line results are never changed or removed.
CREATE OR REPLACE FUNCTION tenant.supplier_bill_match_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'supplier_bill_match_evaluations' THEN
    IF OLD.posted_evidence THEN RAISE EXCEPTION 'Posted matching evidence cannot be changed.' USING ERRCODE = 'P0001'; END IF;
  ELSIF EXISTS (SELECT 1 FROM tenant.supplier_bill_match_evaluations evaluation WHERE evaluation.id = OLD.evaluation_id AND evaluation.posted_evidence) THEN
    RAISE EXCEPTION 'Posted matching evidence cannot be changed.' USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'supplier_bill_match_evaluations_immutable') THEN
    CREATE TRIGGER supplier_bill_match_evaluations_immutable BEFORE UPDATE OR DELETE ON tenant.supplier_bill_match_evaluations
      FOR EACH ROW EXECUTE FUNCTION tenant.supplier_bill_match_evidence_immutable();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'supplier_bill_match_line_results_immutable') THEN
    CREATE TRIGGER supplier_bill_match_line_results_immutable BEFORE UPDATE OR DELETE ON tenant.supplier_bill_match_line_results
      FOR EACH ROW EXECUTE FUNCTION tenant.supplier_bill_match_evidence_immutable();
  END IF;
END $$;

-- The bill's current result (NULL on bills recorded before 2-Way Matching: derived from matching_status when read).
ALTER TABLE tenant.accounting_vendor_bills
  ADD COLUMN IF NOT EXISTS two_way_result text,
  ADD COLUMN IF NOT EXISTS two_way_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS two_way_evaluation_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_vendor_bills_two_way_result_check') THEN
    ALTER TABLE tenant.accounting_vendor_bills ADD CONSTRAINT accounting_vendor_bills_two_way_result_check
      CHECK (two_way_result IS NULL OR two_way_result IN ('matched', 'mismatch', 'approved_exception', 'not_applicable'));
  END IF;
END $$;

-- What the supplier invoiced, as invoiced: its unit (normalised to the order's unit for matching) and an explicit invoice discount.
ALTER TABLE tenant.accounting_vendor_bill_lines
  ADD COLUMN IF NOT EXISTS invoiced_uom_id uuid,
  ADD COLUMN IF NOT EXISTS invoiced_quantity numeric(24,10),
  ADD COLUMN IF NOT EXISTS invoiced_unit_price numeric(24,10),
  ADD COLUMN IF NOT EXISTS invoice_discount_type text,
  ADD COLUMN IF NOT EXISTS invoice_discount_value numeric(24,6);

-- Accepting a commercial variance: purchasing managers already may; Finance's payables approvers too (they own its accounting).
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'procurement.matching.override' FROM public.role_permissions existing
 WHERE existing.permission_key = 'accounting.payables.approve'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0052_two_way_matching.sql', 'two-way-matching');
