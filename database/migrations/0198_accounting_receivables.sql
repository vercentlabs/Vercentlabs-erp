-- Finance MVP F4: Receivables.
--
-- 1. A receipt allocation can be undone (applied to the wrong invoice, or the receipt bounced): allocations stay append-only; the undo is
--    its own record, and the invoice is owed again and the receipt's amount unapplied again.
-- 2. A posted receipt can be reversed (a bounced cheque, a payment entered in error): who, when, why and the reversing journal are kept.
-- 3. A receipt keeps the note it was recorded with.
--
-- Additive and re-runnable.

CREATE TABLE IF NOT EXISTS tenant.accounting_customer_receipt_allocation_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  allocation_id uuid NOT NULL REFERENCES tenant.accounting_customer_receipt_allocations(id),
  receipt_id uuid NOT NULL REFERENCES tenant.accounting_customer_receipts(id),
  customer_invoice_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id),
  amount numeric(24,6) NOT NULL CHECK (amount > 0),
  receipt_amount numeric(24,6) NOT NULL CHECK (receipt_amount > 0),
  reason text NOT NULL,
  reversed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reversed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, allocation_id)
);
CREATE INDEX IF NOT EXISTS accounting_customer_receipt_allocation_reversals_receipt_idx
  ON tenant.accounting_customer_receipt_allocation_reversals (organization_id, receipt_id);

ALTER TABLE tenant.accounting_customer_receipts ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
ALTER TABLE tenant.accounting_customer_receipts ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.accounting_customer_receipts ADD COLUMN IF NOT EXISTS reversal_reason text;
ALTER TABLE tenant.accounting_customer_receipts ADD COLUMN IF NOT EXISTS reversal_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id);
ALTER TABLE tenant.accounting_customer_receipts ADD COLUMN IF NOT EXISTS notes text;

DO $$
BEGIN
  ALTER TABLE tenant.accounting_customer_receipt_allocation_reversals ENABLE ROW LEVEL SECURITY;
  ALTER TABLE tenant.accounting_customer_receipt_allocation_reversals FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'accounting_customer_receipt_allocation_reversals' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.accounting_customer_receipt_allocation_reversals
      USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
  GRANT SELECT, INSERT ON tenant.accounting_customer_receipt_allocation_reversals TO vercent_app;
  GRANT SELECT ON tenant.accounting_customer_receipt_allocation_reversals TO vercent_worker;
END $$;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0198_accounting_receivables.sql', 'accounting-receivables') ON CONFLICT DO NOTHING;
