-- Assets — Asset Location. One Company-scoped location master (tenant.asset_locations, extended): backend codes (ALOC-000001), a small type
-- set (office, factory, warehouse, room or area, customer site, repair facility, other), a hierarchy without cycles inside one Company, a
-- manager, external sites tied to their customer or vendor, safe inactivation. Each asset has one confirmed registered location; every
-- change to it is recorded with what authorized it (initial registration, a completed transfer, an administrative correction, recovery or
-- reinstatement), and after commissioning it changes only with such an authority. Temporary whereabouts and verification sightings are
-- observations that never move the registered location; a difference becomes a discrepancy to review. Additive:
--
--   1. location master      type, description, floor/room, manager, external party, normalized name (unique under one parent), row version.
--   2. hierarchy guard      same Company, no cycles, an inactive parent takes no new children; a used location is never deleted.
--   3. location changes     an append-only history of each location's own changes (created, renamed, moved, deactivated…).
--   4. asset location events  an append-only history of each asset's registered location, written by a trigger.
--   5. movement guard       after commissioning a location changes only with an authorizing event, to an active location, and never for a
--                           lost, retired or disposed asset except by recovery, reinstatement or correction.
--   6. observations         temporary, maintenance and verification sightings, with expiry.
--   7. discrepancies        registered vs observed differences, reviewed and resolved (transfer, correction, dismissed).
--   8. permissions          create, edit, deactivate, manage hierarchy, history, record observations, review discrepancies, export.

-- ============================================================ 1. location master
ALTER TABLE tenant.asset_locations
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS floor_room text,
  ADD COLUMN IF NOT EXISTS manager_user_id uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS external_party_id uuid,
  ADD COLUMN IF NOT EXISTS normalized_name text,
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS create_key text,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
UPDATE tenant.asset_locations SET kind = CASE location_type WHEN 'site' THEN 'OFFICE' WHEN 'building' THEN 'ROOM_OR_AREA' WHEN 'floor' THEN 'ROOM_OR_AREA' WHEN 'room' THEN 'ROOM_OR_AREA'
  WHEN 'yard' THEN 'WAREHOUSE' ELSE 'OTHER' END WHERE kind IS NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_locations_kind_check') THEN
    ALTER TABLE tenant.asset_locations ADD CONSTRAINT asset_locations_kind_check CHECK (kind IN ('OFFICE', 'FACTORY', 'WAREHOUSE', 'ROOM_OR_AREA', 'CUSTOMER_SITE', 'REPAIR_FACILITY', 'OTHER'));
  END IF;
END $$;
ALTER TABLE tenant.asset_locations ALTER COLUMN kind SET DEFAULT 'OTHER';
-- The normalized name and the legacy type follow the name and the kind; each change bumps the row version.
CREATE OR REPLACE FUNCTION tenant.asset_locations_normalize() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.normalized_name := lower(regexp_replace(btrim(normalize(NEW.name, NFKC)), '\s+', ' ', 'g'));
  NEW.kind := COALESCE(NEW.kind, 'OTHER');
  NEW.location_type := CASE NEW.kind WHEN 'OFFICE' THEN 'site' WHEN 'FACTORY' THEN 'site' WHEN 'WAREHOUSE' THEN 'building' WHEN 'ROOM_OR_AREA' THEN 'room' ELSE 'other' END;
  IF TG_OP = 'UPDATE' THEN NEW.row_version := OLD.row_version + 1; NEW.updated_at := clock_timestamp(); END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_locations_normalize') THEN
    CREATE TRIGGER asset_locations_normalize BEFORE INSERT OR UPDATE ON tenant.asset_locations FOR EACH ROW EXECUTE FUNCTION tenant.asset_locations_normalize();
  END IF;
