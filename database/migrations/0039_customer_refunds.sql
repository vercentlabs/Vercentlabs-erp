-- Customer Refunds.
--
-- A refund pays money back to a customer out of credit the customer really
-- has: what is left unapplied on a posted credit note, or on a receipt (an
-- overpayment or an advance). It is its own Finance transaction, never an
-- edit of an invoice, a credit note or a receipt: Draft (no effect) → Posted
-- (the credit is consumed, the bank or cash account is credited, the journal
-- is posted; fixed) → Reversed (posted in error: the money movement is
-- reversed and the credit restored). A draft can be Cancelled. A refund
-- moves no stock and carries no tax: the credit note already corrected
-- revenue and tax.
--
-- 1. tenant.accounting_customer_refunds, tenant.accounting_customer_refund_allocations (which credit
--    a refund consumes: one source per refund for now), tenant.accounting_customer_refund_sends.
-- 2. Posted refunds are fixed.
-- 3. Permissions: drafted by whoever records receipts; posted and reversed only by whoever executes or approves payments.

CREATE TABLE IF NOT EXISTS tenant.accounting_customer_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id),
  refund_number text NOT NULL,
  party_id uuid NOT NULL REFERENCES tenant.business_parties(id),
  customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  refund_date date NOT NULL,
  accounting_date date NOT NULL,
  currency_code character(3) NOT NULL,
  functional_currency_code character(3) NOT NULL,
  exchange_rate numeric(24,10) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  amount numeric(24,6) NOT NULL CHECK (amount > 0),
  base_amount numeric(24,6) NOT NULL CHECK (base_amount > 0),
  reason_code text NOT NULL CHECK (reason_code IN ('customer_credit', 'overpayment', 'order_cancellation', 'returned_goods', 'billing_adjustment', 'duplicate_payment', 'other')),
  reason_note text,
  payment_method text NOT NULL DEFAULT 'bank_transfer' CHECK (payment_method IN ('bank_transfer', 'cash', 'cheque', 'other')),
  bank_account_id uuid REFERENCES tenant.accounting_bank_accounts(id),
  external_reference text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed', 'cancelled')),
  customer_notes text,
  internal_notes text,
  idempotency_key text,
  version integer NOT NULL DEFAULT 1,
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  posted_at timestamptz,
  posted_by uuid REFERENCES public.users(id),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES public.users(id),
  reversal_reason text,
  reversal_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id),
  cancel_reason text,
  sent_at timestamptz,
  sent_by uuid REFERENCES public.users(id),
  sent_to text,
  sent_channel text,
  created_by uuid REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, refund_number),
  -- A posted refund always says where the money left from.
  CHECK (status NOT IN ('posted', 'reversed') OR bank_account_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_customer_refunds_key_idx ON tenant.accounting_customer_refunds (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS accounting_customer_refunds_party_idx ON tenant.accounting_customer_refunds (organization_id, party_id, refund_date);
CREATE INDEX IF NOT EXISTS accounting_customer_refunds_status_idx ON tenant.accounting_customer_refunds (organization_id, status, created_at);
ALTER TABLE tenant.accounting_customer_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_customer_refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.accounting_customer_refunds
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE ON tenant.accounting_customer_refunds TO vercent_app;
GRANT SELECT ON tenant.accounting_customer_refunds TO vercent_worker;

-- The credit a refund consumes. One row per refund for now; several sources per refund fit the same table later.
CREATE TABLE IF NOT EXISTS tenant.accounting_customer_refund_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  refund_id uuid NOT NULL REFERENCES tenant.accounting_customer_refunds(id),
  source_type text NOT NULL CHECK (source_type IN ('credit_note', 'receipt')),
  credit_note_id uuid REFERENCES tenant.accounting_customer_invoices(id),
  receipt_id uuid REFERENCES tenant.accounting_customer_receipts(id),
  amount numeric(24,6) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source_type = 'credit_note' AND credit_note_id IS NOT NULL AND receipt_id IS NULL)
      OR (source_type = 'receipt' AND receipt_id IS NOT NULL AND credit_note_id IS NULL))
);
CREATE INDEX IF NOT EXISTS accounting_customer_refund_allocations_refund_idx ON tenant.accounting_customer_refund_allocations (organization_id, refund_id);
CREATE INDEX IF NOT EXISTS accounting_customer_refund_allocations_credit_idx ON tenant.accounting_customer_refund_allocations (organization_id, credit_note_id) WHERE credit_note_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS accounting_customer_refund_allocations_receipt_idx ON tenant.accounting_customer_refund_allocations (organization_id, receipt_id) WHERE receipt_id IS NOT NULL;
ALTER TABLE tenant.accounting_customer_refund_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_customer_refund_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.accounting_customer_refund_allocations
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE ON tenant.accounting_customer_refund_allocations TO vercent_app;
GRANT SELECT ON tenant.accounting_customer_refund_allocations TO vercent_worker;

