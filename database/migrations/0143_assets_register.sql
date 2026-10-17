-- Assets — Asset Register. One authoritative identity per physical asset (tenant.assets), redesigned so the Register owns identity,
-- custody and operational history while Finance owns capitalization and carrying value. Additive over the existing asset tables:
--
--   1. classification   asset type (tangible / intangible / under construction / low-value / external), capitalization class
--                       (pending Finance / capitalized / tracked only), how it was acquired.
--   2. state            the lifecycle (DRAFT → REGISTERED → ACTIVE, ON_HOLD, RETIRED, DISPOSED, LOST) kept apart from availability
--                       (available / assigned / maintenance / restricted) and physical condition. The legacy `status` column that the
--                       existing custody, maintenance and disposal screens still write is kept in step both ways by a trigger.
--   3. identity         an opaque QR lookup token (never an authorization), unique tags, archive, row version, a create key.
--   4. acquisition      allocations of an asset to the exact source line it came from (supplier invoice, goods receipt or purchase
--                       order line, opening balance, a controlled exception), never beyond the line's quantity — across the whole
--                       purchase chain, so the receipt and the bill of the same unit cannot both register it.
--   5. batches          bulk registration from a source line and CSV imports, with row-level outcomes, resumable and idempotent.
--   6. verification     physical observations (found, not found, wrong location, damaged) — evidence, never a change of location.
--   7. categories       asset type, capitalization guidance and maintenance applicability on the one shared category master.
--   8. history          asset events and movements become append-only.
--   9. permissions      the Register's permissions and role grants.

