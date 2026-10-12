-- POS Cash Difference: shortages and overages as reconciliation results of the cash session (built on Shift Opening 0103, Opening Cash Float
-- 0104 and Shift Closing 0105 — no separate cash ledger, no cash movement is ever created for a difference).
--
--   one formula      difference = physically counted − reference, everywhere. The reference is the expected cash (closing), the documented
--                    handover (opening) or the amount handed over (a custody transfer accepted later). Negative = shortage, positive = overage.
--   ledger version   each closing count records the cash ledger version it was compared with (the number of the session's cash events, which
--                    are append-only). A later cash event makes that comparison — and any approval of it — stale: count again.
--   policy           the tolerance (within it, a reason is enough), the approval threshold and the hard limit can differ for shortages and
--                    overages; each count and difference keeps the policy version (a hash of the rules) it was evaluated under.
--   cases            every non-zero difference is a case: its context, reference, count, difference, reason, approval, policy, and the
--                    custody it belongs to. Cases are investigated and resolved (with a Finance treatment reference) without ever touching
--                    the count, the variance or the closed session. A handover difference can be linked to the closing it came from, so the
--                    same missing cash is not counted twice.
--
-- Additive only.

-- ============================================================ 1. reasons and sign-specific policy
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS closing_shortage_approval_above numeric(20, 2);
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS closing_overage_approval_above numeric(20, 2);
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS closing_shortage_block_above numeric(20, 2);
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS closing_overage_block_above numeric(20, 2);
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS cash_difference_unknown_note_required boolean NOT NULL DEFAULT true;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_settings_cash_difference_check') THEN
    ALTER TABLE tenant.pos_settings ADD CONSTRAINT pos_settings_cash_difference_check
      CHECK ((closing_shortage_approval_above IS NULL OR closing_shortage_approval_above >= 0) AND (closing_overage_approval_above IS NULL OR closing_overage_approval_above >= 0)
             AND (closing_shortage_block_above IS NULL OR closing_shortage_block_above > 0) AND (closing_overage_block_above IS NULL OR closing_overage_block_above > 0));
  END IF;
END $$;
ALTER TABLE tenant.pos_settings ALTER COLUMN closing_variance_reasons SET DEFAULT
  '["COUNTING_ERROR", "INCORRECT_CHANGE", "CASH_REFUND_ERROR", "MISSING_CASH_MOVEMENT", "CASH_RECEIPT_ERROR", "DRAWER_SHORTAGE", "DRAWER_OVERAGE", "PREVIOUS_HANDOVER_MISMATCH", "UNKNOWN", "OTHER"]'::jsonb;
UPDATE tenant.pos_settings
   SET closing_variance_reasons = '["COUNTING_ERROR", "INCORRECT_CHANGE", "CASH_REFUND_ERROR", "MISSING_CASH_MOVEMENT", "CASH_RECEIPT_ERROR", "DRAWER_SHORTAGE", "DRAWER_OVERAGE", "PREVIOUS_HANDOVER_MISMATCH", "UNKNOWN", "OTHER"]'::jsonb
 WHERE closing_variance_reasons = '["COUNTING_ERROR", "INCORRECT_CHANGE", "CASH_REFUND_DISCREPANCY", "MISSING_CASH_MOVEMENT", "DRAWER_SHORTAGE", "DRAWER_OVERAGE", "OTHER"]'::jsonb;

-- ============================================================ 2. what each closing count was compared with
ALTER TABLE tenant.pos_cash_closing_counts ADD COLUMN IF NOT EXISTS cash_ledger_version integer;
ALTER TABLE tenant.pos_cash_closing_counts ADD COLUMN IF NOT EXISTS policy_version text;

CREATE OR REPLACE FUNCTION tenant.pos_cash_closing_count_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.counted_amount IS DISTINCT FROM OLD.counted_amount OR NEW.expected_amount IS DISTINCT FROM OLD.expected_amount OR NEW.variance_amount IS DISTINCT FROM OLD.variance_amount
     OR NEW.denominations IS DISTINCT FROM OLD.denominations OR NEW.counted_by IS DISTINCT FROM OLD.counted_by OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     OR NEW.cash_session_id IS DISTINCT FROM OLD.cash_session_id OR NEW.shift_id IS DISTINCT FROM OLD.shift_id OR NEW.count_sequence IS DISTINCT FROM OLD.count_sequence
     OR NEW.cash_ledger_version IS DISTINCT FROM OLD.cash_ledger_version OR NEW.policy_version IS DISTINCT FROM OLD.policy_version THEN
    RAISE EXCEPTION 'A closing cash count cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'A superseded or finalized closing count is final.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ============================================================ 3. cash difference cases
