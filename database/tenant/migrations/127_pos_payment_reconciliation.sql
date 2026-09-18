BEGIN;

-- F304 payment reconciliation. Ties into F303's existing day-end report
-- (tenant.pos_day_end_reports) rather than being a disconnected shift-only
-- aggregate: migration 121 already reserved
-- reconciliation_status/reconciliation_references/outstanding_exceptions
-- on that table specifically for this workstream to populate, including
-- past a report's own 'closed' lock (its immutability trigger explicitly
-- exempts those three columns). A CLOSED day-end report is therefore the
-- unit of reconciliation work here, which is why tenant.pos_reconciliations
-- (unused since migration 048) is re-keyed below from (shift_id,
-- payment_method) to (day_end_report_id, payment_method): a business-day
-- report can span multiple shifts, so per-shift was never going to be the
-- right natural key for the aggregate this capability actually reconciles.
--
-- "A captured payment is not automatically a settled payment" (explicit
-- product instruction): tenant.pos_payments.status already distinguishes
-- 'captured' (money changed hands at the terminal) from every failure
-- state, but nothing distinguishes "captured" from "the provider's own
-- settlement batch actually paid this out" -- that is what
-- settlement_status/settled_amount/settlement_fee_amount/settled_at below
-- add. Cash needs no external settlement evidence (it's physically in the
-- till the moment it's captured) and is reconciled directly against F303's
-- own counted-vs-expected cash count instead of a settlement entry -- see
-- reconciliation.js.
ALTER TABLE tenant.pos_payments
  ADD COLUMN IF NOT EXISTS settlement_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (settlement_status IN ('not_applicable','pending','settled','exception')),
  ADD COLUMN IF NOT EXISTS settled_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
  ADD COLUMN IF NOT EXISTS settlement_fee_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (settlement_fee_amount >= 0),
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

-- A settlement batch is real evidence supplied by finance ops -- imported
-- from a provider statement/file/API export, or (in this environment,
-- where no live merchant-certified provider credential exists -- see
-- tender-and-payment-execution/adapter.js's own disclosed limitation) the
-- sandbox adapter's own test-settlement generator for end-to-end proof.
-- Reconciliation never fabricates a settlement; an entry only exists here
-- because something outside POS reported it.
CREATE TABLE IF NOT EXISTS tenant.pos_settlement_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  store_id uuid REFERENCES tenant.pos_stores(id),
  payment_method text NOT NULL CHECK (payment_method IN ('card','upi','bank_transfer','wallet','store_credit')),
  provider_key text NOT NULL,
  batch_reference text NOT NULL,
  settlement_date date NOT NULL,
  total_amount numeric(20,6) NOT NULL DEFAULT 0,
  total_fee_amount numeric(20,6) NOT NULL DEFAULT 0,
  entry_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'imported' CHECK (status IN ('imported','matched','closed')),
  imported_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,provider_key,batch_reference)
);

CREATE TABLE IF NOT EXISTS tenant.pos_settlement_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  batch_id uuid NOT NULL REFERENCES tenant.pos_settlement_batches(id),
  provider_reference text NOT NULL,
  amount numeric(20,6) NOT NULL,
  fee_amount numeric(20,6) NOT NULL DEFAULT 0,
  settled_at timestamptz NOT NULL,
  matched_payment_id uuid REFERENCES tenant.pos_payments(id),
  -- 'unmatched': the provider reported money POS has no captured-payment
  -- record for -- a real "missing transaction" exception, investigated,
  -- never silently absorbed. 'duplicate': this provider_reference already
  -- matched a payment via an earlier entry (either an earlier row in the
  -- same batch, or a previous batch) -- never double-counted or
  -- double-matched.
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','matched','duplicate')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,batch_id,provider_reference)
);

ALTER TABLE tenant.pos_payments
  ADD COLUMN IF NOT EXISTS settlement_entry_id uuid REFERENCES tenant.pos_settlement_entries(id);

CREATE INDEX IF NOT EXISTS pos_payments_settlement_lookup_idx
  ON tenant.pos_payments(organization_id,company_id,payment_method,provider_reference)
  WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS pos_settlement_entries_batch_idx
  ON tenant.pos_settlement_entries(organization_id,batch_id,match_status);

-- Re-key pos_reconciliations onto the day-end report (see header comment).
-- shift_id is retained (a shift-scoped report still has exactly one) but
-- is no longer part of the natural key; it becomes nullable for a
-- business-day-scoped report's rows, which don't correspond to one shift.
ALTER TABLE tenant.pos_reconciliations
  DROP CONSTRAINT IF EXISTS pos_reconciliations_shift_id_payment_method_key;
ALTER TABLE tenant.pos_reconciliations
  ALTER COLUMN shift_id DROP NOT NULL;
ALTER TABLE tenant.pos_reconciliations
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES tenant.pos_stores(id),
  ADD COLUMN IF NOT EXISTS day_end_report_id uuid REFERENCES tenant.pos_day_end_reports(id),
  ADD COLUMN IF NOT EXISTS reconciliation_number text,
  ADD COLUMN IF NOT EXISTS settled_amount numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_total numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS missing_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS matched_by uuid,
  ADD COLUMN IF NOT EXISTS matched_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS pos_reconciliations_report_method_uidx
  ON tenant.pos_reconciliations(organization_id,day_end_report_id,payment_method)
  WHERE day_end_report_id IS NOT NULL;

-- Immutable once resolved -- modeled directly on
-- tenant.pos_day_end_report_protect_closed() (migration 121). A resolved
-- reconciliation's figures never move; a later correction is a new row in
-- pos_reconciliation_corrections, the original stays as the permanent
-- record of what was investigated and signed off.
CREATE OR REPLACE FUNCTION tenant.pos_reconciliation_protect_resolved()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.status='resolved' THEN
    RAISE EXCEPTION 'A resolved POS reconciliation cannot be deleted; record a correction instead';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='resolved' THEN
    RAISE EXCEPTION 'A resolved POS reconciliation is immutable; record a linked correction instead of editing it';
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$;

DROP TRIGGER IF EXISTS pos_reconciliations_resolved_immutable ON tenant.pos_reconciliations;
CREATE TRIGGER pos_reconciliations_resolved_immutable
  BEFORE UPDATE OR DELETE ON tenant.pos_reconciliations
  FOR EACH ROW EXECUTE FUNCTION tenant.pos_reconciliation_protect_resolved();

CREATE TABLE IF NOT EXISTS tenant.pos_reconciliation_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL REFERENCES tenant.pos_reconciliations(id),
  correction_number text NOT NULL,
  reason text NOT NULL,
  adjustment jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_reconciliations_report_idx
  ON tenant.pos_reconciliations(organization_id,company_id,day_end_report_id);
CREATE INDEX IF NOT EXISTS pos_reconciliation_corrections_reconciliation_idx
  ON tenant.pos_reconciliation_corrections(organization_id,reconciliation_id);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'pos_settlement_batches',
    'pos_settlement_entries',
    'pos_reconciliation_corrections'
  ]
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON tenant.%I',table_name || '_organization_isolation',table_name);
    EXECUTE format(
      'CREATE POLICY %I ON tenant.%I USING (organization_id=tenant.current_organization_id()) WITH CHECK (organization_id=tenant.current_organization_id())',
      table_name || '_organization_isolation',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
