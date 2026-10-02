// F281 — coupon definition CRUD plus the reservation/commit/release
// redemption lifecycle. Configuration is gated on pos.settings.manage;
// attaching an already-configured coupon to a cart during checkout only
// needs pos.sale.create (cart.js) since eligibility is enforced by the
// coupon's own rules, not by cashier authority.
import { posError } from "../shared/errors.js";

// Called inside sale-completion's own transaction, AFTER the cart row is
// already locked. Re-validates the usage limit under the coupon's own row
// lock (closing the "two terminals racing for the last available use"
// race a preview-time check alone cannot close) and flips the cart's
// 'reserved' redemption row to 'committed'. Returns null if the cart had
// no coupon attached.
export async function commitPosCouponRedemption(client, context, cartId, saleId, discountAmount) {
  const redemption = await client.query(
    `SELECT * FROM tenant.pos_coupon_redemptions WHERE organization_id=$1 AND cart_id=$2 AND status='reserved' FOR UPDATE`,
    [context.organizationId, cartId],
  );
  const row = redemption.rows[0];
  if (!row) return null;
  const coupon = await client.query(
    `SELECT id,usage_limit_total,usage_limit_per_customer,usage_limit_per_store,committed_count
     FROM tenant.pos_coupons WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, row.coupon_id],
  );
  if (!coupon.rows[0]) throw posError(409, "The applied coupon no longer exists.", "POS_COUPON_NOT_FOUND");
  if (coupon.rows[0].usage_limit_total != null && coupon.rows[0].committed_count >= coupon.rows[0].usage_limit_total) {
    throw posError(409, "This coupon reached its usage limit before checkout completed.", "POS_COUPON_USAGE_LIMIT_REACHED");
  }
  // Concurrency (F281): the preview-time check in cart-pricing.js's
  // evaluateCoupon() re-runs on every reprice, but two terminals can BOTH
  // pass that preview for the same customer's last remaining use and then
  // both reach completion. Holding the coupon's own row lock (FOR UPDATE
  // above) serializes every commit for this coupon, so re-checking the
  // per-customer count here is race-free -- exactly one of two racing
  // completions for the same customer's final use can pass this check.
  if (row.customer_id && coupon.rows[0].usage_limit_per_customer != null) {
    const perCustomer = await client.query(
      `SELECT count(*)::int AS count FROM tenant.pos_coupon_redemptions
       WHERE organization_id=$1 AND coupon_id=$2 AND customer_id=$3 AND status='committed'`,
      [context.organizationId, row.coupon_id, row.customer_id],
    );
    if (Number(perCustomer.rows[0].count) >= coupon.rows[0].usage_limit_per_customer) {
      throw posError(409, "This customer already reached this coupon's usage limit before checkout completed.", "POS_COUPON_CUSTOMER_LIMIT_REACHED");
    }
  }
  // Matrix item #18 (per-store half): same race, same fix, keyed on
  // row.store_id -- stamped onto the redemption row at reservation time
  // (cart.js's applyPosCartCoupon), the same already-established precedent
  // row.customer_id itself follows.
  if (row.store_id && coupon.rows[0].usage_limit_per_store != null) {
    const perStore = await client.query(
      `SELECT count(*)::int AS count FROM tenant.pos_coupon_redemptions
       WHERE organization_id=$1 AND coupon_id=$2 AND store_id=$3 AND status='committed'`,
      [context.organizationId, row.coupon_id, row.store_id],
    );
    if (Number(perStore.rows[0].count) >= coupon.rows[0].usage_limit_per_store) {
      throw posError(409, "This coupon reached its per-store usage limit before checkout completed.", "POS_COUPON_STORE_LIMIT_REACHED");
    }
  }
  await client.query(`UPDATE tenant.pos_coupons SET committed_count=committed_count+1 WHERE organization_id=$1 AND id=$2`, [
    context.organizationId,
    row.coupon_id,
  ]);
  await client.query(
    `UPDATE tenant.pos_coupon_redemptions SET status='committed',sale_id=$3,discount_amount=$4,committed_at=now()
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, row.id, saleId, discountAmount],
  );
  return { couponId: row.coupon_id, redemptionId: row.id };
}

// F281 reversal dependency: releasing a coupon's committed_count when a
// sale it was redeemed on is FULLY returned. Only implemented for the
// full-return case (an already-supported, already-lockable path through
// completePointOfSaleReturn); a partial return leaves the redemption
// committed as-is -- proportional partial-reversal is intentionally not
// implemented, since it would require deciding how to re-derive a
// *fractional* coupon usage credit, which is an unspecified business rule.
export async function releasePosCouponRedemptionForFullReturn(client, context, saleId) {
  const redemption = await client.query(
    `SELECT * FROM tenant.pos_coupon_redemptions WHERE organization_id=$1 AND sale_id=$2 AND status='committed' FOR UPDATE`,
    [context.organizationId, saleId],
  );
  const row = redemption.rows[0];
  if (!row) return null;
  await client.query(`UPDATE tenant.pos_coupons SET committed_count=GREATEST(0,committed_count-1) WHERE organization_id=$1 AND id=$2`, [
    context.organizationId,
    row.coupon_id,
  ]);
  await client.query(`UPDATE tenant.pos_coupon_redemptions SET status='released',released_at=now() WHERE organization_id=$1 AND id=$2`, [
    context.organizationId,
    row.id,
  ]);
  return { couponId: row.coupon_id, redemptionId: row.id };
}
