-- 0095 POS Split Payments: one bill settled by up to three tenders — cash, card and UPI, one of each — still one sale and one invoice. The
-- cashier plans the split; each part is collected through its own method (cash custody, card terminal, UPI QR), one external attempt at a
-- time; the sale is finalised only when the confirmed parts add up to the bill exactly. Cancelling compensates every part already
-- collected (cash handed back, card / UPI refunded through the provider) and keeps the bill locked until each is resolved.
--
-- 1. The bill keeps its split plan (method, planned amount, collection order) and the plan's version, and whether it is paid single or split.
-- 2. One confirmed, not yet finalised part per method on a bill (cash already has one cash-in-hand per bill).
-- 3. Company policy: split payments on / off, and how a return's refund is shared across the sale's original tenders (in proportion to
--    each, or electronic tenders first).

-- ============================================================ 1. the split plan

ALTER TABLE tenant.pos_carts
  ADD COLUMN IF NOT EXISTS split_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS split_plan_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_mode text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_carts_split_plan_check') THEN
    ALTER TABLE tenant.pos_carts ADD CONSTRAINT pos_carts_split_plan_check CHECK (jsonb_typeof(split_plan) = 'array' AND jsonb_array_length(split_plan) <= 3
      AND (payment_mode IS NULL OR payment_mode IN ('single', 'split')));
  END IF;
END $$;

-- ============================================================ 2. one confirmed part per method

CREATE UNIQUE INDEX IF NOT EXISTS pos_payments_one_confirmed_method_uidx ON tenant.pos_payments (organization_id, cart_id, payment_method)
  WHERE sale_id IS NULL AND status = 'captured' AND payment_method <> 'cash' AND cart_id IS NOT NULL;

-- ============================================================ 3. policy

ALTER TABLE tenant.pos_settings
  ADD COLUMN IF NOT EXISTS split_payments_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS refund_allocation_policy text NOT NULL DEFAULT 'proportional';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_settings_refund_allocation_policy_check') THEN
    ALTER TABLE tenant.pos_settings ADD CONSTRAINT pos_settings_refund_allocation_policy_check CHECK (refund_allocation_policy IN ('proportional', 'electronic_first'));
  END IF;
END $$;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0095_pos_split_payments.sql', 'pos-split-payments') ON CONFLICT DO NOTHING;
