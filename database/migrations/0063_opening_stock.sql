-- Opening Stock: the controlled Inventory document that brings in the stock a company already owns when it starts using Vercentlabs.
--
-- One document is one warehouse of the company at one cutoff date, with a migration reference that is never loaded twice. Lines hold the
-- item, location, quantity as entered (unit and conversion snapshot) and in base units, the opening cost as entered and per base unit, the
-- value, the disposition (available, quality hold, quarantined, damaged) and the batch or serial numbers. A draft moves nothing; posting
-- creates the Inventory movements (receipts referenced 'opening_stock'), their valuation layers, the batches and serials, and the Finance
-- opening entry (Dr Inventory, Cr Opening balance equity). A posted document changes only by a controlled reversal while nothing has used its
-- stock; later differences are Inventory adjustments.
--
-- Also: an Opening balance equity account (3900), an Opening balance journal (OPN) and the default 'inventory' (1300) and
-- 'opening_balance_equity' (3900) account mappings for every company (a company's own mappings take precedence), the OS number series and
-- the Opening Stock permissions.

-- ============================================================ 1. documents
CREATE TABLE IF NOT EXISTS tenant.opening_stocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  document_number text NOT NULL,
  warehouse_id uuid NOT NULL,
  opening_date date NOT NULL,
  accounting_date date NOT NULL,
  currency_code text NOT NULL DEFAULT 'INR',
  migration_reference text NOT NULL CHECK (btrim(migration_reference) <> ''),
  source_system text,
  external_reference text,
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled', 'reversed')),
  total_value numeric(20, 6) NOT NULL DEFAULT 0,
  journal_entry_id uuid,
  reversal_journal_entry_id uuid,
  backdated_acknowledged boolean NOT NULL DEFAULT false,
  zero_cost_reason text,
  cancel_reason text,
  reversal_reason text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  posted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  posted_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  reversed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reversed_at timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, document_number),
  FOREIGN KEY (organization_id, warehouse_id) REFERENCES tenant.warehouses (organization_id, id),
  CHECK (accounting_date >= opening_date),
  CHECK ((status IN ('posted', 'reversed')) = (posted_at IS NOT NULL)),
  CHECK ((status = 'reversed') = (reversed_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
-- A migration reference is loaded once: a second document with it is refused unless the first was cancelled.
CREATE UNIQUE INDEX IF NOT EXISTS opening_stocks_reference_uidx ON tenant.opening_stocks (organization_id, upper(btrim(migration_reference))) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS opening_stocks_list_idx ON tenant.opening_stocks (organization_id, status, opening_date DESC);
CREATE INDEX IF NOT EXISTS opening_stocks_warehouse_idx ON tenant.opening_stocks (organization_id, warehouse_id);

CREATE TABLE IF NOT EXISTS tenant.opening_stock_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  opening_stock_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  item_id uuid NOT NULL,
  location_id uuid NOT NULL,
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  uom_id uuid NOT NULL,
  conversion_factor numeric(20, 6) NOT NULL CHECK (conversion_factor > 0),
  base_quantity numeric(20, 6) NOT NULL CHECK (base_quantity > 0),
  unit_cost numeric(20, 6) CHECK (unit_cost >= 0),
  base_unit_cost numeric(20, 6) CHECK (base_unit_cost >= 0),
  line_value numeric(20, 6) NOT NULL DEFAULT 0 CHECK (line_value >= 0),
  disposition text NOT NULL DEFAULT 'available' CHECK (disposition IN ('available', 'quality_hold', 'quarantined', 'damaged')),
  batch_number text,
  manufactured_on date,
  expires_on date,
  batch_id uuid,
  serial_numbers text[] NOT NULL DEFAULT '{}',
  notes text,
  movement_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opening_stock_id, line_number),
  FOREIGN KEY (organization_id, opening_stock_id) REFERENCES tenant.opening_stocks (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, item_id) REFERENCES tenant.items (organization_id, id),
  FOREIGN KEY (organization_id, location_id) REFERENCES tenant.warehouse_locations (organization_id, id),
  FOREIGN KEY (organization_id, uom_id) REFERENCES tenant.units_of_measure (organization_id, id),
  CHECK (manufactured_on IS NULL OR expires_on IS NULL OR expires_on >= manufactured_on)
);
CREATE INDEX IF NOT EXISTS opening_stock_lines_document_idx ON tenant.opening_stock_lines (organization_id, opening_stock_id, line_number);
CREATE INDEX IF NOT EXISTS opening_stock_lines_item_idx ON tenant.opening_stock_lines (organization_id, item_id);

