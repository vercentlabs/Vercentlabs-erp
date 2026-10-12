-- Automatic Accounting Posting: one shared posting service between every module and the general ledger. Each financial event a module
-- reaches (a sales invoice issued, a goods receipt, a supplier payment, a POS day …) becomes exactly one posting: validated, mapped to
-- accounts, written as one balanced journal, linked both ways to its source document. Failures stay visible and are retried without ever
-- duplicating an entry; posted entries are corrected only by reversal.
--
--   postings            one row per (posting event, source document): PENDING (queued) → DRAFT (journal written, not yet posted) → POSTED,
--                       or FAILED (with a plain-language reason, retried in place), and POSTED → REVERSED. The database refuses a second live
--                       posting of the same event for the same document.
--   posting attempts    the append-only history of every attempt, retry, failure, detection and reversal.
--   journal lines       a line can no longer be added to a posted entry (updates and deletes were already refused).
--   GST                 separate input and output CGST / SGST / IGST / cess accounts, and an input-tax-credit account for credit that has
--                       not yet been confirmed claimable (GSTR-2B and the statutory conditions); the tax ledger records each component, the
--                       supply category (taxable, exempt, nil-rated, non-GST) and the ITC status (pending / eligible / ineligible).
--   expenses            an expense recorded, approved by a second person and posted: expense against cash / bank, or against expense
--                       claims payable (paid later).
--   fund transfers      money moved between cash and bank accounts.
--   opening balances    a controlled opening journal: prepared, approved by a second person, posted once, any difference to opening
--                       balance equity.
--
-- Additive only.

-- ============================================================ 1. postings
CREATE TABLE IF NOT EXISTS tenant.accounting_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  posting_event text NOT NULL,
  source_module text NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  source_number text,
  once_per_source boolean NOT NULL DEFAULT true,
  automatic boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DRAFT', 'POSTED', 'FAILED', 'REVERSED', 'CANCELLED')),
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  reversal_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  transaction_date date,
  posting_date date,
  amount numeric(24, 6),
  currency_code text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  detected_by text NOT NULL DEFAULT 'POSTING' CHECK (detected_by IN ('POSTING', 'SCAN', 'BACKFILL')),
  error_code text,
  error_message text,
  error_hint text,
  failed_at timestamptz,
  posted_at timestamptz,
  posted_by uuid REFERENCES public.users(id),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES public.users(id),
  reversal_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id),
  cancel_reason text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('DRAFT', 'POSTED', 'REVERSED') OR journal_entry_id IS NOT NULL),
  CHECK (status <> 'REVERSED' OR reversal_journal_entry_id IS NOT NULL),
  CHECK (status <> 'FAILED' OR error_message IS NOT NULL),
  CHECK (status <> 'CANCELLED' OR cancel_reason IS NOT NULL)
);
-- One live posting per event per document: a retry reuses the failed row; only a reversal frees the key for a fresh posting.
CREATE UNIQUE INDEX IF NOT EXISTS accounting_postings_once_uidx ON tenant.accounting_postings (organization_id, posting_event, source_id)
  WHERE once_per_source AND status IN ('PENDING', 'DRAFT', 'POSTED', 'FAILED');
