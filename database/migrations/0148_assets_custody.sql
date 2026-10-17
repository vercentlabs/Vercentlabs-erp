-- Assets — Custodian. One accountable custody holder per asset at a time — an employee, a department (with its accountable person) or an
-- asset store (a location run by its manager) — kept apart from the legal owner, the actual user and the registered location. Custody
-- changes through handovers: prepared (the previous custodian stays accountable), physically handed over (the possession time is kept as
-- it happened), then acknowledged by the recipient, disputed, or confirmed by an authorized exception. Returns go back to a store or a
-- department, never to nobody. Every assignment and acknowledgment is kept. Additive:
--
--   1. accountability     departments get an accountable person for asset custody; locations can be asset stores.
--   2. assignments        the custody periods (who, from, to, condition at issue and return, acknowledgment state); one current per asset.
--   3. handovers          issue, reassignment and return requests and their states; one open per asset.
--   4. acknowledgments    the recipient's own confirmation or dispute, append-only.
--   5. exceptions         disputes, unacknowledged or unreturned assets, inactive custodians, missing accountability.
--   6. projection         the asset's current assignment, store and open handover; a trigger records custody changes made by other
--                         workflows (registration, transfers, retirement, recovery) so the history is complete.
--   7. permissions        assign, reassign, return, acknowledge, dispute, bulk, history, exceptions, clearance, export.

-- ============================================================ 1. accountability
CREATE TABLE IF NOT EXISTS tenant.asset_department_custody (
  organization_id uuid NOT NULL,
  department_id uuid NOT NULL REFERENCES public.departments(id),
  accountable_user_id uuid NOT NULL REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, department_id)
);
ALTER TABLE tenant.asset_locations ADD COLUMN IF NOT EXISTS is_asset_store boolean NOT NULL DEFAULT false;