END $$;
UPDATE tenant.asset_locations SET normalized_name = lower(regexp_replace(btrim(normalize(name, NFKC)), '\s+', ' ', 'g')) WHERE normalized_name IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS asset_locations_create_key_idx ON tenant.asset_locations (organization_id, create_key) WHERE create_key IS NOT NULL;
-- One name once under one parent (rooms of the same name may sit in different buildings). Where existing data repeats a name the guard is
-- not created and the Company renames one.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'tenant' AND indexname = 'asset_locations_name_under_parent_idx')
     AND NOT EXISTS (SELECT 1 FROM tenant.asset_locations GROUP BY organization_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized_name HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX asset_locations_name_under_parent_idx ON tenant.asset_locations (organization_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized_name);
  END IF;
END $$;

-- ============================================================ 2. hierarchy guard
CREATE OR REPLACE FUNCTION tenant.asset_locations_hierarchy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent record;
  cursor_id uuid := NEW.parent_id;
  depth integer := 0;
BEGIN
  IF NEW.parent_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id) THEN RETURN NEW; END IF;
  SELECT organization_id, active INTO parent FROM tenant.asset_locations WHERE id = NEW.parent_id;
  IF NOT FOUND OR parent.organization_id <> NEW.organization_id THEN RAISE EXCEPTION 'The parent location belongs to another Company.' USING ERRCODE = 'check_violation'; END IF;
  IF NOT parent.active THEN RAISE EXCEPTION 'An inactive location takes no new child locations.' USING ERRCODE = 'check_violation'; END IF;
  WHILE cursor_id IS NOT NULL AND depth < 50 LOOP
    IF cursor_id = NEW.id THEN RAISE EXCEPTION 'This change would create an invalid location hierarchy.' USING ERRCODE = 'check_violation'; END IF;
    SELECT parent_id INTO cursor_id FROM tenant.asset_locations WHERE id = cursor_id;
    depth := depth + 1;
  END LOOP;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_locations_hierarchy_guard') THEN
    CREATE TRIGGER asset_locations_hierarchy_guard BEFORE INSERT OR UPDATE ON tenant.asset_locations FOR EACH ROW EXECUTE FUNCTION tenant.asset_locations_hierarchy_guard();
  END IF;
END $$;
CREATE OR REPLACE FUNCTION tenant.asset_locations_no_delete_used() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenant.assets WHERE location_id = OLD.id) OR EXISTS (SELECT 1 FROM tenant.asset_movements WHERE from_location_id = OLD.id OR to_location_id = OLD.id)
     OR EXISTS (SELECT 1 FROM tenant.asset_locations WHERE parent_id = OLD.id) THEN
    RAISE EXCEPTION 'A location with assets, history or child locations is deactivated, never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_locations_no_delete_used') THEN
    CREATE TRIGGER asset_locations_no_delete_used BEFORE DELETE ON tenant.asset_locations FOR EACH ROW EXECUTE FUNCTION tenant.asset_locations_no_delete_used();
  END IF;
END $$;

-- ============================================================ 3. location changes
CREATE TABLE IF NOT EXISTS tenant.asset_location_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  location_id uuid NOT NULL REFERENCES tenant.asset_locations(id),
  action text NOT NULL CHECK (action IN ('CREATED', 'UPDATED', 'MOVED', 'DEACTIVATED', 'REACTIVATED')),
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_location_changes_location_idx ON tenant.asset_location_changes (location_id, occurred_at DESC);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_location_changes_append_only') THEN
    CREATE TRIGGER asset_location_changes_append_only BEFORE UPDATE OR DELETE ON tenant.asset_location_changes FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ 4. asset location events
