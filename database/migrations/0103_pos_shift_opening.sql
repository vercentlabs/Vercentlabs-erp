-- POS Shift Opening: a POS operating session (tenant.pos_shifts — who operates which terminal, when) with, when the counter takes cash, its own
-- linked cash session (tenant.pos_cash_sessions — the opening float the cashier physically counted and confirmed, and where it came from).
-- A card- or UPI-only counter opens without a cash session; it may open one later, explicitly, with a counted float.
--
--   lifecycle   OPENING, OPEN, SUSPENDED, CLOSING, CLOSED, RECOVERY_REQUIRED, FORCE_CLOSED (the legacy status column is kept in step: a suspended
--               or recovering session still holds its terminal; a closed one never reopens).
--   handover    cash left in the drawer when a session closes is a documented handover for the terminal's next session. The next opening count
--               is compared with it (never with the old float or the old expected cash); a difference is kept as an opening variance, approved
--               by a supervisor when it is over the outlet's threshold — nothing is ever corrected on the previous session.
--   attempts    every refused opening is recorded with its sanitized reason (who, which terminal, when).
--
-- The opening float is not sales revenue and not a cash-in movement: it stays the session's 'opening' cash event. Additive only.

-- ============================================================ 1. the operating session
ALTER TABLE tenant.pos_shifts
  ADD COLUMN IF NOT EXISTS lifecycle_status text,
  ADD COLUMN IF NOT EXISTS cash_enabled boolean,
  ADD COLUMN IF NOT EXISTS cash_session_id uuid,
  ADD COLUMN IF NOT EXISTS previous_session_id uuid REFERENCES tenant.pos_shifts(id),
  ADD COLUMN IF NOT EXISTS opening_approval_id uuid REFERENCES tenant.pos_permission_approvals(id),
  ADD COLUMN IF NOT EXISTS opening_idempotency_key text,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  -- Paused (resumed only by the cashier signing in again) and under review (cleared by a supervisor), with who, when and why.
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS resumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_reason text,
  ADD COLUMN IF NOT EXISTS recovery_flagged_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS recovery_flagged_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_resolution text,
  ADD COLUMN IF NOT EXISTS recovery_resolved_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS recovery_resolved_at timestamptz;
UPDATE tenant.pos_shifts SET lifecycle_status = CASE status WHEN 'draft' THEN 'OPENING' WHEN 'open' THEN 'OPEN' WHEN 'closing' THEN 'CLOSING' ELSE 'CLOSED' END
 WHERE lifecycle_status IS NULL;
UPDATE tenant.pos_shifts shift SET cash_enabled = (COALESCE(terminal.cash_management_enabled, true) OR shift.opening_cash > 0)
  FROM tenant.pos_terminals terminal WHERE shift.cash_enabled IS NULL AND terminal.organization_id = shift.organization_id AND terminal.id = shift.terminal_id;
