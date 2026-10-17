-- Assets — Asset Transfers. One Company-scoped movement workflow: a transfer (one asset or many) is drafted, submitted, approved where
-- policy requires it, dispatched (the asset is then in transfer, its confirmed location unchanged), received at the destination (identity
-- and condition checked) and only then completed — the registered location changes once, through the location record, and custody
-- moves through the Custodian handover, never a parallel ledger. Each asset line keeps its own progress, so a partly received transfer
-- is never shown as complete; damage, a wrong asset, a dispute or a loss in transit are exceptions to resolve. Temporary movements
-- (to a repair facility) return through a linked return transfer. Additive:
--
--   1. orders        the transfer: type, reason, dates, approval (kept apart from execution), carrier, versions.
--   2. lines         each asset's movement: source snapshot, destination, dispatch and receipt facts, links to the location event and
--                    custody handover; one active movement per asset.
--   3. events        an append-only history of every transition.
--   4. exceptions    missing, damaged, wrong asset or disputed receipts, with their resolution.
--   5. availability  in transfer from dispatch until receipt (or while a receipt is disputed).
--   6. history       open requests of the older single-asset transfer table move into this workflow.
--   7. permissions   view, create, submit, approve, reject, dispatch, receive, complete, cancel, report / manage exceptions, bulk, history, export.