CREATE TABLE IF NOT EXISTS tenant.asset_location_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  previous_location_id uuid,
  new_location_id uuid,
  event_type text NOT NULL CHECK (event_type IN ('INITIAL', 'TRANSFER', 'ADMIN_CORRECTION', 'RECOVERY', 'REINSTATEMENT', 'IMPORT', 'WORKFLOW_UPDATE')),
  source_type text,
  source_id uuid,
  reason text,
  changed_by uuid REFERENCES public.users(id),
  effective_at date,
  command_id text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_location_events_asset_idx ON tenant.asset_location_events (asset_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS asset_location_events_location_idx ON tenant.asset_location_events (organization_id, new_location_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_location_events_append_only') THEN
    CREATE TRIGGER asset_location_events_append_only BEFORE UPDATE OR DELETE ON tenant.asset_location_events FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;
-- The command names its authority in vercent.location_event (with the actor, reason, key and source of the status context); a change
-- before commissioning is the initial location; anything else from an older screen is recorded as a workflow update.
CREATE OR REPLACE FUNCTION tenant.assets_record_location_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event text := NULLIF(current_setting('vercent.location_event', true), '');
BEGIN
  IF TG_OP = 'INSERT' AND NEW.location_id IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.location_id IS NOT DISTINCT FROM OLD.location_id THEN RETURN NULL; END IF;
  INSERT INTO tenant.asset_location_events (organization_id, asset_id, previous_location_id, new_location_id, event_type, source_type, source_id, reason, changed_by, effective_at, command_id)
  VALUES (NEW.organization_id, NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.location_id END, NEW.location_id,
    COALESCE(event, CASE WHEN TG_OP = 'INSERT' OR NEW.lifecycle_status IN ('DRAFT', 'REGISTERED') THEN 'INITIAL' ELSE 'WORKFLOW_UPDATE' END),
    NULLIF(current_setting('vercent.asset_source_type', true), ''), NULLIF(current_setting('vercent.asset_source_id', true), '')::uuid,
    NULLIF(current_setting('vercent.asset_reason', true), ''), COALESCE(NULLIF(current_setting('vercent.asset_actor', true), '')::uuid, NEW.created_by),
    COALESCE(NULLIF(current_setting('vercent.asset_effective', true), '')::date, current_date), NULLIF(current_setting('vercent.asset_key', true), ''));
  RETURN NULL;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'assets_record_location_change') THEN
    CREATE TRIGGER assets_record_location_change AFTER INSERT OR UPDATE ON tenant.assets FOR EACH ROW EXECUTE FUNCTION tenant.assets_record_location_change();
  END IF;
END $$;
-- Existing assets start their history with their current location.
INSERT INTO tenant.asset_location_events (organization_id, asset_id, new_location_id, event_type, reason, changed_by, effective_at)
SELECT a.organization_id, a.id, a.location_id, 'INITIAL', 'Location when location history began', a.created_by, COALESCE(a.created_at::date, current_date) FROM tenant.assets a
 WHERE a.location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant.asset_location_events e WHERE e.asset_id = a.id);

-- ============================================================ 5. movement guard
CREATE OR REPLACE FUNCTION tenant.assets_location_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event text := NULLIF(current_setting('vercent.location_event', true), '');
BEGIN
  IF NEW.location_id IS NOT DISTINCT FROM OLD.location_id THEN RETURN NEW; END IF;
  IF NEW.location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant.asset_locations l WHERE l.id = NEW.location_id AND l.organization_id = NEW.organization_id AND l.active) THEN
    RAISE EXCEPTION 'This location cannot receive new Assets.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.lifecycle_status IN ('DRAFT', 'REGISTERED') AND NEW.lifecycle_status IN ('DRAFT', 'REGISTERED') THEN RETURN NEW; END IF;
  IF event IS NULL THEN RAISE EXCEPTION 'Use the Asset Transfer workflow to change the registered location.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.lifecycle_status IN ('LOST', 'RETIRED', 'DISPOSED') AND event NOT IN ('RECOVERY', 'REINSTATEMENT', 'ADMIN_CORRECTION') THEN
    RAISE EXCEPTION 'This asset cannot be moved in its current state.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'assets_location_guard') THEN
    CREATE TRIGGER assets_location_guard BEFORE UPDATE ON tenant.assets FOR EACH ROW EXECUTE FUNCTION tenant.assets_location_guard();
  END IF;
END $$;

