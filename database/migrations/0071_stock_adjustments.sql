-- Stock Adjustments: the one Inventory document that corrects recorded stock when it differs from what physically exists — a count found
-- 96 where the books said 100, a migration loaded 250 where 247 exist. It is never a receipt, delivery, return, transfer, consumption or a
-- disposition change: those have their own documents.
--
-- One document: one company, one warehouse, a structured reason (a small reason master with a direction policy and its gain and loss
-- accounts), and lines — each one item at one location in one disposition, entered as a counted quantity (the system quantity and the
-- balance's last movement are captured, so a count that has gone stale is refused) or as a difference, in any of the item's units (kept with
-- the conversion), with the batches or serial numbers it concerns. Draft → Posted → Reversed, or Cancelled while a draft. Posting re-checks
-- current stock, resolves the reservations a shortage would break (release or reallocate, in the same transaction), posts Adjustment In / Out
-- through the Stock Ledger (a gain at an authorized cost, a loss at the valuation engine's cost) and the gain/loss journal. Nothing posted is
-- edited; a posting mistake is reversed whole.

-- ============================================================ 1. reasons
CREATE TABLE IF NOT EXISTS tenant.inventory_adjustment_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  direction_policy text NOT NULL DEFAULT 'both' CHECK (direction_policy IN ('increase', 'decrease', 'both')),
  requires_notes boolean NOT NULL DEFAULT false,
  gain_account_id uuid REFERENCES tenant.accounting_accounts(id),
  loss_account_id uuid REFERENCES tenant.accounting_accounts(id),
  is_system boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  UNIQUE (organization_id, code)
);

-- ============================================================ 2. documents
CREATE TABLE IF NOT EXISTS tenant.inventory_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  document_number text NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  adjustment_date date NOT NULL,
  posting_date date,
  reason_id uuid NOT NULL REFERENCES tenant.inventory_adjustment_reasons(id),
  reference text,
  count_reference text,
  stock_count_id uuid REFERENCES tenant.stock_counts(id),
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled', 'reversed')),
  posted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  posted_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason text,
  reversed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reversed_at timestamptz,
  reversal_reason text,
  movement_group_id uuid REFERENCES tenant.stock_movement_groups(id),
  reversal_group_id uuid REFERENCES tenant.stock_movement_groups(id),
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  reversal_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  value_increase numeric(20, 6),
  value_decrease numeric(20, 6),
  idempotency_key text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, document_number),
  UNIQUE (organization_id, idempotency_key),
  CHECK ((status IN ('posted', 'reversed')) = (posted_at IS NOT NULL)),
  CHECK ((status = 'reversed') = (reversed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS inventory_adjustments_list_idx ON tenant.inventory_adjustments (organization_id, status, adjustment_date DESC);
CREATE INDEX IF NOT EXISTS inventory_adjustments_warehouse_idx ON tenant.inventory_adjustments (organization_id, warehouse_id);

-- One line: one item at one location in one disposition. The system quantity and the position's last movement are captured when it is counted
-- (a counted line posts only if nothing moved there since); the difference is kept signed in base units.
CREATE TABLE IF NOT EXISTS tenant.inventory_adjustment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  adjustment_id uuid NOT NULL REFERENCES tenant.inventory_adjustments(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  item_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  location_id uuid REFERENCES tenant.warehouse_locations(id),
  disposition text NOT NULL DEFAULT 'available' CHECK (disposition IN ('available', 'quality_hold', 'quarantined', 'damaged', 'expired')),
  entry_mode text NOT NULL CHECK (entry_mode IN ('counted', 'difference')),
  system_base_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  balance_version_snapshot bigint,
  last_movement_snapshot uuid,
  counted_at timestamptz,
  uom_id uuid NOT NULL,
  conversion_factor numeric(24, 10) NOT NULL CHECK (conversion_factor > 0),
  counted_quantity numeric(24, 6) CHECK (counted_quantity IS NULL OR counted_quantity >= 0),
  counted_base_quantity numeric(20, 6) CHECK (counted_base_quantity IS NULL OR counted_base_quantity >= 0),
  entered_difference numeric(24, 6),
  adjustment_base_quantity numeric(20, 6) NOT NULL,
  valuation_source text CHECK (valuation_source IS NULL OR valuation_source IN ('current_valuation_cost', 'manual_authorized_cost', 'zero_cost_authorized')),
  manual_unit_cost numeric(20, 6) CHECK (manual_unit_cost IS NULL OR manual_unit_cost >= 0),
  cost_note text,
  notes text,
  movement_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, adjustment_id, line_number),
  CHECK ((entry_mode = 'counted') = (counted_quantity IS NOT NULL)),
  CHECK (entry_mode = 'counted' OR entered_difference IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS inventory_adjustment_lines_item_idx ON tenant.inventory_adjustment_lines (organization_id, item_id);
ALTER TABLE tenant.inventory_adjustment_lines ADD CONSTRAINT inventory_adjustment_lines_uom_fkey FOREIGN KEY (organization_id, uom_id) REFERENCES tenant.units_of_measure(organization_id, id);

-- A batch-tracked line's batches: each an existing batch (or a genuinely new lot found, created on posting), with its own system snapshot and
-- signed difference; together they make the line's difference.
CREATE TABLE IF NOT EXISTS tenant.inventory_adjustment_lot_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  adjustment_line_id uuid NOT NULL REFERENCES tenant.inventory_adjustment_lines(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES tenant.stock_batches(id),
  new_batch_number text,
  new_expires_on date,
  system_base_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  last_movement_snapshot uuid,
  counted_base_quantity numeric(20, 6) CHECK (counted_base_quantity IS NULL OR counted_base_quantity >= 0),
  adjustment_base_quantity numeric(20, 6) NOT NULL,
  CHECK ((batch_id IS NULL) <> (new_batch_number IS NULL)),
  CHECK (new_batch_number IS NULL OR adjustment_base_quantity > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_adjustment_lots_batch_uidx ON tenant.inventory_adjustment_lot_allocations (adjustment_line_id, batch_id) WHERE batch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_adjustment_lots_new_uidx ON tenant.inventory_adjustment_lot_allocations (adjustment_line_id, lower(new_batch_number)) WHERE new_batch_number IS NOT NULL;

-- A serial-tracked line's serial numbers: missing ones (out of stock) and found ones (an existing record coming back, or a new serial number
-- registered on posting). A reserved one missing names how its reservation was resolved.
CREATE TABLE IF NOT EXISTS tenant.inventory_adjustment_serials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  adjustment_line_id uuid NOT NULL REFERENCES tenant.inventory_adjustment_lines(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('out', 'in')),
  serial_id uuid REFERENCES tenant.stock_serials(id),
  serial_number text NOT NULL,
  reservation_resolution jsonb,
  CHECK (direction = 'in' OR serial_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_adjustment_serials_uidx ON tenant.inventory_adjustment_serials (adjustment_line_id, lower(serial_number));

-- ============================================================ 3. history
CREATE TABLE IF NOT EXISTS tenant.inventory_adjustment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  adjustment_id uuid NOT NULL REFERENCES tenant.inventory_adjustments(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS inventory_adjustment_events_idx ON tenant.inventory_adjustment_events (organization_id, adjustment_id, created_at);

-- A serial number adjusted out (missing at a count) stays in history, out of stock, marked missing; found again, it comes back.
ALTER TABLE tenant.stock_serials ADD COLUMN IF NOT EXISTS missing_since timestamptz;
-- Above this absolute value, posting an adjustment needs the large-adjustment permission (empty: no threshold).
ALTER TABLE tenant.stock_settings ADD COLUMN IF NOT EXISTS adjustment_value_threshold numeric(20, 2) CHECK (adjustment_value_threshold IS NULL OR adjustment_value_threshold >= 0);

-- ============================================================ 4. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['inventory_adjustment_reasons', 'inventory_adjustments', 'inventory_adjustment_lines', 'inventory_adjustment_lot_allocations',
    'inventory_adjustment_serials', 'inventory_adjustment_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', name);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
-- The history is evidence: never edited or removed by the application.
REVOKE UPDATE, DELETE ON tenant.inventory_adjustment_events FROM vercent_app;

-- ============================================================ 5. the system reasons of every company already here (new companies get them on first use)
INSERT INTO tenant.inventory_adjustment_reasons (organization_id, code, name, description, direction_policy, requires_notes, is_system)
SELECT organization.id, reason.code, reason.name, reason.description, reason.direction, reason.notes, true
  FROM public.organizations organization
 CROSS JOIN (VALUES
   ('PHYSICAL_COUNT_GAIN', 'Physical count gain', 'A count found more than the books show.', 'increase', false),
   ('PHYSICAL_COUNT_LOSS', 'Physical count loss', 'A count found less than the books show.', 'decrease', false),
   ('DATA_CORRECTION', 'Data correction', 'A recording error corrected; explain it in the notes.', 'both', true),
   ('MIGRATION_CORRECTION', 'Migration correction', 'A quantity loaded wrongly from the previous system; explain it in the notes.', 'both', true),
   ('TRACKING_CORRECTION', 'Tracking correction', 'A batch or serial number quantity corrected through controlled movements.', 'both', false),
   ('OTHER', 'Other', 'Any other discrepancy; explain it in the notes.', 'both', true)
 ) AS reason(code, name, description, direction, notes)
ON CONFLICT (organization_id, code) DO NOTHING;

-- ============================================================ 6. finance: the inventory adjustment gain and loss accounts and their default mappings
INSERT INTO tenant.accounting_accounts (organization_id, ledger_id, code, name, account_class, account_type, normal_balance, is_group, allow_manual_posting,
  reconciliation_required, status, parent_id)
SELECT ledger.organization_id, ledger.id, defaults.code, defaults.name, defaults.class, defaults.type, defaults.balance, false, true, false, 'active',
       (SELECT parent.id FROM tenant.accounting_accounts parent WHERE parent.organization_id = ledger.organization_id AND parent.ledger_id = ledger.id AND parent.code = defaults.parent)
  FROM tenant.accounting_ledgers ledger
 CROSS JOIN (VALUES ('4960', 'Inventory adjustment gain', 'revenue', 'other_income', 'credit', '4000'),
                    ('6550', 'Inventory adjustment loss', 'expense', 'expense', 'debit', '6000')) AS defaults (code, name, class, type, balance, parent)
 WHERE ledger.code = 'PRIMARY'
ON CONFLICT (organization_id, ledger_id, code) DO NOTHING;

-- Defaults at priority 1000: any mapping a company configured itself (an item's, a category's, or its own default) still wins.
INSERT INTO tenant.accounting_account_mappings (organization_id, ledger_id, mapping_key, account_id, priority, status)
SELECT ledger.organization_id, ledger.id, defaults.mapping_key, account.id, 1000, 'active'
  FROM tenant.accounting_ledgers ledger
  CROSS JOIN (VALUES ('inventory_adjustment_gain', '4960'), ('inventory_adjustment_loss', '6550')) AS defaults (mapping_key, account_code)
  JOIN tenant.accounting_accounts account ON account.organization_id = ledger.organization_id AND account.ledger_id = ledger.id AND account.code = defaults.account_code
 WHERE ledger.code = 'PRIMARY'
   AND NOT EXISTS (SELECT 1 FROM tenant.accounting_account_mappings existing WHERE existing.organization_id = ledger.organization_id AND existing.ledger_id = ledger.id
                     AND existing.mapping_key = defaults.mapping_key AND existing.priority = 1000 AND existing.party_id IS NULL AND existing.item_id IS NULL
                     AND existing.item_group_id IS NULL AND existing.tax_category_id IS NULL);

-- ============================================================ 7. permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('stock.adjustments.view', 'View stock adjustments', 'Inventory', 'See stock adjustments, their lines, tracking and stock movements.'),
  ('stock.adjustments.create', 'Create stock adjustments', 'Inventory', 'Create draft stock adjustments.'),
  ('stock.adjustments.edit', 'Edit draft stock adjustments', 'Inventory', 'Change and cancel draft stock adjustments.'),
  ('stock.adjustments.count', 'Enter physical counts', 'Inventory', 'Enter counted quantities and capture the system stock they are compared with.'),
  ('stock.adjustments.post_increase', 'Post stock increases', 'Inventory', 'Post adjustments that add stock found.'),
  ('stock.adjustments.post_decrease', 'Post stock decreases', 'Inventory', 'Post adjustments that remove stock found missing.'),
  ('stock.adjustments.post_large', 'Post large stock adjustments', 'Inventory', 'Post adjustments whose value is above the company''s threshold.'),
  ('stock.adjustments.restricted', 'Adjust restricted stock', 'Inventory', 'Adjust stock on quality hold, quarantined, damaged or expired.'),
  ('stock.adjustments.batch', 'Adjust batch stock', 'Inventory', 'Adjust batch-tracked items, batch by batch.'),
  ('stock.adjustments.serial', 'Adjust serial-numbered stock', 'Inventory', 'Adjust serial-numbered items: serial numbers missing or found.'),
  ('stock.adjustments.resolve_reservations', 'Resolve reservation conflicts', 'Inventory', 'Release or reallocate reservations a stock shortage would break.'),
  ('stock.adjustments.manual_cost', 'Enter adjustment cost', 'Inventory', 'Enter the unit cost of stock found.'),
  ('stock.adjustments.zero_cost', 'Add stock at zero cost', 'Inventory', 'Authorize stock found to be added at zero cost.'),
  ('stock.adjustments.backdate', 'Backdate stock adjustments', 'Inventory', 'Post an adjustment effective on an earlier date in an open period.'),
  ('stock.adjustments.reverse', 'Reverse stock adjustments', 'Inventory', 'Reverse a posted stock adjustment that was a posting mistake.'),
  ('stock.adjustments.view_cost', 'View stock adjustment value', 'Inventory', 'See the cost and value of stock adjustments.'),
  ('stock.adjustments.view_accounting', 'View stock adjustment accounting', 'Inventory', 'See the journals stock adjustments posted.'),
  ('stock.adjustments.manage_reasons', 'Manage stock adjustment reasons', 'Inventory', 'Create, rename, deactivate and configure stock adjustment reasons.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, granted.key FROM public.role_permissions existing
  JOIN (VALUES ('stock.view', 'stock.adjustments.view'),
               ('stock.adjust', 'stock.adjustments.view'), ('stock.adjust', 'stock.adjustments.create'), ('stock.adjust', 'stock.adjustments.edit'),
               ('stock.adjust', 'stock.adjustments.count'), ('stock.adjust', 'stock.adjustments.post_increase'), ('stock.adjust', 'stock.adjustments.post_decrease'),
               ('stock.adjust', 'stock.adjustments.batch'), ('stock.adjust', 'stock.adjustments.serial'), ('stock.adjust', 'stock.adjustments.restricted'),
               ('stock.valuation.view', 'stock.adjustments.view_cost'), ('accounting.view', 'stock.adjustments.view_accounting'),
               ('inventory_setup.manage', 'stock.adjustments.post_large'), ('inventory_setup.manage', 'stock.adjustments.resolve_reservations'),
               ('inventory_setup.manage', 'stock.adjustments.manual_cost'), ('inventory_setup.manage', 'stock.adjustments.zero_cost'),
               ('inventory_setup.manage', 'stock.adjustments.backdate'), ('inventory_setup.manage', 'stock.adjustments.reverse'),
               ('inventory_setup.manage', 'stock.adjustments.manage_reasons'))
       AS granted(source, key) ON granted.source = existing.permission_key
  JOIN public.permissions permission ON permission.key = granted.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0071_stock_adjustments.sql', 'stock-adjustments');
