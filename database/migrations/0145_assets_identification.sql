-- Assets — Asset Identification and Code. One permanent identity per asset (its UUID and its Company-scoped AST-… code, both generated
-- by the backend and never changed or reused), with the external identifiers kept apart and under control: the manufacturer's serial
-- (normalized for matching, placeholders such as N/A never treated as a serial, duplicates blocked or accepted through an authorized,
-- recorded exception), the Company's own asset tag (unique while assigned, replaced through a controlled change), and a historical code
-- carried over from an earlier register. Every change to an identifier is recorded. Labels carry the opaque QR token and a Code 128
-- barcode of the asset code; the register knows which assets have had a label printed. Additive:
--
--   1. normalization        tenant.asset_identifier_normalize(): one rule, used by the database and the application alike.
--   2. asset identifiers    normalized serial and tag, the historical code, label-print tracking; kept in step by a trigger.
--   3. identity guard       the code, the QR token and the Company of an asset never change.
--   4. identifier history   an append-only record of every serial, tag and historical-code change, with its reason and actor.
--   5. aliases              previous tags and serials and historical codes that still find the asset; never an alternate key.
--   6. duplicate exceptions authorized acceptances of a serial another asset also carries, with the reason.
--   7. permissions          correct serial, replace tag, import identifiers, print labels, print in bulk, history, resolve duplicates, export.

-- ============================================================ 1. normalization
-- Trim, Unicode NFKC, collapse inner whitespace, upper case. Hyphens and leading zeros are kept. A placeholder (blank, N/A, NA, NONE,
-- NIL, NULL, UNKNOWN, TBD, -, 0, ...) is not an identifier and normalizes to NULL.
CREATE OR REPLACE FUNCTION tenant.asset_identifier_normalize(value text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN n IS NULL OR n = '' OR n ~ '^[-_./ 0]*$' OR n IN ('N/A', 'NA', 'N.A.', 'NONE', 'NIL', 'NULL', 'UNKNOWN', 'TBD', 'TBA', 'NOT AVAILABLE', 'NO SERIAL', 'XXX', '?')
    THEN NULL ELSE n END
  FROM (SELECT upper(regexp_replace(btrim(normalize(value, NFKC)), '\s+', ' ', 'g')) AS n) AS t
$$;

-- ============================================================ 2. asset identifiers
ALTER TABLE tenant.assets
  ADD COLUMN IF NOT EXISTS serial_normalized text,
  ADD COLUMN IF NOT EXISTS tag_normalized text,
  ADD COLUMN IF NOT EXISTS legacy_asset_code text,
  ADD COLUMN IF NOT EXISTS legacy_normalized text,
  ADD COLUMN IF NOT EXISTS label_printed_at timestamptz,
  ADD COLUMN IF NOT EXISTS label_print_count integer NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION tenant.assets_identifiers_normalized() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.serial_normalized := tenant.asset_identifier_normalize(NEW.serial_number);
  NEW.tag_normalized := tenant.asset_identifier_normalize(NEW.tag_code);
  NEW.legacy_normalized := tenant.asset_identifier_normalize(NEW.legacy_asset_code);
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'assets_identifiers_normalized') THEN
    CREATE TRIGGER assets_identifiers_normalized BEFORE INSERT OR UPDATE OF serial_number, tag_code, legacy_asset_code ON tenant.assets FOR EACH ROW EXECUTE FUNCTION tenant.assets_identifiers_normalized();
  END IF;
END $$;
UPDATE tenant.assets SET serial_normalized = tenant.asset_identifier_normalize(serial_number), tag_normalized = tenant.asset_identifier_normalize(tag_code),
  legacy_normalized = tenant.asset_identifier_normalize(legacy_asset_code)
  WHERE serial_normalized IS DISTINCT FROM tenant.asset_identifier_normalize(serial_number) OR tag_normalized IS DISTINCT FROM tenant.asset_identifier_normalize(tag_code)
     OR legacy_normalized IS DISTINCT FROM tenant.asset_identifier_normalize(legacy_asset_code);
