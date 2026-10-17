-- Assets — Asset Assignment. The request, approval, reservation, issue and return interface for allocating equipment to an employee, a
-- department or an asset store — built on the Custodian workflow, which stays the one record of who is accountable: an assignment
-- request is never custody; custody changes only through the confirmed physical handover (or, between sites, through an Asset Transfer).
-- A shared reservation keeps assignments and transfers from claiming the same asset. Additive:
--
--   1. reservations   one active operation per asset across workflows (transfer lines keep theirs by trigger).
--   2. requests       the allocation decision: recipient, purpose, temporary or indefinite, dates, approval, reservation, issue, handover.
--   3. batches        bulk assignments with their per-row results; a retry returns the same batch.
--   4. events         an append-only history of every request.
--   5. permissions    view, request, approve, issue, return, extend, bulk, manage exceptions, history, export.

-- ============================================================ 1. reservations
CREATE TABLE IF NOT EXISTS tenant.asset_operation_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  source_type text NOT NULL CHECK (source_type IN ('TRANSFER', 'ASSIGNMENT')),
  source_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED', 'CONSUMED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz,
  released_at timestamptz,
  release_reason text,
  CONSTRAINT asset_reservations_release_check CHECK ((status = 'ACTIVE') = (released_at IS NULL))
);
-- One active exclusive operation per asset: an assignment and a transfer can never both hold it.
CREATE UNIQUE INDEX IF NOT EXISTS asset_operation_reservations_active_idx ON tenant.asset_operation_reservations (asset_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS asset_operation_reservations_source_idx ON tenant.asset_operation_reservations (source_type, source_id);
CREATE OR REPLACE FUNCTION tenant.asset_operation_reservations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A reservation is released, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status <> 'ACTIVE' THEN RAISE EXCEPTION 'A released reservation stays released.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.asset_id <> OLD.asset_id OR NEW.source_id <> OLD.source_id OR NEW.source_type <> OLD.source_type THEN RAISE EXCEPTION 'A reservation keeps its asset and source.' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_operation_reservations_guard') THEN
    CREATE TRIGGER asset_operation_reservations_guard BEFORE UPDATE OR DELETE ON tenant.asset_operation_reservations FOR EACH ROW EXECUTE FUNCTION tenant.asset_operation_reservations_guard();
  END IF;
END $$;
-- A transfer line holds the asset's reservation while it is active; completed it is consumed, otherwise released.
CREATE OR REPLACE FUNCTION tenant.asset_transfer_lines_reserve() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  live constant text[] := ARRAY['PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS'];
BEGIN
  IF TG_OP = 'INSERT' AND NEW.line_status = ANY(live) THEN
    INSERT INTO tenant.asset_operation_reservations (organization_id, asset_id, source_type, source_id) VALUES (NEW.organization_id, NEW.asset_id, 'TRANSFER', NEW.id);
  ELSIF TG_OP = 'UPDATE' AND OLD.line_status = ANY(live) AND NOT (NEW.line_status = ANY(live)) THEN
    UPDATE tenant.asset_operation_reservations SET status = CASE WHEN NEW.line_status = 'COMPLETED' THEN 'CONSUMED' ELSE 'RELEASED' END, released_at = clock_timestamp(),
        release_reason = 'Transfer line ' || lower(NEW.line_status) WHERE source_type = 'TRANSFER' AND source_id = NEW.id AND status = 'ACTIVE';
  END IF;
  RETURN NULL;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_transfer_lines_reserve') THEN
    CREATE TRIGGER asset_transfer_lines_reserve AFTER INSERT OR UPDATE OF line_status ON tenant.asset_transfer_lines FOR EACH ROW EXECUTE FUNCTION tenant.asset_transfer_lines_reserve();
  END IF;
END $$;
INSERT INTO tenant.asset_operation_reservations (organization_id, asset_id, source_type, source_id)
SELECT l.organization_id, l.asset_id, 'TRANSFER', l.id FROM tenant.asset_transfer_lines l
 WHERE l.line_status IN ('PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS')
   AND NOT EXISTS (SELECT 1 FROM tenant.asset_operation_reservations r WHERE r.source_type = 'TRANSFER' AND r.source_id = l.id)
   AND NOT EXISTS (SELECT 1 FROM tenant.asset_operation_reservations r WHERE r.asset_id = l.asset_id AND r.status = 'ACTIVE');

