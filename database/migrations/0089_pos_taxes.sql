-- 0089 POS Taxes: POS consumes the shared tax engine (services/api/src/core/tax) — it never calculates GST itself. This migration adds what
-- the engine and POS need to do that correctly, and what a finished sale keeps:
--
-- 1. Company registrations: the regime (regular, composition, casual taxable person, …) and the dates it is valid. Only a regular registration
--    charges GST on a tax invoice; anything else is blocked at POS with a setup message, never guessed.
-- 2. The bill's supply context: handed over at the counter (place of supply: the store) or delivered (place of supply: the delivery state).
--    A customer's state alone never makes a supply inter-state.
-- 3. The bill's last tax calculation: a fingerprint of it (bound to the checkout attempt) and, when it could not be calculated, why — a bill
--    with a tax problem cannot be paid. Cart lines carry the line's classification, HSN/SAC, rate and price basis for the cashier's view.
-- 4. A finished sale's tax snapshot, never changed afterwards: per line the HSN/SAC, tax category, rate, classification (taxable, nil-rated,
--    exempt, non-GST, zero-rated), taxable value and price basis; per sale the seller registration, place of supply, supply mode, the
--    document it is (tax invoice, bill of supply, or both), the taxable total, the breakdown by component and rate, and the fingerprint.
-- 5. Returns: each returned line keeps its taxable value, tax and components, worked out from the original sale's snapshot (never from
--    today's rate), so a credit note reverses exactly what was charged.

-- ============================================================ 1. registrations