CREATE TABLE IF NOT EXISTS tenant.accounting_customer_refund_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  refund_id uuid NOT NULL REFERENCES tenant.accounting_customer_refunds(id),
  channel text NOT NULL CHECK (channel IN ('email', 'other')),
  recipients text,
  subject text,
  note text,
  message_id text,
  pdf_file_id uuid,
  idempotency_key text,
  sent_by uuid REFERENCES public.users(id),
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_customer_refund_sends_key_idx ON tenant.accounting_customer_refund_sends (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE tenant.accounting_customer_refund_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.accounting_customer_refund_sends FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.accounting_customer_refund_sends
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT ON tenant.accounting_customer_refund_sends TO vercent_app;
GRANT SELECT ON tenant.accounting_customer_refund_sends TO vercent_worker;

-- A posted refund is history: afterwards only its sending and its reversal are recorded. Nothing is ever deleted.
CREATE OR REPLACE FUNCTION tenant.accounting_customer_refund_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  open_columns text[] := ARRAY['sent_at', 'sent_by', 'sent_to', 'sent_channel', 'updated_at', 'updated_by'];
  reversal_columns text[] := ARRAY['status', 'reversed_at', 'reversed_by', 'reversal_reason', 'reversal_journal_entry_id'];
  refund_status text;
BEGIN
  IF TG_TABLE_NAME = 'accounting_customer_refund_allocations' THEN
    SELECT status INTO refund_status FROM tenant.accounting_customer_refunds WHERE id = OLD.refund_id;
    IF TG_OP = 'DELETE' OR refund_status <> 'draft' THEN
      RAISE EXCEPTION 'The credit a refund consumes cannot be changed once it is no longer a draft';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A refund is never deleted; cancel a draft or reverse a posted refund';
  END IF;
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'posted' AND NEW.status = 'reversed'
     AND (to_jsonb(OLD) - open_columns - reversal_columns) IS NOT DISTINCT FROM (to_jsonb(NEW) - open_columns - reversal_columns) THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(OLD) - open_columns) IS NOT DISTINCT FROM (to_jsonb(NEW) - open_columns) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A % refund cannot be changed', OLD.status;
END;
$$;
CREATE OR REPLACE TRIGGER accounting_customer_refunds_guard BEFORE UPDATE OR DELETE ON tenant.accounting_customer_refunds
  FOR EACH ROW EXECUTE FUNCTION tenant.accounting_customer_refund_guard();
CREATE OR REPLACE TRIGGER accounting_customer_refund_allocations_guard BEFORE UPDATE OR DELETE ON tenant.accounting_customer_refund_allocations
  FOR EACH ROW EXECUTE FUNCTION tenant.accounting_customer_refund_guard();

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('accounting.refund.view', 'View customer refunds', 'Accounting', 'See customer refunds and print or download the refund voucher.'),
  ('accounting.refund.create', 'Create draft refunds', 'Accounting', 'Prepare a draft refund of a customer''s credit. A draft moves no money.'),
  ('accounting.refund.edit', 'Edit draft refunds', 'Accounting', 'Change a draft refund''s amount, date, reason, reference and notes.'),
  ('accounting.refund.cancel', 'Cancel draft refunds', 'Accounting', 'Cancel a draft refund that will not be paid.'),
  ('accounting.refund.select_account', 'Choose the refund bank or cash account', 'Accounting', 'See the bank and cash accounts and choose which one a refund is paid from.'),
  ('accounting.refund.post', 'Post refunds', 'Accounting', 'Post a refund: the customer''s credit is consumed and the bank or cash account is credited.'),
  ('accounting.refund.reverse', 'Reverse refunds', 'Accounting', 'Reverse a posted refund entered in error: the money movement is reversed and the credit restored.'),
  ('accounting.refund.send', 'Send refund confirmations', 'Accounting', 'Email the refund voucher to the customer or record that it was sent.'),
  ('accounting.refund.accounting.view', 'View refund accounting', 'Accounting', 'See the journal entry of a posted refund.'),
  ('accounting.customer_credit.view', 'View customer credit', 'Accounting', 'See the credit a customer has left on credit notes and receipts, and what can be refunded.')
ON CONFLICT (key) DO NOTHING;

-- Whoever sees the books sees refunds, the customer credit behind them and their journal.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['accounting.refund.view', 'accounting.customer_credit.view', 'accounting.refund.accounting.view'])
 WHERE existing.permission_key = 'accounting.view'
ON CONFLICT DO NOTHING;
-- Whoever records receipts or executes payments prepares, edits, cancels and sends refunds.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['accounting.refund.create', 'accounting.refund.edit', 'accounting.refund.cancel', 'accounting.refund.send'])
 WHERE existing.permission_key IN ('accounting.receipts.manage', 'accounting.payments.manage', 'accounting.payments.approve')
ON CONFLICT DO NOTHING;
-- Money leaves only at the hands of whoever executes or approves payments.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['accounting.refund.select_account', 'accounting.refund.post', 'accounting.refund.reverse'])
 WHERE existing.permission_key IN ('accounting.payments.manage', 'accounting.payments.approve')
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0039_customer_refunds.sql', 'customer-refunds');
