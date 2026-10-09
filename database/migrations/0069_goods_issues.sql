-- Goods Issues: the Inventory document for stock deliberately taken out of inventory for a known internal purpose — consumption, maintenance,
-- samples, project use, scrap and disposal. It is not a sale (Sales Delivery), a supplier return (Purchase Return), a move (Transfer) or a
-- correction of an unexplained difference (Inventory Adjustment).
--
-- One document: one company, one source warehouse, a structured reason (from a small reason master), who or what the goods were issued to, and
-- lines in any of the item's units (kept with their conversion), each from one location, with its batches or serial numbers. Draft → Posted →
-- (partly or fully) Reversed, or Cancelled while a draft. Posting issues stock through the Stock Ledger at the valuation engine's cost and
-- posts the expense journal; a reversal brings the same batch or serial back at the cost it left with. Nothing posted is edited.

-- ============================================================ 1. reasons
CREATE TABLE IF NOT EXISTS tenant.goods_issue_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  allowed_dispositions text[] NOT NULL DEFAULT ARRAY['available'],
  requires_recipient boolean NOT NULL DEFAULT false,
  requires_notes boolean NOT NULL DEFAULT false,
  expense_account_id uuid REFERENCES tenant.accounting_accounts(id),
  is_system boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  CHECK (cardinality(allowed_dispositions) > 0 AND allowed_dispositions <@ ARRAY['available', 'quality_hold', 'quarantined', 'damaged', 'expired']),
  UNIQUE (organization_id, code)
);

-- ============================================================ 2. documents
CREATE TABLE IF NOT EXISTS tenant.goods_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  document_number text NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  issue_date date NOT NULL,
  reason_id uuid NOT NULL REFERENCES tenant.goods_issue_reasons(id),
  issue_to_type text CHECK (issue_to_type IS NULL OR issue_to_type IN ('department', 'employee', 'project', 'cost_center', 'other')),
  issue_to_id uuid,
  issue_to_text text,
  project_id uuid,
  cost_center_id uuid REFERENCES public.cost_centers(id),
  external_reference text,
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled')),
  issued_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  posted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  posted_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason text,
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  issued_value numeric(20, 6),
  idempotency_key text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, document_number),
  UNIQUE (organization_id, idempotency_key),
  CHECK ((status = 'posted') = (posted_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS goods_issues_list_idx ON tenant.goods_issues (organization_id, status, issue_date DESC);
CREATE INDEX IF NOT EXISTS goods_issues_warehouse_idx ON tenant.goods_issues (organization_id, warehouse_id);

CREATE TABLE IF NOT EXISTS tenant.goods_issue_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  goods_issue_id uuid NOT NULL REFERENCES tenant.goods_issues(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  item_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  quantity numeric(24, 6) NOT NULL CHECK (quantity > 0),
  uom_id uuid NOT NULL,
  conversion_factor numeric(24, 10) NOT NULL CHECK (conversion_factor > 0),
  base_quantity numeric(20, 6) NOT NULL CHECK (base_quantity > 0),
  location_id uuid REFERENCES tenant.warehouse_locations(id),
  source_disposition text NOT NULL DEFAULT 'available' CHECK (source_disposition IN ('available', 'quality_hold', 'quarantined', 'damaged', 'expired')),
  serial_ids uuid[] NOT NULL DEFAULT '{}',
  reason_id uuid REFERENCES tenant.goods_issue_reasons(id),
  notes text,
  movement_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, goods_issue_id, line_number),
  CHECK (cardinality(serial_ids) = 0 OR cardinality(serial_ids) = base_quantity)
);
CREATE INDEX IF NOT EXISTS goods_issue_lines_item_idx ON tenant.goods_issue_lines (organization_id, item_id);
ALTER TABLE tenant.goods_issue_lines ADD CONSTRAINT goods_issue_lines_uom_fkey FOREIGN KEY (organization_id, uom_id) REFERENCES tenant.units_of_measure(organization_id, id);

-- A batch-tracked line's batches: they account for exactly the line's base quantity.
CREATE TABLE IF NOT EXISTS tenant.goods_issue_lot_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  goods_issue_line_id uuid NOT NULL REFERENCES tenant.goods_issue_lines(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES tenant.stock_batches(id),
  base_quantity numeric(20, 6) NOT NULL CHECK (base_quantity > 0),
  UNIQUE (goods_issue_line_id, batch_id)
);

-- ============================================================ 3. reversals (full or partial; what each brought back)
CREATE TABLE IF NOT EXISTS tenant.goods_issue_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  goods_issue_id uuid NOT NULL REFERENCES tenant.goods_issues(id),
  reason text NOT NULL,
  reversal_date date NOT NULL,
  journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id),
  reversed_value numeric(20, 6),
  idempotency_key text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS tenant.goods_issue_reversal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  reversal_id uuid NOT NULL REFERENCES tenant.goods_issue_reversals(id) ON DELETE CASCADE,
  goods_issue_line_id uuid NOT NULL REFERENCES tenant.goods_issue_lines(id),
  batch_id uuid REFERENCES tenant.stock_batches(id),
  serial_id uuid REFERENCES tenant.stock_serials(id),
  base_quantity numeric(20, 6) NOT NULL CHECK (base_quantity > 0),
  movement_id uuid REFERENCES tenant.stock_movements(id)
);
CREATE INDEX IF NOT EXISTS goods_issue_reversal_lines_line_idx ON tenant.goods_issue_reversal_lines (organization_id, goods_issue_line_id);
CREATE UNIQUE INDEX IF NOT EXISTS goods_issue_reversal_lines_one_serial_uidx ON tenant.goods_issue_reversal_lines (goods_issue_line_id, serial_id) WHERE serial_id IS NOT NULL;