CREATE TABLE IF NOT EXISTS tenant.pos_cash_differences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  difference_number text NOT NULL,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  terminal_id uuid REFERENCES tenant.pos_terminals(id),
  cash_drawer_id uuid REFERENCES tenant.pos_cash_drawers(id),
  cash_session_id uuid REFERENCES tenant.pos_cash_sessions(id),
  operating_session_id uuid NOT NULL REFERENCES tenant.pos_shifts(id),
  cashier_user_id uuid REFERENCES public.users(id),
  difference_context text NOT NULL CHECK (difference_context IN ('OPENING', 'CLOSING', 'HANDOVER')),
  currency_code text NOT NULL DEFAULT 'INR',
  reference_amount numeric(20, 2) NOT NULL,
  counted_amount numeric(20, 2) NOT NULL CHECK (counted_amount >= 0),
  difference_amount numeric(20, 2) NOT NULL,
  count_id uuid REFERENCES tenant.pos_cash_closing_counts(id),
  cash_ledger_version integer,
  recounts integer NOT NULL DEFAULT 0 CHECK (recounts >= 0),
  reason_code text,
  reason_note text,
  policy_version text,
  policy jsonb,
  evaluation jsonb,
  approval_id uuid REFERENCES tenant.pos_permission_approvals(id),
  closing_id uuid REFERENCES tenant.pos_shift_closings(id),
  handover_id uuid REFERENCES tenant.pos_cash_handovers(id),
  transfer_id uuid REFERENCES tenant.pos_cash_custody_transfers(id),
  related_difference_id uuid REFERENCES tenant.pos_cash_differences(id),
  case_status text NOT NULL DEFAULT 'OPEN' CHECK (case_status IN ('OPEN', 'INVESTIGATING', 'RESOLVED')),
  assigned_to uuid REFERENCES public.users(id),
  investigation_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution_type text CHECK (resolution_type IS NULL OR resolution_type IN ('SHORTAGE_ACCEPTED', 'OVERAGE_ACCEPTED', 'CASH_MOVEMENT_CORRECTION', 'CUSTODY_RESOLVED',
    'SAME_AS_LINKED_DIFFERENCE', 'OTHER')),
  resolution_note text,
  resolution_movement_id uuid REFERENCES tenant.pos_cash_movements(id),
  finance_status text NOT NULL DEFAULT 'PENDING' CHECK (finance_status IN ('PENDING', 'RECORDED', 'NOT_REQUIRED')),
  finance_treatment text CHECK (finance_treatment IS NULL OR finance_treatment IN ('SHORTAGE_EXPENSE', 'OVERAGE_INCOME', 'SUSPENSE', 'NO_ENTRY')),
  finance_adjustment_reference text,
  finance_recorded_by uuid REFERENCES public.users(id),
  finance_recorded_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  CHECK (difference_amount = counted_amount - reference_amount AND difference_amount <> 0),
  CHECK (difference_context <> 'CLOSING' OR (cash_session_id IS NOT NULL AND count_id IS NOT NULL AND cash_ledger_version IS NOT NULL)),
  CHECK (difference_context <> 'OPENING' OR handover_id IS NOT NULL),
  CHECK (difference_context <> 'HANDOVER' OR transfer_id IS NOT NULL),
  CHECK (case_status <> 'RESOLVED' OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_type IS NOT NULL AND resolution_note IS NOT NULL)),
  CHECK (resolution_type IS DISTINCT FROM 'CASH_MOVEMENT_CORRECTION' OR resolution_movement_id IS NOT NULL),
  CHECK (resolution_type IS DISTINCT FROM 'SAME_AS_LINKED_DIFFERENCE' OR related_difference_id IS NOT NULL),
  CHECK (finance_status <> 'RECORDED' OR (finance_treatment IS NOT NULL AND finance_recorded_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_differences_number_uidx ON tenant.pos_cash_differences (organization_id, difference_number);
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_differences_closing_uidx ON tenant.pos_cash_differences (organization_id, cash_session_id) WHERE difference_context = 'CLOSING';
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_differences_opening_uidx ON tenant.pos_cash_differences (organization_id, handover_id) WHERE difference_context = 'OPENING';
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_differences_transfer_uidx ON tenant.pos_cash_differences (organization_id, transfer_id) WHERE difference_context = 'HANDOVER';
CREATE INDEX IF NOT EXISTS pos_cash_differences_report_idx ON tenant.pos_cash_differences (organization_id, store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pos_cash_differences_open_idx ON tenant.pos_cash_differences (organization_id, case_status) WHERE case_status <> 'RESOLVED';

-- The difference itself never changes; a case moves forward (open → investigating → resolved) and is final once resolved; Finance links its
-- treatment once.
CREATE OR REPLACE FUNCTION tenant.pos_cash_difference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reference_amount IS DISTINCT FROM OLD.reference_amount OR NEW.counted_amount IS DISTINCT FROM OLD.counted_amount OR NEW.difference_amount IS DISTINCT FROM OLD.difference_amount
     OR NEW.difference_context IS DISTINCT FROM OLD.difference_context OR NEW.count_id IS DISTINCT FROM OLD.count_id OR NEW.cash_ledger_version IS DISTINCT FROM OLD.cash_ledger_version
     OR NEW.reason_code IS DISTINCT FROM OLD.reason_code OR NEW.reason_note IS DISTINCT FROM OLD.reason_note OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.approval_id IS DISTINCT FROM OLD.approval_id OR NEW.operating_session_id IS DISTINCT FROM OLD.operating_session_id OR NEW.cash_session_id IS DISTINCT FROM OLD.cash_session_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.closing_id IS NOT NULL AND NEW.closing_id IS DISTINCT FROM OLD.closing_id) THEN
    RAISE EXCEPTION 'A cash difference cannot be changed; add to its case instead.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.case_status = 'RESOLVED' AND (NEW.case_status IS DISTINCT FROM OLD.case_status OR NEW.resolution_type IS DISTINCT FROM OLD.resolution_type
       OR NEW.resolution_note IS DISTINCT FROM OLD.resolution_note OR NEW.resolution_movement_id IS DISTINCT FROM OLD.resolution_movement_id) THEN
    RAISE EXCEPTION 'A resolved cash difference case is final.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.finance_status <> 'PENDING' AND (NEW.finance_status IS DISTINCT FROM OLD.finance_status OR NEW.finance_treatment IS DISTINCT FROM OLD.finance_treatment
       OR NEW.finance_adjustment_reference IS DISTINCT FROM OLD.finance_adjustment_reference) THEN
    RAISE EXCEPTION 'The Finance treatment of a cash difference is recorded once.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pos_cash_differences_guard' AND tgrelid = 'tenant.pos_cash_differences'::regclass) THEN
    CREATE TRIGGER pos_cash_differences_guard BEFORE UPDATE ON tenant.pos_cash_differences FOR EACH ROW EXECUTE FUNCTION tenant.pos_cash_difference_guard();
  END IF;