-- ============================================================ 1–3. the asset
ALTER TABLE tenant.assets
  ADD COLUMN IF NOT EXISTS asset_type text NOT NULL DEFAULT 'TANGIBLE',
  ADD COLUMN IF NOT EXISTS capitalization_class text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS acquisition_method text,
  ADD COLUMN IF NOT EXISTS lifecycle_status text,
  ADD COLUMN IF NOT EXISTS availability_status text,
  ADD COLUMN IF NOT EXISTS condition text,
  ADD COLUMN IF NOT EXISTS received_date date,
  ADD COLUMN IF NOT EXISTS qr_token text,
  ADD COLUMN IF NOT EXISTS warranty_provider text,
  ADD COLUMN IF NOT EXISTS warranty_reference text,
  ADD COLUMN IF NOT EXISTS support_contact text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS create_key text,
  ADD COLUMN IF NOT EXISTS registration_batch_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_asset_type_check') THEN
    ALTER TABLE tenant.assets ADD CONSTRAINT assets_asset_type_check CHECK (asset_type IN ('TANGIBLE', 'INTANGIBLE', 'UNDER_CONSTRUCTION', 'LOW_VALUE', 'EXTERNAL'));
    ALTER TABLE tenant.assets ADD CONSTRAINT assets_capitalization_class_check CHECK (capitalization_class IN ('PENDING', 'CAPITALIZED', 'TRACKED_ONLY'));
    ALTER TABLE tenant.assets ADD CONSTRAINT assets_acquisition_method_check CHECK (acquisition_method IS NULL OR acquisition_method IN ('PURCHASE', 'OPENING_BALANCE', 'CONTRIBUTION', 'TRANSFER_IN', 'OTHER'));
    ALTER TABLE tenant.assets ADD CONSTRAINT assets_lifecycle_status_check CHECK (lifecycle_status IN ('DRAFT', 'REGISTERED', 'ACTIVE', 'ON_HOLD', 'RETIRED', 'DISPOSED', 'LOST'));
    ALTER TABLE tenant.assets ADD CONSTRAINT assets_availability_status_check CHECK (availability_status IN ('AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'RESTRICTED'));
    ALTER TABLE tenant.assets ADD CONSTRAINT assets_condition_check CHECK (condition IS NULL OR condition IN ('NEW', 'GOOD', 'FAIR', 'DAMAGED', 'UNSERVICEABLE'));
    -- A tracked-only item is never depreciated; an external asset is never capitalized by the Register.
    ALTER TABLE tenant.assets ADD CONSTRAINT assets_external_not_capitalized_check CHECK (ownership IS DISTINCT FROM 'loaned' OR capitalization_class <> 'CAPITALIZED');
  END IF;
END $$;
-- Existing rows take their lifecycle and availability from the legacy status.
UPDATE tenant.assets SET
  lifecycle_status = CASE status WHEN 'draft' THEN 'DRAFT' WHEN 'retired' THEN 'RETIRED' WHEN 'pending_disposal' THEN 'RETIRED' WHEN 'lost' THEN 'LOST' WHEN 'disposed' THEN 'DISPOSED' ELSE 'ACTIVE' END,
  availability_status = CASE status WHEN 'assigned' THEN 'ASSIGNED' WHEN 'in_maintenance' THEN 'MAINTENANCE' WHEN 'pending_disposal' THEN 'RESTRICTED' WHEN 'available' THEN 'AVAILABLE' ELSE 'RESTRICTED' END,
  capitalization_class = CASE WHEN capitalized_at IS NOT NULL THEN 'CAPITALIZED' ELSE capitalization_class END
WHERE lifecycle_status IS NULL;
UPDATE tenant.assets SET qr_token = encode(gen_random_bytes(18), 'hex') WHERE qr_token IS NULL;
ALTER TABLE tenant.assets ALTER COLUMN lifecycle_status SET NOT NULL, ALTER COLUMN lifecycle_status SET DEFAULT 'DRAFT',
  ALTER COLUMN availability_status SET NOT NULL, ALTER COLUMN availability_status SET DEFAULT 'AVAILABLE',
  ALTER COLUMN qr_token SET DEFAULT encode(gen_random_bytes(18), 'hex'), ALTER COLUMN qr_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assets_qr_token_idx ON tenant.assets (qr_token);
CREATE UNIQUE INDEX IF NOT EXISTS assets_tag_code_idx ON tenant.assets (organization_id, lower(tag_code)) WHERE tag_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assets_create_key_idx ON tenant.assets (organization_id, create_key) WHERE create_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS assets_register_idx ON tenant.assets (organization_id, lifecycle_status, availability_status) WHERE archived_at IS NULL;

-- The legacy status and the new state move together: whichever a statement changes, the other follows.
CREATE OR REPLACE FUNCTION tenant.assets_sync_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  new_changed boolean := TG_OP = 'INSERT' OR NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status OR NEW.availability_status IS DISTINCT FROM OLD.availability_status;
  old_changed boolean := TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status;
BEGIN
  IF old_changed AND NOT new_changed THEN
    NEW.lifecycle_status := CASE NEW.status WHEN 'draft' THEN (CASE WHEN OLD.lifecycle_status IN ('DRAFT', 'REGISTERED') THEN OLD.lifecycle_status ELSE 'DRAFT' END)
      WHEN 'retired' THEN 'RETIRED' WHEN 'pending_disposal' THEN 'RETIRED' WHEN 'lost' THEN 'LOST' WHEN 'disposed' THEN 'DISPOSED' ELSE 'ACTIVE' END;
    NEW.availability_status := CASE NEW.status WHEN 'assigned' THEN 'ASSIGNED' WHEN 'in_maintenance' THEN 'MAINTENANCE' WHEN 'available' THEN 'AVAILABLE' WHEN 'draft' THEN OLD.availability_status ELSE 'RESTRICTED' END;
  ELSIF new_changed THEN
    NEW.status := CASE NEW.lifecycle_status WHEN 'DRAFT' THEN 'draft' WHEN 'REGISTERED' THEN 'draft' WHEN 'RETIRED' THEN 'retired' WHEN 'DISPOSED' THEN 'disposed' WHEN 'LOST' THEN 'lost'
      ELSE CASE NEW.availability_status WHEN 'ASSIGNED' THEN 'assigned' WHEN 'MAINTENANCE' THEN 'in_maintenance' ELSE 'available' END END;
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW.row_version := OLD.row_version + 1; NEW.updated_at := clock_timestamp(); END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'assets_sync_state') THEN
    CREATE TRIGGER assets_sync_state BEFORE INSERT OR UPDATE ON tenant.assets FOR EACH ROW EXECUTE FUNCTION tenant.assets_sync_state();
  END IF;
END $$;
-- An asset is archived or disposed, never deleted; its code is never reused.
CREATE OR REPLACE FUNCTION tenant.assets_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'An asset is archived or disposed, never deleted.' USING ERRCODE = 'check_violation';
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'assets_no_delete') THEN
    CREATE TRIGGER assets_no_delete BEFORE DELETE ON tenant.assets FOR EACH ROW EXECUTE FUNCTION tenant.assets_no_delete();
  END IF;