-- ============================================================ 1. orders
CREATE TABLE IF NOT EXISTS tenant.asset_transfer_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  transfer_number text NOT NULL,
  transfer_type text NOT NULL CHECK (transfer_type IN ('LOCATION', 'CUSTODY', 'COMBINED', 'TEMPORARY', 'RETURN')),
  reason_code text NOT NULL CHECK (reason_code IN ('EMPLOYEE_REASSIGNMENT', 'DEPARTMENT_CHANGE', 'OFFICE_RELOCATION', 'INTERNAL_STORAGE', 'CUSTOMER_SITE', 'REPAIR', 'RETURN_FROM_REPAIR',
    'REPLACEMENT_RECOVERY', 'DISPOSAL_MOVEMENT', 'OTHER')),
  reason_detail text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIPT_EXCEPTION', 'COMPLETED',
    'REJECTED', 'CANCELLED', 'RECOVERY_REQUIRED')),
  approval_status text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (approval_status IN ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED')),
  approval_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  planned_date date NOT NULL,
  expected_arrival_at timestamptz,
  expected_return_at date,
  return_of_id uuid REFERENCES tenant.asset_transfer_orders(id),
  carrier text,
  tracking_reference text,
  notes text,
  requested_by uuid NOT NULL REFERENCES public.users(id),
  submitted_at timestamptz,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  approved_version integer,
  decision_note text,
  cancelled_by uuid REFERENCES public.users(id),
  cancelled_at timestamptz,
  cancel_reason text,
  completed_at timestamptz,
  idempotency_key text,
  legacy_transfer_id uuid,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT asset_transfer_orders_number_unique UNIQUE (organization_id, transfer_number),
  CONSTRAINT asset_transfer_orders_return_check CHECK (transfer_type <> 'TEMPORARY' OR expected_return_at IS NOT NULL),
  CONSTRAINT asset_transfer_orders_reason_check CHECK (reason_code <> 'OTHER' OR length(btrim(COALESCE(reason_detail, ''))) >= 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_transfer_orders_key_idx ON tenant.asset_transfer_orders (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS asset_transfer_orders_status_idx ON tenant.asset_transfer_orders (organization_id, status, created_at DESC);
CREATE OR REPLACE FUNCTION tenant.asset_transfer_orders_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A transfer is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status IN ('COMPLETED', 'REJECTED', 'CANCELLED') THEN RAISE EXCEPTION 'A completed, rejected or cancelled transfer stays as it is; correct it with a new transfer.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.transfer_number <> OLD.transfer_number OR NEW.requested_by <> OLD.requested_by THEN RAISE EXCEPTION 'A transfer keeps its number and requester.' USING ERRCODE = 'check_violation'; END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_transfer_orders_guard') THEN
    CREATE TRIGGER asset_transfer_orders_guard BEFORE UPDATE OR DELETE ON tenant.asset_transfer_orders FOR EACH ROW EXECUTE FUNCTION tenant.asset_transfer_orders_guard();
  END IF;
END $$;

-- ============================================================ 2. lines
CREATE TABLE IF NOT EXISTS tenant.asset_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  transfer_id uuid NOT NULL REFERENCES tenant.asset_transfer_orders(id),
  line_number integer NOT NULL CHECK (line_number > 0),
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  from_location_id uuid,
  from_custody_assignment_id uuid,
  from_custodian_label text,
  to_location_id uuid,
  to_custodian_type text CHECK (to_custodian_type IS NULL OR to_custodian_type IN ('EMPLOYEE', 'DEPARTMENT', 'ASSET_STORE')),
  to_user_id uuid,
  to_department_id uuid,
  to_store_location_id uuid,
  line_status text NOT NULL DEFAULT 'PENDING' CHECK (line_status IN ('PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'COMPLETED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS',
    'CANCELLED', 'REJECTED', 'RETURNED')),
  dispatch_condition text,
  dispatched_at timestamptz,
  dispatched_by uuid REFERENCES public.users(id),
  transit_holder text,
  receipt_condition text,
  received_at timestamptz,
  received_by uuid REFERENCES public.users(id),
  receipt_identifier text,
  completed_at timestamptz,
  location_event_id uuid,
  custody_handover_id uuid,
  custody_outcome text,
  close_reason text,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT asset_transfer_lines_number_unique UNIQUE (transfer_id, line_number),
  CONSTRAINT asset_transfer_lines_change_check CHECK (to_location_id IS NOT NULL OR to_custodian_type IS NOT NULL),
  CONSTRAINT asset_transfer_lines_receipt_check CHECK (line_status NOT IN ('RECEIVED', 'COMPLETED') OR received_at IS NOT NULL OR to_location_id IS NULL)
);
-- One active movement per asset: two transfers can never reserve the same asset.
CREATE UNIQUE INDEX IF NOT EXISTS asset_transfer_lines_active_idx ON tenant.asset_transfer_lines (asset_id)
  WHERE line_status IN ('PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS');
CREATE INDEX IF NOT EXISTS asset_transfer_lines_transfer_idx ON tenant.asset_transfer_lines (transfer_id);
CREATE INDEX IF NOT EXISTS asset_transfer_lines_asset_idx ON tenant.asset_transfer_lines (organization_id, asset_id, created_at DESC);
CREATE OR REPLACE FUNCTION tenant.asset_transfer_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A transfer line is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.line_status IN ('COMPLETED', 'CANCELLED', 'REJECTED', 'RETURNED') THEN RAISE EXCEPTION 'A finished transfer line stays as it is.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.asset_id <> OLD.asset_id OR NEW.transfer_id <> OLD.transfer_id THEN RAISE EXCEPTION 'A transfer line keeps its asset.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at THEN RAISE EXCEPTION 'A recorded dispatch is never rewritten.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.received_at IS NOT NULL AND NEW.received_at IS DISTINCT FROM OLD.received_at THEN RAISE EXCEPTION 'A recorded receipt is never rewritten.' USING ERRCODE = 'check_violation'; END IF;
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_transfer_lines_guard') THEN
    CREATE TRIGGER asset_transfer_lines_guard BEFORE UPDATE OR DELETE ON tenant.asset_transfer_lines FOR EACH ROW EXECUTE FUNCTION tenant.asset_transfer_lines_guard();
  END IF;
END $$;

-- ============================================================ 3. events
CREATE TABLE IF NOT EXISTS tenant.asset_transfer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  transfer_id uuid NOT NULL REFERENCES tenant.asset_transfer_orders(id),
  line_id uuid,
  asset_id uuid,
  action text NOT NULL,
  from_status text,
  to_status text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  actor_user_id uuid REFERENCES public.users(id),
  command_id text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_transfer_events_transfer_idx ON tenant.asset_transfer_events (transfer_id, occurred_at);
CREATE INDEX IF NOT EXISTS asset_transfer_events_asset_idx ON tenant.asset_transfer_events (asset_id, occurred_at) WHERE asset_id IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_transfer_events_append_only') THEN
    CREATE TRIGGER asset_transfer_events_append_only BEFORE UPDATE OR DELETE ON tenant.asset_transfer_events FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ 4. exceptions
CREATE TABLE IF NOT EXISTS tenant.asset_transfer_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  exception_number bigint GENERATED ALWAYS AS IDENTITY,
  transfer_id uuid NOT NULL REFERENCES tenant.asset_transfer_orders(id),
  line_id uuid NOT NULL REFERENCES tenant.asset_transfer_lines(id),
  asset_id uuid NOT NULL,
  exception_type text NOT NULL CHECK (exception_type IN ('MISSING', 'DAMAGED', 'WRONG_ASSET', 'DISPUTED', 'OTHER')),
  description text NOT NULL CHECK (length(btrim(description)) >= 3),
  observed_condition text,
  expected_identifier text,
  observed_identifier text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED')),
  resolution text CHECK (resolution IS NULL OR resolution IN ('RECEIVED', 'ACCEPTED', 'RETURN_TO_SOURCE', 'LOST_INVESTIGATION', 'CORRECTED')),
  resolution_note text,
  related_incident_id uuid,
  reported_by uuid NOT NULL REFERENCES public.users(id),
  reported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  CONSTRAINT asset_transfer_exceptions_resolved_check CHECK ((status = 'RESOLVED') = (resolution IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS asset_transfer_exceptions_open_idx ON tenant.asset_transfer_exceptions (organization_id, status) WHERE status <> 'RESOLVED';
CREATE OR REPLACE FUNCTION tenant.asset_transfer_exceptions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A transfer exception is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status = 'RESOLVED' THEN RAISE EXCEPTION 'A resolved exception stays as it is.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.exception_type <> OLD.exception_type OR NEW.description <> OLD.description OR NEW.line_id <> OLD.line_id THEN RAISE EXCEPTION 'An exception keeps what was reported.' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_transfer_exceptions_guard') THEN
    CREATE TRIGGER asset_transfer_exceptions_guard BEFORE UPDATE OR DELETE ON tenant.asset_transfer_exceptions FOR EACH ROW EXECUTE FUNCTION tenant.asset_transfer_exceptions_guard();
  END IF;
END $$;

-- ============================================================ 5. availability
-- Precedence unchanged: not in service → under maintenance → in transfer → assigned → unserviceable → available. An asset is in transfer
-- from dispatch until its receipt is accepted (a disputed receipt keeps it out of ordinary use).
CREATE OR REPLACE FUNCTION tenant.asset_effective_availability(a tenant.assets) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN a.lifecycle_status <> 'ACTIVE' THEN 'NOT_AVAILABLE'
    WHEN a.availability_status = 'MAINTENANCE' OR EXISTS (SELECT 1 FROM tenant.asset_maintenance_orders m WHERE m.asset_id = a.id AND m.status = 'in_progress' AND m.took_asset_out_of_service IS NOT FALSE) THEN 'UNDER_MAINTENANCE'
    WHEN EXISTS (SELECT 1 FROM tenant.asset_transfer_lines t WHERE t.asset_id = a.id AND t.line_status IN ('DISPATCHED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS')) THEN 'IN_TRANSFER'
    WHEN a.current_user_id IS NOT NULL OR a.current_department_id IS NOT NULL OR a.availability_status = 'ASSIGNED' THEN 'ASSIGNED'
    WHEN a.availability_status = 'RESTRICTED' OR a.condition = 'UNSERVICEABLE' THEN 'NOT_AVAILABLE'
    ELSE 'AVAILABLE' END
$$;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['asset_transfer_orders', 'asset_transfer_lines', 'asset_transfer_events', 'asset_transfer_exceptions'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_transfer_orders, tenant.asset_transfer_lines, tenant.asset_transfer_exceptions TO vercent_app;
GRANT SELECT, INSERT ON tenant.asset_transfer_events TO vercent_app;
GRANT SELECT ON tenant.asset_transfer_orders, tenant.asset_transfer_lines, tenant.asset_transfer_events, tenant.asset_transfer_exceptions TO vercent_worker;

-- ============================================================ 6. history: open requests of the older single-asset transfers
-- Each still-open request (submitted or approved, never dispatched in that model) becomes a transfer here, keeping its number, reason
-- and requester; the older row is closed with a note pointing to it. Re-running finds nothing left to move.
DO $$
DECLARE
  old record;
  made uuid;
BEGIN
  FOR old IN SELECT t.*, a.location_id AS asset_location FROM tenant.asset_transfers t JOIN tenant.assets a ON a.id = t.asset_id
    WHERE t.status IN ('submitted', 'approved') AND NOT EXISTS (SELECT 1 FROM tenant.asset_transfer_orders o WHERE o.legacy_transfer_id = t.id) LOOP
    IF EXISTS (SELECT 1 FROM tenant.asset_transfer_lines l WHERE l.asset_id = old.asset_id AND l.line_status IN ('PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS')) THEN CONTINUE; END IF;
    IF old.to_location_id IS NULL AND old.to_user_id IS NULL THEN CONTINUE; END IF;
    INSERT INTO tenant.asset_transfer_orders (organization_id, transfer_number, transfer_type, reason_code, reason_detail, status, approval_status, planned_date, requested_by, submitted_at,
        approved_by, approved_at, legacy_transfer_id)
    VALUES (old.organization_id, old.transfer_number, CASE WHEN old.to_location_id IS NOT NULL AND old.to_user_id IS NOT NULL THEN 'COMBINED' WHEN old.to_location_id IS NOT NULL THEN 'LOCATION' ELSE 'CUSTODY' END,
        'OTHER', COALESCE(NULLIF(btrim(old.reason), ''), 'Moved from the earlier transfer list'), CASE WHEN old.status = 'approved' THEN 'APPROVED' ELSE 'PENDING_APPROVAL' END,
        CASE WHEN old.status = 'approved' THEN 'APPROVED' ELSE 'PENDING' END, COALESCE(old.effective_date, current_date), old.requested_by, old.created_at, old.approved_by, old.approved_at, old.id)
    RETURNING id INTO made;
    INSERT INTO tenant.asset_transfer_lines (organization_id, transfer_id, line_number, asset_id, from_location_id, to_location_id, to_custodian_type, to_user_id, line_status)
    VALUES (old.organization_id, made, 1, old.asset_id, COALESCE(old.from_location_id, old.asset_location), old.to_location_id, CASE WHEN old.to_user_id IS NOT NULL THEN 'EMPLOYEE' END, old.to_user_id,
        CASE WHEN old.status = 'approved' THEN 'APPROVED' ELSE 'PENDING' END);
    INSERT INTO tenant.asset_transfer_events (organization_id, transfer_id, asset_id, action, to_status, details, reason)
    VALUES (old.organization_id, made, old.asset_id, 'MIGRATED', CASE WHEN old.status = 'approved' THEN 'APPROVED' ELSE 'PENDING_APPROVAL' END, jsonb_build_object('legacyTransferId', old.id), 'Moved from the earlier transfer list');
    UPDATE tenant.asset_transfers SET status = 'cancelled', rejected_reason = 'Continued in Asset Transfers as ' || old.transfer_number WHERE id = old.id;
  END LOOP;
END $$;

-- ============================================================ 7. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('assets.transfer.view', 'View asset transfers', 'Assets', 'See the transfers you are permitted to see.'),
  ('assets.transfer.create', 'Prepare asset transfers', 'Assets', 'Draft a transfer of one or more assets.'),
  ('assets.transfer.submit', 'Submit asset transfers', 'Assets', 'Submit a drafted transfer.'),
  ('assets.transfer.approve', 'Approve asset transfers', 'Assets', 'Approve transfers that need authorization.'),
  ('assets.transfer.reject', 'Reject asset transfers', 'Assets', 'Reject a transfer or ask for changes.'),
  ('assets.transfer.dispatch', 'Dispatch transferred assets', 'Assets', 'Confirm that assets left their source.'),
  ('assets.transfer.receive', 'Receive transferred assets', 'Assets', 'Confirm the physical receipt of assets at their destination.'),
  ('assets.transfer.complete', 'Complete asset transfers', 'Assets', 'Finalize a transfer line once its exception is resolved.'),
  ('assets.transfer.cancel', 'Cancel asset transfers', 'Assets', 'Cancel a transfer before dispatch.'),
  ('assets.transfer.report_exception', 'Report transfer exceptions', 'Assets', 'Report missing, damaged, wrong or disputed assets in a transfer.'),
  ('assets.transfer.manage_exception', 'Resolve transfer exceptions', 'Assets', 'Resolve transfer exceptions and act for any source or destination.'),
  ('assets.transfer.bulk_manage', 'Transfer many assets at once', 'Assets', 'Prepare transfers of several assets.'),
  ('assets.transfer.view_history', 'View transfer history', 'Assets', 'See every transfer event, approval and exception.'),
  ('assets.transfer.export', 'Export asset transfers', 'Assets', 'Download transfer records.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('asset_manager', 'assets.transfer.view'), ('asset_manager', 'assets.transfer.create'), ('asset_manager', 'assets.transfer.submit'), ('asset_manager', 'assets.transfer.approve'),
    ('asset_manager', 'assets.transfer.reject'), ('asset_manager', 'assets.transfer.dispatch'), ('asset_manager', 'assets.transfer.receive'), ('asset_manager', 'assets.transfer.complete'),
    ('asset_manager', 'assets.transfer.cancel'), ('asset_manager', 'assets.transfer.report_exception'), ('asset_manager', 'assets.transfer.manage_exception'), ('asset_manager', 'assets.transfer.bulk_manage'),
    ('asset_manager', 'assets.transfer.view_history'), ('asset_manager', 'assets.transfer.export'),
    ('employee', 'assets.transfer.view'), ('employee', 'assets.transfer.create'), ('employee', 'assets.transfer.submit'), ('employee', 'assets.transfer.report_exception'),
    ('inventory_manager', 'assets.transfer.view'), ('inventory_manager', 'assets.transfer.dispatch'), ('inventory_manager', 'assets.transfer.receive'), ('inventory_manager', 'assets.transfer.report_exception'),
    ('finance_manager', 'assets.transfer.view'), ('finance_manager', 'assets.transfer.view_history'), ('finance_manager', 'assets.transfer.export')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0152_assets_transfers.sql', 'assets-transfers') ON CONFLICT DO NOTHING;
