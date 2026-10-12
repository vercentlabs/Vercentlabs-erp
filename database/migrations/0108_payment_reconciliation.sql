-- Payment Reconciliation: one engine that verifies every non-cash POS payment and refund against provider evidence, provider settlements
-- against Finance bank receipts, and keeps every difference visible as an owned exception until it is resolved with evidence. It replaces the
-- earlier day-report-based reconciliation (whose tables stay, unused). It never edits a sale, never fabricates a payment outcome, never
-- retries a payment or refund blindly; settlement accounting posts through Accounting's own journals.
--
--   merchant accounts   a provider + merchant account reference (as the outlet's payment configuration records it), the Finance bank account
--                       its payouts reach, and how long settlement normally takes (the aging threshold).
--   imports             a settlement report (CSV / XLSX / normalized provider API lines): previewed, then committed once; a file is recognised
--                       by its hash so the same file never imports twice.
--   settlements         one provider payout: gross receipts − refunds − fees − tax on fees − chargebacks + signed adjustments = net. Each line
--                       (payment, refund, fee, adjustment …) is provider evidence: never edited, and never imported twice.
--   matches             internal ↔ external evidence by layer (settlement of a payment or refund, bank receipt of a payout), with the rule
--                       that made it (or the person and reason for a manual one). The database refuses any match that would consume more of a
--                       source than it holds — two people cannot use the same money twice. A wrong match is reversed, never deleted.
--   exceptions          one queue: open → assigned → investigating (awaiting evidence / escalated) → resolved with a resolution and evidence.
--   runs                each reconciliation run, its counts and outcome.
--
-- Additive only.

-- ============================================================ 1. merchant accounts
CREATE TABLE IF NOT EXISTS tenant.payment_merchant_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  provider_key text NOT NULL,
  merchant_account_reference text NOT NULL,
  display_name text NOT NULL,
  payment_methods text[] NOT NULL DEFAULT ARRAY['card', 'upi']::text[],
  currency_code text NOT NULL DEFAULT 'INR',
  bank_account_id uuid REFERENCES tenant.accounting_bank_accounts(id),
  settlement_expected_days integer NOT NULL DEFAULT 3 CHECK (settlement_expected_days BETWEEN 0 AND 60),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_merchant_accounts_identity_uidx ON tenant.payment_merchant_accounts (organization_id, provider_key, merchant_account_reference);

-- The accounts payments already reference (an outlet's provider configuration, or a payment's own provider and merchant reference).
INSERT INTO tenant.payment_merchant_accounts (organization_id, provider_key, merchant_account_reference, display_name, payment_methods)
SELECT organization_id, provider_key, reference, provider_key || ' · ' || reference, array_agg(DISTINCT method)
  FROM (
    SELECT organization_id, provider_key, COALESCE(NULLIF(btrim(merchant_account_reference), ''), 'DEFAULT') AS reference, payment_method AS method
      FROM tenant.pos_payment_provider_configs
    UNION
    SELECT organization_id, provider_key, COALESCE(NULLIF(btrim(merchant_account_reference), ''), 'DEFAULT'), payment_method
      FROM tenant.pos_payments WHERE payment_method <> 'cash' AND provider_key IS NOT NULL
  ) known
 GROUP BY organization_id, provider_key, reference
ON CONFLICT DO NOTHING;

-- ============================================================ 2. settlement imports
CREATE TABLE IF NOT EXISTS tenant.payment_reconciliation_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  merchant_account_id uuid NOT NULL REFERENCES tenant.payment_merchant_accounts(id),
  adapter_code text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('CSV', 'XLSX', 'API', 'MANUAL')),
  file_name text,
  source_hash text NOT NULL,
  status text NOT NULL DEFAULT 'PREVIEW' CHECK (status IN ('PREVIEW', 'COMMITTED', 'REJECTED')),
  line_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview jsonb NOT NULL DEFAULT '{}'::jsonb,
  batch_id uuid,
  uploaded_by uuid NOT NULL REFERENCES public.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  committed_by uuid REFERENCES public.users(id),
  committed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_reconciliation_imports_file_uidx ON tenant.payment_reconciliation_imports (organization_id, merchant_account_id, source_hash) WHERE status <> 'REJECTED';