END $$;

-- ============================================================ 4. differences already recorded (closings and handover openings before this)
INSERT INTO tenant.pos_cash_differences (organization_id, difference_number, store_id, terminal_id, cash_drawer_id, cash_session_id, operating_session_id, cashier_user_id,
  difference_context, currency_code, reference_amount, counted_amount, difference_amount, count_id, cash_ledger_version, reason_code, reason_note, approval_id, closing_id,
  created_by, created_at)
SELECT closing.organization_id, 'CD-C-' || substr(replace(closing.id::text, '-', ''), 1, 12), closing.store_id, closing.terminal_id, cash.cash_drawer_id, closing.cash_session_id,
       closing.shift_id, closing.cashier_user_id, 'CLOSING', closing.currency_code, closing.expected_cash_amount, closing.counted_cash_amount, closing.variance_amount,
       closing.closing_count_id, COALESCE((SELECT count(*)::int FROM tenant.pos_cash_movements movement WHERE movement.organization_id = closing.organization_id AND movement.shift_id = closing.shift_id), 0),
       closing.variance_reason_code, closing.variance_reason, closing.approval_id, closing.id, closing.closed_by, closing.closed_at
  FROM tenant.pos_shift_closings closing
  JOIN tenant.pos_cash_sessions cash ON cash.organization_id = closing.organization_id AND cash.id = closing.cash_session_id
 WHERE closing.variance_amount IS NOT NULL AND closing.variance_amount <> 0
ON CONFLICT DO NOTHING;
INSERT INTO tenant.pos_cash_differences (organization_id, difference_number, store_id, terminal_id, cash_drawer_id, cash_session_id, operating_session_id, cashier_user_id,
  difference_context, currency_code, reference_amount, counted_amount, difference_amount, reason_note, approval_id, handover_id, created_by, created_at)
SELECT cash.organization_id, 'CD-O-' || substr(replace(cash.id::text, '-', ''), 1, 12), cash.store_id, cash.terminal_id, cash.cash_drawer_id, cash.id, cash.operating_session_id,
       cash.opening_confirmed_by, 'OPENING', cash.currency_code, cash.handover_amount, cash.opening_float_amount, cash.opening_float_amount - cash.handover_amount,
       cash.variance_reason, cash.approval_id, cash.handover_id, cash.opening_confirmed_by, cash.opening_confirmed_at
  FROM tenant.pos_cash_sessions cash
 WHERE cash.handover_id IS NOT NULL AND cash.handover_amount IS NOT NULL AND cash.opening_float_amount <> cash.handover_amount
ON CONFLICT DO NOTHING;

-- ============================================================ 5. isolation and grants
ALTER TABLE tenant.pos_cash_differences ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_cash_differences FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'pos_cash_differences' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.pos_cash_differences USING (organization_id = tenant.current_organization_id())
      WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.pos_cash_differences TO vercent_app;
GRANT SELECT ON tenant.pos_cash_differences TO vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0106_pos_cash_difference.sql', 'pos-cash-difference') ON CONFLICT DO NOTHING;