UPDATE tenant.pos_shifts SET cash_enabled = true WHERE cash_enabled IS NULL;
ALTER TABLE tenant.pos_shifts ALTER COLUMN lifecycle_status SET DEFAULT 'OPEN';
ALTER TABLE tenant.pos_shifts ALTER COLUMN lifecycle_status SET NOT NULL;
ALTER TABLE tenant.pos_shifts ALTER COLUMN cash_enabled SET DEFAULT true;
ALTER TABLE tenant.pos_shifts ALTER COLUMN cash_enabled SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_shifts_lifecycle_check') THEN
    ALTER TABLE tenant.pos_shifts ADD CONSTRAINT pos_shifts_lifecycle_check
      CHECK (lifecycle_status IN ('OPENING', 'OPEN', 'SUSPENDED', 'CLOSING', 'CLOSED', 'RECOVERY_REQUIRED', 'FORCE_CLOSED'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS pos_shifts_opening_key_uidx ON tenant.pos_shifts (organization_id, opening_idempotency_key) WHERE opening_idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS pos_shifts_lifecycle_idx ON tenant.pos_shifts (organization_id, store_id, lifecycle_status, opened_at DESC);

-- Lifecycle and the legacy status move together; a closed session never comes back.
CREATE OR REPLACE FUNCTION tenant.pos_shift_lifecycle_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.lifecycle_status IN ('CLOSED', 'FORCE_CLOSED') AND NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status THEN
      RAISE EXCEPTION 'A closed POS session cannot be reopened.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status IN ('closed', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'A closed POS session cannot be reopened.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status THEN
      NEW.status := CASE NEW.lifecycle_status WHEN 'OPENING' THEN 'draft' WHEN 'CLOSING' THEN 'closing' WHEN 'CLOSED' THEN 'closed' WHEN 'FORCE_CLOSED' THEN 'closed' ELSE 'open' END;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.lifecycle_status := CASE NEW.status WHEN 'draft' THEN 'OPENING' WHEN 'open' THEN 'OPEN' WHEN 'closing' THEN 'CLOSING' ELSE 'CLOSED' END;
    END IF;
    NEW.updated_at := now();
    NEW.version := OLD.version + 1;
  ELSE
    NEW.lifecycle_status := CASE NEW.status WHEN 'draft' THEN 'OPENING' WHEN 'open' THEN COALESCE(NULLIF(NEW.lifecycle_status, 'OPENING'), 'OPEN') WHEN 'closing' THEN 'CLOSING' ELSE 'CLOSED' END;
  END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pos_shifts_lifecycle_sync') THEN
    CREATE TRIGGER pos_shifts_lifecycle_sync BEFORE INSERT OR UPDATE ON tenant.pos_shifts FOR EACH ROW EXECUTE FUNCTION tenant.pos_shift_lifecycle_sync();
  END IF;
END $$;

-- ============================================================ 2. the cash session (physical custody)
CREATE TABLE IF NOT EXISTS tenant.pos_cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  operating_session_id uuid NOT NULL REFERENCES tenant.pos_shifts(id),
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  terminal_id uuid NOT NULL REFERENCES tenant.pos_terminals(id),
  currency_code text NOT NULL DEFAULT 'INR',
  opening_float_amount numeric(20, 2) NOT NULL CHECK (opening_float_amount >= 0),
  opening_source text NOT NULL CHECK (opening_source IN ('first_opening', 'new_float', 'handover')),
  denomination_details jsonb,
  handover_id uuid,
  handover_amount numeric(20, 2),
  opening_variance_amount numeric(20, 2) NOT NULL DEFAULT 0,
  variance_reason text,
  approval_id uuid REFERENCES tenant.pos_permission_approvals(id),
  opening_notes text,
  opening_confirmed_by uuid NOT NULL REFERENCES public.users(id),
  opening_confirmed_at timestamptz NOT NULL DEFAULT now(),
  opened_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing', 'closed')),
  closed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- One cash session per operating session.
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_sessions_operating_uidx ON tenant.pos_cash_sessions (organization_id, operating_session_id);
CREATE INDEX IF NOT EXISTS pos_cash_sessions_terminal_idx ON tenant.pos_cash_sessions (organization_id, terminal_id, opened_at DESC);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_shifts_cash_session_fkey') THEN
    ALTER TABLE tenant.pos_shifts ADD CONSTRAINT pos_shifts_cash_session_fkey FOREIGN KEY (cash_session_id) REFERENCES tenant.pos_cash_sessions(id);
  END IF;
END $$;

-- The opening count is final: amount, source, handover, variance, approval, who and when never change; only the status moves forward.
CREATE OR REPLACE FUNCTION tenant.pos_cash_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.opening_float_amount IS DISTINCT FROM OLD.opening_float_amount OR NEW.opening_source IS DISTINCT FROM OLD.opening_source
     OR NEW.denomination_details IS DISTINCT FROM OLD.denomination_details OR NEW.handover_id IS DISTINCT FROM OLD.handover_id
     OR NEW.handover_amount IS DISTINCT FROM OLD.handover_amount OR NEW.opening_variance_amount IS DISTINCT FROM OLD.opening_variance_amount
     OR NEW.approval_id IS DISTINCT FROM OLD.approval_id OR NEW.opening_confirmed_by IS DISTINCT FROM OLD.opening_confirmed_by
     OR NEW.opening_confirmed_at IS DISTINCT FROM OLD.opening_confirmed_at OR NEW.operating_session_id IS DISTINCT FROM OLD.operating_session_id
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code THEN
    RAISE EXCEPTION 'A cash session''s opening count cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'closed' AND NEW.status <> 'closed' THEN RAISE EXCEPTION 'A closed cash session cannot be reopened.' USING ERRCODE = 'check_violation'; END IF;
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pos_cash_sessions_guard') THEN
    CREATE TRIGGER pos_cash_sessions_guard BEFORE UPDATE ON tenant.pos_cash_sessions FOR EACH ROW EXECUTE FUNCTION tenant.pos_cash_session_guard();
  END IF;
END $$;

-- Every existing cash-taking session gets its cash session (its opening float as a first opening), so cash flows keep one model.
INSERT INTO tenant.pos_cash_sessions (organization_id, operating_session_id, store_id, terminal_id, currency_code, opening_float_amount, opening_source, opening_confirmed_by,
  opening_confirmed_at, opened_at, status, closed_at)
SELECT shift.organization_id, shift.id, shift.store_id, shift.terminal_id, COALESCE(NULLIF(btrim(store.currency_code), ''), 'INR'), round(shift.opening_cash, 2), 'first_opening',
       COALESCE(shift.opened_by, shift.cashier_user_id), COALESCE(shift.opened_at, shift.created_at), COALESCE(shift.opened_at, shift.created_at),
       CASE WHEN shift.status = 'open' THEN 'open' WHEN shift.status = 'closing' THEN 'closing' ELSE 'closed' END, shift.closed_at
  FROM tenant.pos_shifts shift JOIN tenant.pos_stores store ON store.organization_id = shift.organization_id AND store.id = shift.store_id
 WHERE shift.cash_enabled AND shift.status <> 'draft'
   AND NOT EXISTS (SELECT 1 FROM tenant.pos_cash_sessions cash WHERE cash.organization_id = shift.organization_id AND cash.operating_session_id = shift.id);
UPDATE tenant.pos_shifts shift SET cash_session_id = cash.id
  FROM tenant.pos_cash_sessions cash WHERE shift.cash_session_id IS NULL AND cash.organization_id = shift.organization_id AND cash.operating_session_id = shift.id;

-- ============================================================ 3. cash handovers between sessions
CREATE TABLE IF NOT EXISTS tenant.pos_cash_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  terminal_id uuid NOT NULL REFERENCES tenant.pos_terminals(id),
  from_session_id uuid NOT NULL REFERENCES tenant.pos_shifts(id),
  from_cash_session_id uuid REFERENCES tenant.pos_cash_sessions(id),
  closing_counted_amount numeric(20, 2) NOT NULL CHECK (closing_counted_amount >= 0),
  amount numeric(20, 2) NOT NULL CHECK (amount >= 0),
  removed_amount numeric(20, 2) NOT NULL DEFAULT 0 CHECK (removed_amount >= 0),
  removal_note text,
  currency_code text NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled')),
  handed_over_by uuid REFERENCES public.users(id),
  handed_over_at timestamptz NOT NULL DEFAULT now(),
  to_session_id uuid REFERENCES tenant.pos_shifts(id),
  to_cash_session_id uuid REFERENCES tenant.pos_cash_sessions(id),
  received_amount numeric(20, 2),
  variance_amount numeric(20, 2),
  accepted_by uuid REFERENCES public.users(id),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount + removed_amount = closing_counted_amount),
  CHECK (status <> 'accepted' OR (to_session_id IS NOT NULL AND received_amount IS NOT NULL AND accepted_at IS NOT NULL))
);
-- One handover waiting per terminal; one per closing session.
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_handovers_pending_uidx ON tenant.pos_cash_handovers (organization_id, terminal_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_handovers_from_uidx ON tenant.pos_cash_handovers (organization_id, from_session_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_cash_sessions_handover_fkey') THEN
    ALTER TABLE tenant.pos_cash_sessions ADD CONSTRAINT pos_cash_sessions_handover_fkey FOREIGN KEY (handover_id) REFERENCES tenant.pos_cash_handovers(id);
  END IF;
END $$;
-- What was handed over never changes; it is accepted (or cancelled) once.
CREATE OR REPLACE FUNCTION tenant.pos_cash_handover_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.closing_counted_amount IS DISTINCT FROM OLD.closing_counted_amount OR NEW.removed_amount IS DISTINCT FROM OLD.removed_amount
     OR NEW.from_session_id IS DISTINCT FROM OLD.from_session_id OR NEW.terminal_id IS DISTINCT FROM OLD.terminal_id THEN
    RAISE EXCEPTION 'A cash handover''s amounts cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'A cash handover is settled once.' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pos_cash_handovers_guard') THEN
    CREATE TRIGGER pos_cash_handovers_guard BEFORE UPDATE ON tenant.pos_cash_handovers FOR EACH ROW EXECUTE FUNCTION tenant.pos_cash_handover_guard();
  END IF;
END $$;

-- ============================================================ 4. opening attempts (refusals are kept)
CREATE TABLE IF NOT EXISTS tenant.pos_shift_opening_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid REFERENCES public.users(id),
  store_id uuid,
  terminal_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('opened', 'restored', 'denied', 'failed')),
  code text,
  message text,
  session_id uuid REFERENCES tenant.pos_shifts(id),
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_shift_opening_attempts_idx ON tenant.pos_shift_opening_attempts (organization_id, attempted_at DESC);

