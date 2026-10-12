-- 0092 POS Cash Payments: physical cash taken at checkout, with the change given, recorded against the exact cash session that handled it.
-- The session's expected cash moves by what the drawer really gains (cash received less change), never by the gross tender; cash taken
-- for a sale that could not be finalised stays visible until it is finalised or handed back. Finance keeps the accounting.
--
-- 1. A cash payment keeps the tender: cash received, change due, change given, the amount applied to the sale (pos_payments.amount), who
--    confirmed receiving it and when, the terminal, the bill version, and its custody: pending (received, sale not finalised), completed,
--    returned (handed back) or reconciliation_required. Once part of a finished sale its figures never change.
-- 2. Cash movements say what physically happened (cash received, change given, uncompleted tender handed back, refund paid, paid in/out,
--    opening, closing adjustment) and which payment they belong to; a retried request cannot add a movement twice; movements are
--    append-only (a correction is a new, linked movement).
-- 3. Company policy: cash on or off, quick tender amounts and the notes they are built from, a safety ceiling on one cash tender and a
--    large-cash warning level. No automatic cash rounding.

-- ============================================================ 1. cash tenders

ALTER TABLE tenant.pos_payments
  ADD COLUMN IF NOT EXISTS terminal_id uuid REFERENCES tenant.pos_terminals(id),
  ADD COLUMN IF NOT EXISTS cart_version integer,
  ADD COLUMN IF NOT EXISTS cash_received_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS change_due_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS change_given_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS cash_receipt_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS change_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS custody_status text,
  ADD COLUMN IF NOT EXISTS custody_note text,
  ADD COLUMN IF NOT EXISTS custody_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS custody_resolved_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalization_error text,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_payments_custody_status_check') THEN
    ALTER TABLE tenant.pos_payments ADD CONSTRAINT pos_payments_custody_status_check
      CHECK (custody_status IS NULL OR custody_status IN ('pending', 'completed', 'returned', 'reconciliation_required'));
  END IF;
  -- Cash received = amount applied + change given; nothing negative.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_payments_cash_tender_check') THEN
    ALTER TABLE tenant.pos_payments ADD CONSTRAINT pos_payments_cash_tender_check CHECK (
      cash_received_amount IS NULL OR (
        payment_method = 'cash' AND cash_received_amount > 0 AND COALESCE(change_due_amount, 0) >= 0 AND COALESCE(change_given_amount, 0) >= 0
        AND cash_received_amount - COALESCE(change_given_amount, 0) = amount));
  END IF;
END $$;

-- At most one cash tender in hand per bill at a time (pending custody).
CREATE UNIQUE INDEX IF NOT EXISTS pos_payments_one_pending_cash_uidx ON tenant.pos_payments (organization_id, cart_id)
  WHERE payment_method = 'cash' AND custody_status = 'pending';
CREATE INDEX IF NOT EXISTS pos_payments_cash_custody_idx ON tenant.pos_payments (organization_id, shift_id, custody_status) WHERE payment_method = 'cash';

-- A payment that is part of a finished sale keeps its figures (refund totals and settlement still move).
CREATE OR REPLACE FUNCTION tenant.pos_payment_completed_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sale_id IS NOT NULL AND (NEW.amount IS DISTINCT FROM OLD.amount OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.sale_id IS DISTINCT FROM OLD.sale_id OR NEW.shift_id IS DISTINCT FROM OLD.shift_id
     OR NEW.cash_received_amount IS DISTINCT FROM OLD.cash_received_amount OR NEW.change_given_amount IS DISTINCT FROM OLD.change_given_amount
     OR NEW.change_due_amount IS DISTINCT FROM OLD.change_due_amount) THEN
    RAISE EXCEPTION 'A payment that is part of a completed sale cannot be changed; use a refund.' USING ERRCODE = 'check_violation', CONSTRAINT = 'pos_payment_completed_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER pos_payments_completed_guard BEFORE UPDATE OF amount, payment_method, sale_id, shift_id, cash_received_amount, change_given_amount, change_due_amount
  ON tenant.pos_payments FOR EACH ROW EXECUTE FUNCTION tenant.pos_payment_completed_guard();

-- ============================================================ 2. cash movements

ALTER TABLE tenant.pos_cash_movements
  ADD COLUMN IF NOT EXISTS cash_event text,
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES tenant.pos_payments(id),
  ADD COLUMN IF NOT EXISTS terminal_id uuid REFERENCES tenant.pos_terminals(id),
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES tenant.pos_stores(id),
  ADD COLUMN IF NOT EXISTS currency_code text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS compensates_movement_id uuid REFERENCES tenant.pos_cash_movements(id);

-- What each existing movement was, before movements become append-only.
UPDATE tenant.pos_cash_movements SET cash_event = CASE movement_type
    WHEN 'opening' THEN 'opening' WHEN 'sale' THEN 'sale_net' WHEN 'refund' THEN 'cash_refund_paid'
    WHEN 'paid_in' THEN 'cash_movement_in' WHEN 'paid_out' THEN 'cash_movement_out' ELSE 'closing_adjustment' END
 WHERE cash_event IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_cash_movements_cash_event_check') THEN
    ALTER TABLE tenant.pos_cash_movements ADD CONSTRAINT pos_cash_movements_cash_event_check CHECK (cash_event IS NULL OR cash_event IN (
      'opening', 'sale_net', 'sale_cash_received', 'sale_change_given', 'uncompleted_tender_cash_returned', 'cash_refund_paid',
      'cash_movement_in', 'cash_movement_out', 'closing_adjustment'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_movements_idempotency_uidx ON tenant.pos_cash_movements (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS pos_cash_movements_payment_idx ON tenant.pos_cash_movements (organization_id, payment_id) WHERE payment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION tenant.pos_cash_movement_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Only labelling an unlabelled movement (its event) is allowed; amounts, shift and references never change.
  IF OLD.cash_event IS NULL AND (to_jsonb(NEW) - 'cash_event') = (to_jsonb(OLD) - 'cash_event') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Cash movements cannot be changed; record a correcting movement.' USING ERRCODE = 'check_violation', CONSTRAINT = 'pos_cash_movement_append_only';
END;
$$;
CREATE OR REPLACE TRIGGER pos_cash_movements_append_only BEFORE UPDATE ON tenant.pos_cash_movements FOR EACH ROW EXECUTE FUNCTION tenant.pos_cash_movement_append_only();

-- ============================================================ 3. policy

ALTER TABLE tenant.pos_settings
  ADD COLUMN IF NOT EXISTS cash_payments_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cash_quick_amounts_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cash_denominations jsonb NOT NULL DEFAULT '[10, 20, 50, 100, 200, 500]'::jsonb,
  ADD COLUMN IF NOT EXISTS max_cash_tender_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS large_cash_warning_amount numeric(20,6);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_settings_cash_policy_check') THEN
    ALTER TABLE tenant.pos_settings ADD CONSTRAINT pos_settings_cash_policy_check CHECK (
      (max_cash_tender_amount IS NULL OR max_cash_tender_amount > 0) AND (large_cash_warning_amount IS NULL OR large_cash_warning_amount > 0)
      AND jsonb_typeof(cash_denominations) = 'array');
  END IF;
END $$;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0092_pos_cash_payments.sql', 'pos-cash-payments') ON CONFLICT DO NOTHING;
