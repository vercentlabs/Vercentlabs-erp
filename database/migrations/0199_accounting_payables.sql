-- Finance MVP F5: Payables.
--
-- 1. A supplier payment carries the bills it is meant to settle (planned applications) from the moment it is prepared, so the approver
--    approves what is paid and for what; posting the approved payment applies them.
-- 2. A payment keeps the note it was prepared with, and why a draft was discarded.
-- 3. An undone application keeps the payment amount it gave back (as receipts do).
--
-- Additive and re-runnable.

ALTER TABLE tenant.accounting_vendor_payments ADD COLUMN IF NOT EXISTS planned_allocations jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tenant.accounting_vendor_payments ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE tenant.accounting_vendor_payments ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE tenant.accounting_vendor_payments ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.accounting_vendor_payments ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE tenant.accounting_vendor_payment_allocation_reversals ADD COLUMN IF NOT EXISTS payment_amount numeric(24,6);

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0199_accounting_payables.sql', 'accounting-payables') ON CONFLICT DO NOTHING;