CREATE INDEX IF NOT EXISTS accounting_postings_source_idx ON tenant.accounting_postings (organization_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS accounting_postings_journal_idx ON tenant.accounting_postings (organization_id, journal_entry_id);
CREATE INDEX IF NOT EXISTS accounting_postings_status_idx ON tenant.accounting_postings (organization_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION tenant.accounting_posting_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  journal_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Accounting postings are never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id <> OLD.organization_id OR NEW.posting_event <> OLD.posting_event OR NEW.source_type <> OLD.source_type OR NEW.source_id <> OLD.source_id THEN
      RAISE EXCEPTION 'A posting''s source cannot be changed.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status IN ('REVERSED', 'CANCELLED') THEN RAISE EXCEPTION 'A % posting is final.', lower(OLD.status) USING ERRCODE = 'check_violation'; END IF;
    IF OLD.status = 'POSTED' AND NEW.status NOT IN ('POSTED', 'REVERSED') THEN
      RAISE EXCEPTION 'A posted posting is corrected only by reversal.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'POSTED' AND NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id THEN
      RAISE EXCEPTION 'A posted posting keeps its journal entry.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'POSTED' THEN
    SELECT status INTO journal_status FROM tenant.accounting_journal_entries WHERE id = NEW.journal_entry_id AND organization_id = NEW.organization_id;
    IF journal_status IS DISTINCT FROM 'posted' AND journal_status IS DISTINCT FROM 'reversed' THEN
      RAISE EXCEPTION 'A posting is posted only when its journal entry is posted.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'accounting_postings_guard' AND tgrelid = 'tenant.accounting_postings'::regclass) THEN
    CREATE TRIGGER accounting_postings_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.accounting_postings FOR EACH ROW EXECUTE FUNCTION tenant.accounting_posting_guard();
  END IF;
END $$;

-- ============================================================ 2. posting attempts (history)
CREATE TABLE IF NOT EXISTS tenant.accounting_posting_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  posting_id uuid NOT NULL REFERENCES tenant.accounting_postings(id),
  outcome text NOT NULL CHECK (outcome IN ('QUEUED', 'DRAFTED', 'POSTED', 'FAILED', 'DUPLICATE_REFUSED', 'RETRY_REQUESTED', 'DETECTED_MISSING', 'REVERSED', 'CANCELLED', 'RESOLVED')),
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  error_code text,
  message text,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accounting_posting_attempts_posting_idx ON tenant.accounting_posting_attempts (organization_id, posting_id, occurred_at);

CREATE OR REPLACE FUNCTION tenant.accounting_posting_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Posting history is append-only.' USING ERRCODE = 'check_violation';
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'accounting_posting_attempts_guard' AND tgrelid = 'tenant.accounting_posting_attempts'::regclass) THEN
    CREATE TRIGGER accounting_posting_attempts_guard BEFORE UPDATE OR DELETE ON tenant.accounting_posting_attempts FOR EACH ROW EXECUTE FUNCTION tenant.accounting_posting_attempt_guard();
  END IF;
END $$;

-- Every journal already in the books becomes a posting (as it was: posted, reversed, still draft), so the list is complete from day one.
INSERT INTO tenant.accounting_postings (organization_id, posting_event, source_module, source_type, source_id, source_number, once_per_source, automatic, status,
  journal_entry_id, reversal_journal_entry_id, transaction_date, posting_date, amount, currency_code, detected_by, posted_at, posted_by, reversed_at, reversal_reason,
  cancelled_at, cancel_reason, created_by, created_at)
SELECT entry.organization_id, COALESCE(entry.source_type, 'manual_journal'), COALESCE(entry.source_module, 'accounting'), COALESCE(entry.source_type, 'journal_entry'),
       COALESCE(entry.source_id, entry.id), COALESCE(entry.source_number, entry.entry_number), false, entry.source_type IS NOT NULL,
       CASE entry.status WHEN 'posted' THEN 'POSTED' WHEN 'cancelled' THEN 'CANCELLED' ELSE 'DRAFT' END,
       entry.id, NULL, COALESCE(entry.document_date, entry.entry_date), entry.accounting_date,
       (SELECT COALESCE(sum(line.base_debit_amount), 0) FROM tenant.accounting_journal_lines line WHERE line.journal_entry_id = entry.id),
       entry.functional_currency_code, 'BACKFILL', entry.posted_at, entry.posted_by, NULL, NULL,
       CASE WHEN entry.status = 'cancelled' THEN entry.updated_at END, CASE WHEN entry.status = 'cancelled' THEN 'Cancelled before this feature.' END,
       entry.created_by, entry.created_at
  FROM tenant.accounting_journal_entries entry
 WHERE entry.entry_type <> 'reversal'
   AND entry.status IN ('draft', 'pending_approval', 'approved', 'posted', 'cancelled', 'rejected')
   AND NOT EXISTS (SELECT 1 FROM tenant.accounting_postings posting WHERE posting.journal_entry_id = entry.id);
INSERT INTO tenant.accounting_postings (organization_id, posting_event, source_module, source_type, source_id, source_number, once_per_source, automatic, status,
  journal_entry_id, reversal_journal_entry_id, transaction_date, posting_date, amount, currency_code, detected_by, posted_at, posted_by, reversed_at, reversal_reason, created_by, created_at)
SELECT entry.organization_id, COALESCE(entry.source_type, 'manual_journal'), COALESCE(entry.source_module, 'accounting'), COALESCE(entry.source_type, 'journal_entry'),
       COALESCE(entry.source_id, entry.id), COALESCE(entry.source_number, entry.entry_number), false, entry.source_type IS NOT NULL, 'REVERSED',
       entry.id, entry.reversed_by_id, COALESCE(entry.document_date, entry.entry_date), entry.accounting_date,
       (SELECT COALESCE(sum(line.base_debit_amount), 0) FROM tenant.accounting_journal_lines line WHERE line.journal_entry_id = entry.id),
       entry.functional_currency_code, 'BACKFILL', entry.posted_at, entry.posted_by, entry.updated_at, entry.reversal_reason, entry.created_by, entry.created_at
  FROM tenant.accounting_journal_entries entry
 WHERE entry.entry_type <> 'reversal' AND entry.status = 'reversed' AND entry.reversed_by_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM tenant.accounting_postings posting WHERE posting.journal_entry_id = entry.id);

