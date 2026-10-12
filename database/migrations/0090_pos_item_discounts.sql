-- 0090 POS Item Discounts: a cashier's discount on one bill line — a percentage or a fixed amount off that line — controlled by the shared
-- product policy, the company's stacking rule and the cashier's permission profile. Never a change to the product's price, a price list or
-- stock value.
--
-- 1. Product discount policy, kept on the shared Item Master and its categories: whether a manual discount is allowed, the largest
--    percentage, and the lowest price a unit may be sold at after discounts.
-- 2. Company policy: how a manual discount meets an automatic promotion on the same line (non-stackable by default; stackable; or the manual
--    discount replaces the promotion), whether a line may be discounted to zero, whether a reason is always required, and the reason codes.
-- 3. A cashier's limits: besides the percentage and the per-line amount, a ceiling on all manual discounts on one bill (when unset, the
--    per-line amount also caps the bill, as before).
-- 4. The bill line keeps what the cashier entered — the type (percent / amount) and value — so a percentage follows quantity changes and a
--    fixed amount stays fixed; plus the reason code and note.
-- 5. A finished sale line keeps its discount history as charged, never changed afterwards: the gross value, the manual discount (type,
--    value, amount, reason, approval), the promotion and the share of the bill discount.
-- 6. A return line keeps the share of the original discounts it gives back, for net discount reporting.

-- ============================================================ 1. product policy

ALTER TABLE tenant.items
  ADD COLUMN IF NOT EXISTS manual_discount_allowed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_manual_discount_percent numeric(7,4),
  ADD COLUMN IF NOT EXISTS min_selling_price numeric(20,6);
