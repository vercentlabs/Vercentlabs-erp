-- Supplier Bills: the supplier's financial claim, recorded once as Finance's
-- Accounts Payable document (tenant.accounting_vendor_bills, bill_type
-- 'bill'), created in Procurement from a purchase order, from goods receipts,
-- or directly for an expense. Finance owns the payable, the journals, the tax
-- ledger, approvals, payments and credits; Procurement owns sourcing and
-- matching. Debit notes are Finance credit notes (bill_type 'credit_note')
-- against a bill. Nothing here moves stock.
--
-- The supplier's invoice number is kept exactly as supplied
-- (supplier_invoice_reference). Duplicates are prevented on a normalized key
-- (number without whitespace, case-folded, with the issuing GSTIN and the
-- financial year) once a bill leaves draft. supplier_invoice_number and its
-- index (migration 0045) are no longer written: they are left unused.

ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS supplier_invoice_reference text;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS supplier_invoice_key text;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS duplicate_override_reason text;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS duplicate_override_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS supplier_id uuid;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS source_type text CHECK (source_type IS NULL OR source_type IN ('purchase_order', 'goods_receipt', 'direct'));
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS supplier_tax_registration_id uuid;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS supplier_tax_snapshot jsonb;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS supplier_address_snapshot jsonb;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS buying_registration_id uuid REFERENCES tenant.tax_registrations(id);
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS buying_registration_snapshot jsonb;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS place_of_supply text;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS supply_nature text;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS reverse_charge boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS price_mode text NOT NULL DEFAULT 'exclusive' CHECK (price_mode IN ('exclusive', 'inclusive'));
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS document_discount_type text CHECK (document_discount_type IS NULL OR document_discount_type IN ('percent', 'amount'));
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS document_discount_value numeric(24,6) NOT NULL DEFAULT 0 CHECK (document_discount_value >= 0);
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS taxable_total numeric(24,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS invoice_total numeric(24,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS supplier_stated_total numeric(24,6);
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS reverse_charge_tax_total numeric(24,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS reverse_charge_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id);
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS payment_term_id uuid;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS withholding_section_id uuid;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS reversal_reason text;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS reversal_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id);
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS debit_note_reason text;
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS source_purchase_return_id uuid;
ALTER TABLE tenant.accounting_vendor_bills ADD CONSTRAINT accounting_vendor_bills_supplier_fk FOREIGN KEY (organization_id, supplier_id) REFERENCES tenant.procurement_suppliers(organization_id, id);
ALTER TABLE tenant.accounting_vendor_bills ADD CONSTRAINT accounting_vendor_bills_purchase_return_fk FOREIGN KEY (organization_id, source_purchase_return_id) REFERENCES tenant.purchase_returns(organization_id, id);
ALTER TABLE tenant.accounting_vendor_bills ADD CONSTRAINT accounting_vendor_bills_supplier_stated_total_check CHECK (supplier_stated_total IS NULL OR supplier_stated_total >= 0);
-- One supplier invoice is one payable: unique once the bill is submitted, approved or posted (an authorised exception leaves the key empty).
CREATE UNIQUE INDEX IF NOT EXISTS accounting_vendor_bills_supplier_invoice_key ON tenant.accounting_vendor_bills (organization_id, party_id, supplier_invoice_key)
  WHERE supplier_invoice_key IS NOT NULL AND bill_type = 'bill' AND status NOT IN ('draft', 'cancelled', 'reversed');
CREATE INDEX IF NOT EXISTS accounting_vendor_bills_supplier_idx ON tenant.accounting_vendor_bills (organization_id, supplier_id, bill_date DESC);
CREATE INDEX IF NOT EXISTS accounting_vendor_bills_source_bill_idx ON tenant.accounting_vendor_bills (organization_id, source_bill_id) WHERE source_bill_id IS NOT NULL;
-- What was recorded before this migration keeps its number as the reference.
UPDATE tenant.accounting_vendor_bills SET supplier_invoice_reference = supplier_invoice_number WHERE supplier_invoice_reference IS NULL AND supplier_invoice_number IS NOT NULL;

ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS product_type text;
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS product_snapshot jsonb;
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS uom_snapshot jsonb;
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS tax_category_id uuid;
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS gross_amount numeric(24,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS line_discount_type text CHECK (line_discount_type IS NULL OR line_discount_type IN ('percent', 'amount'));
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS line_discount_value numeric(24,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS line_discount_amount numeric(24,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS allocated_document_discount numeric(24,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS reverse_charge boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS reverse_charge_tax numeric(24,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS withholding_rate numeric(10,4) NOT NULL DEFAULT 0;
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS variance_account_id uuid REFERENCES tenant.accounting_accounts(id);
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS variance_amount numeric(24,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS source_bill_line_id uuid;
ALTER TABLE tenant.accounting_vendor_bill_lines ADD COLUMN IF NOT EXISTS adjustment_kind text CHECK (adjustment_kind IS NULL OR adjustment_kind IN ('quantity', 'value'));
CREATE INDEX IF NOT EXISTS accounting_vendor_bill_lines_source_line_idx ON tenant.accounting_vendor_bill_lines (organization_id, source_bill_line_id) WHERE source_bill_line_id IS NOT NULL;

-- A supplier payment reversed by Finance gives back what it settled. Allocations are append-only: a reversal is its own record.
CREATE TABLE IF NOT EXISTS tenant.accounting_vendor_payment_allocation_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  allocation_id uuid NOT NULL REFERENCES tenant.accounting_vendor_payment_allocations(id),
  payment_id uuid NOT NULL REFERENCES tenant.accounting_vendor_payments(id),
  vendor_bill_id uuid NOT NULL REFERENCES tenant.accounting_vendor_bills(id),
  amount numeric(24,6) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  reversed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reversed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, allocation_id)
);
ALTER TABLE tenant.accounting_vendor_payments ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
ALTER TABLE tenant.accounting_vendor_payments ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.accounting_vendor_payments ADD COLUMN IF NOT EXISTS reversal_reason text;
ALTER TABLE tenant.accounting_vendor_payments ADD COLUMN IF NOT EXISTS reversal_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id);

-- Each line's tax by component (CGST, SGST, IGST, CESS), as calculated by the shared tax engine; reverse-charge tax is self-assessed, not charged.
CREATE TABLE IF NOT EXISTS tenant.supplier_bill_line_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_bill_id uuid NOT NULL REFERENCES tenant.accounting_vendor_bills(id),
  vendor_bill_line_id uuid NOT NULL REFERENCES tenant.accounting_vendor_bill_lines(id),
  tax_type text NOT NULL,
  label text NOT NULL,
  tax_rate numeric(10,4) NOT NULL,
  taxable_base numeric(24,6) NOT NULL,
  tax_amount numeric(24,6) NOT NULL,
  tax_classification text NOT NULL DEFAULT 'input' CHECK (tax_classification IN ('input', 'reverse_charge')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_bill_line_taxes_bill_idx ON tenant.supplier_bill_line_taxes (organization_id, vendor_bill_id);

-- TDS / withholding sections: the rate withheld from a supplier's bill (on its taxable value), owned by the shared tax set-up.
CREATE TABLE IF NOT EXISTS tenant.withholding_tax_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  rate numeric(10,4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);
ALTER TABLE tenant.procurement_suppliers ADD COLUMN IF NOT EXISTS withholding_section_id uuid;
ALTER TABLE tenant.procurement_suppliers ADD CONSTRAINT procurement_suppliers_withholding_section_fk FOREIGN KEY (organization_id, withholding_section_id) REFERENCES tenant.withholding_tax_sections(organization_id, id);
ALTER TABLE tenant.accounting_vendor_bills ADD CONSTRAINT accounting_vendor_bills_withholding_section_fk FOREIGN KEY (organization_id, withholding_section_id) REFERENCES tenant.withholding_tax_sections(organization_id, id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_bill_line_taxes', 'withholding_tax_sections', 'accounting_vendor_payment_allocation_reversals'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', t);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', t);
  END LOOP;
END $$;

-- Posted documents stay fixed except what settlement changes, a due-date correction, and now a reversal's own record (who, when, why, its journal).
CREATE OR REPLACE FUNCTION tenant.accounting_protect_posted_subledger_document() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_payload jsonb;
  new_payload jsonb;
  open_columns text[] := ARRAY['status', 'outstanding_amount', 'e_invoice_status', 'e_invoice_reference', 'due_date', 'updated_by', 'updated_at',
    'reversed_by', 'reversed_at', 'reversal_reason', 'reversal_journal_entry_id'];
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed', 'reversed') THEN
    RAISE EXCEPTION 'Posted subledger documents cannot be deleted; create a credit note or reversal';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed', 'reversed') THEN
    old_payload := to_jsonb(OLD) - open_columns;
    new_payload := to_jsonb(NEW) - open_columns;
    IF old_payload IS DISTINCT FROM new_payload THEN
      RAISE EXCEPTION 'Posted subledger document commercial fields are immutable';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ---------------------------------------------------------------- permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('procurement.bills.view', 'View supplier bills', 'Procurement', 'See supplier bills, their matching, payments and debit notes.'),
  ('procurement.bills.override_duplicate', 'Accept a duplicate supplier invoice', 'Procurement', 'Post a supplier bill whose invoice number matches one already recorded, with a reason.'),
  ('procurement.bills.reverse', 'Reverse supplier bills', 'Procurement', 'Reverse a posted supplier bill that has no payments, credits or debit notes.')
ON CONFLICT (key) DO NOTHING;
-- Seen by procurement, Accounts Payable, Finance approvers and treasury; duplicates accepted and bills reversed by whoever approves payables.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, granted.key FROM public.role_permissions existing
  JOIN (VALUES
    ('procurement.view', 'procurement.bills.view'), ('accounting.payables.manage', 'procurement.bills.view'), ('accounting.payables.approve', 'procurement.bills.view'), ('accounting.payments.manage', 'procurement.bills.view'),
    ('accounting.payables.approve', 'procurement.bills.override_duplicate'), ('accounting.payables.approve', 'procurement.bills.reverse')
  ) AS granted(source, key) ON granted.source = existing.permission_key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0049_supplier_bills.sql', 'supplier-bills');