-- ============================================================ 4. history
CREATE TABLE IF NOT EXISTS tenant.goods_issue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  goods_issue_id uuid NOT NULL REFERENCES tenant.goods_issues(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS goods_issue_events_idx ON tenant.goods_issue_events (organization_id, goods_issue_id, created_at);

-- ============================================================ 5. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['goods_issue_reasons', 'goods_issues', 'goods_issue_lines', 'goods_issue_lot_allocations', 'goods_issue_reversals', 'goods_issue_reversal_lines',
    'goods_issue_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.%I TO vercent_app', name);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
-- A reversal and its history are evidence: never edited or removed by the application.
REVOKE UPDATE, DELETE ON tenant.goods_issue_reversals, tenant.goods_issue_reversal_lines, tenant.goods_issue_events FROM vercent_app;

-- ============================================================ 6. the system reasons of every company already here (new companies get them on first use)
INSERT INTO tenant.goods_issue_reasons (organization_id, code, name, description, allowed_dispositions, requires_recipient, requires_notes, is_system)
SELECT organization.id, reason.code, reason.name, reason.description, reason.allowed, reason.recipient, reason.notes, true
  FROM public.organizations organization
 CROSS JOIN (VALUES
   ('INTERNAL_CONSUMPTION', 'Internal consumption', 'Consumables used inside the company.', ARRAY['available'], false, false),
   ('MAINTENANCE', 'Maintenance', 'Parts and materials used to maintain the company''s own equipment.', ARRAY['available'], false, false),
   ('SAMPLE_PROMOTION', 'Sample / promotion', 'Free samples and promotional goods given without a sale.', ARRAY['available'], true, false),
   ('PROJECT_CONSUMPTION', 'Project consumption', 'Material permanently consumed by an internal project.', ARRAY['available'], true, false),
   ('SCRAP_DISPOSAL', 'Scrap / disposal', 'Damaged, expired or quarantined stock destroyed or disposed of.', ARRAY['available', 'quality_hold', 'quarantined', 'damaged', 'expired'], false, true),
   ('OTHER', 'Other', 'Any other authorized issue; explain it in the notes.', ARRAY['available'], false, true)
 ) AS reason(code, name, description, allowed, recipient, notes)
ON CONFLICT (organization_id, code) DO NOTHING;

-- ============================================================ 7. permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('stock.goods_issue.view', 'View goods issues', 'Inventory', 'See goods issues, their lines, tracking and stock movements.'),
  ('stock.goods_issue.create', 'Prepare goods issues', 'Inventory', 'Create, edit and cancel draft goods issues.'),
  ('stock.goods_issue.post', 'Post goods issues', 'Inventory', 'Post a goods issue: the stock leaves inventory.'),
  ('stock.goods_issue.reverse', 'Reverse goods issues', 'Inventory', 'Reverse a posted goods issue, fully or partly, bringing the same stock back.'),
  ('stock.goods_issue.issue_restricted', 'Issue restricted stock', 'Inventory', 'Issue stock that is on quality hold, quarantined, damaged or expired (scrap and disposal).'),
  ('stock.goods_issue.dispose', 'Post scrap and disposal issues', 'Inventory', 'Post goods issues for scrap and disposal.'),
  ('stock.goods_issue.view_cost', 'View goods issue value', 'Inventory', 'See the cost and value of goods issued.'),
  ('stock.goods_issue.manage_reasons', 'Manage goods issue reasons', 'Inventory', 'Create, rename, deactivate and configure goods issue reasons.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, granted.key FROM public.role_permissions existing
  JOIN (VALUES ('stock.view', 'stock.goods_issue.view'), ('stock.issue', 'stock.goods_issue.view'), ('stock.issue', 'stock.goods_issue.create'), ('stock.issue', 'stock.goods_issue.post'),
               ('stock.adjust', 'stock.goods_issue.issue_restricted'), ('stock.adjust', 'stock.goods_issue.dispose'), ('stock.valuation.view', 'stock.goods_issue.view_cost'),
               ('inventory_setup.manage', 'stock.goods_issue.reverse'), ('inventory_setup.manage', 'stock.goods_issue.issue_restricted'), ('inventory_setup.manage', 'stock.goods_issue.dispose'),
               ('inventory_setup.manage', 'stock.goods_issue.manage_reasons'))
       AS granted(source, key) ON granted.source = existing.permission_key
  JOIN public.permissions permission ON permission.key = granted.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0069_goods_issues.sql', 'goods-issues');
