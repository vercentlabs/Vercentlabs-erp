-- 0087 Walk-In Customer (POS): a sale without a customer record is the default — a transaction context, never a customer. No placeholder
-- "walk-in" customer, no customer per anonymous sale: the bill and the sale say walk-in and carry no customer_id; the shared Customer Master
-- stays the only source of registered customers.
--
-- 1. Customer mode on the bill and the sale (walk_in / registered), kept consistent with customer_id by the database and filled from it when a
--    caller does not say (an older code path that only sets customer_id).
-- 2. Optional, transaction-level buyer details on a walk-in bill (a name and an address for the invoice — never a GSTIN: a business invoice
--    is a registered business customer's) and an optional receipt contact (phone / email) with its receipt-delivery consent — never marketing
--    consent, never a customer profile. The customer context version moves on every change of either.
-- 3. The sale's buyer snapshot: mode, buyer name, tax details, billing address and tax treatment as they were at completion — never changed
--    afterwards, whatever later happens to the customer record (corrections go through their own documents).
-- 4. Digital receipt deliveries: one row per receipt sent (or not: no provider configured), with the destination, consent and outcome.
-- 5. Outlet policy (allow walk-in sales, allow a buyer name, allow receipt contact capture) and the company's amount from which a walk-in
--    invoice needs the buyer's name and address (tax policy, default 50,000). The outlet's old "default customer" placeholder is no longer used.

-- ============================================================ 1. customer mode

ALTER TABLE tenant.pos_carts
  ADD COLUMN IF NOT EXISTS customer_mode text,
  ADD COLUMN IF NOT EXISTS buyer_name text,
  ADD COLUMN IF NOT EXISTS buyer_address jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS receipt_contact_phone text,
  ADD COLUMN IF NOT EXISTS receipt_contact_email text,
  ADD COLUMN IF NOT EXISTS receipt_delivery_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_context_version integer NOT NULL DEFAULT 1;
ALTER TABLE tenant.pos_sales
  ADD COLUMN IF NOT EXISTS customer_mode text,
  ADD COLUMN IF NOT EXISTS buyer_name_snapshot text,
  ADD COLUMN IF NOT EXISTS buyer_tax_details jsonb,
  ADD COLUMN IF NOT EXISTS billing_address_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS tax_treatment_snapshot text;

UPDATE tenant.pos_carts SET customer_mode = CASE WHEN customer_id IS NULL THEN 'walk_in' ELSE 'registered' END WHERE customer_mode IS NULL;
UPDATE tenant.pos_sales SET customer_mode = CASE WHEN customer_id IS NULL THEN 'walk_in' ELSE 'registered' END,
                            tax_treatment_snapshot = COALESCE(tax_treatment_snapshot, 'b2c') WHERE customer_mode IS NULL;

-- A caller that only sets customer_id gets the matching mode.
CREATE OR REPLACE FUNCTION tenant.pos_customer_mode_fill() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_mode IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.customer_id IS DISTINCT FROM OLD.customer_id AND NEW.customer_mode IS NOT DISTINCT FROM OLD.customer_mode) THEN
    NEW.customer_mode := CASE WHEN NEW.customer_id IS NULL THEN 'walk_in' ELSE 'registered' END;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER pos_carts_customer_mode_fill BEFORE INSERT OR UPDATE OF customer_id, customer_mode ON tenant.pos_carts
  FOR EACH ROW EXECUTE FUNCTION tenant.pos_customer_mode_fill();