-- A posted line keeps what was loaded: quantities, units, costs, tracking and place never change after posting.
CREATE OR REPLACE FUNCTION tenant.opening_stock_lines_posted_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE document_status text;
BEGIN
  SELECT status INTO document_status FROM tenant.opening_stocks WHERE id = COALESCE(NEW.opening_stock_id, OLD.opening_stock_id);
  IF document_status IS DISTINCT FROM 'draft' THEN
    IF TG_OP = 'UPDATE' AND (NEW.item_id, NEW.location_id, NEW.quantity, NEW.uom_id, NEW.conversion_factor, NEW.base_quantity, NEW.unit_cost, NEW.base_unit_cost,
         NEW.line_value, NEW.disposition, NEW.batch_number, NEW.expires_on, NEW.serial_numbers)
       IS NOT DISTINCT FROM (OLD.item_id, OLD.location_id, OLD.quantity, OLD.uom_id, OLD.conversion_factor, OLD.base_quantity, OLD.unit_cost, OLD.base_unit_cost,
         OLD.line_value, OLD.disposition, OLD.batch_number, OLD.expires_on, OLD.serial_numbers) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'A posted opening stock line cannot change. Use an Inventory adjustment.' USING ERRCODE = 'check_violation', CONSTRAINT = 'opening_stock_posted_immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE OR REPLACE TRIGGER opening_stock_lines_posted_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.opening_stock_lines
  FOR EACH ROW EXECUTE FUNCTION tenant.opening_stock_lines_posted_guard();

