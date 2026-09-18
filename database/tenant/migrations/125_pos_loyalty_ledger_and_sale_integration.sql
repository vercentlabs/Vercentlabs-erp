BEGIN;

-- F306 — Loyalty, PART 2: the immutable ledger and the cart/sale/sale-line
-- columns that integrate it into the checkout pipeline.
--
-- LEDGER DESIGN: entry_type distinguishes the four things that can ever
-- happen to a customer's points, and `points` is SIGNED (positive credits
-- the balance, negative debits it) so balance is always
-- `sum(points)` -- a single, unambiguous derivation with no separate
-- sign-lookup-by-type step required at read time. earn/adjust(credit) are
-- positive; redeem/expire/reverse_earn are negative; reverse_redeem
-- (crediting back points spent on a since-returned line) is positive.
-- The running balance in tenant.pos_loyalty_balances is ONLY ever updated
-- in the same statement/transaction as a ledger insert, under that
-- customer's balance row lock (see features/loyalty.js) -- it is never
-- written independently, so it can never drift from sum(points).
--
-- ONE EARN ROW PER SALE LINE (not one per sale): this is what makes a
-- PARTIAL return's proportional reversal possible without re-deriving
-- anything -- a return line already identifies its own sale_line_id, so
-- reversal looks up that exact line's own earn row and reverses a
-- quantity-proportional share of ITS points, referencing that row as
-- original_entry_id. ONE REDEEM ROW PER SALE (redemption is a single
-- cashier action against the whole cart, not per line -- see
-- cart-pricing.js's evaluatePosLoyaltyRedemption).
CREATE TABLE IF NOT EXISTS tenant.pos_loyalty_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  program_id uuid REFERENCES tenant.pos_loyalty_programs(id) ON DELETE SET NULL,
  customer_id uuid NOT NULL REFERENCES tenant.business_parties(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('earn','redeem','reverse_earn','reverse_redeem','expire','adjust')),
  points numeric(18,6) NOT NULL CHECK (points <> 0),
  sale_id uuid REFERENCES tenant.pos_sales(id) ON DELETE SET NULL,
  sale_line_id uuid REFERENCES tenant.pos_sale_lines(id) ON DELETE SET NULL,
  return_id uuid REFERENCES tenant.pos_returns(id) ON DELETE SET NULL,
  original_entry_id uuid REFERENCES tenant.pos_loyalty_ledger(id),
  reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_loyalty_ledger_customer_idx
  ON tenant.pos_loyalty_ledger(organization_id,customer_id,created_at);
CREATE INDEX IF NOT EXISTS pos_loyalty_ledger_sale_idx
  ON tenant.pos_loyalty_ledger(organization_id,sale_id);

-- Idempotency guards (defense-in-depth alongside the sale-completion-level
-- idempotency key check in beginIdempotentOperation): a replay of the same
-- sale completion, or an offline-sync replay that calls the earn/redeem
-- commit function directly, can never insert a second earn row for the
-- same sale line or a second redeem row for the same sale.
CREATE UNIQUE INDEX IF NOT EXISTS pos_loyalty_ledger_earn_line_uidx
  ON tenant.pos_loyalty_ledger(organization_id,sale_line_id)
  WHERE entry_type='earn' AND sale_line_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pos_loyalty_ledger_redeem_sale_uidx
  ON tenant.pos_loyalty_ledger(organization_id,sale_id)
  WHERE entry_type='redeem' AND sale_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pos_loyalty_ledger_reverse_redeem_return_uidx
  ON tenant.pos_loyalty_ledger(organization_id,return_id)
  WHERE entry_type='reverse_redeem' AND return_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pos_loyalty_ledger_reverse_earn_line_return_uidx
  ON tenant.pos_loyalty_ledger(organization_id,return_id,sale_line_id)
  WHERE entry_type='reverse_earn' AND return_id IS NOT NULL AND sale_line_id IS NOT NULL;

-- Cart: the cashier's requested redemption (validated/capped by
-- redeemPosCartLoyaltyPoints, re-evaluated on every reprice exactly like
-- coupon_code is). NULL means no redemption requested.
ALTER TABLE tenant.pos_carts ADD COLUMN IF NOT EXISTS loyalty_redeem_points numeric(18,6) CHECK (loyalty_redeem_points IS NULL OR loyalty_redeem_points > 0);
ALTER TABLE tenant.pos_cart_lines ADD COLUMN IF NOT EXISTS loyalty_redeem_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (loyalty_redeem_amount >= 0);

-- Sale/sale-line evidence, baked in at completion time (same rationale as
-- 113's manual/promotion/coupon discount columns): a receipt or audit must
-- be able to show exactly what loyalty effect a completed sale had without
-- re-deriving it from the ledger or from program config that may since
-- have changed.
ALTER TABLE tenant.pos_sales ADD COLUMN IF NOT EXISTS loyalty_program_id uuid REFERENCES tenant.pos_loyalty_programs(id) ON DELETE SET NULL;
ALTER TABLE tenant.pos_sales ADD COLUMN IF NOT EXISTS loyalty_points_earned numeric(18,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.pos_sales ADD COLUMN IF NOT EXISTS loyalty_redeem_points numeric(18,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.pos_sales ADD COLUMN IF NOT EXISTS loyalty_redeem_amount numeric(20,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.pos_sale_lines ADD COLUMN IF NOT EXISTS loyalty_points_earned numeric(18,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.pos_sale_lines ADD COLUMN IF NOT EXISTS loyalty_redeem_points numeric(18,6) NOT NULL DEFAULT 0;
ALTER TABLE tenant.pos_sale_lines ADD COLUMN IF NOT EXISTS loyalty_redeem_amount numeric(20,6) NOT NULL DEFAULT 0;

ALTER TABLE tenant.pos_loyalty_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_loyalty_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_loyalty_ledger_organization_isolation ON tenant.pos_loyalty_ledger;
CREATE POLICY pos_loyalty_ledger_organization_isolation ON tenant.pos_loyalty_ledger
  USING (organization_id=tenant.current_organization_id())
  WITH CHECK (organization_id=tenant.current_organization_id());

COMMIT;