-- ============================================================ 3. settlements and their lines (provider evidence, immutable)
CREATE TABLE IF NOT EXISTS tenant.payment_settlement_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  merchant_account_id uuid NOT NULL REFERENCES tenant.payment_merchant_accounts(id),
  import_id uuid REFERENCES tenant.payment_reconciliation_imports(id),
  provider_settlement_id text NOT NULL,
  settlement_date date NOT NULL,
  currency_code text NOT NULL DEFAULT 'INR',
  gross_amount numeric(20, 2) NOT NULL DEFAULT 0 CHECK (gross_amount >= 0),
  refund_amount numeric(20, 2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  fee_amount numeric(20, 2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  fee_tax_amount numeric(20, 2) NOT NULL DEFAULT 0 CHECK (fee_tax_amount >= 0),
  chargeback_amount numeric(20, 2) NOT NULL DEFAULT 0 CHECK (chargeback_amount >= 0),
  adjustment_amount numeric(20, 2) NOT NULL DEFAULT 0,
  calculated_net_amount numeric(20, 2) NOT NULL,
  reported_net_amount numeric(20, 2),
  bank_payout_reference text,
  status text NOT NULL DEFAULT 'IMPORTED' CHECK (status IN ('IMPORTED', 'MATCHED', 'PARTIALLY_MATCHED', 'MISMATCHED', 'AWAITING_BANK_MATCH', 'BANK_MATCHED', 'EXCEPTION')),
  bank_matched_amount numeric(20, 2) NOT NULL DEFAULT 0,
  finance_status text NOT NULL DEFAULT 'PENDING' CHECK (finance_status IN ('PENDING', 'POSTED', 'FAILED', 'NOT_REQUIRED')),
  finance_journal_entry_id uuid,
  finance_error text,
  finance_attempts integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (calculated_net_amount = gross_amount - refund_amount - fee_amount - fee_tax_amount - chargeback_amount + adjustment_amount)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_settlement_batches_identity_uidx ON tenant.payment_settlement_batches (organization_id, merchant_account_id, provider_settlement_id);
CREATE INDEX IF NOT EXISTS payment_settlement_batches_status_idx ON tenant.payment_settlement_batches (organization_id, status, settlement_date);

CREATE TABLE IF NOT EXISTS tenant.payment_settlement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  batch_id uuid NOT NULL REFERENCES tenant.payment_settlement_batches(id),
  merchant_account_id uuid NOT NULL REFERENCES tenant.payment_merchant_accounts(id),
  line_number integer NOT NULL CHECK (line_number > 0),
  line_type text NOT NULL CHECK (line_type IN ('PAYMENT', 'REFUND', 'FEE', 'FEE_TAX', 'CHARGEBACK', 'ADJUSTMENT')),
  provider_transaction_id text,
  provider_reference text,
  original_provider_transaction_id text,
  transaction_at timestamptz,
  currency_code text NOT NULL DEFAULT 'INR',
  gross_amount numeric(20, 2) NOT NULL,
  fee_amount numeric(20, 2) NOT NULL DEFAULT 0,
  fee_tax_amount numeric(20, 2) NOT NULL DEFAULT 0,
  net_amount numeric(20, 2) NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (line_type = 'ADJUSTMENT' OR gross_amount >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_settlement_lines_number_uidx ON tenant.payment_settlement_lines (organization_id, batch_id, line_number);
-- A provider transaction is settled once: the same payment or refund line can never be imported twice, whatever the file.
CREATE UNIQUE INDEX IF NOT EXISTS payment_settlement_lines_identity_uidx ON tenant.payment_settlement_lines (organization_id, merchant_account_id, line_type, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL AND line_type IN ('PAYMENT', 'REFUND', 'CHARGEBACK');

CREATE OR REPLACE FUNCTION tenant.payment_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Provider evidence cannot be changed or deleted.' USING ERRCODE = 'check_violation';
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payment_settlement_lines_immutable' AND tgrelid = 'tenant.payment_settlement_lines'::regclass) THEN
    CREATE TRIGGER payment_settlement_lines_immutable BEFORE UPDATE OR DELETE ON tenant.payment_settlement_lines FOR EACH ROW EXECUTE FUNCTION tenant.payment_evidence_immutable();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION tenant.payment_settlement_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A settlement batch cannot be deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.gross_amount IS DISTINCT FROM OLD.gross_amount OR NEW.refund_amount IS DISTINCT FROM OLD.refund_amount OR NEW.fee_amount IS DISTINCT FROM OLD.fee_amount
     OR NEW.fee_tax_amount IS DISTINCT FROM OLD.fee_tax_amount OR NEW.chargeback_amount IS DISTINCT FROM OLD.chargeback_amount OR NEW.adjustment_amount IS DISTINCT FROM OLD.adjustment_amount
     OR NEW.reported_net_amount IS DISTINCT FROM OLD.reported_net_amount OR NEW.provider_settlement_id IS DISTINCT FROM OLD.provider_settlement_id
     OR NEW.merchant_account_id IS DISTINCT FROM OLD.merchant_account_id OR NEW.settlement_date IS DISTINCT FROM OLD.settlement_date OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR NEW.bank_payout_reference IS DISTINCT FROM OLD.bank_payout_reference THEN
    RAISE EXCEPTION 'A settlement''s reported figures cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.finance_status = 'POSTED' AND (NEW.finance_status IS DISTINCT FROM OLD.finance_status OR NEW.finance_journal_entry_id IS DISTINCT FROM OLD.finance_journal_entry_id) THEN
    RAISE EXCEPTION 'A settlement is posted to Finance once.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payment_settlement_batches_guard' AND tgrelid = 'tenant.payment_settlement_batches'::regclass) THEN
    CREATE TRIGGER payment_settlement_batches_guard BEFORE UPDATE OR DELETE ON tenant.payment_settlement_batches FOR EACH ROW EXECUTE FUNCTION tenant.payment_settlement_batch_guard();
  END IF;
END $$;

-- ============================================================ 4. matches (capacity enforced by the database)
CREATE TABLE IF NOT EXISTS tenant.payment_reconciliation_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  layer text NOT NULL CHECK (layer IN ('PAYMENT_SETTLEMENT', 'REFUND_SETTLEMENT', 'BANK_RECEIPT')),
  internal_source_type text NOT NULL CHECK (internal_source_type IN ('pos_payment', 'payment_refund_component', 'payment_settlement_batch')),
  internal_source_id uuid NOT NULL,
  external_source_type text NOT NULL CHECK (external_source_type IN ('payment_settlement_line', 'accounting_bank_statement_line')),
  external_source_id uuid NOT NULL,
  matched_amount numeric(20, 2) NOT NULL CHECK (matched_amount > 0),
  currency_code text NOT NULL DEFAULT 'INR',
  match_type text NOT NULL CHECK (match_type IN ('AUTO', 'MANUAL')),
  match_rule text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PENDING_APPROVAL', 'ACTIVE', 'REVERSED')),
  reason text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key text,
  matched_by uuid NOT NULL REFERENCES public.users(id),
  matched_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  reversed_by uuid REFERENCES public.users(id),
  reversed_at timestamptz,
  reversal_reason text,
  version integer NOT NULL DEFAULT 1,
  CHECK (match_type = 'AUTO' OR reason IS NOT NULL),
  CHECK (status <> 'REVERSED' OR (reversed_by IS NOT NULL AND reversal_reason IS NOT NULL)),
  CHECK (approved_by IS NULL OR approved_by <> matched_by)
);
CREATE INDEX IF NOT EXISTS payment_reconciliation_matches_internal_idx ON tenant.payment_reconciliation_matches (organization_id, internal_source_type, internal_source_id) WHERE status <> 'REVERSED';
CREATE INDEX IF NOT EXISTS payment_reconciliation_matches_external_idx ON tenant.payment_reconciliation_matches (organization_id, external_source_type, external_source_id) WHERE status <> 'REVERSED';
CREATE UNIQUE INDEX IF NOT EXISTS payment_reconciliation_matches_key_uidx ON tenant.payment_reconciliation_matches (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- How much of a source can be matched: a payment's amount, a refund component's successful amount, a payout's net, a settlement line's gross,
-- a bank statement line's credit.
CREATE OR REPLACE FUNCTION tenant.payment_match_capacity(source_type text, source_id uuid) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE capacity numeric;
BEGIN
  -- One matcher per source at a time (held to the end of the transaction): a second one waits and then sees the first one's match.
  PERFORM pg_advisory_xact_lock(hashtextextended(source_type || ':' || source_id::text, 0));
  CASE source_type
    WHEN 'pos_payment' THEN SELECT amount INTO capacity FROM tenant.pos_payments WHERE id = source_id;
    WHEN 'payment_refund_component' THEN SELECT CASE WHEN status = 'succeeded' THEN GREATEST(successful_amount, allocated_amount) ELSE successful_amount END INTO capacity
      FROM tenant.payment_refund_components WHERE id = source_id;
    WHEN 'payment_settlement_batch' THEN SELECT calculated_net_amount INTO capacity FROM tenant.payment_settlement_batches WHERE id = source_id;
    WHEN 'payment_settlement_line' THEN SELECT abs(gross_amount) INTO capacity FROM tenant.payment_settlement_lines WHERE id = source_id;
    WHEN 'accounting_bank_statement_line' THEN SELECT GREATEST(credit_amount, debit_amount) INTO capacity FROM tenant.accounting_bank_statement_lines WHERE id = source_id;
    ELSE capacity := NULL;
  END CASE;
  RETURN capacity;
END $$;

CREATE OR REPLACE FUNCTION tenant.payment_match_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  internal_capacity numeric; external_capacity numeric; internal_used numeric; external_used numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A reconciliation match is reversed, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.internal_source_id IS DISTINCT FROM OLD.internal_source_id OR NEW.external_source_id IS DISTINCT FROM OLD.external_source_id OR NEW.matched_amount IS DISTINCT FROM OLD.matched_amount
       OR NEW.layer IS DISTINCT FROM OLD.layer OR NEW.match_rule IS DISTINCT FROM OLD.match_rule OR NEW.matched_by IS DISTINCT FROM OLD.matched_by THEN
      RAISE EXCEPTION 'A reconciliation match cannot be edited; reverse it and match again.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'REVERSED' THEN RAISE EXCEPTION 'A reversed match is final.' USING ERRCODE = 'check_violation'; END IF;
    NEW.version := OLD.version + 1;
    IF NEW.status = 'REVERSED' THEN RETURN NEW; END IF;
  END IF;
  internal_capacity := tenant.payment_match_capacity(NEW.internal_source_type, NEW.internal_source_id);
  external_capacity := tenant.payment_match_capacity(NEW.external_source_type, NEW.external_source_id);
  IF internal_capacity IS NULL OR external_capacity IS NULL THEN RAISE EXCEPTION 'The matched records were not found.' USING ERRCODE = 'foreign_key_violation'; END IF;
  SELECT COALESCE(sum(matched_amount), 0) INTO internal_used FROM tenant.payment_reconciliation_matches
   WHERE organization_id = NEW.organization_id AND internal_source_type = NEW.internal_source_type AND internal_source_id = NEW.internal_source_id AND status <> 'REVERSED' AND id <> NEW.id
     AND layer = NEW.layer;
  SELECT COALESCE(sum(matched_amount), 0) INTO external_used FROM tenant.payment_reconciliation_matches
   WHERE organization_id = NEW.organization_id AND external_source_type = NEW.external_source_type AND external_source_id = NEW.external_source_id AND status <> 'REVERSED' AND id <> NEW.id;
  IF internal_used + NEW.matched_amount > internal_capacity OR external_used + NEW.matched_amount > external_capacity THEN
    RAISE EXCEPTION 'This match would use more than the records hold.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payment_reconciliation_matches_guard' AND tgrelid = 'tenant.payment_reconciliation_matches'::regclass) THEN
    CREATE TRIGGER payment_reconciliation_matches_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.payment_reconciliation_matches FOR EACH ROW EXECUTE FUNCTION tenant.payment_match_guard();
  END IF;
END $$;

-- ============================================================ 5. the exception queue
CREATE TABLE IF NOT EXISTS tenant.payment_reconciliation_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  exception_number text NOT NULL,
  exception_code text NOT NULL CHECK (exception_code IN ('PAYMENT_MISSING_INTERNAL', 'PAYMENT_MISSING_PROVIDER', 'PAYMENT_AMOUNT_MISMATCH', 'PAYMENT_CURRENCY_MISMATCH',
    'PAYMENT_DUPLICATE', 'PAYMENT_UNAPPLIED', 'PAYMENT_STATUS_UNKNOWN', 'PAYMENT_WRONG_SOURCE', 'REFUND_MISSING_PROVIDER', 'REFUND_AMOUNT_MISMATCH', 'REFUND_DUPLICATE',
    'SETTLEMENT_MISSING', 'SETTLEMENT_AMOUNT_MISMATCH', 'SETTLEMENT_FEE_MISMATCH', 'BANK_RECEIPT_MISSING', 'BANK_RECEIPT_AMOUNT_MISMATCH', 'MERCHANT_ACCOUNT_MISMATCH',
    'CASH_SESSION_VARIANCE', 'FINANCE_POSTING_MISSING', 'PROVIDER_FILE_DUPLICATE', 'CHECKOUT_PAYMENT_MISMATCH', 'PROVIDER_ADJUSTMENT_REPORTED')),
  layer text NOT NULL CHECK (layer IN ('CHECKOUT', 'PROVIDER_PAYMENT', 'REFUND', 'SETTLEMENT', 'BANK', 'CASH', 'FINANCE')),
  store_id uuid REFERENCES tenant.pos_stores(id),
  merchant_account_id uuid REFERENCES tenant.payment_merchant_accounts(id),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  references_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  currency_code text NOT NULL DEFAULT 'INR',
  expected_amount numeric(20, 2),
  actual_amount numeric(20, 2),
  difference_amount numeric(20, 2),
  exposure_amount numeric(20, 2),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ASSIGNED', 'INVESTIGATING', 'AWAITING_EXTERNAL_EVIDENCE', 'ESCALATED', 'RESOLVED')),
  assigned_to uuid REFERENCES public.users(id),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution_type text CHECK (resolution_type IS NULL OR resolution_type IN ('MATCHED_WITH_EVIDENCE', 'CONDITION_CLEARED', 'CHECKOUT_RECOVERED', 'CUSTOMER_REFUNDED',
    'ACCEPTED_DIFFERENCE', 'FINANCE_CORRECTION_POSTED', 'PROVIDER_CORRECTED', 'DUPLICATE_IGNORED', 'OTHER')),
  resolution_reference text,
  resolution_note text,
  approval_requested_by uuid REFERENCES public.users(id),
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  detected_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CHECK (status <> 'RESOLVED' OR (resolved_at IS NOT NULL AND resolution_type IS NOT NULL AND resolution_note IS NOT NULL
    AND (resolution_type = 'CONDITION_CLEARED' OR jsonb_array_length(evidence) > 0 OR resolution_reference IS NOT NULL))),
  CHECK (approved_by IS NULL OR approval_requested_by IS NULL OR approved_by <> approval_requested_by)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_reconciliation_exceptions_number_uidx ON tenant.payment_reconciliation_exceptions (organization_id, exception_number);
CREATE UNIQUE INDEX IF NOT EXISTS payment_reconciliation_exceptions_open_uidx ON tenant.payment_reconciliation_exceptions (organization_id, exception_code, source_type, source_id)
  WHERE status <> 'RESOLVED';
CREATE INDEX IF NOT EXISTS payment_reconciliation_exceptions_queue_idx ON tenant.payment_reconciliation_exceptions (organization_id, status, detected_at);

CREATE OR REPLACE FUNCTION tenant.payment_exception_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A reconciliation exception cannot be deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.exception_code IS DISTINCT FROM OLD.exception_code OR NEW.source_type IS DISTINCT FROM OLD.source_type OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.detected_at IS DISTINCT FROM OLD.detected_at OR NEW.exception_number IS DISTINCT FROM OLD.exception_number THEN
    RAISE EXCEPTION 'An exception''s subject cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'RESOLVED' THEN RAISE EXCEPTION 'A resolved exception is final.' USING ERRCODE = 'check_violation'; END IF;
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payment_reconciliation_exceptions_guard' AND tgrelid = 'tenant.payment_reconciliation_exceptions'::regclass) THEN
    CREATE TRIGGER payment_reconciliation_exceptions_guard BEFORE UPDATE OR DELETE ON tenant.payment_reconciliation_exceptions FOR EACH ROW EXECUTE FUNCTION tenant.payment_exception_guard();
  END IF;
END $$;

-- ============================================================ 6. runs
CREATE TABLE IF NOT EXISTS tenant.payment_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  merchant_account_id uuid REFERENCES tenant.payment_merchant_accounts(id),
  run_type text NOT NULL CHECK (run_type IN ('ALL', 'PAYMENT', 'REFUND', 'SETTLEMENT', 'BANK')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  processed_count integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  exception_count integer NOT NULL DEFAULT 0,
  resolved_count integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  idempotency_key text,
  started_by uuid NOT NULL REFERENCES public.users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK (period_end > period_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_reconciliation_runs_key_uidx ON tenant.payment_reconciliation_runs (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================ 7. policy
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS reconciliation_unknown_after_minutes integer NOT NULL DEFAULT 30;
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS reconciliation_refund_overdue_days integer NOT NULL DEFAULT 7;
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS reconciliation_manual_approval_above numeric(20, 2) DEFAULT 10000;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_settings_reconciliation_check') THEN
    ALTER TABLE tenant.pos_settings ADD CONSTRAINT pos_settings_reconciliation_check CHECK (reconciliation_unknown_after_minutes BETWEEN 1 AND 10080
      AND reconciliation_refund_overdue_days BETWEEN 1 AND 90 AND (reconciliation_manual_approval_above IS NULL OR reconciliation_manual_approval_above >= 0));
  END IF;
END $$;

-- ============================================================ 8. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['payment_merchant_accounts', 'payment_reconciliation_imports', 'payment_settlement_batches', 'payment_settlement_lines', 'payment_reconciliation_matches',
                             'payment_reconciliation_exceptions', 'payment_reconciliation_runs'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.payment_merchant_accounts, tenant.payment_reconciliation_imports, tenant.payment_settlement_batches, tenant.payment_reconciliation_matches,
  tenant.payment_reconciliation_exceptions, tenant.payment_reconciliation_runs TO vercent_app;
GRANT SELECT, INSERT ON tenant.payment_settlement_lines TO vercent_app;
GRANT SELECT ON tenant.payment_merchant_accounts, tenant.payment_reconciliation_imports, tenant.payment_settlement_batches, tenant.payment_settlement_lines,
  tenant.payment_reconciliation_matches, tenant.payment_reconciliation_exceptions, tenant.payment_reconciliation_runs TO vercent_worker;
GRANT EXECUTE ON FUNCTION tenant.payment_match_capacity(text, uuid) TO vercent_app;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0108_payment_reconciliation.sql', 'payment-reconciliation') ON CONFLICT DO NOTHING;