ALTER TABLE tenant.item_groups
  ADD COLUMN IF NOT EXISTS manual_discount_allowed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_manual_discount_percent numeric(7,4);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_manual_discount_policy_check') THEN
    ALTER TABLE tenant.items ADD CONSTRAINT items_manual_discount_policy_check CHECK (
      (max_manual_discount_percent IS NULL OR max_manual_discount_percent BETWEEN 0 AND 100) AND (min_selling_price IS NULL OR min_selling_price >= 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_groups_manual_discount_policy_check') THEN
    ALTER TABLE tenant.item_groups ADD CONSTRAINT item_groups_manual_discount_policy_check CHECK (max_manual_discount_percent IS NULL OR max_manual_discount_percent BETWEEN 0 AND 100);
  END IF;
END $$;

-- ============================================================ 2. company policy

ALTER TABLE tenant.pos_settings
  ADD COLUMN IF NOT EXISTS manual_discount_stacking text NOT NULL DEFAULT 'non_stackable',
  ADD COLUMN IF NOT EXISTS allow_full_line_discount boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discount_reason_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discount_reasons jsonb NOT NULL DEFAULT '[
    {"code": "CUSTOMER_GOODWILL", "label": "Customer goodwill"},
    {"code": "DAMAGED_PACKAGING", "label": "Damaged packaging"},
    {"code": "MINOR_DEFECT", "label": "Minor product defect"},
    {"code": "PRICE_MATCH", "label": "Price matching"},
    {"code": "COMPLAINT", "label": "Customer complaint resolution"},
    {"code": "MANAGER_SPECIAL", "label": "Manager-approved special discount"},
    {"code": "OTHER", "label": "Other", "requiresNote": true}
  ]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_settings_manual_discount_stacking_check') THEN
    ALTER TABLE tenant.pos_settings ADD CONSTRAINT pos_settings_manual_discount_stacking_check
      CHECK (manual_discount_stacking IN ('non_stackable', 'stackable', 'manual_replaces_automatic'));
  END IF;
END $$;

-- ============================================================ 3. cashier limits

ALTER TABLE tenant.pos_permission_profile_grants ADD COLUMN IF NOT EXISTS max_aggregate_amount numeric(20,6);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_permission_profile_grants_aggregate_check') THEN
    ALTER TABLE tenant.pos_permission_profile_grants ADD CONSTRAINT pos_permission_profile_grants_aggregate_check CHECK (max_aggregate_amount IS NULL OR max_aggregate_amount >= 0);
  END IF;
END $$;

-- ============================================================ 4. the bill line's manual discount

ALTER TABLE tenant.pos_cart_lines
  ADD COLUMN IF NOT EXISTS manual_discount_type text,
  ADD COLUMN IF NOT EXISTS manual_discount_value numeric(20,6),
  ADD COLUMN IF NOT EXISTS manual_discount_reason_code text,
  ADD COLUMN IF NOT EXISTS manual_discount_note text;

-- A discount recorded before this release was an amount: it stays that amount.
UPDATE tenant.pos_cart_lines SET manual_discount_type = 'amount', manual_discount_value = manual_discount_amount
 WHERE manual_discount_type IS NULL AND COALESCE(manual_discount_amount, 0) > 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_cart_lines_manual_discount_check') THEN
    ALTER TABLE tenant.pos_cart_lines ADD CONSTRAINT pos_cart_lines_manual_discount_check CHECK (
      (manual_discount_type IS NULL AND manual_discount_value IS NULL)
      OR (manual_discount_type = 'percent' AND manual_discount_value > 0 AND manual_discount_value <= 100)
      OR (manual_discount_type = 'amount' AND manual_discount_value > 0));
  END IF;
END $$;

-- ============================================================ 5. the sale line's discount snapshot

ALTER TABLE tenant.pos_sale_lines
  ADD COLUMN IF NOT EXISTS gross_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS list_unit_price numeric(20,6),
  ADD COLUMN IF NOT EXISTS cart_discount_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS manual_discount_type text,
  ADD COLUMN IF NOT EXISTS manual_discount_value numeric(20,6),
  ADD COLUMN IF NOT EXISTS manual_discount_reason_code text,
  ADD COLUMN IF NOT EXISTS manual_discount_note text,
  ADD COLUMN IF NOT EXISTS manual_discount_approval_id uuid;

CREATE OR REPLACE FUNCTION tenant.pos_sale_line_discount_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.gross_amount IS DISTINCT FROM OLD.gross_amount OR NEW.list_unit_price IS DISTINCT FROM OLD.list_unit_price
     OR NEW.cart_discount_amount IS DISTINCT FROM OLD.cart_discount_amount OR NEW.manual_discount_type IS DISTINCT FROM OLD.manual_discount_type
     OR NEW.manual_discount_value IS DISTINCT FROM OLD.manual_discount_value OR NEW.manual_discount_amount IS DISTINCT FROM OLD.manual_discount_amount
     OR NEW.manual_discount_reason_code IS DISTINCT FROM OLD.manual_discount_reason_code OR NEW.manual_discount_note IS DISTINCT FROM OLD.manual_discount_note
     OR NEW.manual_discount_approval_id IS DISTINCT FROM OLD.manual_discount_approval_id OR NEW.promotion_discount_amount IS DISTINCT FROM OLD.promotion_discount_amount
     OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount OR NEW.unit_price IS DISTINCT FROM OLD.unit_price OR NEW.line_total IS DISTINCT FROM OLD.line_total THEN
    RAISE EXCEPTION 'A completed sale''s discounts cannot be changed; use a return.' USING ERRCODE = 'check_violation', CONSTRAINT = 'pos_sale_line_discount_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER pos_sale_lines_discount_guard BEFORE UPDATE OF gross_amount, list_unit_price, cart_discount_amount, manual_discount_type, manual_discount_value,
  manual_discount_amount, manual_discount_reason_code, manual_discount_note, manual_discount_approval_id, promotion_discount_amount, discount_amount, unit_price, line_total
  ON tenant.pos_sale_lines FOR EACH ROW EXECUTE FUNCTION tenant.pos_sale_line_discount_guard();

CREATE INDEX IF NOT EXISTS pos_sale_lines_manual_discount_idx ON tenant.pos_sale_lines (organization_id, sale_id) WHERE manual_discount_amount > 0;

-- ============================================================ 6. returns

ALTER TABLE tenant.pos_return_lines ADD COLUMN IF NOT EXISTS discount_amount numeric(20,6);

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0090_pos_item_discounts.sql', 'pos-item-discounts') ON CONFLICT DO NOTHING;