-- ============================================================ 6. observations
CREATE TABLE IF NOT EXISTS tenant.asset_location_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  kind text NOT NULL CHECK (kind IN ('TEMPORARY', 'MAINTENANCE', 'VERIFICATION')),
  observed_location_id uuid REFERENCES tenant.asset_locations(id),
  observed_location_text text,
  registered_location_id uuid,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz,
  ended_at timestamptz,
  reason text,
  discrepancy boolean NOT NULL DEFAULT false,
  verification_id uuid,
  observed_by uuid NOT NULL REFERENCES public.users(id),
  CONSTRAINT asset_location_observations_where_check CHECK (observed_location_id IS NOT NULL OR length(btrim(COALESCE(observed_location_text, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS asset_location_observations_asset_idx ON tenant.asset_location_observations (asset_id, observed_at DESC);
CREATE OR REPLACE FUNCTION tenant.asset_location_observations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'An observation is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.ended_at IS NOT NULL OR NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.observed_location_id IS DISTINCT FROM OLD.observed_location_id OR NEW.observed_at IS DISTINCT FROM OLD.observed_at
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.observed_by IS DISTINCT FROM OLD.observed_by THEN
    RAISE EXCEPTION 'An observation is only ever ended.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_location_observations_guard') THEN
    CREATE TRIGGER asset_location_observations_guard BEFORE UPDATE OR DELETE ON tenant.asset_location_observations FOR EACH ROW EXECUTE FUNCTION tenant.asset_location_observations_guard();
  END IF;
END $$;

-- ============================================================ 7. discrepancies
CREATE TABLE IF NOT EXISTS tenant.asset_location_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  discrepancy_number bigint GENERATED ALWAYS AS IDENTITY,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  expected_location_id uuid,
  observed_location_id uuid,
  observed_location_text text,
  source text NOT NULL CHECK (source IN ('VERIFICATION', 'OBSERVATION')),
  source_id uuid,
  reported_by uuid NOT NULL REFERENCES public.users(id),
  reported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED_TRANSFER', 'RESOLVED_CORRECTION', 'DISMISSED')),
  resolution_note text,
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  transfer_id uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_location_discrepancies_open_idx ON tenant.asset_location_discrepancies (asset_id) WHERE status = 'OPEN';
CREATE OR REPLACE FUNCTION tenant.asset_location_discrepancies_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A location discrepancy is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status <> 'OPEN' OR NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.expected_location_id IS DISTINCT FROM OLD.expected_location_id
     OR NEW.observed_location_id IS DISTINCT FROM OLD.observed_location_id OR NEW.reported_by IS DISTINCT FROM OLD.reported_by THEN
    RAISE EXCEPTION 'A resolved discrepancy stays resolved; what was observed is kept.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_location_discrepancies_guard') THEN
    CREATE TRIGGER asset_location_discrepancies_guard BEFORE UPDATE OR DELETE ON tenant.asset_location_discrepancies FOR EACH ROW EXECUTE FUNCTION tenant.asset_location_discrepancies_guard();
  END IF;
END $$;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['asset_location_changes', 'asset_location_events', 'asset_location_observations', 'asset_location_discrepancies'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT ON tenant.asset_location_changes, tenant.asset_location_events TO vercent_app;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_location_observations, tenant.asset_location_discrepancies TO vercent_app;
GRANT SELECT ON tenant.asset_location_changes, tenant.asset_location_events, tenant.asset_location_observations, tenant.asset_location_discrepancies TO vercent_worker;

-- ============================================================ 8. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('assets.location.create', 'Create asset locations', 'Assets', 'Add offices, rooms, storage points and external sites.'),
  ('assets.location.edit', 'Edit asset locations', 'Assets', 'Rename a location and change its details.'),
  ('assets.location.deactivate', 'Deactivate asset locations', 'Assets', 'Deactivate or reactivate a location.'),
  ('assets.location.manage_hierarchy', 'Reorganize asset locations', 'Assets', 'Move a location under another parent.'),
  ('assets.location.view_history', 'View location history', 'Assets', 'See every change to asset locations and each asset''s location history.'),
  ('assets.location.record_observation', 'Record asset whereabouts', 'Assets', 'Record where an asset was seen or temporarily is, without moving it.'),
  ('assets.location.review_discrepancy', 'Review location discrepancies', 'Assets', 'Resolve location differences, including authorized corrections.'),
  ('assets.location.export', 'Export asset locations', 'Assets', 'Export the location master.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('asset_manager', 'assets.location.create'), ('asset_manager', 'assets.location.edit'), ('asset_manager', 'assets.location.deactivate'), ('asset_manager', 'assets.location.manage_hierarchy'),
    ('asset_manager', 'assets.location.view_history'), ('asset_manager', 'assets.location.record_observation'), ('asset_manager', 'assets.location.review_discrepancy'), ('asset_manager', 'assets.location.export'),
    ('finance_manager', 'assets.location.view_history'), ('finance_manager', 'assets.location.export'), ('accountant', 'assets.location.view_history')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0147_assets_locations.sql', 'assets-locations') ON CONFLICT DO NOTHING;