-- ============================================================ 3. journal lines: nothing is added to a posted entry
CREATE OR REPLACE FUNCTION tenant.accounting_journal_line_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status FROM tenant.accounting_journal_entries WHERE id = NEW.journal_entry_id;
  IF parent_status IN ('posted', 'reversed') THEN RAISE EXCEPTION 'Lines cannot be added to a posted accounting entry' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'accounting_journal_line_insert_guard' AND tgrelid = 'tenant.accounting_journal_lines'::regclass) THEN
    CREATE TRIGGER accounting_journal_line_insert_guard BEFORE INSERT ON tenant.accounting_journal_lines FOR EACH ROW EXECUTE FUNCTION tenant.accounting_journal_line_insert_guard();
  END IF;
END $$;

-- ============================================================ 4. GST: the Indian chart's tax accounts and their posting mappings
-- New accounts, in every existing ledger, where the code is free; then each mapping key that is not configured yet points at its account, as a
-- default underneath (priority 1000) that a company's own choice overrides.
DO $$
DECLARE
  ledger record;
  seed record;
  parent_id uuid;
  account_id uuid;
BEGIN
  FOR ledger IN SELECT accounting_ledger.id, accounting_ledger.organization_id FROM tenant.accounting_ledgers accounting_ledger WHERE accounting_ledger.status = 'active' LOOP
    FOR seed IN SELECT * FROM (VALUES
        ('1411', 'Input CGST', 'asset', 'tax_input', 'debit', '1000', 'input_cgst'),
        ('1412', 'Input SGST', 'asset', 'tax_input', 'debit', '1000', 'input_sgst'),
        ('1413', 'Input IGST', 'asset', 'tax_input', 'debit', '1000', 'input_igst'),
        ('1414', 'Input GST cess', 'asset', 'tax_input', 'debit', '1000', 'input_cess'),
        ('1419', 'Input GST awaiting ITC confirmation', 'asset', 'tax_input', 'debit', '1000', 'input_tax_pending'),
        ('2211', 'Output CGST', 'liability', 'tax_output', 'credit', '2000', 'output_cgst'),
        ('2212', 'Output SGST', 'liability', 'tax_output', 'credit', '2000', 'output_sgst'),
        ('2213', 'Output IGST', 'liability', 'tax_output', 'credit', '2000', 'output_igst'),
        ('2214', 'Output GST cess', 'liability', 'tax_output', 'credit', '2000', 'output_cess'),
        ('2160', 'Goods received not invoiced', 'liability', 'current_liability', 'credit', '2000', 'grni'),
        ('2410', 'Expense claims payable', 'liability', 'current_liability', 'credit', '2000', 'expense_payable'),
        ('6150', 'Ineligible input tax', 'expense', 'expense', 'debit', '6000', 'itc_ineligible')
      ) AS rows(code, name, account_class, account_type, normal_balance, parent_code, mapping_key) LOOP
      SELECT id INTO parent_id FROM tenant.accounting_accounts WHERE organization_id = ledger.organization_id AND ledger_id = ledger.id AND code = seed.parent_code AND is_group;
      INSERT INTO tenant.accounting_accounts (organization_id, ledger_id, parent_id, code, name, account_class, account_type, normal_balance, is_group,
                                              allow_manual_posting, reconciliation_required, status)
      VALUES (ledger.organization_id, ledger.id, parent_id, seed.code, seed.name, seed.account_class, seed.account_type, seed.normal_balance, false,
              false, seed.account_type IN ('tax_input', 'tax_output', 'current_liability'), 'active')
      ON CONFLICT (organization_id, ledger_id, code) DO NOTHING;
      SELECT id INTO account_id FROM tenant.accounting_accounts
       WHERE organization_id = ledger.organization_id AND ledger_id = ledger.id AND code = seed.code AND account_class = seed.account_class AND NOT is_group AND status = 'active';
      IF account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant.accounting_account_mappings
          WHERE organization_id = ledger.organization_id AND ledger_id = ledger.id AND mapping_key = seed.mapping_key) THEN
        INSERT INTO tenant.accounting_account_mappings (organization_id, ledger_id, mapping_key, account_id, priority, status)
        VALUES (ledger.organization_id, ledger.id, seed.mapping_key, account_id, 1000, 'active');
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- The tax ledger: the supply category of every line (so GST reports reconcile to exempt, nil-rated and non-GST supplies too), and for input
-- tax the input-tax-credit status — never claimable merely because a supplier invoice exists.
ALTER TABLE tenant.accounting_tax_ledger ADD COLUMN IF NOT EXISTS supply_category text NOT NULL DEFAULT 'taxable';
ALTER TABLE tenant.accounting_tax_ledger ADD COLUMN IF NOT EXISTS itc_status text NOT NULL DEFAULT 'NOT_APPLICABLE';
ALTER TABLE tenant.accounting_tax_ledger ADD COLUMN IF NOT EXISTS itc_decided_at timestamptz;
ALTER TABLE tenant.accounting_tax_ledger ADD COLUMN IF NOT EXISTS itc_decided_by uuid REFERENCES public.users(id);
ALTER TABLE tenant.accounting_tax_ledger ADD COLUMN IF NOT EXISTS itc_reason text;
ALTER TABLE tenant.accounting_tax_ledger ADD COLUMN IF NOT EXISTS itc_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_tax_ledger_supply_category_check') THEN
    ALTER TABLE tenant.accounting_tax_ledger ADD CONSTRAINT accounting_tax_ledger_supply_category_check
      CHECK (supply_category IN ('taxable', 'zero_rated', 'exempt', 'nil_rated', 'non_gst', 'reverse_charge'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_tax_ledger_itc_status_check') THEN
    ALTER TABLE tenant.accounting_tax_ledger ADD CONSTRAINT accounting_tax_ledger_itc_status_check
      CHECK (itc_status IN ('NOT_APPLICABLE', 'PENDING', 'ELIGIBLE', 'INELIGIBLE'));
  END IF;
END $$;
-- Input tax already in the books was booked as claimable: it stays eligible.
UPDATE tenant.accounting_tax_ledger SET itc_status = 'ELIGIBLE' WHERE direction = 'input' AND itc_status = 'NOT_APPLICABLE' AND recoverable_amount <> 0;
CREATE INDEX IF NOT EXISTS accounting_tax_ledger_itc_idx ON tenant.accounting_tax_ledger (organization_id, itc_status, source_type, source_id) WHERE direction = 'input';

ALTER TABLE tenant.accounting_settings ADD COLUMN IF NOT EXISTS itc_requires_confirmation boolean NOT NULL DEFAULT true;
ALTER TABLE tenant.accounting_settings ADD COLUMN IF NOT EXISTS expense_approval_required boolean NOT NULL DEFAULT true;

-- ============================================================ 5. expenses
CREATE TABLE IF NOT EXISTS tenant.accounting_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id),
  expense_number text NOT NULL,
  expense_date date NOT NULL,
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  expense_account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id),
  party_id uuid REFERENCES tenant.business_parties(id),
  payee_name text,
  supplier_gstin text,
  supplier_invoice_reference text,
  currency_code text NOT NULL DEFAULT 'INR',
  amount numeric(20, 2) NOT NULL CHECK (amount > 0),
  gst_treatment text NOT NULL DEFAULT 'NO_GST' CHECK (gst_treatment IN ('NO_GST', 'GST_CLAIM_ITC', 'GST_NO_ITC')),
  gst_supply text CHECK (gst_supply IS NULL OR gst_supply IN ('INTRA_STATE', 'INTER_STATE')),
  gst_rate numeric(7, 4) NOT NULL DEFAULT 0 CHECK (gst_rate >= 0 AND gst_rate <= 100),
  tax_amount numeric(20, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount numeric(20, 2) NOT NULL,
  settlement text NOT NULL CHECK (settlement IN ('PAID', 'PAYABLE')),
  paid_from_account_id uuid REFERENCES tenant.accounting_accounts(id),
  department_id uuid,
  cost_center_id uuid,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'POSTED', 'REJECTED', 'REVERSED', 'CANCELLED')),
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  approved_by uuid REFERENCES public.users(id),
  rejection_reason text,
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  posted_at timestamptz,
  posted_by uuid REFERENCES public.users(id),
  paid_at timestamptz,
  payment_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  reversal_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES public.users(id),
  reversal_reason text,
  idempotency_key text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_amount = amount + tax_amount),
  CHECK (gst_treatment = 'NO_GST' OR (gst_supply IS NOT NULL AND gst_rate > 0)),
  CHECK (gst_treatment <> 'NO_GST' OR tax_amount = 0),
  CHECK (settlement <> 'PAID' OR paid_from_account_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_expenses_number_uidx ON tenant.accounting_expenses (organization_id, expense_number);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_expenses_key_uidx ON tenant.accounting_expenses (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS accounting_expenses_status_idx ON tenant.accounting_expenses (organization_id, status, expense_date DESC);

-- ============================================================ 6. fund transfers
CREATE TABLE IF NOT EXISTS tenant.accounting_fund_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id),
  transfer_number text NOT NULL,
  transfer_date date NOT NULL,
  from_account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id),
  to_account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id),
  amount numeric(20, 2) NOT NULL CHECK (amount > 0),
  currency_code text NOT NULL DEFAULT 'INR',
  reference text,
  description text,
  status text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED')),
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  reversal_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES public.users(id),
  reversal_reason text,
  idempotency_key text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_account_id <> to_account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_fund_transfers_number_uidx ON tenant.accounting_fund_transfers (organization_id, transfer_number);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_fund_transfers_key_uidx ON tenant.accounting_fund_transfers (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================ 7. opening balances
CREATE TABLE IF NOT EXISTS tenant.accounting_opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id),
  document_number text NOT NULL,
  as_of_date date NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'POSTED', 'REJECTED', 'REVERSED')),
  total_debit numeric(24, 6) NOT NULL DEFAULT 0,
  total_credit numeric(24, 6) NOT NULL DEFAULT 0,
  balancing_amount numeric(24, 6) NOT NULL DEFAULT 0,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  approved_by uuid REFERENCES public.users(id),
  rejection_reason text,
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  reversal_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES public.users(id),
  reversal_reason text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (approved_by IS NULL OR approved_by <> submitted_by)
);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_opening_balances_number_uidx ON tenant.accounting_opening_balances (organization_id, document_number);
CREATE TABLE IF NOT EXISTS tenant.accounting_opening_balance_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  opening_balance_id uuid NOT NULL REFERENCES tenant.accounting_opening_balances(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  account_id uuid NOT NULL REFERENCES tenant.accounting_accounts(id),
  description text,
  debit numeric(24, 6) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(24, 6) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK ((debit > 0) <> (credit > 0)),
  UNIQUE (opening_balance_id, sequence)
);

