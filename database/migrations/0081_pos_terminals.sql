-- 0081 POS Terminals: one logical checkout register inside an outlet (tenant.pos_terminals). A terminal is the register's business identity
-- — not a computer, warehouse, cashier, session, stock balance or cash ledger. Its company is its outlet's (the organization); everything
-- else it does not override is inherited from the outlet.
--
-- 1. The terminal: code unique within its outlet (compared trimmed and upper-cased), name, Active / Inactive only (the old maintenance
--    status becomes Inactive), cash management on or off, an optional selling location inside the outlet's warehouse, an optional cash
--    account, an optional restriction of the outlet's payment methods, the receipt series (receipt_prefix, numbered by the shared numbering
--    service), a payment device reference and light hardware details (device label, receipt printer, cash drawer, barcode scanning).
-- 2. Guards in the database: the selling location belongs to the outlet's warehouse; a terminal with sessions, carts, sales or returns never
--    moves to another outlet; at most one open session per terminal (pos_terminal_open_shift_uidx, already in place).
-- 3. Terminal history: every material configuration change, who made it, when, from what to what.
-- 4. Permissions for viewing, creating, editing, activating, and configuring inventory, cash, payments, numbering and hardware, and for
--    seeing a terminal's sessions and transactions. Operating a terminal stays pos.operate / pos.shift.open with outlet access.

-- ============================================================ 1. the terminal

UPDATE tenant.pos_terminals SET status = 'inactive' WHERE status = 'maintenance';
UPDATE tenant.pos_terminals SET code = upper(btrim(code)) WHERE code IS DISTINCT FROM upper(btrim(code));

