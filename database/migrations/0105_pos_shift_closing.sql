-- POS Shift Closing: the accountable end of a POS operating session and its cash session (built on Shift Opening, 0103, and Opening Cash
-- Float, 0104 — no separate closing ledger). Closing is a reconciliation and custody transfer; it never edits a sale, payment, refund or stock
-- movement to make the drawer balance.
--
--   closing state    beginning to close moves the session to CLOSING (new checkouts and payments stop; recovery of existing ones does not).
--                    Who began closing is recorded: another person continues only as a supervisor closing someone else's session.
--   blind counts     the cashier's closing counts, numbered; a recount supersedes the earlier count (both kept). Each count stores the expected
--                    cash and the difference at the moment it was submitted; the count used for the close is finalized. Counts never change.
--   closing record   one per session: opening float, expected, counted, difference (always counted − expected), its reason and approval, the
--                    count used, the custody result and an immutable snapshot (with its hash) that the closing report reproduces. A card / UPI
--                    session has no cash fields at all (not a counted ₹0).
--   destinations     where the closing cash went: left in the drawer for the next shift, the store safe, an authorized manager, or kept in the
--                    secured drawer pending a handover. Each amount is accounted for exactly once (they add up to the count) and stays pending
--                    until someone other than the closer accepts it (the next cashier's opening count accepts what stayed in the drawer).
--   exceptions       what a close carries forward with an accountable owner: the cash difference, payments whose outcome is unknown, refunds
--                    still with the provider, and anything a supervisor force-closed over.
--   prints           every print and reprint of the closing report (the report itself is the snapshot; printing changes nothing).
--
-- Additive only.

-- ============================================================ 1. closing state on the session
ALTER TABLE tenant.pos_shifts ADD COLUMN IF NOT EXISTS closing_started_at timestamptz;
ALTER TABLE tenant.pos_shifts ADD COLUMN IF NOT EXISTS closing_started_by uuid REFERENCES public.users(id);

-- ============================================================ 2. blind closing counts
CREATE TABLE IF NOT EXISTS tenant.pos_cash_closing_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  shift_id uuid NOT NULL REFERENCES tenant.pos_shifts(id),
  cash_session_id uuid NOT NULL REFERENCES tenant.pos_cash_sessions(id),
  count_sequence integer NOT NULL CHECK (count_sequence > 0),
  counted_amount numeric(20, 2) NOT NULL CHECK (counted_amount >= 0),
  denominations jsonb,
  expected_amount numeric(20, 2) NOT NULL,
  variance_amount numeric(20, 2) NOT NULL,
  counted_by uuid NOT NULL REFERENCES public.users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'SUPERSEDED', 'FINALIZED')),
  status_changed_at timestamptz,
  idempotency_key text,
  CHECK (variance_amount = counted_amount - expected_amount)
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_closing_counts_sequence_uidx ON tenant.pos_cash_closing_counts (organization_id, cash_session_id, count_sequence);
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_closing_counts_current_uidx ON tenant.pos_cash_closing_counts (organization_id, cash_session_id) WHERE status = 'SUBMITTED';
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_closing_counts_final_uidx ON tenant.pos_cash_closing_counts (organization_id, cash_session_id) WHERE status = 'FINALIZED';
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_closing_counts_key_uidx ON tenant.pos_cash_closing_counts (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION tenant.pos_cash_closing_count_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.counted_amount IS DISTINCT FROM OLD.counted_amount OR NEW.expected_amount IS DISTINCT FROM OLD.expected_amount OR NEW.variance_amount IS DISTINCT FROM OLD.variance_amount
     OR NEW.denominations IS DISTINCT FROM OLD.denominations OR NEW.counted_by IS DISTINCT FROM OLD.counted_by OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     OR NEW.cash_session_id IS DISTINCT FROM OLD.cash_session_id OR NEW.shift_id IS DISTINCT FROM OLD.shift_id OR NEW.count_sequence IS DISTINCT FROM OLD.count_sequence THEN
    RAISE EXCEPTION 'A closing cash count cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'A superseded or finalized closing count is final.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pos_cash_closing_counts_guard' AND tgrelid = 'tenant.pos_cash_closing_counts'::regclass) THEN
    CREATE TRIGGER pos_cash_closing_counts_guard BEFORE UPDATE ON tenant.pos_cash_closing_counts FOR EACH ROW EXECUTE FUNCTION tenant.pos_cash_closing_count_guard();
  END IF;
END $$;

-- ============================================================ 3. the closing record (immutable)
CREATE TABLE IF NOT EXISTS tenant.pos_shift_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  shift_id uuid NOT NULL REFERENCES tenant.pos_shifts(id),
  cash_session_id uuid REFERENCES tenant.pos_cash_sessions(id),
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  terminal_id uuid NOT NULL REFERENCES tenant.pos_terminals(id),
  cashier_user_id uuid NOT NULL REFERENCES public.users(id),
  closing_type text NOT NULL DEFAULT 'NORMAL' CHECK (closing_type IN ('NORMAL', 'FORCE')),
  closing_status text NOT NULL CHECK (closing_status IN ('CLOSED', 'FORCE_CLOSED')),
  opened_at timestamptz,
  closing_started_at timestamptz NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  currency_code text NOT NULL DEFAULT 'INR',
  opening_float_amount numeric(20, 2),
  expected_cash_amount numeric(20, 2),
  counted_cash_amount numeric(20, 2),
  variance_amount numeric(20, 2),
  variance_reason_code text,
  variance_reason text,
  approval_id uuid REFERENCES tenant.pos_permission_approvals(id),
  closing_count_id uuid REFERENCES tenant.pos_cash_closing_counts(id),
  cash_custody_status text NOT NULL CHECK (cash_custody_status IN ('NOT_APPLICABLE', 'NO_CASH', 'PENDING_ACCEPTANCE', 'TRANSFERRED')),
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  closed_by uuid NOT NULL REFERENCES public.users(id),
  close_reason text,
  idempotency_key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((closing_type = 'FORCE') = (closing_status = 'FORCE_CLOSED')),
  CHECK (closing_type = 'NORMAL' OR close_reason IS NOT NULL),
  -- A card / UPI session has no cash figures; a cash session always has all of them, and the difference is counted − expected.
  CHECK (cash_session_id IS NOT NULL OR (opening_float_amount IS NULL AND expected_cash_amount IS NULL AND counted_cash_amount IS NULL AND variance_amount IS NULL
         AND closing_count_id IS NULL AND cash_custody_status = 'NOT_APPLICABLE')),
  CHECK (cash_session_id IS NULL OR (opening_float_amount IS NOT NULL AND expected_cash_amount IS NOT NULL AND counted_cash_amount IS NOT NULL AND variance_amount IS NOT NULL
         AND closing_count_id IS NOT NULL AND cash_custody_status <> 'NOT_APPLICABLE' AND variance_amount = counted_cash_amount - expected_cash_amount)),
  CHECK (variance_amount IS NULL OR variance_amount = 0 OR variance_reason_code IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_shift_closings_shift_uidx ON tenant.pos_shift_closings (organization_id, shift_id);
CREATE UNIQUE INDEX IF NOT EXISTS pos_shift_closings_key_uidx ON tenant.pos_shift_closings (organization_id, idempotency_key);
CREATE INDEX IF NOT EXISTS pos_shift_closings_store_idx ON tenant.pos_shift_closings (organization_id, store_id, closed_at DESC);

CREATE OR REPLACE FUNCTION tenant.pos_shift_closing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A finalized shift closing cannot be changed; record a linked correction instead.' USING ERRCODE = 'check_violation';
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pos_shift_closings_guard' AND tgrelid = 'tenant.pos_shift_closings'::regclass) THEN
    CREATE TRIGGER pos_shift_closings_guard BEFORE UPDATE OR DELETE ON tenant.pos_shift_closings FOR EACH ROW EXECUTE FUNCTION tenant.pos_shift_closing_guard();
  END IF;
END $$;

ALTER TABLE tenant.pos_shifts ADD COLUMN IF NOT EXISTS closing_id uuid REFERENCES tenant.pos_shift_closings(id);

-- ============================================================ 4. where the closing cash went
CREATE TABLE IF NOT EXISTS tenant.pos_cash_custody_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  closing_id uuid NOT NULL REFERENCES tenant.pos_shift_closings(id),
  shift_id uuid NOT NULL REFERENCES tenant.pos_shifts(id),
  cash_session_id uuid NOT NULL REFERENCES tenant.pos_cash_sessions(id),
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  cash_drawer_id uuid REFERENCES tenant.pos_cash_drawers(id),
  destination_type text NOT NULL CHECK (destination_type IN ('NEXT_SHIFT_HANDOVER', 'STORE_SAFE', 'AUTHORIZED_MANAGER', 'SECURED_DRAWER_PENDING_HANDOVER')),
  amount numeric(20, 2) NOT NULL CHECK (amount > 0),
  currency_code text NOT NULL DEFAULT 'INR',
  reference text,
  note text,
  recipient_user_id uuid REFERENCES public.users(id),
  handover_id uuid REFERENCES tenant.pos_cash_handovers(id),
  status text NOT NULL DEFAULT 'PENDING_ACCEPTANCE' CHECK (status IN ('PENDING_ACCEPTANCE', 'ACCEPTED')),
  received_amount numeric(20, 2) CHECK (received_amount IS NULL OR received_amount >= 0),
  variance_amount numeric(20, 2),
  accepted_by uuid REFERENCES public.users(id),
  accepted_at timestamptz,
  acceptance_note text,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'ACCEPTED' OR (accepted_by IS NOT NULL AND accepted_at IS NOT NULL AND received_amount IS NOT NULL AND variance_amount = received_amount - amount)),
  CHECK (destination_type <> 'AUTHORIZED_MANAGER' OR recipient_user_id IS NOT NULL),
  CHECK (destination_type <> 'STORE_SAFE' OR reference IS NOT NULL),
  CHECK (destination_type NOT IN ('NEXT_SHIFT_HANDOVER', 'SECURED_DRAWER_PENDING_HANDOVER') OR handover_id IS NOT NULL),
  -- Cash leaving the drawer is accepted by someone other than the person who closed (the drawer's next custodian accepts what stayed in it).
  CHECK (destination_type IN ('NEXT_SHIFT_HANDOVER', 'SECURED_DRAWER_PENDING_HANDOVER') OR accepted_by IS NULL OR accepted_by <> created_by)
);
CREATE INDEX IF NOT EXISTS pos_cash_custody_transfers_closing_idx ON tenant.pos_cash_custody_transfers (organization_id, closing_id);
CREATE INDEX IF NOT EXISTS pos_cash_custody_transfers_pending_idx ON tenant.pos_cash_custody_transfers (organization_id, store_id, status) WHERE status = 'PENDING_ACCEPTANCE';
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_custody_transfers_handover_uidx ON tenant.pos_cash_custody_transfers (organization_id, handover_id) WHERE handover_id IS NOT NULL;

CREATE OR REPLACE FUNCTION tenant.pos_cash_custody_transfer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.destination_type IS DISTINCT FROM OLD.destination_type OR NEW.closing_id IS DISTINCT FROM OLD.closing_id
     OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id OR NEW.handover_id IS DISTINCT FROM OLD.handover_id OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.cash_session_id IS DISTINCT FROM OLD.cash_session_id THEN
    RAISE EXCEPTION 'A cash custody transfer cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'ACCEPTED' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.received_amount IS DISTINCT FROM OLD.received_amount OR NEW.accepted_by IS DISTINCT FROM OLD.accepted_by) THEN
    RAISE EXCEPTION 'An accepted cash custody transfer is final.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pos_cash_custody_transfers_guard' AND tgrelid = 'tenant.pos_cash_custody_transfers'::regclass) THEN
    CREATE TRIGGER pos_cash_custody_transfers_guard BEFORE UPDATE ON tenant.pos_cash_custody_transfers FOR EACH ROW EXECUTE FUNCTION tenant.pos_cash_custody_transfer_guard();
  END IF;
