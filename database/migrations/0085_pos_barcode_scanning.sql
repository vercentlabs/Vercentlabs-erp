-- 0085 Barcode Scanning (POS): scan → identify → validate → add to the sale → ready for the next scan. Scanning is an input to Product
-- Search and the cart, not a catalogue, price list or stock system of its own; barcodes stay the shared Item Master's registry.
--
-- 1. The barcode registry (tenant.item_identifiers, the Item Master's): an optional known format, a GTIN key so a UPC-A and the same number as
--    EAN-13 / GTIN-14 are one barcode (an explicit GS1 rule, never a guess) and can never belong to two items, and who changed a barcode when.
-- 2. Terminal scanner settings on the existing terminal record (barcode_scanning stays the on / off switch): keyboard-wedge mode, an optional
--    prefix, the suffix the scanner ends a code with (Enter, Tab or a custom one) and success / error sounds.
-- 3. Scan actions: each completed scan has its own action id. Retrying the same action returns its original outcome; reusing the id for a
--    different scan is refused (the request fingerprint), so retries never add twice while a second, intentional scan always adds.
-- 4. A sale line keeps the barcode it was scanned with and the SKU it was sold under, so receipts stay right when barcodes change later.
-- 5. Scan diagnostics: failed scans (unknown, inactive or unreadable barcodes, ambiguities, refusals, serial rejections) and slow scans, with
--    their context; successful scans are already in the cart's own records. Old diagnostics can be purged.

-- ============================================================ 1. barcode registry

ALTER TABLE tenant.item_identifiers
  ADD COLUMN IF NOT EXISTS barcode_format text,
  ADD COLUMN IF NOT EXISTS gtin_key text GENERATED ALWAYS AS (CASE WHEN value ~ '^[0-9]{12,14}$' THEN lpad(value, 14, '0') END) STORED,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_identifiers_barcode_format_check') THEN
    ALTER TABLE tenant.item_identifiers ADD CONSTRAINT item_identifiers_barcode_format_check
      CHECK (barcode_format IS NULL OR barcode_format IN ('ean13', 'ean8', 'upca', 'upce', 'code128', 'code39', 'qr', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_identifiers_version_check') THEN
    ALTER TABLE tenant.item_identifiers ADD CONSTRAINT item_identifiers_version_check CHECK (version >= 1);
  END IF;
END $$;
-- One active GTIN per company, whichever of its 12-, 13- or 14-digit spellings was stored.
CREATE UNIQUE INDEX IF NOT EXISTS item_identifiers_gtin_key_uidx ON tenant.item_identifiers (organization_id, gtin_key) WHERE status = 'active' AND gtin_key IS NOT NULL;

-- ============================================================ 2. terminal scanner settings

ALTER TABLE tenant.pos_terminals
  ADD COLUMN IF NOT EXISTS scanner_input_mode text NOT NULL DEFAULT 'keyboard_wedge',
  ADD COLUMN IF NOT EXISTS scanner_prefix text,
  ADD COLUMN IF NOT EXISTS scanner_suffix text NOT NULL DEFAULT 'enter',
  ADD COLUMN IF NOT EXISTS scanner_suffix_custom text,
  ADD COLUMN IF NOT EXISTS scan_success_sound_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS scan_error_sound_enabled boolean NOT NULL DEFAULT true;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_terminals_scanner_check') THEN
    ALTER TABLE tenant.pos_terminals ADD CONSTRAINT pos_terminals_scanner_check CHECK (
      scanner_input_mode IN ('keyboard_wedge')
      AND scanner_suffix IN ('enter', 'tab', 'custom')
      AND (scanner_prefix IS NULL OR char_length(scanner_prefix) BETWEEN 1 AND 10)
      AND (scanner_suffix <> 'custom' OR char_length(COALESCE(scanner_suffix_custom, '')) BETWEEN 1 AND 10)
      AND (scanner_suffix_custom IS NULL OR char_length(scanner_suffix_custom) <= 10));
  END IF;
END $$;

-- ============================================================ 3. scan actions

ALTER TABLE tenant.pos_cart_request_keys
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS outcome jsonb;

-- ============================================================ 4. sale line snapshot

ALTER TABLE tenant.pos_sale_lines
  ADD COLUMN IF NOT EXISTS scanned_barcode text,
  ADD COLUMN IF NOT EXISTS sku text;

-- ============================================================ 5. scan diagnostics

CREATE TABLE IF NOT EXISTS tenant.pos_scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid REFERENCES tenant.pos_stores(id) ON DELETE SET NULL,
  terminal_id uuid REFERENCES tenant.pos_terminals(id) ON DELETE SET NULL,
  shift_id uuid REFERENCES tenant.pos_shifts(id) ON DELETE SET NULL,
  cart_id uuid REFERENCES tenant.pos_carts(id) ON DELETE SET NULL,
  cashier_id uuid,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  scan_action_id uuid,
  barcode text CHECK (barcode IS NULL OR char_length(barcode) <= 64),
  result text NOT NULL CHECK (result IN ('not_found', 'invalid', 'inactive_barcode', 'ambiguous', 'rejected', 'serial_rejected', 'permission_denied', 'failed', 'slow')),
  error_code text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_scan_events_idx ON tenant.pos_scan_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pos_scan_events_result_idx ON tenant.pos_scan_events (organization_id, result, created_at DESC);

-- Diagnostics are kept for a limited time: deletes this company's scan events older than the given number of days (at least 7).
CREATE OR REPLACE FUNCTION tenant.purge_pos_scan_events(keep_days integer DEFAULT 90) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE removed integer;
BEGIN
  DELETE FROM tenant.pos_scan_events WHERE organization_id = tenant.current_organization_id() AND created_at < now() - make_interval(days => greatest(keep_days, 7));
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

ALTER TABLE tenant.pos_scan_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_scan_events FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'pos_scan_events' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.pos_scan_events USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, DELETE ON tenant.pos_scan_events TO vercent_app;
GRANT SELECT ON tenant.pos_scan_events TO vercent_worker;
GRANT UPDATE ON tenant.pos_cart_request_keys TO vercent_app;
GRANT EXECUTE ON FUNCTION tenant.purge_pos_scan_events(integer) TO vercent_app;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0085_pos_barcode_scanning.sql', 'pos-barcode-scanning') ON CONFLICT DO NOTHING;