-- ============================================================ 2. assignments
CREATE TABLE IF NOT EXISTS tenant.asset_custody_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  custodian_type text NOT NULL CHECK (custodian_type IN ('EMPLOYEE', 'DEPARTMENT', 'ASSET_STORE')),
  user_id uuid REFERENCES public.users(id),
  department_id uuid REFERENCES public.departments(id),
  store_location_id uuid REFERENCES tenant.asset_locations(id),
  accountable_user_id uuid REFERENCES public.users(id),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  condition_at_issue text,
  condition_at_return text,
  expected_return_at date,
  return_requested_at timestamptz,
  source text NOT NULL DEFAULT 'HANDOVER' CHECK (source IN ('HANDOVER', 'REGISTRATION', 'TRANSFER', 'WORKFLOW', 'OPENING')),
  source_handover_id uuid,
  acknowledgment text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (acknowledgment IN ('PENDING', 'ACKNOWLEDGED', 'EXCEPTION', 'DISPUTED', 'NOT_REQUIRED')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED')),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT asset_custody_assignments_holder_check CHECK (
    (custodian_type = 'EMPLOYEE' AND user_id IS NOT NULL) OR (custodian_type = 'DEPARTMENT' AND department_id IS NOT NULL) OR (custodian_type = 'ASSET_STORE' AND store_location_id IS NOT NULL)),
  CONSTRAINT asset_custody_assignments_period_check CHECK (status = 'ACTIVE' OR effective_to IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_custody_assignments_current_idx ON tenant.asset_custody_assignments (asset_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS asset_custody_assignments_user_idx ON tenant.asset_custody_assignments (organization_id, user_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS asset_custody_assignments_asset_idx ON tenant.asset_custody_assignments (asset_id, effective_from DESC);
-- A custody period ends once and keeps who held it and from when; only its end, return condition, acknowledgment and return request move.
CREATE OR REPLACE FUNCTION tenant.asset_custody_assignments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A custody record is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status = 'ENDED' AND (NEW.status <> 'ENDED' OR NEW.effective_to IS DISTINCT FROM OLD.effective_to) THEN RAISE EXCEPTION 'An ended custody period stays ended.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.custodian_type IS DISTINCT FROM OLD.custodian_type OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.store_location_id IS DISTINCT FROM OLD.store_location_id OR NEW.effective_from IS DISTINCT FROM OLD.effective_from OR NEW.condition_at_issue IS DISTINCT FROM OLD.condition_at_issue THEN
    RAISE EXCEPTION 'A custody record keeps who held the asset and from when.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_custody_assignments_guard') THEN
    CREATE TRIGGER asset_custody_assignments_guard BEFORE UPDATE OR DELETE ON tenant.asset_custody_assignments FOR EACH ROW EXECUTE FUNCTION tenant.asset_custody_assignments_guard();
  END IF;
END $$;

-- ============================================================ 3. handovers
CREATE TABLE IF NOT EXISTS tenant.asset_custody_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  handover_number bigint GENERATED ALWAYS AS IDENTITY,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  kind text NOT NULL CHECK (kind IN ('ISSUE', 'REASSIGN', 'RETURN')),
  from_assignment_id uuid REFERENCES tenant.asset_custody_assignments(id),
  to_type text NOT NULL CHECK (to_type IN ('EMPLOYEE', 'DEPARTMENT', 'ASSET_STORE')),
  to_user_id uuid REFERENCES public.users(id),
  to_department_id uuid REFERENCES public.departments(id),
  to_store_location_id uuid REFERENCES tenant.asset_locations(id),
  recipient_user_id uuid REFERENCES public.users(id),
  status text NOT NULL CHECK (status IN ('PENDING_HANDOVER', 'AWAITING_ACKNOWLEDGMENT', 'CONFIRMED', 'CANCELLED', 'DISPUTED')),
  issued_by uuid REFERENCES public.users(id),
  received_by uuid REFERENCES public.users(id),
  physical_handover_at timestamptz,
  acknowledged_at timestamptz,
  condition_at_handover text,
  accessories text,
  expected_return_at date,
  notes text,
  to_assignment_id uuid REFERENCES tenant.asset_custody_assignments(id),
  related_transfer_id uuid,
  cancel_reason text,
  idempotency_key text,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_custody_handovers_open_idx ON tenant.asset_custody_handovers (asset_id) WHERE status IN ('PENDING_HANDOVER', 'AWAITING_ACKNOWLEDGMENT', 'DISPUTED');
CREATE UNIQUE INDEX IF NOT EXISTS asset_custody_handovers_key_idx ON tenant.asset_custody_handovers (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE OR REPLACE FUNCTION tenant.asset_custody_handovers_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A handover is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status IN ('CONFIRMED', 'CANCELLED') THEN RAISE EXCEPTION 'A completed or cancelled handover stays as it is.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.physical_handover_at IS NOT NULL AND NEW.physical_handover_at IS DISTINCT FROM OLD.physical_handover_at THEN RAISE EXCEPTION 'The time of the physical handover is kept as recorded.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.to_user_id IS DISTINCT FROM OLD.to_user_id OR NEW.to_department_id IS DISTINCT FROM OLD.to_department_id OR NEW.to_store_location_id IS DISTINCT FROM OLD.to_store_location_id THEN
    RAISE EXCEPTION 'A handover keeps its asset and recipient.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_custody_handovers_guard') THEN
    CREATE TRIGGER asset_custody_handovers_guard BEFORE UPDATE OR DELETE ON tenant.asset_custody_handovers FOR EACH ROW EXECUTE FUNCTION tenant.asset_custody_handovers_guard();
  END IF;
END $$;

-- ============================================================ 4. acknowledgments
CREATE TABLE IF NOT EXISTS tenant.asset_custody_acknowledgments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  handover_id uuid NOT NULL REFERENCES tenant.asset_custody_handovers(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  decision text NOT NULL CHECK (decision IN ('ACKNOWLEDGED', 'DISPUTED', 'EXCEPTION')),
  dispute_reason text CHECK (dispute_reason IS NULL OR dispute_reason IN ('NOT_RECEIVED', 'WRONG_ASSET', 'WRONG_CONDITION', 'MISSING_ACCESSORIES', 'OTHER')),
  condition_confirmed boolean,
  comment text,
  on_behalf boolean NOT NULL DEFAULT false,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_custody_acknowledgments_handover_idx ON tenant.asset_custody_acknowledgments (handover_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_custody_acknowledgments_append_only') THEN
    CREATE TRIGGER asset_custody_acknowledgments_append_only BEFORE UPDATE OR DELETE ON tenant.asset_custody_acknowledgments FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ 5. exceptions
CREATE TABLE IF NOT EXISTS tenant.asset_custody_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  exception_number bigint GENERATED ALWAYS AS IDENTITY,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  handover_id uuid REFERENCES tenant.asset_custody_handovers(id),
  assignment_id uuid REFERENCES tenant.asset_custody_assignments(id),
  kind text NOT NULL CHECK (kind IN ('DISPUTED', 'ACKNOWLEDGMENT_WAIVED', 'CANNOT_RETURN', 'INACTIVE_CUSTODIAN')),
  description text NOT NULL,
  owner_user_id uuid REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  resolution text,
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_custody_exceptions_open_idx ON tenant.asset_custody_exceptions (organization_id) WHERE status = 'OPEN';
CREATE OR REPLACE FUNCTION tenant.asset_custody_exceptions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A custody exception is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status = 'RESOLVED' OR NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.description IS DISTINCT FROM OLD.description THEN
    RAISE EXCEPTION 'A custody exception is only ever resolved.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_custody_exceptions_guard') THEN
    CREATE TRIGGER asset_custody_exceptions_guard BEFORE UPDATE OR DELETE ON tenant.asset_custody_exceptions FOR EACH ROW EXECUTE FUNCTION tenant.asset_custody_exceptions_guard();
  END IF;
END $$;

-- ============================================================ 6. projection
-- The current assignment and any open handover are read from their own tables (one active / one open per asset); only the store
-- custodian is a new asset column, beside the existing custodian user and department.
ALTER TABLE tenant.assets ADD COLUMN IF NOT EXISTS current_store_location_id uuid;
-- Custody changed by another workflow (registration before commissioning, a transfer, retirement, recovery): the engine sets
-- vercent.custody_engine for its own changes; anything else ends the current period and opens the matching one.
CREATE OR REPLACE FUNCTION tenant.assets_record_custody_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_type text;
BEGIN
  IF NULLIF(current_setting('vercent.custody_engine', true), '') IS NOT NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.current_user_id IS NOT DISTINCT FROM OLD.current_user_id AND NEW.current_department_id IS NOT DISTINCT FROM OLD.current_department_id
     AND NEW.current_store_location_id IS NOT DISTINCT FROM OLD.current_store_location_id THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' AND NEW.current_user_id IS NULL AND NEW.current_department_id IS NULL AND NEW.current_store_location_id IS NULL THEN RETURN NULL; END IF;
  UPDATE tenant.asset_custody_assignments SET status = 'ENDED', effective_to = clock_timestamp() WHERE asset_id = NEW.id AND status = 'ACTIVE';
  current_type := CASE WHEN NEW.current_user_id IS NOT NULL THEN 'EMPLOYEE' WHEN NEW.current_department_id IS NOT NULL THEN 'DEPARTMENT' WHEN NEW.current_store_location_id IS NOT NULL THEN 'ASSET_STORE' END;
  IF current_type IS NOT NULL THEN
    INSERT INTO tenant.asset_custody_assignments (organization_id, asset_id, custodian_type, user_id, department_id, store_location_id, accountable_user_id, effective_from, condition_at_issue, source, created_by)
    VALUES (NEW.organization_id, NEW.id, current_type, NEW.current_user_id, CASE WHEN current_type = 'DEPARTMENT' OR current_type = 'EMPLOYEE' THEN NEW.current_department_id END,
      CASE WHEN current_type = 'ASSET_STORE' THEN NEW.current_store_location_id END,
      CASE current_type WHEN 'EMPLOYEE' THEN NEW.current_user_id
        WHEN 'DEPARTMENT' THEN (SELECT accountable_user_id FROM tenant.asset_department_custody d WHERE d.organization_id = NEW.organization_id AND d.department_id = NEW.current_department_id)
        ELSE (SELECT manager_user_id FROM tenant.asset_locations l WHERE l.id = NEW.current_store_location_id) END,
      clock_timestamp(), NEW.condition,
      CASE WHEN TG_OP = 'INSERT' OR NEW.lifecycle_status IN ('DRAFT', 'REGISTERED') THEN 'REGISTRATION' WHEN NULLIF(current_setting('vercent.location_event', true), '') = 'TRANSFER' THEN 'TRANSFER' ELSE 'WORKFLOW' END,
      COALESCE(NULLIF(current_setting('vercent.asset_actor', true), '')::uuid, NEW.created_by));
  END IF;
  RETURN NULL;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'assets_record_custody_change') THEN
    CREATE TRIGGER assets_record_custody_change AFTER INSERT OR UPDATE ON tenant.assets FOR EACH ROW EXECUTE FUNCTION tenant.assets_record_custody_change();
  END IF;
END $$;
-- A new custodian (any type) only for an asset that may be used, and a store custodian only for an active asset store.
CREATE OR REPLACE FUNCTION tenant.assets_custody_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A person or department given custody by another workflow replaces a store custodian.
  IF NULLIF(current_setting('vercent.custody_engine', true), '') IS NULL AND NEW.current_store_location_id IS NOT NULL AND NEW.current_store_location_id IS NOT DISTINCT FROM OLD.current_store_location_id
     AND ((NEW.current_user_id IS NOT NULL AND NEW.current_user_id IS DISTINCT FROM OLD.current_user_id) OR (NEW.current_department_id IS NOT NULL AND NEW.current_department_id IS DISTINCT FROM OLD.current_department_id)) THEN
    NEW.current_store_location_id := NULL;
  END IF;
  IF (NEW.current_user_id IS NOT NULL AND NEW.current_user_id IS DISTINCT FROM OLD.current_user_id)
     AND (NEW.lifecycle_status IN ('ON_HOLD', 'RETIRED', 'LOST', 'DISPOSED') OR NEW.condition = 'UNSERVICEABLE') THEN
    RAISE EXCEPTION 'This asset cannot be newly assigned in its current state.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.current_store_location_id IS NOT NULL AND NEW.current_store_location_id IS DISTINCT FROM OLD.current_store_location_id
     AND NOT EXISTS (SELECT 1 FROM tenant.asset_locations l WHERE l.id = NEW.current_store_location_id AND l.organization_id = NEW.organization_id AND l.active AND l.is_asset_store) THEN
    RAISE EXCEPTION 'Select an active Asset Store.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.lifecycle_status = 'DISPOSED' AND OLD.lifecycle_status = 'DISPOSED' AND (NEW.current_department_id IS NOT NULL AND NEW.current_department_id IS DISTINCT FROM OLD.current_department_id) THEN
    RAISE EXCEPTION 'A disposed asset takes no new custodian.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
-- Existing custody starts the history.
INSERT INTO tenant.asset_custody_assignments (organization_id, asset_id, custodian_type, user_id, department_id, accountable_user_id, effective_from, condition_at_issue, source, created_by)
SELECT a.organization_id, a.id, CASE WHEN a.current_user_id IS NOT NULL THEN 'EMPLOYEE' ELSE 'DEPARTMENT' END, a.current_user_id, a.current_department_id,
  COALESCE(a.current_user_id, (SELECT accountable_user_id FROM tenant.asset_department_custody d WHERE d.organization_id = a.organization_id AND d.department_id = a.current_department_id)),
  COALESCE(a.updated_at, a.created_at), a.condition, 'OPENING', a.created_by FROM tenant.assets a
 WHERE (a.current_user_id IS NOT NULL OR a.current_department_id IS NOT NULL) AND a.lifecycle_status <> 'DISPOSED'
   AND NOT EXISTS (SELECT 1 FROM tenant.asset_custody_assignments x WHERE x.asset_id = a.id AND x.status = 'ACTIVE');

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['asset_department_custody', 'asset_custody_assignments', 'asset_custody_handovers', 'asset_custody_acknowledgments', 'asset_custody_exceptions'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_department_custody, tenant.asset_custody_assignments, tenant.asset_custody_handovers, tenant.asset_custody_exceptions TO vercent_app;
GRANT SELECT, INSERT ON tenant.asset_custody_acknowledgments TO vercent_app;
GRANT SELECT ON tenant.asset_department_custody, tenant.asset_custody_assignments, tenant.asset_custody_handovers, tenant.asset_custody_acknowledgments, tenant.asset_custody_exceptions TO vercent_worker;

-- ============================================================ 7. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('assets.custody.assign', 'Issue assets', 'Assets', 'Issue an asset to an employee, a department or an asset store.'),
  ('assets.custody.reassign', 'Reassign asset custody', 'Assets', 'Move an asset from one custodian to another.'),
  ('assets.custody.return', 'Receive returned assets', 'Assets', 'Receive an asset back into a store or department, recording its condition.'),
  ('assets.custody.acknowledge', 'Acknowledge received assets', 'Assets', 'Confirm receipt of an asset handed to you.'),
  ('assets.custody.dispute', 'Dispute a handover', 'Assets', 'Report that an asset handed to you was not received, wrong or not as described.'),
  ('assets.custody.bulk_manage', 'Issue and receive assets in bulk', 'Assets', 'Issue or receive many assets at once.'),
  ('assets.custody.view_history', 'View custody history', 'Assets', 'See every custody period, handover and acknowledgment.'),
  ('assets.custody.manage_exceptions', 'Resolve custody exceptions', 'Assets', 'Resolve disputes and record authorized acknowledgment exceptions.'),
  ('assets.custody.view_clearance', 'View employee asset clearance', 'Assets', 'See the assets an employee still has to return.'),
  ('assets.custody.export', 'Export custody records', 'Assets', 'Export custody assignments.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('asset_manager', 'assets.custody.assign'), ('asset_manager', 'assets.custody.reassign'), ('asset_manager', 'assets.custody.return'), ('asset_manager', 'assets.custody.acknowledge'),
    ('asset_manager', 'assets.custody.dispute'), ('asset_manager', 'assets.custody.bulk_manage'), ('asset_manager', 'assets.custody.view_history'), ('asset_manager', 'assets.custody.manage_exceptions'),
    ('asset_manager', 'assets.custody.view_clearance'), ('asset_manager', 'assets.custody.export'),
    ('finance_manager', 'assets.custody.view_history'), ('finance_manager', 'assets.custody.export'), ('accountant', 'assets.custody.view_history'),
    ('employee', 'assets.custody.acknowledge'), ('employee', 'assets.custody.dispute')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0148_assets_custody.sql', 'assets-custody') ON CONFLICT DO NOTHING;
