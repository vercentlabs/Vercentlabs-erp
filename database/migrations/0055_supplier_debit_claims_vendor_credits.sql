-- Supplier Debit Notes & Vendor Credits. Asking for a credit, the supplier's credit, the payable it reduces and the money that comes back are
-- separate events — and separate records:
--
--  * supplier_debit_claims: the buyer's debit note to the supplier — a documented commercial claim (returned goods, overbilling, a price
--    correction, a deficient service). Draft → issued → the supplier's response (accepted, partly accepted, rejected) → resolved by a vendor
--    credit, or closed. A claim never touches the payable, tax or the bill.
--  * vendor credits: Finance's credit note documents (accounting_vendor_bills, bill_type 'credit_note') — the financial credit, posted
--    through Finance. They now say where they come from (the supplier's credit note, an accepted claim, another authorised basis), their
--    supplier credit note date, whether they adjust GST or are financial only, and per line the reason, quantity or amount basis and the
--    purchase return line they credit. One credit may correct lines of several bills; a credit may also stay on account.
--  * accounting_vendor_credit_refunds: money the supplier actually paid back against a posted credit (Finance: Dr bank, Cr payable).
-- Applying credits to bills uses Finance's existing credit allocations.

CREATE TABLE IF NOT EXISTS tenant.supplier_debit_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  claim_number text NOT NULL,
  supplier_id uuid NOT NULL,
  party_id uuid NOT NULL,
  buying_registration_id uuid,
  currency_code char(3) NOT NULL,
  issue_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'accepted', 'partially_accepted', 'rejected', 'resolved', 'closed')),
  reason text NOT NULL,
  claimed_amount numeric(24,6) NOT NULL DEFAULT 0,
  accepted_amount numeric(24,6) NOT NULL DEFAULT 0,
  rejected_amount numeric(24,6) NOT NULL DEFAULT 0,
  supplier_reference text,
  supplier_snapshot jsonb,
  purchase_return_id uuid,
  notes text,
  issued_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  issued_at timestamptz,
  closed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  close_reason text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, claim_number),
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS supplier_debit_claims_supplier_idx ON tenant.supplier_debit_claims (organization_id, supplier_id, status);

CREATE TABLE IF NOT EXISTS tenant.supplier_debit_claim_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL,
  line_number integer NOT NULL,
  supplier_bill_id uuid,
  supplier_bill_line_id uuid,
  purchase_return_line_id uuid,
  reason text NOT NULL,
  description text NOT NULL,
  basis text NOT NULL DEFAULT 'amount' CHECK (basis IN ('quantity', 'amount')),
  quantity numeric(24,10),
  unit_value numeric(24,10),
  amount numeric(24,6) NOT NULL CHECK (amount > 0),
  tax_amount numeric(24,6) NOT NULL DEFAULT 0,
  total numeric(24,6) NOT NULL,
  notes text,
  FOREIGN KEY (organization_id, claim_id) REFERENCES tenant.supplier_debit_claims(organization_id, id) ON DELETE CASCADE
);

-- The supplier's decisions, as recorded: never an editable accepted balance.
CREATE TABLE IF NOT EXISTS tenant.supplier_debit_claim_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('accepted', 'partially_accepted', 'rejected')),
  accepted_amount numeric(24,6) NOT NULL DEFAULT 0,
  rejected_amount numeric(24,6) NOT NULL DEFAULT 0,
  supplier_reference text,
  responded_on date,
  notes text,
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, claim_id) REFERENCES tenant.supplier_debit_claims(organization_id, id)
);

CREATE TABLE IF NOT EXISTS tenant.supplier_debit_claim_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL,
  event_type text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, claim_id) REFERENCES tenant.supplier_debit_claims(organization_id, id)
);

