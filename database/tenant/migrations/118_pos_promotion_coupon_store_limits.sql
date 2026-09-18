BEGIN;

-- Matrix item #18, the per-store half. usage_limit_total and
-- usage_limit_per_customer already existed on pos_promotions/pos_coupons
-- (migration 113) and are already enforced at both preview time
-- (cart-pricing.js's evaluatePromotions/evaluateCoupon) and re-checked
-- under the record's own row lock at commit time (promotions.js's
-- commitPosPromotionApplications / coupons.js's commitPosCouponRedemption)
-- -- see the F280/Phase 4 comments there. usage_limit_per_store follows
-- the exact same two-check pattern, added here.
ALTER TABLE tenant.pos_promotions ADD COLUMN IF NOT EXISTS usage_limit_per_store integer
  CHECK (usage_limit_per_store IS NULL OR usage_limit_per_store > 0);
ALTER TABLE tenant.pos_coupons ADD COLUMN IF NOT EXISTS usage_limit_per_store integer
  CHECK (usage_limit_per_store IS NULL OR usage_limit_per_store > 0);

-- Counting store-scoped usage reuses the existing immutable-evidence
-- tables rather than a new counter column, exactly like the existing
-- customer_id-based per-customer count on these same two tables. Neither
-- table carried store_id before this migration, so it is added here,
-- denormalized from the cart/sale at the moment of application/redemption
-- (cart-pricing.js/promotions.js/coupons.js/cart.js) rather than re-derived
-- by a join on every check -- the same already-established precedent
-- customer_id itself set on these tables.
ALTER TABLE tenant.pos_promotion_applications ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE tenant.pos_coupon_redemptions ADD COLUMN IF NOT EXISTS store_id uuid;

CREATE INDEX IF NOT EXISTS pos_promotion_applications_store_idx
  ON tenant.pos_promotion_applications(organization_id, promotion_id, store_id);
CREATE INDEX IF NOT EXISTS pos_coupon_redemptions_store_idx
  ON tenant.pos_coupon_redemptions(organization_id, coupon_id, store_id, status);

COMMIT;