-- ============================================================ 5. policy
ALTER TABLE tenant.pos_settings
  ADD COLUMN IF NOT EXISTS opening_variance_approval_above numeric(20, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_count_denominations jsonb NOT NULL DEFAULT '[500, 200, 100, 50, 20, 10, 5, 2, 1]'::jsonb,
  ADD COLUMN IF NOT EXISTS long_open_shift_hours integer NOT NULL DEFAULT 14;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_settings_shift_opening_check') THEN
    ALTER TABLE tenant.pos_settings ADD CONSTRAINT pos_settings_shift_opening_check
      CHECK ((opening_variance_approval_above IS NULL OR opening_variance_approval_above >= 0) AND long_open_shift_hours BETWEEN 1 AND 72);
  END IF;
END $$;

-- ============================================================ 6. isolation and grants
ALTER TABLE tenant.pos_cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_cash_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_cash_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_cash_handovers FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_shift_opening_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_shift_opening_attempts FORCE ROW LEVEL SECURITY;
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['pos_cash_sessions', 'pos_cash_handovers', 'pos_shift_opening_attempts'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.pos_cash_sessions TO vercent_app;
GRANT SELECT, INSERT, UPDATE ON tenant.pos_cash_handovers TO vercent_app;
GRANT SELECT, INSERT ON tenant.pos_shift_opening_attempts TO vercent_app;
GRANT SELECT ON tenant.pos_cash_sessions, tenant.pos_cash_handovers, tenant.pos_shift_opening_attempts TO vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0103_pos_shift_opening.sql', 'pos-shift-opening') ON CONFLICT DO NOTHING;
