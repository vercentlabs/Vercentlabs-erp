-- 0091 POS Cart Discounts: one cashier discount on the eligible value of the whole bill — a percentage or a fixed amount off the bill —
-- allocated by the pricing engine across the eligible lines (so each line's GST, refunds and reports stay exact). Never a change to a
-- product's price, a price list or stock value.
--
-- 1. The bill keeps the discount as entered (type, value, reason code and note, approval), what it came to, the eligible value it was taken
--    from, and — when a supervisor approved it — the amount the approval covered (a later, larger discount needs approval again).
-- 2. Each bill line keeps its share of the bill discount and, when it is left out, why (a promotion it cannot be combined with, a price
--    override, a product that takes no manual discounts, nothing left to discount).
-- 3. The history of the bill discount: one row per discount as applied; changing it ends the row (replaced) and adds a new one, removing it
--    ends it (removed). At most one active row per bill. Each row holds the eligible value, the amount and the line allocations.
-- 4. A finished sale keeps the bill discount as charged (never changed afterwards); its lines already keep their shares (0090).
-- 5. A return line keeps the share of the bill discount it gives back.
-- 6. Company policy: whether a bill may be discounted to a zero total, and the reasons offered for a bill discount.

-- ============================================================ 1. the bill

ALTER TABLE tenant.pos_carts
  ADD COLUMN IF NOT EXISTS cart_discount_reason_code text,
  ADD COLUMN IF NOT EXISTS cart_discount_note text,
  ADD COLUMN IF NOT EXISTS cart_discount_total numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cart_discount_eligible_base numeric(20,6),
  ADD COLUMN IF NOT EXISTS cart_discount_approved_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS cart_discount_issue_code text,
  ADD COLUMN IF NOT EXISTS cart_discount_issue_message text;

-- ============================================================ 2. bill lines

ALTER TABLE tenant.pos_cart_lines
  ADD COLUMN IF NOT EXISTS cart_discount_amount numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cart_discount_excluded_reason text;

-- ============================================================ 3. history

CREATE TABLE IF NOT EXISTS tenant.pos_cart_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cart_id uuid NOT NULL REFERENCES tenant.pos_carts(id) ON DELETE CASCADE,
  adjustment_type text NOT NULL DEFAULT 'manual_cart_discount' CHECK (adjustment_type IN ('manual_cart_discount')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'replaced', 'removed', 'completed')),
  discount_type text NOT NULL CHECK (discount_type IN ('percent', 'amount')),
  entered_value numeric(20,6) NOT NULL CHECK (entered_value > 0),
  eligible_base_amount numeric(20,6) NOT NULL DEFAULT 0,
  calculated_discount_amount numeric(20,6) NOT NULL DEFAULT 0,
  currency_code text,
  reason_code text,
  reason_note text,
  approval_id uuid REFERENCES tenant.pos_permission_approvals(id),
  allocations jsonb NOT NULL DEFAULT '[]'::jsonb,
  allocation_version integer NOT NULL DEFAULT 1,
  cart_version integer,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ended_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  CONSTRAINT pos_cart_adjustments_percent_check CHECK (discount_type <> 'percent' OR entered_value <= 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_cart_adjustments_one_active_uidx ON tenant.pos_cart_adjustments (organization_id, cart_id, adjustment_type) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS pos_cart_adjustments_cart_idx ON tenant.pos_cart_adjustments (organization_id, cart_id, created_at);
ALTER TABLE tenant.pos_cart_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_cart_adjustments FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'pos_cart_adjustments' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.pos_cart_adjustments USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.pos_cart_adjustments TO vercent_app;
GRANT SELECT ON tenant.pos_cart_adjustments TO vercent_worker;

-- A bill discount already on a bill (before this migration) becomes its first history row.
INSERT INTO tenant.pos_cart_adjustments (organization_id, cart_id, discount_type, entered_value, currency_code, reason_note, approval_id, cart_version, created_by)
SELECT cart.organization_id, cart.id, cart.cart_discount_type, cart.cart_discount_value, cart.currency_code, cart.cart_discount_reason, cart.cart_discount_approval_id,
       cart.version, cart.cashier_user_id
  FROM tenant.pos_carts cart
 WHERE cart.cart_discount_type IS NOT NULL AND cart.cart_discount_value > 0 AND (cart.cart_discount_type <> 'percent' OR cart.cart_discount_value <= 100)
   AND NOT EXISTS (SELECT 1 FROM tenant.pos_cart_adjustments adjustment WHERE adjustment.organization_id = cart.organization_id AND adjustment.cart_id = cart.id);

-- ============================================================ 4. finished sales

ALTER TABLE tenant.pos_sales
  ADD COLUMN IF NOT EXISTS cart_discount_type text,
  ADD COLUMN IF NOT EXISTS cart_discount_value numeric(20,6),
  ADD COLUMN IF NOT EXISTS cart_discount_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS cart_discount_eligible_base numeric(20,6),
  ADD COLUMN IF NOT EXISTS cart_discount_reason_code text,
  ADD COLUMN IF NOT EXISTS cart_discount_note text,
  ADD COLUMN IF NOT EXISTS cart_discount_approval_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sales_cart_discount_type_check') THEN
    ALTER TABLE tenant.pos_sales ADD CONSTRAINT pos_sales_cart_discount_type_check CHECK (cart_discount_type IS NULL OR cart_discount_type IN ('percent', 'amount'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION tenant.pos_sale_cart_discount_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cart_discount_type IS DISTINCT FROM OLD.cart_discount_type OR NEW.cart_discount_value IS DISTINCT FROM OLD.cart_discount_value
     OR NEW.cart_discount_amount IS DISTINCT FROM OLD.cart_discount_amount OR NEW.cart_discount_eligible_base IS DISTINCT FROM OLD.cart_discount_eligible_base
     OR NEW.cart_discount_reason_code IS DISTINCT FROM OLD.cart_discount_reason_code OR NEW.cart_discount_note IS DISTINCT FROM OLD.cart_discount_note
     OR NEW.cart_discount_approval_id IS DISTINCT FROM OLD.cart_discount_approval_id THEN
    RAISE EXCEPTION 'A completed sale''s bill discount cannot be changed; use a return.' USING ERRCODE = 'check_violation', CONSTRAINT = 'pos_sale_cart_discount_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER pos_sales_cart_discount_guard BEFORE UPDATE OF cart_discount_type, cart_discount_value, cart_discount_amount, cart_discount_eligible_base,
  cart_discount_reason_code, cart_discount_note, cart_discount_approval_id ON tenant.pos_sales FOR EACH ROW EXECUTE FUNCTION tenant.pos_sale_cart_discount_guard();

CREATE INDEX IF NOT EXISTS pos_sales_cart_discount_idx ON tenant.pos_sales (organization_id, sale_date) WHERE cart_discount_amount > 0;

-- ============================================================ 5. returns

ALTER TABLE tenant.pos_return_lines ADD COLUMN IF NOT EXISTS cart_discount_amount numeric(20,6);

-- ============================================================ 6. policy

ALTER TABLE tenant.pos_settings
  ADD COLUMN IF NOT EXISTS allow_zero_total_sale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cart_discount_reasons jsonb NOT NULL DEFAULT '[
    {"code": "CUSTOMER_GOODWILL", "label": "Customer goodwill"},
    {"code": "BULK_PURCHASE", "label": "Bulk purchase"},
    {"code": "COMPLAINT", "label": "Customer complaint"},
    {"code": "SPECIAL_NEGOTIATION", "label": "Special negotiation"},
    {"code": "PROMOTIONAL_EXCEPTION", "label": "Promotional exception"},
    {"code": "PRICE_MATCH", "label": "Price matching"},
    {"code": "OTHER", "label": "Other", "requiresNote": true}
  ]'::jsonb;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0091_pos_cart_discounts.sql', 'pos-cart-discounts') ON CONFLICT DO NOTHING;
