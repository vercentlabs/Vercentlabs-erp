-- Manufacturing: Finished-Goods Receipt. The receipt note (FGR) as a controlled document over a manufacturing order's accepted, unreceived
-- output: a draft names the production entries it receives from, the quantity of each, the destination warehouse and bin, and the lot or
-- serial numbers; a destination other than the order's finished-goods warehouse waits for an approval bound to that exact content; posting
-- revalidates under the order's lock and receives the stock through Inventory's own movements, moves its value from work in progress to
-- finished goods through Finance, and records the receipt the order's figures are built from (manufacturing_goods_receipts, 0112) — all in
-- one database transaction, under a posting identity fixed by the document and its version, so a retry never receives twice. Posted notes
-- are immutable; a posting error is corrected by an approved reversal of the whole receipt (the exact movements, at their original value).
-- Additive only: no table, column or constraint is dropped.

-- ============================================================ 1. the receipt note
CREATE TABLE IF NOT EXISTS tenant.manufacturing_finished_goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  receipt_number text NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  finished_item_id uuid NOT NULL REFERENCES tenant.items(id),
  -- Where the goods come from (the order's manufacturing warehouse) and where they go.
  source_warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  source_location_id uuid REFERENCES tenant.warehouse_locations(id),
  destination_warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  destination_location_id uuid REFERENCES tenant.warehouse_locations(id),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'POSTING', 'POSTED', 'CANCELLED', 'RECOVERY_REQUIRED')),
  receipt_date date NOT NULL DEFAULT current_date,
  notes text,
  -- The approval of an exception (a destination other than the order's finished-goods warehouse), bound to the exact content.
  approval_status text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (approval_status IN ('NOT_REQUIRED', 'REQUESTED', 'APPROVED', 'REJECTED')),
  approval_hash text,
  approval_reason text,
  approval_requested_by uuid REFERENCES public.users(id),
  approval_requested_at timestamptz,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  approval_note text,
  content_hash text,
  -- Posting results: the order's receipt record, Inventory's value and Finance's journal.
  posting_key text,
  posted_mo_version integer,
  posted_by uuid REFERENCES public.users(id),
  posted_at timestamptz,
  goods_receipt_id uuid REFERENCES tenant.manufacturing_goods_receipts(id),
  unit_cost numeric(20, 6),
  total_cost numeric(20, 2),
  cost_basis jsonb,
  journal_entry_id uuid,
  finance_status text CHECK (finance_status IS NULL OR finance_status IN ('POSTED', 'NOT_REQUIRED', 'PENDING')),
  -- After posting: NONE, or a reversal requested, done or turned down.
  correction_status text NOT NULL DEFAULT 'NONE' CHECK (correction_status IN ('NONE', 'REQUESTED', 'REVERSED', 'REJECTED')),
  cancelled_by uuid REFERENCES public.users(id),
  cancelled_at timestamptz,
  cancel_reason text,
  print_count integer NOT NULL DEFAULT 0,
  last_printed_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text,
  CHECK (status <> 'POSTED' OR (posted_at IS NOT NULL AND posting_key IS NOT NULL AND goods_receipt_id IS NOT NULL)),
  CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_finished_goods_receipts_number_uidx ON tenant.manufacturing_finished_goods_receipts (organization_id, receipt_number);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_finished_goods_receipts_posting_uidx ON tenant.manufacturing_finished_goods_receipts (organization_id, posting_key) WHERE posting_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_finished_goods_receipts_key_uidx ON tenant.manufacturing_finished_goods_receipts (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_finished_goods_receipts_goods_receipt_uidx ON tenant.manufacturing_finished_goods_receipts (organization_id, goods_receipt_id) WHERE goods_receipt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS manufacturing_finished_goods_receipts_order_idx ON tenant.manufacturing_finished_goods_receipts (organization_id, manufacturing_order_id, created_at);
CREATE INDEX IF NOT EXISTS manufacturing_finished_goods_receipts_status_idx ON tenant.manufacturing_finished_goods_receipts (organization_id, status, created_at);

-- One line per production entry received from: the quantity (as entered and in the base unit), the lot it becomes or the serial units.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_finished_goods_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  receipt_id uuid NOT NULL REFERENCES tenant.manufacturing_finished_goods_receipts(id),
  line_number integer NOT NULL,
  production_entry_id uuid NOT NULL REFERENCES tenant.manufacturing_production_entries(id),
  production_batch_id uuid REFERENCES tenant.manufacturing_production_batches(id),
  -- The quality evidence: the latest decision that accepted output of the entry (none when it was accepted as reported, without inspection).
  quality_decision_id uuid REFERENCES tenant.manufacturing_quality_decisions(id),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  uom_id uuid NOT NULL REFERENCES tenant.units_of_measure(id),
  conversion_factor numeric(20, 9) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  base_quantity numeric(20, 6) NOT NULL CHECK (base_quantity > 0),
  lot_number text,
  manufactured_on date,
  expires_on date,
  serial_numbers text[],
  -- Posting results.
  lot_id uuid REFERENCES tenant.stock_batches(id),
  stock_movement_ids uuid[] NOT NULL DEFAULT '{}',
  unit_cost numeric(20, 6),
  total_cost numeric(20, 2),
  UNIQUE (receipt_id, line_number),
  UNIQUE (receipt_id, production_entry_id)
);
CREATE INDEX IF NOT EXISTS manufacturing_finished_goods_receipt_lines_entry_idx ON tenant.manufacturing_finished_goods_receipt_lines (organization_id, production_entry_id);

-- Every serial unit received, linked to its line, its production entry and Inventory's serial record.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_finished_goods_serials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  receipt_line_id uuid NOT NULL REFERENCES tenant.manufacturing_finished_goods_receipt_lines(id),
  production_entry_id uuid NOT NULL REFERENCES tenant.manufacturing_production_entries(id),
  serial_number text NOT NULL,
  serial_id uuid,
  stock_movement_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manufacturing_finished_goods_serials_line_idx ON tenant.manufacturing_finished_goods_serials (organization_id, receipt_line_id);
CREATE INDEX IF NOT EXISTS manufacturing_finished_goods_serials_number_idx ON tenant.manufacturing_finished_goods_serials (organization_id, lower(serial_number));

-- One row per posting (RECEIPT or REVERSAL): the identity, the document version, Inventory's and Finance's outcome.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_finished_goods_receipt_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  receipt_id uuid NOT NULL REFERENCES tenant.manufacturing_finished_goods_receipts(id),
  command_key text NOT NULL,
  document_version integer NOT NULL,
  kind text NOT NULL DEFAULT 'RECEIPT' CHECK (kind IN ('RECEIPT', 'REVERSAL')),
  inventory_status text NOT NULL CHECK (inventory_status IN ('CONFIRMED', 'FAILED')),
  stock_movement_ids uuid[] NOT NULL DEFAULT '{}',
  finance_status text NOT NULL CHECK (finance_status IN ('POSTED', 'NOT_REQUIRED', 'PENDING')),
  journal_entry_id uuid,
  quantity numeric(20, 6),
  amount numeric(20, 2),
  last_error_code text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_finished_goods_receipt_postings_key_uidx ON tenant.manufacturing_finished_goods_receipt_postings (organization_id, command_key);
CREATE INDEX IF NOT EXISTS manufacturing_finished_goods_receipt_postings_receipt_idx ON tenant.manufacturing_finished_goods_receipt_postings (organization_id, receipt_id);

-- A correction of a posted receipt: requested with a reason, decided by someone else; an approved one reverses the whole receipt.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_finished_goods_receipt_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  correction_number text NOT NULL,
  receipt_id uuid NOT NULL REFERENCES tenant.manufacturing_finished_goods_receipts(id),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED')),
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  evidence text,
  requested_by uuid REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_note text,
  stock_movement_ids uuid[] NOT NULL DEFAULT '{}',
  total_cost numeric(20, 2),
  journal_entry_id uuid,
  idempotency_key text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_finished_goods_receipt_corrections_number_uidx ON tenant.manufacturing_finished_goods_receipt_corrections (organization_id, correction_number);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_finished_goods_receipt_corrections_key_uidx ON tenant.manufacturing_finished_goods_receipt_corrections (organization_id, idempotency_key);
-- At most one open request per receipt.
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_finished_goods_receipt_corrections_open_uidx ON tenant.manufacturing_finished_goods_receipt_corrections (organization_id, receipt_id) WHERE status = 'REQUESTED';

-- The note's timeline: append-only.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_finished_goods_receipt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  receipt_id uuid NOT NULL REFERENCES tenant.manufacturing_finished_goods_receipts(id),
  action text NOT NULL,
  from_status text,
  to_status text,
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_finished_goods_receipt_events_receipt_idx ON tenant.manufacturing_finished_goods_receipt_events (organization_id, receipt_id, occurred_at);

-- ============================================================ 2. the order's receipt record and the entries: reversals
-- The receipt record (0112, append-only) names its note and the bin it went to; a reversal is recorded on the note's correction, never by
-- changing the record. A production entry counts what reversals took back (it only grows, like every other entry figure):
-- net received = received - receipt reversed. The order's received quantity is its running net figure.
ALTER TABLE tenant.manufacturing_goods_receipts ADD COLUMN IF NOT EXISTS finished_goods_receipt_id uuid REFERENCES tenant.manufacturing_finished_goods_receipts(id);
ALTER TABLE tenant.manufacturing_goods_receipts ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES tenant.warehouse_locations(id);
ALTER TABLE tenant.manufacturing_production_entries ADD COLUMN IF NOT EXISTS receipt_reversed_quantity numeric(20, 6) NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_production_entries_receipt_reversed_check') THEN
    ALTER TABLE tenant.manufacturing_production_entries ADD CONSTRAINT manufacturing_production_entries_receipt_reversed_check
      CHECK (receipt_reversed_quantity >= 0 AND receipt_reversed_quantity <= received_quantity);
  END IF;
END $$;

-- The entry guard of 0117, extended: the reversed receipt quantity only grows too.
CREATE OR REPLACE FUNCTION tenant.manufacturing_production_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A production entry is never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'CANCELLED' THEN
    IF NEW.status <> 'CANCELLED' OR NEW.reported_quantity <> OLD.reported_quantity THEN
      RAISE EXCEPTION 'A cancelled production entry does not change.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.reported_quantity <> OLD.reported_quantity OR NEW.accepted_quantity <> OLD.accepted_quantity OR NEW.rejected_quantity <> OLD.rejected_quantity
      OR NEW.pending_quantity <> OLD.pending_quantity OR NEW.manufacturing_order_id <> OLD.manufacturing_order_id OR NEW.pending_remaining > OLD.pending_remaining
      OR NEW.received_quantity < OLD.received_quantity OR NEW.receipt_reversed_quantity < OLD.receipt_reversed_quantity
      OR NEW.corrected_pending_quantity < OLD.corrected_pending_quantity
      OR NEW.corrected_accepted_quantity < OLD.corrected_accepted_quantity OR NEW.production_batch_id IS DISTINCT FROM OLD.production_batch_id
      OR NEW.posting_key IS DISTINCT FROM OLD.posting_key OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
      OR (NEW.status <> OLD.status AND NOT (OLD.status = 'REPORTED' AND NEW.status = 'RECOVERY_REQUIRED') AND NOT (OLD.status = 'RECOVERY_REQUIRED' AND NEW.status = 'REPORTED')) THEN
    RAISE EXCEPTION 'A reported production entry does not change; record a quality decision, a receipt or a correction.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- Policy: whether output of an order on hold may still be received (previously accepted output only).
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS fgr_receive_on_hold boolean NOT NULL DEFAULT false;

-- ============================================================ 3. guards
-- A posted (or cancelled) note is history: its content never changes; only printing is counted, a correction recorded beside it, and a
-- posted note may be marked for recovery (and back).
CREATE OR REPLACE FUNCTION tenant.manufacturing_finished_goods_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A finished-goods receipt is never deleted; cancel a draft instead.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('POSTED', 'CANCELLED', 'RECOVERY_REQUIRED') THEN
    IF (NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'POSTED' AND NEW.status = 'RECOVERY_REQUIRED') AND NOT (OLD.status = 'RECOVERY_REQUIRED' AND NEW.status = 'POSTED'))
       OR NEW.manufacturing_order_id <> OLD.manufacturing_order_id OR NEW.destination_warehouse_id <> OLD.destination_warehouse_id
       OR NEW.destination_location_id IS DISTINCT FROM OLD.destination_location_id OR NEW.posting_key IS DISTINCT FROM OLD.posting_key
       OR NEW.posted_at IS DISTINCT FROM OLD.posted_at OR NEW.total_cost IS DISTINCT FROM OLD.total_cost OR NEW.goods_receipt_id IS DISTINCT FROM OLD.goods_receipt_id
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.receipt_number <> OLD.receipt_number THEN
      RAISE EXCEPTION 'A % finished-goods receipt does not change.', lower(OLD.status) USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION tenant.manufacturing_finished_goods_receipt_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  receipt_status text;
