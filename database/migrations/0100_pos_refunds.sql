-- 0100 Refunds: returning money, once, for an authorized source — kept apart from approving it and from sending it. A refund is an
-- obligation (how much is owed, why, approved by whom) split into components, one per original tender (cash, card, UPI …), each with its
-- own state; every provider call is an attempt of its own; outcomes that cannot be determined go to a reconciliation queue.
--
-- 1. Refunds: the source (a posted return, a payment captured for a checkout that never completed, a verified duplicate / excess payment),
--    the sale and outlet, the authorized amount and currency, the reason, the state (draft → awaiting approval → authorized → processing →
--    partially refunded → refunded; failed — action required; reconciliation required; cancelled), approval, version, timestamps.
-- 2. Components: the original payment (or provider reference) refunded, the method, the amount reserved and the amount confirmed paid, the
--    state (pending, submitted, processing, succeeded, failed, unknown, cancel pending, cancelled), the cash session and movement of a cash
--    payout, the provider refund reference, an idempotency key. What is reserved and unresolved keeps counting against the original tender:
--    a payment is never refunded beyond what was taken, whatever two counters do at once.
-- 3. Attempts: each execution of a component — amount, idempotency key, provider references, outcome, error — never rewritten in substance.
-- 4. Reconciliation exceptions: unknown outcomes, provider failures, amount mismatches, duplicate payouts — open until resolved by someone
--    authorized, with the evidence.
-- 5. Links from the return's refund ledger and the card refund attempts to the component they belong to.

-- ============================================================ 1. refunds

