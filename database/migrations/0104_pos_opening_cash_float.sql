-- POS Opening Cash Float: the float a cashier counts into their cash session (built on Shift Opening, 0103 — no separate float module or cash
-- balance). This adds what custody of physical money needs beyond a terminal:
--
--   cash drawers     a logical drawer (a till, a cash box) belongs to an outlet and is held by one cash session at a time — two counters sharing
--                    one drawer can never each claim a float. A terminal uses its assigned drawer; the cashier never picks one. Hardware is
--                    optional (terminal.cash_drawer stays the "a printer-driven drawer is fitted" flag).
--   float source     where the counted cash came from: a fresh float (given by a manager, from a safe), a handover from the previous cashier,
--                    cash already in the drawer, or none (₹0) — with an optional reference (e.g. the safe slip).
--   variance policy  every difference from a handover needs a reason; above the company's approval threshold a supervisor approves; above its
--                    hard limit the drawer cannot be opened until the difference is formally resolved.
--   corrections      a counting mistake found later is recorded beside the opening count (by a supervisor, never the cashier): the confirmed
--                    count is never edited and no cash movement is invented.
--
-- Additive only (the cash session's guard function is replaced to protect the new fields too).

-- ============================================================ 1. cash drawers
CREATE TABLE IF NOT EXISTS tenant.pos_cash_drawers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  cash_account_id uuid,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_drawers_code_uidx ON tenant.pos_cash_drawers (organization_id, store_id, upper(btrim(code)));
ALTER TABLE tenant.pos_terminals ADD COLUMN IF NOT EXISTS cash_drawer_id uuid REFERENCES tenant.pos_cash_drawers(id);

-- Every cash-handling terminal gets its own drawer (code = the terminal's), so today's one-terminal-one-drawer shops change nothing.
INSERT INTO tenant.pos_cash_drawers (organization_id, store_id, code, name, cash_account_id, created_at)
SELECT terminal.organization_id, terminal.store_id, terminal.code, terminal.name || ' drawer', terminal.cash_account_id, terminal.created_at
  FROM tenant.pos_terminals terminal
 WHERE terminal.cash_management_enabled AND terminal.cash_drawer_id IS NULL
ON CONFLICT DO NOTHING;
UPDATE tenant.pos_terminals terminal SET cash_drawer_id = drawer.id
  FROM tenant.pos_cash_drawers drawer
 WHERE terminal.cash_drawer_id IS NULL AND terminal.cash_management_enabled AND drawer.organization_id = terminal.organization_id AND drawer.store_id = terminal.store_id
   AND upper(btrim(drawer.code)) = upper(btrim(terminal.code));

-- ============================================================ 2. the cash session: its drawer, the float's source
ALTER TABLE tenant.pos_cash_sessions
  ADD COLUMN IF NOT EXISTS cash_drawer_id uuid REFERENCES tenant.pos_cash_drawers(id),
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_reference text,
  ADD COLUMN IF NOT EXISTS cash_account_id uuid,
  ADD COLUMN IF NOT EXISTS opening_idempotency_key text;
UPDATE tenant.pos_cash_sessions cash SET cash_drawer_id = terminal.cash_drawer_id
  FROM tenant.pos_terminals terminal WHERE cash.cash_drawer_id IS NULL AND terminal.organization_id = cash.organization_id AND terminal.id = cash.terminal_id;
UPDATE tenant.pos_cash_sessions SET source_type = CASE WHEN opening_source = 'handover' THEN 'HANDOVER' WHEN opening_float_amount = 0 THEN 'ZERO_FLOAT' ELSE 'FRESH_FLOAT' END
 WHERE source_type IS NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_cash_sessions_source_type_check') THEN
    ALTER TABLE tenant.pos_cash_sessions ADD CONSTRAINT pos_cash_sessions_source_type_check
      CHECK (source_type IS NULL OR source_type IN ('FRESH_FLOAT', 'HANDOVER', 'EXISTING_DRAWER', 'ZERO_FLOAT'));
  END IF;
  -- A ₹0 float is ZERO_FLOAT; a handover is always HANDOVER.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_cash_sessions_source_consistency_check') THEN
    ALTER TABLE tenant.pos_cash_sessions ADD CONSTRAINT pos_cash_sessions_source_consistency_check
      CHECK (source_type IS NULL OR ((source_type = 'HANDOVER') = (handover_id IS NOT NULL) AND (source_type <> 'ZERO_FLOAT' OR opening_float_amount = 0))) NOT VALID;
  END IF;
END $$;
-- One custodian per drawer: at most one open (or closing) cash session holds it.
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_sessions_drawer_custody_uidx ON tenant.pos_cash_sessions (organization_id, cash_drawer_id) WHERE status IN ('open', 'closing') AND cash_drawer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_sessions_opening_key_uidx ON tenant.pos_cash_sessions (organization_id, opening_idempotency_key) WHERE opening_idempotency_key IS NOT NULL;

-- The opening count stays final: amount, source and reference, drawer, handover, variance, approval, who and when.
CREATE OR REPLACE FUNCTION tenant.pos_cash_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.opening_float_amount IS DISTINCT FROM OLD.opening_float_amount OR NEW.opening_source IS DISTINCT FROM OLD.opening_source
     OR NEW.denomination_details IS DISTINCT FROM OLD.denomination_details OR NEW.handover_id IS DISTINCT FROM OLD.handover_id
     OR NEW.handover_amount IS DISTINCT FROM OLD.handover_amount OR NEW.opening_variance_amount IS DISTINCT FROM OLD.opening_variance_amount
     OR NEW.approval_id IS DISTINCT FROM OLD.approval_id OR NEW.opening_confirmed_by IS DISTINCT FROM OLD.opening_confirmed_by
     OR NEW.opening_confirmed_at IS DISTINCT FROM OLD.opening_confirmed_at OR NEW.operating_session_id IS DISTINCT FROM OLD.operating_session_id
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code OR NEW.variance_reason IS DISTINCT FROM OLD.variance_reason
     OR (OLD.cash_drawer_id IS NOT NULL AND NEW.cash_drawer_id IS DISTINCT FROM OLD.cash_drawer_id)
     OR (OLD.source_type IS NOT NULL AND NEW.source_type IS DISTINCT FROM OLD.source_type)
     OR NEW.source_reference IS DISTINCT FROM OLD.source_reference OR NEW.opening_idempotency_key IS DISTINCT FROM OLD.opening_idempotency_key THEN
    RAISE EXCEPTION 'A cash session''s opening count cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'closed' AND NEW.status <> 'closed' THEN RAISE EXCEPTION 'A closed cash session cannot be reopened.' USING ERRCODE = 'check_violation'; END IF;
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;

-- ============================================================ 3. handovers follow the drawer
ALTER TABLE tenant.pos_cash_handovers ADD COLUMN IF NOT EXISTS cash_drawer_id uuid REFERENCES tenant.pos_cash_drawers(id);
UPDATE tenant.pos_cash_handovers handover SET cash_drawer_id = cash.cash_drawer_id
  FROM tenant.pos_cash_sessions cash WHERE handover.cash_drawer_id IS NULL AND cash.organization_id = handover.organization_id AND cash.id = handover.from_cash_session_id;
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_handovers_drawer_pending_uidx ON tenant.pos_cash_handovers (organization_id, cash_drawer_id) WHERE status = 'pending' AND cash_drawer_id IS NOT NULL;

-- ============================================================ 4. opening count corrections (never an edit)
CREATE TABLE IF NOT EXISTS tenant.pos_cash_opening_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  cash_session_id uuid NOT NULL REFERENCES tenant.pos_cash_sessions(id),
  confirmed_amount numeric(20, 2) NOT NULL,
  corrected_amount numeric(20, 2) NOT NULL CHECK (corrected_amount >= 0),
  difference numeric(20, 2) NOT NULL,
  reason text NOT NULL,
  approval_id uuid REFERENCES tenant.pos_permission_approvals(id),
  recorded_by uuid NOT NULL REFERENCES public.users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (difference = corrected_amount - confirmed_amount AND difference <> 0)
);
CREATE INDEX IF NOT EXISTS pos_cash_opening_corrections_session_idx ON tenant.pos_cash_opening_corrections (organization_id, cash_session_id, recorded_at);

-- ============================================================ 5. policy
ALTER TABLE tenant.pos_settings ADD COLUMN IF NOT EXISTS opening_variance_block_above numeric(20, 2);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_settings_opening_block_check') THEN
    ALTER TABLE tenant.pos_settings ADD CONSTRAINT pos_settings_opening_block_check CHECK (opening_variance_block_above IS NULL OR opening_variance_block_above > 0);
  END IF;
END $$;

-- ============================================================ 6. isolation and grants
ALTER TABLE tenant.pos_cash_drawers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_cash_drawers FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_cash_opening_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_cash_opening_corrections FORCE ROW LEVEL SECURITY;
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['pos_cash_drawers', 'pos_cash_opening_corrections'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.pos_cash_drawers TO vercent_app;
GRANT SELECT, INSERT ON tenant.pos_cash_opening_corrections TO vercent_app;
GRANT SELECT ON tenant.pos_cash_drawers, tenant.pos_cash_opening_corrections TO vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0104_pos_opening_cash_float.sql', 'pos-opening-cash-float') ON CONFLICT DO NOTHING;
