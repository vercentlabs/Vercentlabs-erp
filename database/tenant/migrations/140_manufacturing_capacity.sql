BEGIN;

-- F150-F154: routings per product, work centres with a calendar and a machine count, shift
-- calendars with holidays/closures, and the capacity these give.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  working_weekdays integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code)
);
CREATE TABLE IF NOT EXISTS tenant.manufacturing_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  calendar_id uuid NOT NULL REFERENCES tenant.manufacturing_calendars(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  UNIQUE (calendar_id, name)
);
CREATE TABLE IF NOT EXISTS tenant.manufacturing_calendar_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  calendar_id uuid NOT NULL REFERENCES tenant.manufacturing_calendars(id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  is_working boolean NOT NULL DEFAULT false,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (calendar_id, exception_date)
);

ALTER TABLE tenant.manufacturing_work_centers
  ADD COLUMN IF NOT EXISTS calendar_id uuid,
  ADD COLUMN IF NOT EXISTS machine_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS center_type text NOT NULL DEFAULT 'machine',
  ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE tenant.manufacturing_work_centers DROP CONSTRAINT IF EXISTS manufacturing_work_centers_machine_count_check;
ALTER TABLE tenant.manufacturing_work_centers ADD CONSTRAINT manufacturing_work_centers_machine_count_check CHECK (machine_count >= 1);
ALTER TABLE tenant.manufacturing_work_centers DROP CONSTRAINT IF EXISTS manufacturing_work_centers_center_type_check;
ALTER TABLE tenant.manufacturing_work_centers ADD CONSTRAINT manufacturing_work_centers_center_type_check CHECK (center_type IN ('machine','labor','cell','subcontract'));

ALTER TABLE tenant.manufacturing_routings
  ADD COLUMN IF NOT EXISTS item_id uuid,
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS supersedes_routing_id uuid,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE tenant.manufacturing_routing_operations
  ADD COLUMN IF NOT EXISTS inspection_required boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS manufacturing_routings_item_idx ON tenant.manufacturing_routings (organization_id, company_id, item_id, status);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['manufacturing_calendars','manufacturing_shifts','manufacturing_calendar_exceptions'] LOOP
  EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', t);
  EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
END LOOP; END $$;

COMMIT;