END $$;

-- ============================================================ 5. what a close carries forward, with an owner
CREATE TABLE IF NOT EXISTS tenant.pos_shift_closing_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  shift_id uuid NOT NULL REFERENCES tenant.pos_shifts(id),
  closing_id uuid REFERENCES tenant.pos_shift_closings(id),
  exception_type text NOT NULL CHECK (exception_type IN ('CASH_VARIANCE', 'PAYMENT_UNKNOWN', 'SPLIT_PAYMENT', 'ACTIVE_CHECKOUT', 'CASH_CUSTODY', 'CASH_REFUND', 'DIGITAL_REFUND', 'RETURN_PENDING')),
  reference_type text,
  reference_id uuid,
  amount numeric(20, 2),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ASSIGNED', 'RESOLVED')),
  assigned_to uuid REFERENCES public.users(id),
  assigned_queue text,
  approval_id uuid REFERENCES tenant.pos_permission_approvals(id),
  note text,
  resolution_note text,
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'ASSIGNED' OR assigned_to IS NOT NULL OR assigned_queue IS NOT NULL),
  CHECK (status <> 'RESOLVED' OR (resolved_at IS NOT NULL AND resolution_note IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_shift_closing_exceptions_ref_uidx ON tenant.pos_shift_closing_exceptions (organization_id, shift_id, exception_type, reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pos_shift_closing_exceptions_open_idx ON tenant.pos_shift_closing_exceptions (organization_id, status) WHERE status <> 'RESOLVED';

CREATE OR REPLACE FUNCTION tenant.pos_shift_closing_exception_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.shift_id IS DISTINCT FROM OLD.shift_id OR NEW.exception_type IS DISTINCT FROM OLD.exception_type OR NEW.reference_id IS DISTINCT FROM OLD.reference_id
     OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.created_by IS DISTINCT FROM OLD.created_by OR (OLD.closing_id IS NOT NULL AND NEW.closing_id IS DISTINCT FROM OLD.closing_id) THEN
    RAISE EXCEPTION 'A closing exception''s subject cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'RESOLVED' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.resolution_note IS DISTINCT FROM OLD.resolution_note) THEN
    RAISE EXCEPTION 'A resolved closing exception is final.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pos_shift_closing_exceptions_guard' AND tgrelid = 'tenant.pos_shift_closing_exceptions'::regclass) THEN
    CREATE TRIGGER pos_shift_closing_exceptions_guard BEFORE UPDATE ON tenant.pos_shift_closing_exceptions FOR EACH ROW EXECUTE FUNCTION tenant.pos_shift_closing_exception_guard();
  END IF;
END $$;

-- ============================================================ 6. closing report prints
CREATE TABLE IF NOT EXISTS tenant.pos_shift_closing_prints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  closing_id uuid NOT NULL REFERENCES tenant.pos_shift_closings(id),
  variant text NOT NULL CHECK (variant IN ('CASHIER', 'RECONCILIATION')),
  format text NOT NULL CHECK (format IN ('THERMAL', 'A4')),
  is_reprint boolean NOT NULL DEFAULT false,
  reason text,
  printed_by uuid NOT NULL REFERENCES public.users(id),
  printed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_shift_closing_prints_closing_idx ON tenant.pos_shift_closing_prints (organization_id, closing_id, printed_at);

-- ============================================================ 7. policy
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS closing_variance_approval_above numeric(20, 2) DEFAULT 0;
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS closing_variance_block_above numeric(20, 2);
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS closing_blind_count boolean NOT NULL DEFAULT true;
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS closing_reveal_expected_after_count boolean NOT NULL DEFAULT true;
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS closing_variance_reasons jsonb NOT NULL DEFAULT
  '["COUNTING_ERROR", "INCORRECT_CHANGE", "CASH_REFUND_DISCREPANCY", "MISSING_CASH_MOVEMENT", "DRAWER_SHORTAGE", "DRAWER_OVERAGE", "OTHER"]'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_settings_closing_variance_check') THEN
    ALTER TABLE tenant.pos_settings ADD CONSTRAINT pos_settings_closing_variance_check
      CHECK ((closing_variance_approval_above IS NULL OR closing_variance_approval_above >= 0) AND (closing_variance_block_above IS NULL OR closing_variance_block_above > 0)
             AND jsonb_typeof(closing_variance_reasons) = 'array');
  END IF;
END $$;

-- ============================================================ 8. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['pos_cash_closing_counts', 'pos_shift_closings', 'pos_cash_custody_transfers', 'pos_shift_closing_exceptions', 'pos_shift_closing_prints'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.pos_cash_closing_counts, tenant.pos_cash_custody_transfers, tenant.pos_shift_closing_exceptions TO vercent_app;
GRANT SELECT, INSERT ON tenant.pos_shift_closings, tenant.pos_shift_closing_prints TO vercent_app;
GRANT SELECT ON tenant.pos_cash_closing_counts, tenant.pos_shift_closings, tenant.pos_cash_custody_transfers, tenant.pos_shift_closing_exceptions, tenant.pos_shift_closing_prints
  TO vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0105_pos_shift_closing.sql', 'pos-shift-closing') ON CONFLICT DO NOTHING;