END $$;

-- ============================================================ 4. acquisition allocations
CREATE TABLE IF NOT EXISTS tenant.asset_acquisition_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  allocation_number bigint GENERATED ALWAYS AS IDENTITY,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  source_type text NOT NULL CHECK (source_type IN ('SUPPLIER_INVOICE_LINE', 'GOODS_RECEIPT_LINE', 'PURCHASE_ORDER_LINE', 'OPENING_BALANCE', 'MANUAL_EXCEPTION')),
  source_document_id uuid,
  source_line_id uuid,
  -- The purchase order line the source belongs to: one physical unit of a purchase is claimed once, whether through its receipt or its bill.
  root_po_line_id uuid,
  allocated_quantity numeric(18,4) NOT NULL DEFAULT 1 CHECK (allocated_quantity > 0),
  allocated_cost numeric(18,2) CHECK (allocated_cost IS NULL OR allocated_cost >= 0),
  cost_basis text NOT NULL DEFAULT 'NONE' CHECK (cost_basis IN ('LINE_NET_PER_UNIT', 'OPENING_BALANCE', 'NONE')),
  cost_status text NOT NULL DEFAULT 'PROPOSED' CHECK (cost_status IN ('PROPOSED', 'FINANCE_CONFIRMED', 'NOT_APPLICABLE')),
  currency char(3),
  source_version text,
  reason text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVERSED')),
  batch_id uuid,
  command_id text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reversed_by uuid REFERENCES public.users(id),
  reversed_at timestamptz,
  reversal_reason text,
  CONSTRAINT asset_acquisition_allocations_line_check CHECK (source_type IN ('OPENING_BALANCE', 'MANUAL_EXCEPTION') OR source_line_id IS NOT NULL),
  CONSTRAINT asset_acquisition_allocations_exception_check CHECK (source_type <> 'MANUAL_EXCEPTION' OR length(btrim(COALESCE(reason, ''))) >= 3),
  CONSTRAINT asset_acquisition_allocations_reversal_check CHECK ((status = 'REVERSED') = (reversed_at IS NOT NULL))
);
-- One acquisition basis per asset at a time.
CREATE UNIQUE INDEX IF NOT EXISTS asset_acquisition_allocations_live_idx ON tenant.asset_acquisition_allocations (asset_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS asset_acquisition_allocations_line_idx ON tenant.asset_acquisition_allocations (organization_id, source_line_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS asset_acquisition_allocations_root_idx ON tenant.asset_acquisition_allocations (organization_id, root_po_line_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS asset_acquisition_allocations_command_idx ON tenant.asset_acquisition_allocations (organization_id, command_id) WHERE command_id IS NOT NULL;
CREATE OR REPLACE FUNCTION tenant.asset_acquisition_allocations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'An acquisition allocation is reversed, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.asset_id <> OLD.asset_id OR NEW.source_line_id IS DISTINCT FROM OLD.source_line_id OR NEW.allocated_quantity <> OLD.allocated_quantity OR NEW.source_type <> OLD.source_type THEN
    RAISE EXCEPTION 'An acquisition allocation keeps its source; reverse it and allocate again.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'REVERSED' AND NEW.status <> 'REVERSED' THEN RAISE EXCEPTION 'A reversed allocation stays reversed.' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_acquisition_allocations_guard') THEN
    CREATE TRIGGER asset_acquisition_allocations_guard BEFORE UPDATE OR DELETE ON tenant.asset_acquisition_allocations FOR EACH ROW EXECUTE FUNCTION tenant.asset_acquisition_allocations_guard();
  END IF;
END $$;

-- ============================================================ 5. registration batches and imports
CREATE TABLE IF NOT EXISTS tenant.asset_registration_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  batch_number bigint GENERATED ALWAYS AS IDENTITY,
  kind text NOT NULL CHECK (kind IN ('FROM_SOURCE', 'IMPORT')),
  source_type text,
  source_line_id uuid,
  file_name text,
  requested_count integer NOT NULL DEFAULT 0 CHECK (requested_count >= 0),
  created_count integer NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  status text NOT NULL DEFAULT 'PREVIEW' CHECK (status IN ('PREVIEW', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'FAILED')),
  idempotency_key text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_registration_batches_key_idx ON tenant.asset_registration_batches (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS tenant.asset_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  batch_id uuid NOT NULL REFERENCES tenant.asset_registration_batches(id),
  row_number integer NOT NULL CHECK (row_number > 0),
  status text NOT NULL CHECK (status IN ('VALID', 'INVALID', 'CREATED', 'DUPLICATE')),
  data jsonb NOT NULL,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  asset_id uuid REFERENCES tenant.assets(id),
  UNIQUE (batch_id, row_number)
);

-- ============================================================ 6. verification
CREATE TABLE IF NOT EXISTS tenant.asset_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  outcome text NOT NULL CHECK (outcome IN ('FOUND', 'NOT_FOUND', 'WRONG_LOCATION', 'DAMAGED')),
  observed_location_id uuid REFERENCES tenant.asset_locations(id),
  observed_location_text text,
  expected_location_id uuid,
  expected_custodian_user_id uuid,
  condition text CHECK (condition IS NULL OR condition IN ('NEW', 'GOOD', 'FAIR', 'DAMAGED', 'UNSERVICEABLE')),
  note text,
  method text NOT NULL DEFAULT 'MANUAL' CHECK (method IN ('MANUAL', 'QR', 'SEARCH')),
  verified_by uuid NOT NULL REFERENCES public.users(id),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT asset_verifications_wrong_location_check CHECK (outcome <> 'WRONG_LOCATION' OR observed_location_id IS NOT NULL OR length(btrim(COALESCE(observed_location_text, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS asset_verifications_asset_idx ON tenant.asset_verifications (asset_id, verified_at DESC);

-- ============================================================ 7. categories and settings
ALTER TABLE tenant.asset_categories
  ADD COLUMN IF NOT EXISTS asset_type text NOT NULL DEFAULT 'TANGIBLE',
  ADD COLUMN IF NOT EXISTS capitalization_guidance text NOT NULL DEFAULT 'REVIEW',
  ADD COLUMN IF NOT EXISTS maintenance_applicable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS serial_required boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_categories_asset_type_check') THEN
    ALTER TABLE tenant.asset_categories ADD CONSTRAINT asset_categories_asset_type_check CHECK (asset_type IN ('TANGIBLE', 'INTANGIBLE', 'UNDER_CONSTRUCTION', 'LOW_VALUE', 'EXTERNAL'));
    ALTER TABLE tenant.asset_categories ADD CONSTRAINT asset_categories_capitalization_guidance_check CHECK (capitalization_guidance IN ('CAPITALIZE', 'TRACK_ONLY', 'REVIEW'));
  END IF;
END $$;
ALTER TABLE tenant.asset_settings ADD COLUMN IF NOT EXISTS verification_period_days integer NOT NULL DEFAULT 365 CHECK (verification_period_days BETWEEN 7 AND 1825);

-- ============================================================ 8. history is append-only
CREATE OR REPLACE FUNCTION tenant.assets_history_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Asset history is never changed.' USING ERRCODE = 'check_violation';
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_events_append_only') THEN
    CREATE TRIGGER asset_events_append_only BEFORE UPDATE OR DELETE ON tenant.asset_events FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_movements_append_only') THEN
    CREATE TRIGGER asset_movements_append_only BEFORE UPDATE OR DELETE ON tenant.asset_movements FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_verifications_append_only') THEN
    CREATE TRIGGER asset_verifications_append_only BEFORE UPDATE OR DELETE ON tenant.asset_verifications FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['asset_acquisition_allocations', 'asset_registration_batches', 'asset_import_rows', 'asset_verifications'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_acquisition_allocations, tenant.asset_registration_batches, tenant.asset_import_rows TO vercent_app;
GRANT SELECT, INSERT ON tenant.asset_verifications TO vercent_app;
GRANT SELECT ON tenant.asset_acquisition_allocations, tenant.asset_registration_batches, tenant.asset_import_rows, tenant.asset_verifications TO vercent_worker;

-- ============================================================ 9. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('assets.edit_draft', 'Edit draft assets', 'Assets', 'Change an asset while it is still a draft.'),
  ('assets.edit_details', 'Edit asset details', 'Assets', 'Change the non-financial details of a registered asset.'),
  ('assets.register_bulk', 'Register assets in bulk', 'Assets', 'Register several assets from one purchase line.'),
  ('assets.import', 'Import assets', 'Assets', 'Import the opening asset register from a CSV file.'),
  ('assets.export', 'Export assets', 'Assets', 'Export the asset register and its reports.'),
  ('assets.activate', 'Commission assets', 'Assets', 'Commission an asset for business use, and put it on hold or return it to use.'),
  ('assets.verify', 'Verify assets', 'Assets', 'Record physical verification of assets.'),
  ('assets.view_financials', 'View asset financials', 'Assets', 'See acquisition cost, capitalization and carrying value.'),
  ('assets.manage_acquisition_link', 'Manage asset acquisition links', 'Assets', 'Link assets to their purchase source and correct those links.'),
  ('assets.retire_or_dispose', 'Retire assets', 'Assets', 'Retire assets and declare them lost.'),
  ('assets.manage_categories', 'Manage asset categories', 'Assets', 'Maintain the asset category master.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('asset_manager', 'assets.edit_draft'), ('asset_manager', 'assets.edit_details'), ('asset_manager', 'assets.register_bulk'), ('asset_manager', 'assets.import'),
    ('asset_manager', 'assets.export'), ('asset_manager', 'assets.activate'), ('asset_manager', 'assets.verify'), ('asset_manager', 'assets.view_financials'),
    ('asset_manager', 'assets.manage_acquisition_link'), ('asset_manager', 'assets.retire_or_dispose'), ('asset_manager', 'assets.manage_categories'),
    ('finance_manager', 'assets.view'), ('finance_manager', 'assets.view_financials'), ('finance_manager', 'assets.manage_acquisition_link'), ('finance_manager', 'assets.capitalize'),
    ('finance_manager', 'assets.export'), ('finance_manager', 'assets.audit.view'), ('finance_manager', 'assets.reports.view'),
    ('accountant', 'assets.view'), ('accountant', 'assets.view_financials'), ('accountant', 'assets.manage_acquisition_link'), ('accountant', 'assets.export'), ('accountant', 'assets.reports.view'),
    ('employee', 'assets.view')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0143_assets_register.sql', 'assets-register') ON CONFLICT DO NOTHING;