-- A finance document leaves draft only forward; posted documents change only to reversed.
CREATE OR REPLACE FUNCTION tenant.accounting_finance_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('POSTED', 'REVERSED') THEN RAISE EXCEPTION 'A posted finance document is never deleted.' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'REVERSED' THEN RAISE EXCEPTION 'A reversed finance document is final.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status = 'POSTED' AND NEW.status NOT IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'A posted finance document is corrected only by reversal.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'POSTED' AND OLD.journal_entry_id IS NOT NULL AND NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id THEN
    RAISE EXCEPTION 'A posted finance document keeps its journal entry.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['accounting_expenses', 'accounting_fund_transfers', 'accounting_opening_balances'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = name || '_guard' AND tgrelid = ('tenant.' || name)::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.accounting_finance_document_guard()', name || '_guard', name);
    END IF;
  END LOOP;
END $$;

-- ============================================================ 8. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['accounting_postings', 'accounting_posting_attempts', 'accounting_expenses', 'accounting_fund_transfers', 'accounting_opening_balances',
                             'accounting_opening_balance_lines'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.accounting_postings, tenant.accounting_expenses, tenant.accounting_fund_transfers, tenant.accounting_opening_balances TO vercent_app;
GRANT SELECT, INSERT ON tenant.accounting_posting_attempts TO vercent_app;
GRANT SELECT, INSERT, DELETE ON tenant.accounting_opening_balance_lines TO vercent_app;
GRANT SELECT ON tenant.accounting_postings, tenant.accounting_posting_attempts, tenant.accounting_expenses, tenant.accounting_fund_transfers, tenant.accounting_opening_balances,
  tenant.accounting_opening_balance_lines TO vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0109_automatic_accounting_posting.sql', 'automatic-accounting-posting') ON CONFLICT DO NOTHING;