CREATE INDEX IF NOT EXISTS assets_serial_normalized_idx ON tenant.assets (organization_id, serial_normalized) WHERE serial_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS assets_legacy_normalized_idx ON tenant.assets (organization_id, legacy_normalized) WHERE legacy_normalized IS NOT NULL;
-- A tag identifies one asset within the Company while it is assigned. Where existing data already repeats a tag the guard is not created,
-- and the repeat shows on the identification exceptions for the Company to correct.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'tenant' AND indexname = 'assets_tag_normalized_idx')
     AND NOT EXISTS (SELECT 1 FROM tenant.assets WHERE tag_normalized IS NOT NULL GROUP BY organization_id, tag_normalized HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX assets_tag_normalized_idx ON tenant.assets (organization_id, tag_normalized) WHERE tag_normalized IS NOT NULL;
  END IF;
END $$;

-- ============================================================ 3. identity guard
CREATE OR REPLACE FUNCTION tenant.assets_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'An asset never moves to another identity or Company.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.asset_number IS DISTINCT FROM OLD.asset_number THEN
    RAISE EXCEPTION 'The system Asset Code cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.qr_token IS DISTINCT FROM OLD.qr_token THEN
    RAISE EXCEPTION 'An asset''s QR lookup token cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'assets_identity_guard') THEN
    CREATE TRIGGER assets_identity_guard BEFORE UPDATE ON tenant.assets FOR EACH ROW EXECUTE FUNCTION tenant.assets_identity_guard();
  END IF;
END $$;

-- ============================================================ 4. identifier history
CREATE TABLE IF NOT EXISTS tenant.asset_identifier_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  identifier_type text NOT NULL CHECK (identifier_type IN ('SERIAL', 'TAG', 'LEGACY_CODE')),
  change_kind text NOT NULL CHECK (change_kind IN ('CORRECTION', 'REPLACEMENT', 'REMOVAL', 'IMPORT', 'DUPLICATE_EXCEPTION')),
  old_value text,
  new_value text,
  reason text,
  approval_id uuid,
  changed_by uuid REFERENCES public.users(id),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_identifier_history_asset_idx ON tenant.asset_identifier_history (asset_id, changed_at DESC);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_identifier_history_append_only') THEN
    CREATE TRIGGER asset_identifier_history_append_only BEFORE UPDATE OR DELETE ON tenant.asset_identifier_history FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ 5. aliases
-- A previous tag or serial, or a historical code, that still finds the asset. Only ever retired (active = false, effective_to set),
-- never rewritten or deleted. Lookups go through the Company's own rows; an alias is never a key that bypasses the Company scope.
CREATE TABLE IF NOT EXISTS tenant.asset_identifier_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  identifier_type text NOT NULL CHECK (identifier_type IN ('LEGACY_CODE', 'PREVIOUS_TAG', 'PREVIOUS_SERIAL')),
  value text NOT NULL,
  normalized text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  ambiguous boolean NOT NULL DEFAULT false,
  effective_from timestamptz NOT NULL DEFAULT clock_timestamp(),
  effective_to timestamptz,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_identifier_aliases_lookup_idx ON tenant.asset_identifier_aliases (organization_id, normalized) WHERE active;
CREATE INDEX IF NOT EXISTS asset_identifier_aliases_asset_idx ON tenant.asset_identifier_aliases (asset_id);
CREATE OR REPLACE FUNCTION tenant.asset_identifier_aliases_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'An identifier alias is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.value IS DISTINCT FROM OLD.value
     OR NEW.normalized IS DISTINCT FROM OLD.normalized OR NEW.identifier_type IS DISTINCT FROM OLD.identifier_type OR (NEW.active AND NOT OLD.active) THEN
    RAISE EXCEPTION 'An identifier alias is only ever retired.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_identifier_aliases_guard') THEN
    CREATE TRIGGER asset_identifier_aliases_guard BEFORE UPDATE OR DELETE ON tenant.asset_identifier_aliases FOR EACH ROW EXECUTE FUNCTION tenant.asset_identifier_aliases_guard();
  END IF;
END $$;
-- Existing historical codes become aliases.
INSERT INTO tenant.asset_identifier_aliases (organization_id, asset_id, identifier_type, value, normalized)
SELECT a.organization_id, a.id, 'LEGACY_CODE', a.legacy_asset_code, a.legacy_normalized FROM tenant.assets a
 WHERE a.legacy_normalized IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant.asset_identifier_aliases x WHERE x.asset_id = a.id AND x.identifier_type = 'LEGACY_CODE');

-- ============================================================ 6. duplicate exceptions
CREATE TABLE IF NOT EXISTS tenant.asset_identifier_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  identifier_type text NOT NULL CHECK (identifier_type IN ('SERIAL')),
  normalized_value text NOT NULL,
  matched_asset_ids uuid[] NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  approved_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_identifier_exceptions_value_idx ON tenant.asset_identifier_exceptions (organization_id, normalized_value);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_identifier_exceptions_append_only') THEN
    CREATE TRIGGER asset_identifier_exceptions_append_only BEFORE UPDATE OR DELETE ON tenant.asset_identifier_exceptions FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['asset_identifier_history', 'asset_identifier_aliases', 'asset_identifier_exceptions'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT ON tenant.asset_identifier_history, tenant.asset_identifier_exceptions TO vercent_app;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_identifier_aliases TO vercent_app;
GRANT SELECT ON tenant.asset_identifier_history, tenant.asset_identifier_aliases, tenant.asset_identifier_exceptions TO vercent_worker;
GRANT EXECUTE ON FUNCTION tenant.asset_identifier_normalize(text) TO vercent_app, vercent_worker;

-- ============================================================ 7. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('assets.identification.edit_serial', 'Correct asset serial numbers', 'Assets', 'Correct a registered asset''s manufacturer serial number, with a reason.'),
  ('assets.identification.edit_tag', 'Replace asset tags', 'Assets', 'Replace or remove a registered asset''s Company tag, with a reason.'),
  ('assets.identification.import', 'Import asset identifiers', 'Assets', 'Bring in historical asset codes and identifiers.'),
  ('assets.identification.print_label', 'Print asset labels', 'Assets', 'Print or reprint an asset''s QR and barcode label.'),
  ('assets.identification.bulk_print', 'Print asset labels in bulk', 'Assets', 'Print labels for many assets at once.'),
  ('assets.identification.view_history', 'View identifier history', 'Assets', 'See every change to an asset''s serial, tag and historical code.'),
  ('assets.identification.resolve_duplicate', 'Accept duplicate serial numbers', 'Assets', 'Record an authorized exception for a serial number another asset also carries.'),
  ('assets.identification.export', 'Export asset identifiers', 'Assets', 'Export codes, serials, tags and historical codes.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('asset_manager', 'assets.identification.edit_serial'), ('asset_manager', 'assets.identification.edit_tag'), ('asset_manager', 'assets.identification.import'),
    ('asset_manager', 'assets.identification.print_label'), ('asset_manager', 'assets.identification.bulk_print'), ('asset_manager', 'assets.identification.view_history'),
    ('asset_manager', 'assets.identification.resolve_duplicate'), ('asset_manager', 'assets.identification.export'),
    ('finance_manager', 'assets.identification.view_history'), ('finance_manager', 'assets.identification.export'),
    ('accountant', 'assets.identification.view_history')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0145_assets_identification.sql', 'assets-identification') ON CONFLICT DO NOTHING;