-- ============================================================ 2. requests
CREATE TABLE IF NOT EXISTS tenant.asset_assignment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  request_number text NOT NULL,
  batch_id uuid,
  asset_id uuid REFERENCES tenant.assets(id),
  category_id uuid REFERENCES tenant.asset_categories(id),
  recipient_type text NOT NULL CHECK (recipient_type IN ('EMPLOYEE', 'DEPARTMENT', 'ASSET_STORE')),
  to_user_id uuid REFERENCES public.users(id),
  to_department_id uuid,
  to_store_location_id uuid,
  deliver_to_location_id uuid,
  purpose text NOT NULL CHECK (length(btrim(purpose)) >= 3),
  assignment_type text NOT NULL DEFAULT 'INDEFINITE' CHECK (assignment_type IN ('INDEFINITE', 'TEMPORARY')),
  requested_issue_date date NOT NULL,
  expected_return_date date,
  original_expected_return_date date,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'READY_TO_ISSUE', 'IN_TRANSFER', 'ISSUED_AWAITING_ACKNOWLEDGMENT', 'FULFILLED', 'REJECTED',
    'CANCELLED', 'RECOVERY_REQUIRED')),
  approval_status text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (approval_status IN ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED')),
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  decision_note text,
  reservation_id uuid REFERENCES tenant.asset_operation_reservations(id),
  transfer_id uuid,
  custody_handover_id uuid,
  issued_by uuid REFERENCES public.users(id),
  issued_at timestamptz,
  issue_condition text,
  accessories text,
  acknowledgment text CHECK (acknowledgment IS NULL OR acknowledgment IN ('PENDING', 'ACKNOWLEDGED', 'DISPUTED', 'EXCEPTION')),
  returned_at timestamptz,
  return_condition text,
  cancel_reason text,
  requested_by uuid NOT NULL REFERENCES public.users(id),
  idempotency_key text,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT asset_assignment_requests_number_unique UNIQUE (organization_id, request_number),
  CONSTRAINT asset_assignment_requests_recipient_check CHECK ((recipient_type = 'EMPLOYEE' AND to_user_id IS NOT NULL) OR (recipient_type = 'DEPARTMENT' AND to_department_id IS NOT NULL)
    OR (recipient_type = 'ASSET_STORE' AND to_store_location_id IS NOT NULL)),
  CONSTRAINT asset_assignment_requests_return_check CHECK (assignment_type <> 'TEMPORARY' OR expected_return_date IS NOT NULL),
  CONSTRAINT asset_assignment_requests_target_check CHECK (asset_id IS NOT NULL OR category_id IS NOT NULL),
  CONSTRAINT asset_assignment_requests_issue_check CHECK (status NOT IN ('ISSUED_AWAITING_ACKNOWLEDGMENT', 'FULFILLED') OR asset_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_assignment_requests_key_idx ON tenant.asset_assignment_requests (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS asset_assignment_requests_status_idx ON tenant.asset_assignment_requests (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS asset_assignment_requests_asset_idx ON tenant.asset_assignment_requests (asset_id, created_at DESC) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS asset_assignment_requests_user_idx ON tenant.asset_assignment_requests (organization_id, to_user_id) WHERE to_user_id IS NOT NULL;
CREATE OR REPLACE FUNCTION tenant.asset_assignment_requests_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'An assignment request is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status IN ('REJECTED', 'CANCELLED') THEN RAISE EXCEPTION 'A rejected or cancelled request stays as it is.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.issued_at IS NOT NULL AND NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN RAISE EXCEPTION 'The time of issue is kept as recorded.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.issued_at IS NOT NULL AND (NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.to_user_id IS DISTINCT FROM OLD.to_user_id OR NEW.recipient_type <> OLD.recipient_type) THEN
    RAISE EXCEPTION 'An issued assignment keeps its asset and recipient.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.original_expected_return_date IS DISTINCT FROM OLD.original_expected_return_date AND OLD.original_expected_return_date IS NOT NULL THEN RAISE EXCEPTION 'The original return date is kept.' USING ERRCODE = 'check_violation'; END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_assignment_requests_guard') THEN
    CREATE TRIGGER asset_assignment_requests_guard BEFORE UPDATE OR DELETE ON tenant.asset_assignment_requests FOR EACH ROW EXECUTE FUNCTION tenant.asset_assignment_requests_guard();
  END IF;
END $$;

-- ============================================================ 3. batches
CREATE TABLE IF NOT EXISTS tenant.asset_assignment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  batch_number text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('COMPLETED', 'PARTIAL', 'FAILED')),
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  succeeded integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  requested_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT asset_assignment_batches_key_unique UNIQUE (organization_id, idempotency_key)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_assignment_batches_append_only') THEN
    CREATE TRIGGER asset_assignment_batches_append_only BEFORE UPDATE OR DELETE ON tenant.asset_assignment_batches FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ 4. events
CREATE TABLE IF NOT EXISTS tenant.asset_assignment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES tenant.asset_assignment_requests(id),
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
CREATE INDEX IF NOT EXISTS asset_assignment_events_request_idx ON tenant.asset_assignment_events (request_id, occurred_at);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_assignment_events_append_only') THEN
    CREATE TRIGGER asset_assignment_events_append_only BEFORE UPDATE OR DELETE ON tenant.asset_assignment_events FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['asset_operation_reservations', 'asset_assignment_requests', 'asset_assignment_batches', 'asset_assignment_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_operation_reservations, tenant.asset_assignment_requests TO vercent_app;
GRANT SELECT, INSERT ON tenant.asset_assignment_batches, tenant.asset_assignment_events TO vercent_app;
GRANT SELECT ON tenant.asset_operation_reservations, tenant.asset_assignment_requests, tenant.asset_assignment_batches, tenant.asset_assignment_events TO vercent_worker;

-- ============================================================ 5. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('assets.assignment.view', 'View asset assignments', 'Assets', 'See the assignment requests you are permitted to see.'),
  ('assets.assignment.request', 'Request asset assignments', 'Assets', 'Request equipment for yourself or, with management rights, for others.'),
  ('assets.assignment.approve', 'Approve asset assignments', 'Assets', 'Approve, send back or reject assignment requests.'),
  ('assets.assignment.issue', 'Issue assigned assets', 'Assets', 'Confirm the physical issue of an approved assignment.'),
  ('assets.assignment.return', 'Receive returned assets', 'Assets', 'Confirm the physical return of assigned assets.'),
  ('assets.assignment.extend', 'Extend temporary assignments', 'Assets', 'Extend a temporary assignment''s expected return.'),
  ('assets.assignment.bulk', 'Assign assets in bulk', 'Assets', 'Assign many assets to many recipients at once.'),
  ('assets.assignment.manage_exception', 'Resolve assignment exceptions', 'Assets', 'Act on any assignment: cancel, revalidate and resolve exceptions.'),
  ('assets.assignment.view_history', 'View assignment history', 'Assets', 'See every assignment request event.'),
  ('assets.assignment.export', 'Export asset assignments', 'Assets', 'Download assignment records.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('asset_manager', 'assets.assignment.view'), ('asset_manager', 'assets.assignment.request'), ('asset_manager', 'assets.assignment.approve'), ('asset_manager', 'assets.assignment.issue'),
    ('asset_manager', 'assets.assignment.return'), ('asset_manager', 'assets.assignment.extend'), ('asset_manager', 'assets.assignment.bulk'), ('asset_manager', 'assets.assignment.manage_exception'),
    ('asset_manager', 'assets.assignment.view_history'), ('asset_manager', 'assets.assignment.export'),
    ('employee', 'assets.assignment.view'), ('employee', 'assets.assignment.request'),
    ('inventory_manager', 'assets.assignment.view'), ('inventory_manager', 'assets.assignment.issue'), ('inventory_manager', 'assets.assignment.return'),
    ('hr_manager', 'assets.assignment.view'), ('hr_manager', 'assets.custody.view_clearance'),
    ('finance_manager', 'assets.assignment.view'), ('finance_manager', 'assets.assignment.view_history'), ('finance_manager', 'assets.assignment.export')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0153_assets_assignments.sql', 'assets-assignments') ON CONFLICT DO NOTHING;