BEGIN
  SELECT status INTO receipt_status FROM tenant.manufacturing_finished_goods_receipts WHERE id = COALESCE(NEW.receipt_id, OLD.receipt_id);
  IF receipt_status IN ('DRAFT', 'PENDING_APPROVAL', 'POSTING') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'The lines of a posted or cancelled finished-goods receipt are fixed.' USING ERRCODE = 'check_violation';
END $$;
-- A serial number appears once per line.
CREATE OR REPLACE FUNCTION tenant.manufacturing_finished_goods_receipt_serial_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.serial_numbers IS NOT NULL AND cardinality(NEW.serial_numbers) <> (SELECT count(DISTINCT lower(value)) FROM unnest(NEW.serial_numbers) value) THEN
    RAISE EXCEPTION 'A serial number appears twice on one receipt line.' USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $$;
-- A decided correction does not change.
CREATE OR REPLACE FUNCTION tenant.manufacturing_finished_goods_receipt_correction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A receipt correction is never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'REQUESTED' OR NEW.receipt_id <> OLD.receipt_id OR NEW.quantity <> OLD.quantity OR NEW.reason <> OLD.reason OR NEW.requested_by IS DISTINCT FROM OLD.requested_by THEN
    RAISE EXCEPTION 'A decided receipt correction does not change.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE
  name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_finished_goods_receipts_guard') THEN
    CREATE TRIGGER manufacturing_finished_goods_receipts_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_finished_goods_receipts FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_finished_goods_receipt_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_finished_goods_receipt_lines_guard') THEN
    CREATE TRIGGER manufacturing_finished_goods_receipt_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.manufacturing_finished_goods_receipt_lines FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_finished_goods_receipt_line_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_finished_goods_receipt_lines_serials') THEN
    CREATE TRIGGER manufacturing_finished_goods_receipt_lines_serials BEFORE INSERT OR UPDATE ON tenant.manufacturing_finished_goods_receipt_lines FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_finished_goods_receipt_serial_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_finished_goods_receipt_corrections_guard') THEN
    CREATE TRIGGER manufacturing_finished_goods_receipt_corrections_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_finished_goods_receipt_corrections FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_finished_goods_receipt_correction_guard();
  END IF;
  FOREACH name IN ARRAY ARRAY['manufacturing_finished_goods_serials', 'manufacturing_finished_goods_receipt_postings', 'manufacturing_finished_goods_receipt_events'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = name || '_append_only' AND tgrelid = ('tenant.' || name)::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_append_only()', name || '_append_only', name);
    END IF;
  END LOOP;
END $$;

-- ============================================================ 4. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['manufacturing_finished_goods_receipts', 'manufacturing_finished_goods_receipt_lines', 'manufacturing_finished_goods_serials',
                             'manufacturing_finished_goods_receipt_postings', 'manufacturing_finished_goods_receipt_corrections', 'manufacturing_finished_goods_receipt_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.manufacturing_finished_goods_receipts, tenant.manufacturing_finished_goods_receipt_lines, tenant.manufacturing_finished_goods_receipt_corrections TO vercent_app;
GRANT DELETE ON tenant.manufacturing_finished_goods_receipt_lines TO vercent_app;
GRANT SELECT, INSERT ON tenant.manufacturing_finished_goods_serials, tenant.manufacturing_finished_goods_receipt_postings, tenant.manufacturing_finished_goods_receipt_events TO vercent_app;
GRANT SELECT ON tenant.manufacturing_finished_goods_receipts, tenant.manufacturing_finished_goods_receipt_lines, tenant.manufacturing_finished_goods_serials,
  tenant.manufacturing_finished_goods_receipt_postings, tenant.manufacturing_finished_goods_receipt_corrections, tenant.manufacturing_finished_goods_receipt_events TO vercent_worker;

-- ============================================================ 5. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('manufacturing.fgr.view', 'View finished-goods receipts', 'Manufacturing', 'See finished-goods receipts, accepted output waiting to be received, and their history.'),
  ('manufacturing.fgr.create', 'Prepare finished-goods receipts', 'Manufacturing', 'Create draft finished-goods receipts.'),
  ('manufacturing.fgr.edit_draft', 'Edit draft finished-goods receipts', 'Manufacturing', 'Change a draft finished-goods receipt.'),
  ('manufacturing.fgr.post', 'Post finished-goods receipts', 'Manufacturing', 'Receive accepted output into Inventory.'),
  ('manufacturing.fgr.cancel_draft', 'Cancel draft finished-goods receipts', 'Manufacturing', 'Cancel a finished-goods receipt that never posted.'),
  ('manufacturing.fgr.request_correction', 'Request receipt corrections', 'Manufacturing', 'Ask for a posted finished-goods receipt to be reversed.'),
  ('manufacturing.fgr.approve_correction', 'Approve receipt corrections', 'Manufacturing', 'Approve or reject a reversal of a posted receipt, and approve receipts into another warehouse.'),
  ('manufacturing.fgr.export', 'Print and export finished-goods receipts', 'Manufacturing', 'Print receipt notes and export receipt reports.'),
  ('manufacturing.fgr.cost_view', 'View finished-goods receipt cost', 'Manufacturing', 'See the value of finished-goods receipts.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('manufacturing_manager', 'manufacturing.fgr.view'), ('manufacturing_manager', 'manufacturing.fgr.create'), ('manufacturing_manager', 'manufacturing.fgr.edit_draft'),
    ('manufacturing_manager', 'manufacturing.fgr.post'), ('manufacturing_manager', 'manufacturing.fgr.cancel_draft'), ('manufacturing_manager', 'manufacturing.fgr.request_correction'),
    ('manufacturing_manager', 'manufacturing.fgr.approve_correction'), ('manufacturing_manager', 'manufacturing.fgr.export'), ('manufacturing_manager', 'manufacturing.fgr.cost_view'),
    ('production_planner', 'manufacturing.fgr.view'), ('production_planner', 'manufacturing.fgr.create'), ('production_planner', 'manufacturing.fgr.edit_draft'),
    ('production_planner', 'manufacturing.fgr.cancel_draft'), ('production_planner', 'manufacturing.fgr.export'),
    ('shop_floor_operator', 'manufacturing.fgr.view'),
    ('inventory_manager', 'manufacturing.fgr.view'), ('inventory_manager', 'manufacturing.fgr.create'), ('inventory_manager', 'manufacturing.fgr.edit_draft'),
    ('inventory_manager', 'manufacturing.fgr.cancel_draft'), ('inventory_manager', 'manufacturing.fgr.post'), ('inventory_manager', 'manufacturing.fgr.request_correction'),
    ('inventory_manager', 'manufacturing.fgr.approve_correction'), ('inventory_manager', 'manufacturing.fgr.export'),
    ('goods_receipt_user', 'manufacturing.view'), ('goods_receipt_user', 'manufacturing.mo.view'), ('goods_receipt_user', 'manufacturing.fgr.view'), ('goods_receipt_user', 'manufacturing.fgr.create'),
    ('goods_receipt_user', 'manufacturing.fgr.edit_draft'), ('goods_receipt_user', 'manufacturing.fgr.post'),
    ('goods_receipt_user', 'manufacturing.fgr.request_correction'), ('goods_receipt_user', 'manufacturing.fgr.export'),
    ('quality_manager', 'manufacturing.fgr.view'),
    ('accountant', 'manufacturing.fgr.view'), ('accountant', 'manufacturing.fgr.export'), ('accountant', 'manufacturing.fgr.cost_view')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0118_manufacturing_finished_goods_receipt.sql', 'manufacturing-finished-goods-receipt') ON CONFLICT DO NOTHING;