CREATE OR REPLACE TRIGGER pos_sales_customer_mode_fill BEFORE INSERT ON tenant.pos_sales
  FOR EACH ROW EXECUTE FUNCTION tenant.pos_customer_mode_fill();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_carts_customer_mode_check') THEN
    ALTER TABLE tenant.pos_carts ADD CONSTRAINT pos_carts_customer_mode_check CHECK (
      (customer_mode = 'walk_in' AND customer_id IS NULL) OR (customer_mode = 'registered' AND customer_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sales_customer_mode_check') THEN
    ALTER TABLE tenant.pos_sales ADD CONSTRAINT pos_sales_customer_mode_check CHECK (
      (customer_mode = 'walk_in' AND customer_id IS NULL) OR (customer_mode = 'registered' AND customer_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_carts_buyer_details_check') THEN
    -- Buyer details and receipt contact belong to a walk-in bill; a registered bill uses the customer's own record.
    ALTER TABLE tenant.pos_carts ADD CONSTRAINT pos_carts_buyer_details_check CHECK (
      (buyer_name IS NULL OR char_length(buyer_name) <= 200)
      AND (receipt_contact_phone IS NULL OR receipt_contact_phone ~ '^\+?[0-9]{7,15}$')
      AND (receipt_contact_email IS NULL OR (char_length(receipt_contact_email) <= 254 AND receipt_contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'))
      AND (customer_mode = 'walk_in' OR (buyer_name IS NULL AND buyer_address = '{}'::jsonb))
      AND (receipt_delivery_consent OR (receipt_contact_phone IS NULL AND receipt_contact_email IS NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sales_tax_treatment_check') THEN
    ALTER TABLE tenant.pos_sales ADD CONSTRAINT pos_sales_tax_treatment_check CHECK (tax_treatment_snapshot IS NULL OR tax_treatment_snapshot IN ('b2c', 'b2b'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS pos_sales_customer_mode_idx ON tenant.pos_sales (organization_id, customer_mode, sale_date);

-- ============================================================ 3. the sale's buyer snapshot never changes

CREATE OR REPLACE FUNCTION tenant.pos_sales_buyer_snapshot_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.customer_mode IS DISTINCT FROM OLD.customer_mode
     OR NEW.buyer_name_snapshot IS DISTINCT FROM OLD.buyer_name_snapshot OR NEW.buyer_tax_details IS DISTINCT FROM OLD.buyer_tax_details
     OR NEW.billing_address_snapshot IS DISTINCT FROM OLD.billing_address_snapshot OR NEW.tax_treatment_snapshot IS DISTINCT FROM OLD.tax_treatment_snapshot THEN
    RAISE EXCEPTION 'A completed sale''s buyer cannot be changed; use a correction document.' USING ERRCODE = 'check_violation', CONSTRAINT = 'pos_sales_buyer_snapshot_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER pos_sales_buyer_snapshot_guard BEFORE UPDATE OF customer_id, customer_mode, buyer_name_snapshot, buyer_tax_details, billing_address_snapshot,
  tax_treatment_snapshot ON tenant.pos_sales FOR EACH ROW EXECUTE FUNCTION tenant.pos_sales_buyer_snapshot_guard();

-- ============================================================ 4. digital receipt deliveries

CREATE TABLE IF NOT EXISTS tenant.pos_receipt_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES tenant.pos_sales(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  destination text NOT NULL CHECK (char_length(destination) <= 254),
  consent boolean NOT NULL CHECK (consent),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'not_configured')),
  error text,
  attempts integer NOT NULL DEFAULT 0,
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS pos_receipt_deliveries_sale_idx ON tenant.pos_receipt_deliveries (organization_id, sale_id);
ALTER TABLE tenant.pos_receipt_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_receipt_deliveries FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'pos_receipt_deliveries' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.pos_receipt_deliveries USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.pos_receipt_deliveries TO vercent_app;
GRANT SELECT ON tenant.pos_receipt_deliveries TO vercent_worker;

-- ============================================================ 5. policy

ALTER TABLE tenant.pos_stores
  ADD COLUMN IF NOT EXISTS allow_walk_in_sales boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_optional_buyer_name boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_receipt_contact_capture boolean NOT NULL DEFAULT true;
ALTER TABLE tenant.pos_settings
  ADD COLUMN IF NOT EXISTS walk_in_buyer_details_required_above numeric(20,2) DEFAULT 50000;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_settings_walk_in_threshold_check') THEN
    ALTER TABLE tenant.pos_settings ADD CONSTRAINT pos_settings_walk_in_threshold_check CHECK (walk_in_buyer_details_required_above IS NULL OR walk_in_buyer_details_required_above >= 0);
  END IF;
END $$;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0087_pos_walk_in_customer.sql', 'pos-walk-in-customer') ON CONFLICT DO NOTHING;
