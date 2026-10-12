-- 0088 Named Customer (POS): a registered customer on a bill is always a Customer Master customer (tenant.business_parties) — POS keeps no
-- customer list of its own, only the bill's choice of customer, billing address and the price list in effect.
--
-- 1. The bill's billing address (one of the customer's own active billing addresses, chosen at the counter; none on a walk-in bill) and the
--    price list its prices came from (the customer's own price list when it prices the item, else the outlet's).
-- 2. The sale's named-customer snapshot, alongside the 0087 buyer snapshot: customer number, customer type (individual / business), the
--    billing address it was invoiced to and the effective price list — kept as they were at completion, never rewritten by later edits to
--    the customer.
-- 3. Quick-create retries: one counter request (idempotency key) creates one customer, however often the cashier's device resends it.
-- 4. Search: phone numbers are matched digits-only (spaces, dashes and brackets ignored).

-- ============================================================ 1. the bill's billing address and price list

ALTER TABLE tenant.pos_carts
  ADD COLUMN IF NOT EXISTS billing_address_id uuid REFERENCES tenant.addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS effective_price_list_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_carts_billing_address_mode_check') THEN
    -- A billing address is a registered customer's; a walk-in bill keeps its own buyer details instead.
    ALTER TABLE tenant.pos_carts ADD CONSTRAINT pos_carts_billing_address_mode_check CHECK (billing_address_id IS NULL OR customer_mode = 'registered');
  END IF;
END $$;

-- ============================================================ 2. the sale's named-customer snapshot

ALTER TABLE tenant.pos_sales
  ADD COLUMN IF NOT EXISTS customer_code_snapshot text,
  ADD COLUMN IF NOT EXISTS customer_type_snapshot text,
  ADD COLUMN IF NOT EXISTS billing_address_id_snapshot uuid,
  ADD COLUMN IF NOT EXISTS price_list_id_snapshot uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sales_customer_type_check') THEN
    ALTER TABLE tenant.pos_sales ADD CONSTRAINT pos_sales_customer_type_check CHECK (
      customer_type_snapshot IS NULL OR (customer_type_snapshot IN ('individual', 'business') AND customer_mode = 'registered'));
  END IF;
END $$;

-- The 0087 guard, now also covering the named-customer snapshot.
CREATE OR REPLACE FUNCTION tenant.pos_sales_buyer_snapshot_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.customer_mode IS DISTINCT FROM OLD.customer_mode
     OR NEW.buyer_name_snapshot IS DISTINCT FROM OLD.buyer_name_snapshot OR NEW.buyer_tax_details IS DISTINCT FROM OLD.buyer_tax_details
     OR NEW.billing_address_snapshot IS DISTINCT FROM OLD.billing_address_snapshot OR NEW.tax_treatment_snapshot IS DISTINCT FROM OLD.tax_treatment_snapshot
     OR NEW.customer_code_snapshot IS DISTINCT FROM OLD.customer_code_snapshot OR NEW.customer_type_snapshot IS DISTINCT FROM OLD.customer_type_snapshot
     OR NEW.billing_address_id_snapshot IS DISTINCT FROM OLD.billing_address_id_snapshot OR NEW.price_list_id_snapshot IS DISTINCT FROM OLD.price_list_id_snapshot THEN
    RAISE EXCEPTION 'A completed sale''s buyer cannot be changed; use a correction document.' USING ERRCODE = 'check_violation', CONSTRAINT = 'pos_sales_buyer_snapshot_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER pos_sales_buyer_snapshot_guard BEFORE UPDATE OF customer_id, customer_mode, buyer_name_snapshot, buyer_tax_details, billing_address_snapshot,
  tax_treatment_snapshot, customer_code_snapshot, customer_type_snapshot, billing_address_id_snapshot, price_list_id_snapshot ON tenant.pos_sales
  FOR EACH ROW EXECUTE FUNCTION tenant.pos_sales_buyer_snapshot_guard();

-- A customer's purchase history reads their finished sales, newest first.
CREATE INDEX IF NOT EXISTS pos_sales_customer_history_idx ON tenant.pos_sales (organization_id, customer_id, sale_date DESC) WHERE customer_id IS NOT NULL;

-- ============================================================ 3. quick-create retries

CREATE TABLE IF NOT EXISTS tenant.pos_customer_quick_creates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  customer_id uuid NOT NULL REFERENCES tenant.business_parties(id) ON DELETE CASCADE,
  store_id uuid REFERENCES tenant.pos_stores(id) ON DELETE SET NULL,
  cart_id uuid REFERENCES tenant.pos_carts(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
ALTER TABLE tenant.pos_customer_quick_creates ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_customer_quick_creates FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'pos_customer_quick_creates' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.pos_customer_quick_creates USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT ON tenant.pos_customer_quick_creates TO vercent_app;

-- ============================================================ 4. search

CREATE INDEX IF NOT EXISTS business_parties_pos_phone_idx ON tenant.business_parties (organization_id, tenant.crm_normalize_phone(phone))
  WHERE phone IS NOT NULL AND party_type IN ('customer', 'both');

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0088_pos_named_customer.sql', 'pos-named-customer') ON CONFLICT DO NOTHING;