CREATE TABLE IF NOT EXISTS tenant.payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid REFERENCES tenant.pos_stores(id),
  refund_number text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('pos_return', 'checkout_failure', 'payment_exception')),
  source_id uuid NOT NULL,
  sale_id uuid REFERENCES tenant.pos_sales(id),
  original_payment_id uuid REFERENCES tenant.pos_payments(id),
  authorized_amount numeric(20,6) NOT NULL CHECK (authorized_amount > 0),
  currency_code text NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'awaiting_approval', 'authorized', 'processing', 'partially_refunded', 'refunded', 'failed_action_required', 'reconciliation_required', 'cancelled')),
  reason_code text NOT NULL CHECK (reason_code IN ('return_refund', 'duplicate_payment', 'excess_payment', 'checkout_failure', 'authorized_correction', 'payment_reversal', 'other')),
  reason_note text,
  approval_required boolean NOT NULL DEFAULT false,
  approved_version integer,
  approval_note text,
  idempotency_key text,
  created_by uuid REFERENCES public.users(id),
  authorized_by uuid REFERENCES public.users(id),
  executed_by uuid REFERENCES public.users(id),
  cancelled_by uuid REFERENCES public.users(id),
  cancel_reason text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  authorized_at timestamptz,
  executed_at timestamptz,
  resolved_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, refund_number),
  CHECK (reason_code <> 'other' OR reason_note IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_key_uidx ON tenant.payment_refunds (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_refunds_source_idx ON tenant.payment_refunds (organization_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS payment_refunds_status_idx ON tenant.payment_refunds (organization_id, status, created_at DESC);
ALTER TABLE tenant.payment_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.payment_refunds FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'payment_refunds' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.payment_refunds USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.payment_refunds TO vercent_app;
GRANT SELECT ON tenant.payment_refunds TO vercent_worker;

-- The authorized amount never grows without a new authorization, and a finished refund keeps its amount and source.
CREATE OR REPLACE FUNCTION tenant.payment_refund_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.authorized_amount IS DISTINCT FROM OLD.authorized_amount OR NEW.source_type IS DISTINCT FROM OLD.source_type OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.refund_number IS DISTINCT FROM OLD.refund_number OR NEW.currency_code IS DISTINCT FROM OLD.currency_code OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'A refund''s amount and source cannot be changed; cancel it and authorize a new one.' USING ERRCODE = 'check_violation', CONSTRAINT = 'payment_refund_immutable';
  END IF;
  IF OLD.status IN ('refunded', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A finished refund cannot change state.' USING ERRCODE = 'check_violation', CONSTRAINT = 'payment_refund_final';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER payment_refunds_guard BEFORE UPDATE ON tenant.payment_refunds FOR EACH ROW EXECUTE FUNCTION tenant.payment_refund_guard();

-- ============================================================ 2. components

CREATE TABLE IF NOT EXISTS tenant.payment_refund_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  refund_id uuid NOT NULL REFERENCES tenant.payment_refunds(id),
  payment_id uuid REFERENCES tenant.pos_payments(id),
  refund_method text NOT NULL CHECK (refund_method IN ('cash', 'card', 'upi', 'wallet', 'bank_transfer', 'store_credit')),
  allocated_amount numeric(20,6) NOT NULL CHECK (allocated_amount > 0),
  successful_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (successful_amount >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'processing', 'succeeded', 'failed', 'unknown', 'cancel_pending', 'cancelled')),
  execution text NOT NULL DEFAULT 'provider' CHECK (execution IN ('cash', 'provider', 'manual')),
  cash_session_id uuid REFERENCES tenant.pos_shifts(id),
  cash_movement_id uuid,
  provider_key text,
  provider_reference text,
  provider_refund_id text,
  card_refund_id uuid REFERENCES tenant.pos_card_refunds(id),
  return_payment_refund_id uuid REFERENCES tenant.pos_return_payment_refunds(id),
  idempotency_key text NOT NULL,
  last_error_code text,
  last_error_message text,
  confirmed_by uuid REFERENCES public.users(id),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key),
  CHECK (successful_amount <= allocated_amount),
  CHECK (status <> 'succeeded' OR successful_amount = allocated_amount),
  CHECK (payment_id IS NOT NULL OR provider_reference IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS payment_refund_components_refund_idx ON tenant.payment_refund_components (organization_id, refund_id);
CREATE INDEX IF NOT EXISTS payment_refund_components_payment_idx ON tenant.payment_refund_components (organization_id, payment_id) WHERE status NOT IN ('failed', 'cancelled');
CREATE UNIQUE INDEX IF NOT EXISTS payment_refund_components_provider_refund_uidx ON tenant.payment_refund_components (organization_id, provider_key, provider_refund_id) WHERE provider_refund_id IS NOT NULL;
ALTER TABLE tenant.payment_refund_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.payment_refund_components FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'payment_refund_components' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.payment_refund_components USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.payment_refund_components TO vercent_app;
GRANT SELECT ON tenant.payment_refund_components TO vercent_worker;

-- A tender is never refunded beyond what was taken: every component not failed or cancelled (reserved, in flight, unknown or paid) counts.
-- A succeeded component is final; a component's tender, method and amount never change.
CREATE OR REPLACE FUNCTION tenant.payment_refund_component_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  taken numeric;
  reserved numeric;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.payment_id IS DISTINCT FROM OLD.payment_id OR NEW.refund_id IS DISTINCT FROM OLD.refund_id OR NEW.allocated_amount IS DISTINCT FROM OLD.allocated_amount
       OR NEW.refund_method IS DISTINCT FROM OLD.refund_method OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
      RAISE EXCEPTION 'A refund component''s tender and amount cannot be changed.' USING ERRCODE = 'check_violation', CONSTRAINT = 'payment_refund_component_immutable';
    END IF;
    IF OLD.status IN ('succeeded', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'A paid or cancelled refund component is final.' USING ERRCODE = 'check_violation', CONSTRAINT = 'payment_refund_component_final';
    END IF;
  END IF;
  IF NEW.payment_id IS NOT NULL AND NEW.status NOT IN ('failed', 'cancelled') THEN
    SELECT GREATEST(amount, COALESCE(received_amount, amount)) INTO taken FROM tenant.pos_payments WHERE organization_id = NEW.organization_id AND id = NEW.payment_id FOR UPDATE;
    SELECT COALESCE(sum(allocated_amount), 0) INTO reserved FROM tenant.payment_refund_components
     WHERE organization_id = NEW.organization_id AND payment_id = NEW.payment_id AND status NOT IN ('failed', 'cancelled') AND id <> NEW.id;
    IF reserved + NEW.allocated_amount > taken THEN
      RAISE EXCEPTION 'Refund would exceed the original payment.' USING ERRCODE = 'check_violation', CONSTRAINT = 'payment_refund_component_capacity';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER payment_refund_components_guard BEFORE INSERT OR UPDATE ON tenant.payment_refund_components FOR EACH ROW EXECUTE FUNCTION tenant.payment_refund_component_guard();

-- ============================================================ 3. attempts

CREATE TABLE IF NOT EXISTS tenant.payment_refund_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  component_id uuid NOT NULL REFERENCES tenant.payment_refund_components(id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  currency_code text NOT NULL DEFAULT 'INR',
  execution text NOT NULL CHECK (execution IN ('cash', 'provider', 'manual')),
  provider_key text,
  merchant_account_reference text,
  idempotency_key text NOT NULL,
  provider_refund_id text,
  card_refund_id uuid REFERENCES tenant.pos_card_refunds(id),
  cash_movement_id uuid,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'processing', 'succeeded', 'failed', 'unknown', 'cancelled')),
  error_code text,
  error_message text,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_by uuid REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, component_id, attempt_number)
);
ALTER TABLE tenant.payment_refund_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.payment_refund_attempts FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'payment_refund_attempts' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.payment_refund_attempts USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.payment_refund_attempts TO vercent_app;
GRANT SELECT ON tenant.payment_refund_attempts TO vercent_worker;

-- An attempt keeps what was sent: only its outcome, references and events move — and a final outcome stays final.
CREATE OR REPLACE FUNCTION tenant.payment_refund_attempt_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.component_id IS DISTINCT FROM OLD.component_id
     OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number OR NEW.requested_at IS DISTINCT FROM OLD.requested_at OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR (OLD.status IN ('succeeded', 'failed', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'A refund attempt is a record of what was sent; only its outcome may be added.' USING ERRCODE = 'check_violation', CONSTRAINT = 'payment_refund_attempt_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER payment_refund_attempts_guard BEFORE UPDATE ON tenant.payment_refund_attempts FOR EACH ROW EXECUTE FUNCTION tenant.payment_refund_attempt_guard();

-- ============================================================ 4. reconciliation exceptions

CREATE TABLE IF NOT EXISTS tenant.refund_reconciliation_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  refund_id uuid NOT NULL REFERENCES tenant.payment_refunds(id),
  component_id uuid REFERENCES tenant.payment_refund_components(id),
  exception_type text NOT NULL CHECK (exception_type IN ('unknown_outcome', 'provider_failed', 'amount_mismatch', 'duplicate_payout', 'manual_refund_required')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolving', 'resolved')),
  detail text,
  assigned_to uuid REFERENCES public.users(id),
  resolution text,
  resolution_reference text,
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS refund_reconciliation_exceptions_open_uidx ON tenant.refund_reconciliation_exceptions (organization_id, component_id, exception_type) WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS refund_reconciliation_exceptions_status_idx ON tenant.refund_reconciliation_exceptions (organization_id, status, created_at DESC);
ALTER TABLE tenant.refund_reconciliation_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.refund_reconciliation_exceptions FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'refund_reconciliation_exceptions' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.refund_reconciliation_exceptions USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.refund_reconciliation_exceptions TO vercent_app;
GRANT SELECT ON tenant.refund_reconciliation_exceptions TO vercent_worker;

-- ============================================================ 5. links

ALTER TABLE tenant.pos_return_payment_refunds ADD COLUMN IF NOT EXISTS refund_component_id uuid REFERENCES tenant.payment_refund_components(id);
ALTER TABLE tenant.pos_card_refunds ADD COLUMN IF NOT EXISTS refund_component_id uuid REFERENCES tenant.payment_refund_components(id);
ALTER TABLE tenant.pos_payment_exceptions ADD COLUMN IF NOT EXISTS refund_id uuid REFERENCES tenant.payment_refunds(id);

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0100_pos_refunds.sql', 'pos-refunds') ON CONFLICT DO NOTHING;
