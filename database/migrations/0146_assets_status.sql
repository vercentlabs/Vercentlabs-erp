-- Assets — Asset Status. One lifecycle state machine with availability, condition and Finance's classification kept apart. A Hold remembers
-- the state it began from and returns the asset there; a missing-asset report is an incident, not proof of loss, until someone authorized
-- confirms it; a lost asset is recovered and a retired one reinstated only through their own checked actions; every lifecycle and
-- availability change, from whichever workflow, is recorded; condition observations have their own history. Availability is derived from
-- the workflows that own it (custody, transfers, maintenance), never a free field. Additive:
--
--   1. lifecycle history     an append-only record of every lifecycle and availability change, written by a trigger with the command's
--                            action, reason, actor and idempotency key (legacy screens' changes are recorded too).
--   2. holds                 one active hold per asset, with its reason, owner, origin state and release.
--   3. missing incidents     reports of a missing asset, investigated, then confirmed lost, recovered or closed as found.
--   4. condition events      an append-only history of condition observations (applied or proposed).
--   5. asset columns         commissioned / retired / status-changed timestamps, current hold and incident, condition observed date.
--   6. guards                a held, retired, lost, disposed or unserviceable asset takes no new custodian; a legacy status change never
--                            silently releases a hold.
--   7. effective availability  tenant.asset_effective_availability(): not available / under maintenance / in transfer / assigned / available.
--   8. permissions           place / release hold, report missing, confirm lost, recover, reinstate, condition, history, bulk actions.

-- ============================================================ 5. asset columns (first: the triggers below use them)
ALTER TABLE tenant.assets
  ADD COLUMN IF NOT EXISTS commissioned_at timestamptz,
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_hold_id uuid,
  ADD COLUMN IF NOT EXISTS lost_incident_id uuid,
  ADD COLUMN IF NOT EXISTS condition_observed_at timestamptz;
UPDATE tenant.assets SET status_changed_at = COALESCE(updated_at, created_at) WHERE status_changed_at IS NULL;
UPDATE tenant.assets SET commissioned_at = placed_in_service_date::timestamptz WHERE commissioned_at IS NULL AND placed_in_service_date IS NOT NULL AND lifecycle_status NOT IN ('DRAFT', 'REGISTERED');

-- ============================================================ 1. lifecycle history
CREATE TABLE IF NOT EXISTS tenant.asset_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  event_kind text NOT NULL CHECK (event_kind IN ('LIFECYCLE', 'AVAILABILITY')),
  previous_status text,
  new_status text NOT NULL,
  action text NOT NULL,
  reason text,
  initiated_by uuid REFERENCES public.users(id),
  approved_by uuid REFERENCES public.users(id),
  effective_date date,
  source_type text,
  source_id uuid,
  asset_version integer,
  idempotency_key text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_lifecycle_events_asset_idx ON tenant.asset_lifecycle_events (asset_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS asset_lifecycle_events_key_idx ON tenant.asset_lifecycle_events (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL AND event_kind = 'LIFECYCLE';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_lifecycle_events_append_only') THEN
    CREATE TRIGGER asset_lifecycle_events_append_only BEFORE UPDATE OR DELETE ON tenant.asset_lifecycle_events FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;
-- The command sets its context (vercent.asset_action, _reason, _actor, _key, _effective, _source_type, _source_id) for the transaction;
-- a change made without it (an older screen) is recorded as such.
CREATE OR REPLACE FUNCTION tenant.assets_record_status_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  action text := NULLIF(current_setting('vercent.asset_action', true), '');
  actor uuid := NULLIF(current_setting('vercent.asset_actor', true), '')::uuid;
  reason text := NULLIF(current_setting('vercent.asset_reason', true), '');
  key text := NULLIF(current_setting('vercent.asset_key', true), '');
  effective date := NULLIF(current_setting('vercent.asset_effective', true), '')::date;
  source_type text := NULLIF(current_setting('vercent.asset_source_type', true), '');
  source_id uuid := NULLIF(current_setting('vercent.asset_source_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status THEN
    INSERT INTO tenant.asset_lifecycle_events (organization_id, asset_id, event_kind, previous_status, new_status, action, reason, initiated_by, effective_date, source_type, source_id, asset_version, idempotency_key)
    VALUES (NEW.organization_id, NEW.id, 'LIFECYCLE', CASE WHEN TG_OP = 'UPDATE' THEN OLD.lifecycle_status END, NEW.lifecycle_status,
      COALESCE(action, CASE WHEN TG_OP = 'INSERT' THEN 'CREATE' ELSE 'WORKFLOW_UPDATE' END), reason, COALESCE(actor, NEW.created_by), effective, source_type, source_id, NEW.row_version, key);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.availability_status IS DISTINCT FROM OLD.availability_status THEN
    INSERT INTO tenant.asset_lifecycle_events (organization_id, asset_id, event_kind, previous_status, new_status, action, reason, initiated_by, effective_date, source_type, source_id, asset_version)
    VALUES (NEW.organization_id, NEW.id, 'AVAILABILITY', OLD.availability_status, NEW.availability_status, COALESCE(action, 'WORKFLOW_UPDATE'), reason, actor, effective, source_type, source_id, NEW.row_version);
  END IF;
  RETURN NULL;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'assets_record_status_change') THEN
    -- Every update, not UPDATE OF: a legacy status change reaches the lifecycle through the BEFORE trigger, which UPDATE OF would miss.
    CREATE TRIGGER assets_record_status_change AFTER INSERT OR UPDATE ON tenant.assets FOR EACH ROW EXECUTE FUNCTION tenant.assets_record_status_change();
  END IF;
END $$;

-- ============================================================ 2. holds
CREATE TABLE IF NOT EXISTS tenant.asset_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  hold_number bigint GENERATED ALWAYS AS IDENTITY,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  reason_code text NOT NULL CHECK (reason_code IN ('SAFETY_CONCERN', 'INSPECTION_PENDING', 'DAMAGE_INVESTIGATION', 'COMPLIANCE_RESTRICTION', 'OWNERSHIP_VERIFICATION', 'REPAIR_ASSESSMENT', 'OTHER')),
  description text NOT NULL CHECK (length(btrim(description)) >= 3),
  previous_lifecycle text NOT NULL CHECK (previous_lifecycle IN ('REGISTERED', 'ACTIVE')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED', 'CLOSED')),
  reported_by uuid NOT NULL REFERENCES public.users(id),
  resolution_owner_id uuid REFERENCES public.users(id),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  released_at timestamptz,
  released_by uuid REFERENCES public.users(id),
  release_reason text,
  idempotency_key text,
  CONSTRAINT asset_holds_release_check CHECK (status = 'ACTIVE' OR (released_at IS NOT NULL AND release_reason IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_holds_active_idx ON tenant.asset_holds (asset_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS asset_holds_key_idx ON tenant.asset_holds (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE OR REPLACE FUNCTION tenant.asset_holds_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A hold is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status <> 'ACTIVE' THEN RAISE EXCEPTION 'A released hold stays released.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.reason_code IS DISTINCT FROM OLD.reason_code OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.previous_lifecycle IS DISTINCT FROM OLD.previous_lifecycle OR NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.reported_by IS DISTINCT FROM OLD.reported_by THEN
    RAISE EXCEPTION 'A hold keeps what it was placed for.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_holds_guard') THEN
    CREATE TRIGGER asset_holds_guard BEFORE UPDATE OR DELETE ON tenant.asset_holds FOR EACH ROW EXECUTE FUNCTION tenant.asset_holds_guard();
  END IF;
END $$;
-- Assets already on hold (from the Register) get a hold record so they can be released to the right state.
INSERT INTO tenant.asset_holds (organization_id, asset_id, reason_code, description, previous_lifecycle, reported_by)
SELECT a.organization_id, a.id, 'OTHER', 'Placed on hold before hold records were kept', 'ACTIVE', a.created_by FROM tenant.assets a
 WHERE a.lifecycle_status = 'ON_HOLD' AND a.created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant.asset_holds h WHERE h.asset_id = a.id AND h.status = 'ACTIVE');
UPDATE tenant.assets a SET current_hold_id = h.id FROM tenant.asset_holds h WHERE h.asset_id = a.id AND h.status = 'ACTIVE' AND a.current_hold_id IS DISTINCT FROM h.id;

-- ============================================================ 3. missing incidents
CREATE TABLE IF NOT EXISTS tenant.asset_missing_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  incident_number bigint GENERATED ALWAYS AS IDENTITY,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  source text NOT NULL DEFAULT 'REPORT' CHECK (source IN ('REPORT', 'VERIFICATION')),
  reported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reported_by uuid NOT NULL REFERENCES public.users(id),
  missing_since date,
  last_known_location_id uuid,
  last_known_location_text text,
  last_known_custodian_id uuid,
  description text NOT NULL CHECK (length(btrim(description)) >= 3),
  investigation_owner_id uuid REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CONFIRMED_LOST', 'RECOVERED', 'CLOSED_FOUND')),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_note text,
  recovered_at date,
  idempotency_key text
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_missing_incidents_open_idx ON tenant.asset_missing_incidents (asset_id) WHERE status = 'OPEN';
CREATE UNIQUE INDEX IF NOT EXISTS asset_missing_incidents_key_idx ON tenant.asset_missing_incidents (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE OR REPLACE FUNCTION tenant.asset_missing_incidents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A missing-asset report is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.reported_by IS DISTINCT FROM OLD.reported_by OR NEW.reported_at IS DISTINCT FROM OLD.reported_at OR NEW.description IS DISTINCT FROM OLD.description THEN
    RAISE EXCEPTION 'A missing-asset report keeps what was reported.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('RECOVERED', 'CLOSED_FOUND') OR (OLD.status = 'CONFIRMED_LOST' AND NEW.status NOT IN ('CONFIRMED_LOST', 'RECOVERED')) THEN
    RAISE EXCEPTION 'A decided missing-asset report moves only forward.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_missing_incidents_guard') THEN
    CREATE TRIGGER asset_missing_incidents_guard BEFORE UPDATE OR DELETE ON tenant.asset_missing_incidents FOR EACH ROW EXECUTE FUNCTION tenant.asset_missing_incidents_guard();
  END IF;
END $$;

-- ============================================================ 4. condition events
CREATE TABLE IF NOT EXISTS tenant.asset_condition_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  previous_condition text,
  new_condition text CHECK (new_condition IS NULL OR new_condition IN ('NEW', 'GOOD', 'FAIR', 'DAMAGED', 'UNSERVICEABLE')),
  observed_on date NOT NULL,
  source text NOT NULL CHECK (source IN ('REGISTRATION', 'VERIFICATION', 'MAINTENANCE', 'INSPECTION', 'RECOVERY', 'REPORT')),
  status text NOT NULL CHECK (status IN ('APPLIED', 'PROPOSED')),
  reason text,
  source_id uuid,
  observed_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_condition_events_asset_idx ON tenant.asset_condition_events (asset_id, created_at DESC);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_condition_events_append_only') THEN
    CREATE TRIGGER asset_condition_events_append_only BEFORE UPDATE OR DELETE ON tenant.asset_condition_events FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ 6. guards
-- The legacy status moves with the lifecycle as before, except that a held asset stays on hold whatever an older screen writes, and the
-- lifecycle's change time is kept.
CREATE OR REPLACE FUNCTION tenant.assets_sync_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  new_changed boolean := TG_OP = 'INSERT' OR NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status OR NEW.availability_status IS DISTINCT FROM OLD.availability_status;
  old_changed boolean := TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status;
BEGIN
  IF old_changed AND NOT new_changed THEN
    NEW.lifecycle_status := CASE NEW.status WHEN 'draft' THEN (CASE WHEN OLD.lifecycle_status IN ('DRAFT', 'REGISTERED') THEN OLD.lifecycle_status ELSE 'DRAFT' END)
      WHEN 'retired' THEN 'RETIRED' WHEN 'pending_disposal' THEN 'RETIRED' WHEN 'lost' THEN 'LOST' WHEN 'disposed' THEN 'DISPOSED'
      ELSE CASE WHEN OLD.lifecycle_status = 'ON_HOLD' THEN 'ON_HOLD' ELSE 'ACTIVE' END END;
    NEW.availability_status := CASE NEW.status WHEN 'assigned' THEN 'ASSIGNED' WHEN 'in_maintenance' THEN 'MAINTENANCE' WHEN 'available' THEN 'AVAILABLE' WHEN 'draft' THEN OLD.availability_status ELSE 'RESTRICTED' END;
  ELSIF new_changed THEN
    NEW.status := CASE NEW.lifecycle_status WHEN 'DRAFT' THEN 'draft' WHEN 'REGISTERED' THEN 'draft' WHEN 'RETIRED' THEN 'retired' WHEN 'DISPOSED' THEN 'disposed' WHEN 'LOST' THEN 'lost'
      ELSE CASE NEW.availability_status WHEN 'ASSIGNED' THEN 'assigned' WHEN 'MAINTENANCE' THEN 'in_maintenance' ELSE 'available' END END;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status THEN NEW.status_changed_at := clock_timestamp(); END IF;
  IF TG_OP = 'UPDATE' THEN NEW.row_version := OLD.row_version + 1; NEW.updated_at := clock_timestamp(); END IF;
  RETURN NEW;
END $$;
-- A new custodian only for an asset that may be used: not on hold, retired, lost, disposed or unserviceable.
CREATE OR REPLACE FUNCTION tenant.assets_custody_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_user_id IS NOT NULL AND NEW.current_user_id IS DISTINCT FROM OLD.current_user_id
     AND (NEW.lifecycle_status IN ('ON_HOLD', 'RETIRED', 'LOST', 'DISPOSED') OR NEW.condition = 'UNSERVICEABLE') THEN
    RAISE EXCEPTION 'This asset cannot be newly assigned in its current state.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'assets_custody_guard') THEN
    CREATE TRIGGER assets_custody_guard BEFORE UPDATE ON tenant.assets FOR EACH ROW EXECUTE FUNCTION tenant.assets_custody_guard();
  END IF;
END $$;

-- ============================================================ 7. effective availability
-- Precedence: not in service (anything but Active) → under maintenance → in transfer → assigned → unserviceable → available.
CREATE OR REPLACE FUNCTION tenant.asset_effective_availability(a tenant.assets) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN a.lifecycle_status <> 'ACTIVE' THEN 'NOT_AVAILABLE'
    WHEN a.availability_status = 'MAINTENANCE' OR EXISTS (SELECT 1 FROM tenant.asset_maintenance_orders m WHERE m.asset_id = a.id AND m.status = 'in_progress' AND m.took_asset_out_of_service IS NOT FALSE) THEN 'UNDER_MAINTENANCE'
    WHEN EXISTS (SELECT 1 FROM tenant.asset_transfers t WHERE t.asset_id = a.id AND t.status IN ('submitted', 'approved')) THEN 'IN_TRANSFER'
    WHEN a.current_user_id IS NOT NULL OR a.current_department_id IS NOT NULL OR a.availability_status = 'ASSIGNED' THEN 'ASSIGNED'
    WHEN a.availability_status = 'RESTRICTED' OR a.condition = 'UNSERVICEABLE' THEN 'NOT_AVAILABLE'
    ELSE 'AVAILABLE' END
$$;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['asset_lifecycle_events', 'asset_holds', 'asset_missing_incidents', 'asset_condition_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT ON tenant.asset_lifecycle_events, tenant.asset_condition_events TO vercent_app;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_holds, tenant.asset_missing_incidents TO vercent_app;
GRANT SELECT ON tenant.asset_lifecycle_events, tenant.asset_condition_events, tenant.asset_holds, tenant.asset_missing_incidents TO vercent_worker;
GRANT EXECUTE ON FUNCTION tenant.asset_effective_availability(tenant.assets) TO vercent_app, vercent_worker;

-- ============================================================ 8. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('assets.status.place_hold', 'Place assets on hold', 'Assets', 'Restrict an asset''s use with a hold reason and an owner.'),
  ('assets.status.release_hold', 'Release asset holds', 'Assets', 'Release a hold and return the asset to the state it was in.'),
  ('assets.status.report_missing', 'Report missing assets', 'Assets', 'Report that an asset in your care or view cannot be found.'),
  ('assets.status.confirm_lost', 'Confirm assets lost', 'Assets', 'Confirm a missing asset as lost after investigation, or close a report as found.'),
  ('assets.status.recover', 'Recover lost assets', 'Assets', 'Return a recovered lost asset to service after inspection.'),
  ('assets.status.reinstate', 'Reinstate retired assets', 'Assets', 'Return a retired asset to service after a suitability review.'),
  ('assets.status.condition_update', 'Record asset condition', 'Assets', 'Record an authorized condition observation.'),
  ('assets.status.view_history', 'View asset status history', 'Assets', 'See every lifecycle, availability and condition change.'),
  ('assets.status.bulk_action', 'Change asset status in bulk', 'Assets', 'Commission, hold, release or retire several assets at once.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('asset_manager', 'assets.status.place_hold'), ('asset_manager', 'assets.status.release_hold'), ('asset_manager', 'assets.status.report_missing'), ('asset_manager', 'assets.status.confirm_lost'),
    ('asset_manager', 'assets.status.recover'), ('asset_manager', 'assets.status.reinstate'), ('asset_manager', 'assets.status.condition_update'), ('asset_manager', 'assets.status.view_history'),
    ('asset_manager', 'assets.status.bulk_action'),
    ('finance_manager', 'assets.status.view_history'), ('accountant', 'assets.status.view_history'),
    ('employee', 'assets.status.report_missing')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0146_assets_status.sql', 'assets-status') ON CONFLICT DO NOTHING;