ALTER TABLE tenant.tax_registrations
  ADD COLUMN IF NOT EXISTS registration_type text NOT NULL DEFAULT 'regular',
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS valid_until date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_registrations_registration_type_check') THEN
    ALTER TABLE tenant.tax_registrations ADD CONSTRAINT tax_registrations_registration_type_check
      CHECK (registration_type IN ('regular', 'composition', 'casual_taxable', 'non_resident', 'input_service_distributor', 'unregistered'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_registrations_validity_check') THEN
    ALTER TABLE tenant.tax_registrations ADD CONSTRAINT tax_registrations_validity_check CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from);
  END IF;
END $$;

-- ============================================================ 2-3. the bill's supply context and tax calculation

ALTER TABLE tenant.pos_carts
  ADD COLUMN IF NOT EXISTS supply_mode text NOT NULL DEFAULT 'in_store',
  ADD COLUMN IF NOT EXISTS delivery_state_code text,
  ADD COLUMN IF NOT EXISTS tax_calculation_hash text,
  ADD COLUMN IF NOT EXISTS checkout_tax_hash text,
  ADD COLUMN IF NOT EXISTS tax_error_code text,
  ADD COLUMN IF NOT EXISTS tax_error_message text,
  ADD COLUMN IF NOT EXISTS taxable_total numeric(20,6);

ALTER TABLE tenant.pos_cart_lines
  ADD COLUMN IF NOT EXISTS tax_classification text,
  ADD COLUMN IF NOT EXISTS hsn_sac_code text,
  ADD COLUMN IF NOT EXISTS tax_rate numeric(9,4),
  ADD COLUMN IF NOT EXISTS price_includes_tax boolean;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_carts_supply_mode_check') THEN
    ALTER TABLE tenant.pos_carts ADD CONSTRAINT pos_carts_supply_mode_check CHECK (
      supply_mode IN ('in_store', 'delivery') AND (delivery_state_code IS NULL OR delivery_state_code ~ '^[0-9]{2}$')
      AND (supply_mode = 'delivery' OR delivery_state_code IS NULL));
  END IF;
END $$;

-- ============================================================ 4. the sale's tax snapshot

ALTER TABLE tenant.pos_sale_lines
  ADD COLUMN IF NOT EXISTS taxable_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS hsn_sac_snapshot text,
  ADD COLUMN IF NOT EXISTS tax_category_id uuid,
  ADD COLUMN IF NOT EXISTS tax_category_code text,
  ADD COLUMN IF NOT EXISTS tax_rate_id uuid,
  ADD COLUMN IF NOT EXISTS tax_rate numeric(9,4),
  ADD COLUMN IF NOT EXISTS tax_classification text,
  ADD COLUMN IF NOT EXISTS price_includes_tax boolean,
  ADD COLUMN IF NOT EXISTS place_of_supply text;

ALTER TABLE tenant.pos_sales
  ADD COLUMN IF NOT EXISTS seller_tax_registration_id uuid,
  ADD COLUMN IF NOT EXISTS seller_tax_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS place_of_supply_snapshot text,
  ADD COLUMN IF NOT EXISTS supply_mode_snapshot text,
  ADD COLUMN IF NOT EXISTS tax_document_type text,
  ADD COLUMN IF NOT EXISTS taxable_total numeric(20,6),
  ADD COLUMN IF NOT EXISTS tax_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS tax_calculation_hash text,
  ADD COLUMN IF NOT EXISTS tax_date date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sale_lines_tax_classification_check') THEN
    ALTER TABLE tenant.pos_sale_lines ADD CONSTRAINT pos_sale_lines_tax_classification_check
      CHECK (tax_classification IS NULL OR tax_classification IN ('taxable', 'nil_rated', 'exempt', 'non_gst', 'zero_rated'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sales_tax_document_type_check') THEN
    ALTER TABLE tenant.pos_sales ADD CONSTRAINT pos_sales_tax_document_type_check
      CHECK (tax_document_type IS NULL OR tax_document_type IN ('tax_invoice', 'bill_of_supply', 'invoice_cum_bill_of_supply', 'receipt'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sales_supply_mode_check') THEN
    ALTER TABLE tenant.pos_sales ADD CONSTRAINT pos_sales_supply_mode_check CHECK (supply_mode_snapshot IS NULL OR supply_mode_snapshot IN ('in_store', 'delivery'));
  END IF;
END $$;

-- A finished sale's tax never changes: corrections are credit notes and returns.
CREATE OR REPLACE FUNCTION tenant.pos_sale_tax_snapshot_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'pos_sales' THEN
    IF NEW.seller_tax_registration_id IS DISTINCT FROM OLD.seller_tax_registration_id OR NEW.seller_tax_snapshot IS DISTINCT FROM OLD.seller_tax_snapshot
       OR NEW.place_of_supply_snapshot IS DISTINCT FROM OLD.place_of_supply_snapshot OR NEW.supply_mode_snapshot IS DISTINCT FROM OLD.supply_mode_snapshot
       OR NEW.tax_document_type IS DISTINCT FROM OLD.tax_document_type OR NEW.taxable_total IS DISTINCT FROM OLD.taxable_total
       OR NEW.tax_breakdown IS DISTINCT FROM OLD.tax_breakdown OR NEW.tax_calculation_hash IS DISTINCT FROM OLD.tax_calculation_hash
       OR NEW.tax_date IS DISTINCT FROM OLD.tax_date OR NEW.tax_total IS DISTINCT FROM OLD.tax_total THEN
      RAISE EXCEPTION 'A completed sale''s tax cannot be changed; use a return or credit note.' USING ERRCODE = 'check_violation', CONSTRAINT = 'pos_sale_tax_snapshot_immutable';
    END IF;
  ELSE
    IF NEW.taxable_amount IS DISTINCT FROM OLD.taxable_amount OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount OR NEW.tax_components IS DISTINCT FROM OLD.tax_components
       OR NEW.hsn_sac_snapshot IS DISTINCT FROM OLD.hsn_sac_snapshot OR NEW.tax_category_id IS DISTINCT FROM OLD.tax_category_id
       OR NEW.tax_rate_id IS DISTINCT FROM OLD.tax_rate_id OR NEW.tax_rate IS DISTINCT FROM OLD.tax_rate OR NEW.tax_classification IS DISTINCT FROM OLD.tax_classification
       OR NEW.price_includes_tax IS DISTINCT FROM OLD.price_includes_tax OR NEW.place_of_supply IS DISTINCT FROM OLD.place_of_supply THEN
      RAISE EXCEPTION 'A completed sale''s tax cannot be changed; use a return or credit note.' USING ERRCODE = 'check_violation', CONSTRAINT = 'pos_sale_tax_snapshot_immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER pos_sales_tax_snapshot_guard BEFORE UPDATE OF seller_tax_registration_id, seller_tax_snapshot, place_of_supply_snapshot, supply_mode_snapshot,
  tax_document_type, taxable_total, tax_breakdown, tax_calculation_hash, tax_date, tax_total ON tenant.pos_sales
  FOR EACH ROW EXECUTE FUNCTION tenant.pos_sale_tax_snapshot_guard();
CREATE OR REPLACE TRIGGER pos_sale_lines_tax_snapshot_guard BEFORE UPDATE OF taxable_amount, tax_amount, tax_components, hsn_sac_snapshot, tax_category_id, tax_rate_id,
  tax_rate, tax_classification, price_includes_tax, place_of_supply ON tenant.pos_sale_lines
  FOR EACH ROW EXECUTE FUNCTION tenant.pos_sale_tax_snapshot_guard();

CREATE INDEX IF NOT EXISTS pos_sales_tax_period_idx ON tenant.pos_sales (organization_id, sale_date, seller_tax_registration_id);

-- ============================================================ 5. returns

ALTER TABLE tenant.pos_return_lines
  ADD COLUMN IF NOT EXISTS taxable_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS tax_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS tax_components jsonb;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0089_pos_taxes.sql', 'pos-taxes') ON CONFLICT DO NOTHING;