-- Vendor credits: Finance's credit notes, with what makes them a vendor credit.
ALTER TABLE tenant.accounting_vendor_bills
  ADD COLUMN IF NOT EXISTS credit_origin text,
  ADD COLUMN IF NOT EXISTS supplier_credit_note_date date,
  ADD COLUMN IF NOT EXISTS tax_treatment text,
  ADD COLUMN IF NOT EXISTS debit_claim_id uuid,
  ADD COLUMN IF NOT EXISTS credit_authorization_reason text,
  ADD COLUMN IF NOT EXISTS credit_authorized_by uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_vendor_bills_credit_origin_check') THEN
    ALTER TABLE tenant.accounting_vendor_bills ADD CONSTRAINT accounting_vendor_bills_credit_origin_check
      CHECK (credit_origin IS NULL OR credit_origin IN ('supplier_credit_note', 'accepted_claim', 'other_authorized'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_vendor_bills_tax_treatment_check') THEN
    ALTER TABLE tenant.accounting_vendor_bills ADD CONSTRAINT accounting_vendor_bills_tax_treatment_check
      CHECK (tax_treatment IS NULL OR tax_treatment IN ('gst_adjusting', 'financial_only'));
  END IF;
END $$;
ALTER TABLE tenant.accounting_vendor_bill_lines
  ADD COLUMN IF NOT EXISTS credit_reason text,
  ADD COLUMN IF NOT EXISTS credit_basis text,
  ADD COLUMN IF NOT EXISTS purchase_return_line_id uuid;

-- Money the supplier paid back against a posted vendor credit.
CREATE TABLE IF NOT EXISTS tenant.accounting_vendor_credit_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  credit_note_id uuid NOT NULL,
  refund_number text NOT NULL,
  amount numeric(24,6) NOT NULL CHECK (amount > 0),
  refund_date date NOT NULL,
  bank_account_id uuid,
  reference text,
  journal_entry_id uuid,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  reversal_journal_entry_id uuid,
  reversed_at timestamptz,
  reversal_reason text,
  idempotency_key text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, refund_number),
  FOREIGN KEY (organization_id, credit_note_id) REFERENCES tenant.accounting_vendor_bills(organization_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_vendor_credit_refunds_idempotency ON tenant.accounting_vendor_credit_refunds (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['supplier_debit_claims', 'supplier_debit_claim_lines', 'supplier_debit_claim_responses', 'supplier_debit_claim_events', 'accounting_vendor_credit_refunds'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', name);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('procurement.claims.view', 'View debit notes to suppliers', 'Procurement', 'See the commercial claims raised with suppliers.'),
  ('procurement.claims.manage', 'Raise debit notes to suppliers', 'Procurement', 'Draft, issue and close commercial claims to suppliers.'),
  ('procurement.claims.respond', 'Record supplier responses to claims', 'Procurement', 'Record a supplier accepting, partly accepting or rejecting a claim.'),
  ('procurement.credits.manage', 'Prepare vendor credits', 'Procurement', 'Record draft vendor credits from supplier credit notes, bills, returns and accepted claims.'),
  ('procurement.credits.exceptional', 'Approve vendor credits without a supplier credit note', 'Procurement', 'Recognise an on-account credit on another documented, authorised basis.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, granted.key FROM public.role_permissions existing
  JOIN (VALUES
    ('procurement.po.view', 'procurement.claims.view'), ('procurement.po.view_all', 'procurement.claims.view'), ('accounting.payables.manage', 'procurement.claims.view'),
    ('procurement.po.manage', 'procurement.claims.manage'), ('accounting.payables.manage', 'procurement.claims.manage'),
    ('procurement.po.manage', 'procurement.claims.respond'), ('accounting.payables.manage', 'procurement.claims.respond'),
    ('accounting.payables.manage', 'procurement.credits.manage'), ('procurement.po.manage', 'procurement.credits.manage'),
    ('accounting.payables.approve', 'procurement.credits.exceptional')
  ) AS granted(source, key) ON granted.source = existing.permission_key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0055_supplier_debit_claims_vendor_credits.sql', 'supplier-debit-claims-vendor-credits');