ALTER TABLE tenant.pos_terminals
  ADD COLUMN IF NOT EXISTS cash_management_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS selling_location_id uuid,
  ADD COLUMN IF NOT EXISTS cash_account_id uuid,
  -- NULL: every payment method the outlet accepts; otherwise only these (always within the outlet's).
  ADD COLUMN IF NOT EXISTS payment_methods text[],
  ADD COLUMN IF NOT EXISTS payment_device_ref text,
  ADD COLUMN IF NOT EXISTS device_label text,
  ADD COLUMN IF NOT EXISTS receipt_printer text,
  ADD COLUMN IF NOT EXISTS cash_drawer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS barcode_scanning boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_terminals_master_status_check') THEN
    ALTER TABLE tenant.pos_terminals ADD CONSTRAINT pos_terminals_master_status_check CHECK (status IN ('active', 'inactive'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_terminals_code_format_check') THEN
    ALTER TABLE tenant.pos_terminals ADD CONSTRAINT pos_terminals_code_format_check CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,29}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_terminals_payment_methods_check') THEN
    ALTER TABLE tenant.pos_terminals ADD CONSTRAINT pos_terminals_payment_methods_check
      CHECK (payment_methods IS NULL OR payment_methods <@ ARRAY['cash', 'card', 'upi', 'wallet', 'bank_transfer']);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_terminals_selling_location_fkey') THEN
    ALTER TABLE tenant.pos_terminals ADD CONSTRAINT pos_terminals_selling_location_fkey FOREIGN KEY (selling_location_id) REFERENCES tenant.warehouse_locations (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_terminals_cash_account_fkey') THEN
    ALTER TABLE tenant.pos_terminals ADD CONSTRAINT pos_terminals_cash_account_fkey FOREIGN KEY (cash_account_id) REFERENCES tenant.accounting_accounts (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS pos_terminals_code_normalized_uidx ON tenant.pos_terminals (organization_id, store_id, upper(btrim(code)));
CREATE INDEX IF NOT EXISTS pos_terminals_store_idx ON tenant.pos_terminals (organization_id, store_id);

-- ============================================================ 2. guards

CREATE OR REPLACE FUNCTION tenant.pos_terminals_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- The selling location is a location of the outlet's selling warehouse: a terminal never sells from another warehouse.
  IF NEW.selling_location_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM tenant.warehouse_locations location JOIN tenant.pos_stores outlet ON outlet.organization_id = location.organization_id AND outlet.warehouse_id = location.warehouse_id
       WHERE location.organization_id = NEW.organization_id AND location.id = NEW.selling_location_id AND outlet.id = NEW.store_id) THEN
    RAISE EXCEPTION 'The selling location must be a location of the outlet''s selling warehouse.' USING ERRCODE = 'check_violation', CONSTRAINT = 'pos_terminals_location_in_warehouse';
  END IF;
  -- A terminal that has been used keeps its outlet: history stays attributed to the register where it happened.
  IF TG_OP = 'UPDATE' AND NEW.store_id IS DISTINCT FROM OLD.store_id AND (
      EXISTS (SELECT 1 FROM tenant.pos_shifts WHERE organization_id = OLD.organization_id AND terminal_id = OLD.id)
      OR EXISTS (SELECT 1 FROM tenant.pos_carts WHERE organization_id = OLD.organization_id AND terminal_id = OLD.id)
      OR EXISTS (SELECT 1 FROM tenant.pos_sales WHERE organization_id = OLD.organization_id AND terminal_id = OLD.id)
      OR EXISTS (SELECT 1 FROM tenant.pos_returns WHERE organization_id = OLD.organization_id AND terminal_id = OLD.id)) THEN
    RAISE EXCEPTION 'A terminal that has been used cannot move to another outlet.' USING ERRCODE = 'check_violation', CONSTRAINT = 'pos_terminals_outlet_fixed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER pos_terminals_guard BEFORE INSERT OR UPDATE OF store_id, selling_location_id ON tenant.pos_terminals
  FOR EACH ROW EXECUTE FUNCTION tenant.pos_terminals_guard();

-- ============================================================ 3. history

CREATE TABLE IF NOT EXISTS tenant.pos_terminal_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  terminal_id uuid NOT NULL REFERENCES tenant.pos_terminals(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created', 'updated', 'code_changed', 'outlet_changed', 'location_changed', 'cash_changed', 'payment_methods_changed',
    'payment_device_changed', 'numbering_changed', 'hardware_changed', 'activated', 'deactivated')),
  summary text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS pos_terminal_history_idx ON tenant.pos_terminal_history (organization_id, terminal_id, created_at DESC);
ALTER TABLE tenant.pos_terminal_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_terminal_history FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'pos_terminal_history' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.pos_terminal_history USING (organization_id = tenant.current_organization_id())
      WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT ON tenant.pos_terminal_history TO vercent_app;
GRANT SELECT ON tenant.pos_terminal_history TO vercent_worker;
GRANT DELETE ON tenant.pos_terminals TO vercent_app;

-- ============================================================ 4. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('pos.terminals.view', 'View POS terminals', 'Point of Sale', 'See terminals, their setup and who is working on them.'),
  ('pos.terminals.create', 'Create POS terminals', 'Point of Sale', 'Add a terminal to an outlet.'),
  ('pos.terminals.edit', 'Edit POS terminals', 'Point of Sale', 'Change a terminal''s name and notes; correct the code or outlet of an unused terminal.'),
  ('pos.terminals.status', 'Activate and deactivate terminals', 'Point of Sale', 'Activate a terminal, deactivate one with no open session, delete an unused one.'),
  ('pos.terminals.configure_inventory', 'Configure terminal selling location', 'Point of Sale', 'Choose the location inside the outlet''s warehouse a terminal sells from.'),
  ('pos.terminals.configure_cash', 'Configure terminal cash', 'Point of Sale', 'Turn cash management on or off and choose a terminal''s cash account.'),
  ('pos.terminals.configure_payments', 'Configure terminal payment methods', 'Point of Sale', 'Restrict the payment methods a terminal takes and set its payment device.'),
  ('pos.terminals.configure_numbering', 'Configure terminal receipt numbering', 'Point of Sale', 'Choose the receipt series of a terminal.'),
  ('pos.terminals.configure_hardware', 'Configure terminal hardware', 'Point of Sale', 'Record a terminal''s device label, receipt printer, cash drawer and scanning.'),
  ('pos.terminals.view_sessions', 'View terminal sessions', 'Point of Sale', 'See the sessions opened and closed on a terminal.'),
  ('pos.terminals.view_transactions', 'View terminal transactions', 'Point of Sale', 'See the sales and returns made on a terminal.')
ON CONFLICT (key) DO NOTHING;
-- Whoever sees POS sees terminals; terminal administrators set them up; POS settings administrators own cash and payments; whoever sees POS
-- reports sees a terminal's sessions and transactions.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'pos.terminals.view' FROM public.role_permissions existing WHERE existing.permission_key = 'pos.view'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('pos.terminals.view', 'pos.terminals.create', 'pos.terminals.edit', 'pos.terminals.status',
    'pos.terminals.configure_inventory', 'pos.terminals.configure_numbering', 'pos.terminals.configure_hardware', 'pos.terminals.view_sessions', 'pos.terminals.view_transactions')
 WHERE existing.permission_key = 'pos.terminal.manage'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('pos.terminals.view', 'pos.terminals.configure_cash', 'pos.terminals.configure_payments')
 WHERE existing.permission_key = 'pos.settings.manage'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('pos.terminals.view_sessions', 'pos.terminals.view_transactions')
 WHERE existing.permission_key IN ('pos.reports.view', 'pos.report.view')
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0081_pos_terminals.sql', 'pos-terminals');