CREATE TABLE IF NOT EXISTS tenant.opening_stock_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  opening_stock_id uuid,
  migration_reference text NOT NULL,
  source_filename text NOT NULL,
  checksum text NOT NULL,
  status text NOT NULL CHECK (status IN ('validated', 'applied', 'rejected')),
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  warning_rows integer NOT NULL DEFAULT 0,
  error_rows integer NOT NULL DEFAULT 0,
  report jsonb NOT NULL DEFAULT '[]'::jsonb,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, warehouse_id) REFERENCES tenant.warehouses (organization_id, id),
  FOREIGN KEY (organization_id, opening_stock_id) REFERENCES tenant.opening_stocks (organization_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS opening_stock_import_batches_idx ON tenant.opening_stock_import_batches (organization_id, checksum);

CREATE TABLE IF NOT EXISTS tenant.opening_stock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  opening_stock_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('created', 'updated', 'lines_changed', 'imported', 'validated', 'posted', 'finance_linked', 'cancelled', 'reversed',
    'file_added', 'file_removed')),
  summary text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, opening_stock_id) REFERENCES tenant.opening_stocks (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS opening_stock_events_idx ON tenant.opening_stock_events (organization_id, opening_stock_id, created_at DESC);

-- ============================================================ 2. row-level security
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['opening_stocks', 'opening_stock_lines', 'opening_stock_import_batches', 'opening_stock_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.opening_stocks TO vercent_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.opening_stock_lines TO vercent_app;
GRANT SELECT, INSERT, UPDATE ON tenant.opening_stock_import_batches TO vercent_app;
GRANT SELECT, INSERT ON tenant.opening_stock_events TO vercent_app;

-- ============================================================ 3. finance: opening balance equity, the opening journal, default mappings
INSERT INTO tenant.accounting_accounts (organization_id, ledger_id, code, name, account_class, account_type, normal_balance, is_group, allow_manual_posting,
  reconciliation_required, status, parent_id)
SELECT ledger.organization_id, ledger.id, '3900', 'Opening balance equity', 'equity', 'equity', 'credit', false, true, false, 'active',
       (SELECT parent.id FROM tenant.accounting_accounts parent WHERE parent.organization_id = ledger.organization_id AND parent.ledger_id = ledger.id AND parent.code = '3000')
  FROM tenant.accounting_ledgers ledger WHERE ledger.code = 'PRIMARY'
ON CONFLICT (organization_id, ledger_id, code) DO NOTHING;

INSERT INTO tenant.accounting_journals (organization_id, ledger_id, code, name, journal_type, default_debit_account_id, default_credit_account_id, approval_required, status)
SELECT ledger.organization_id, ledger.id, 'OPN', 'Opening balance journal', 'opening',
       (SELECT id FROM tenant.accounting_accounts WHERE organization_id = ledger.organization_id AND ledger_id = ledger.id AND code = '1300'),
       (SELECT id FROM tenant.accounting_accounts WHERE organization_id = ledger.organization_id AND ledger_id = ledger.id AND code = '3900'), false, 'active'
  FROM tenant.accounting_ledgers ledger WHERE ledger.code = 'PRIMARY'
ON CONFLICT (organization_id, code) DO NOTHING;

-- Defaults at priority 1000: any mapping a company configured itself (priority 100 and below) still wins.
INSERT INTO tenant.accounting_account_mappings (organization_id, ledger_id, mapping_key, account_id, priority, status)
SELECT ledger.organization_id, ledger.id, defaults.mapping_key, account.id, 1000, 'active'
  FROM tenant.accounting_ledgers ledger
  CROSS JOIN (VALUES ('inventory', '1300'), ('opening_balance_equity', '3900')) AS defaults (mapping_key, account_code)
  JOIN tenant.accounting_accounts account ON account.organization_id = ledger.organization_id AND account.ledger_id = ledger.id AND account.code = defaults.account_code
 WHERE ledger.code = 'PRIMARY'
   AND NOT EXISTS (SELECT 1 FROM tenant.accounting_account_mappings existing WHERE existing.organization_id = ledger.organization_id AND existing.ledger_id = ledger.id
                     AND existing.mapping_key = defaults.mapping_key AND existing.priority = 1000 AND existing.party_id IS NULL AND existing.item_id IS NULL
                     AND existing.item_group_id IS NULL AND existing.tax_category_id IS NULL);

-- ============================================================ 4. permissions
-- stock.opening (granted with stock.adjust by 0062) now prepares drafts: create, edit, import, validate and cancel. Posting is its own,
-- stronger permission.
UPDATE public.permissions SET name = 'Prepare opening stock', description = 'Create, import, edit, validate and cancel draft opening stock documents.'
 WHERE key = 'stock.opening';
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('stock.opening.view', 'View opening stock', 'Inventory', 'See opening stock documents, their lines and history.'),
  ('stock.opening.view_cost', 'View opening stock cost', 'Inventory', 'See opening costs and values.'),
  ('stock.opening.edit_cost', 'Enter opening stock cost', 'Inventory', 'Enter and change the opening cost of lines.'),
  ('stock.opening.post', 'Post opening stock', 'Inventory', 'Post an opening stock document into Inventory and Finance.'),
  ('stock.opening.reverse', 'Reverse opening stock', 'Inventory', 'Reverse a posted opening stock document while nothing has used its stock.'),
  ('stock.opening.zero_cost', 'Load zero-cost opening stock', 'Inventory', 'Post opening stock lines at zero cost, with a reason.'),
  ('stock.opening.backdate', 'Backdate opening stock', 'Inventory', 'Post opening stock dated before Inventory activity already recorded in the warehouse.'),
  ('stock.opening.reconcile', 'View opening stock reconciliation', 'Inventory', 'See how opening Inventory value reconciles with Finance.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'stock.opening.view' FROM public.role_permissions existing WHERE existing.permission_key = 'stock.view'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('stock.opening.view_cost', 'stock.opening.edit_cost', 'stock.opening.reconcile')
 WHERE existing.permission_key = 'stock.valuation.view'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('stock.opening.view', 'stock.opening', 'stock.opening.post', 'stock.opening.reverse', 'stock.opening.zero_cost',
    'stock.opening.backdate')
 WHERE existing.permission_key = 'inventory_setup.manage'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'stock.opening.reconcile' FROM public.role_permissions existing WHERE existing.permission_key = 'accounting.view'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0063_opening_stock.sql', 'opening-stock');
