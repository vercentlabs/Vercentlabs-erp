// F280 — promotion definition CRUD. Evaluation/application happens in
// cart-pricing.js; this file only owns configuration, gated on
// pos.settings.manage (the same permission that already gates every other
// POS store-level configuration action) so an ordinary cashier can apply
// an eligible promotion during checkout but cannot invent new ones.
import { posError } from "../shared/errors.js";

// Called once per completed sale (inside the same completion transaction)
// to turn this session's in-memory promotion applications into immutable
// evidence and bump each promotion's usage_count atomically under its own
// row lock -- mirrors the coupon commit pattern in coupons.js.
export async function commitPosPromotionApplications(client, context, saleId, saleLineByCartLineNumber, applications, customerId, storeId) {
  const byPromotion = new Map();
  for (const application of applications) {
    if (!byPromotion.has(application.promotionId)) byPromotion.set(application.promotionId, []);
    byPromotion.get(application.promotionId).push(application);
  }
  for (const [promotionId, items] of byPromotion) {
    const promotion = await client.query(
      `SELECT id,usage_limit_total,usage_limit_per_customer,usage_limit_per_store,usage_count
       FROM tenant.pos_promotions WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [context.organizationId, promotionId],
    );
    if (!promotion.rows[0]) continue;
    if (promotion.rows[0].usage_limit_total != null && promotion.rows[0].usage_count >= promotion.rows[0].usage_limit_total) {
      throw posError(409, "A promotion in this cart reached its usage limit before checkout completed.", "POS_PROMOTION_USAGE_LIMIT_REACHED");
    }
    // Concurrency (Phase 4): same race as coupons' commitPosCouponRedemption
    // -- the preview-time per-customer check in cart-pricing.js's
    // evaluatePromotions() can pass on two racing terminals for the same
    // customer's last remaining use; holding this promotion's own row lock
    // (FOR UPDATE above) serializes every commit for it, so this re-check
    // is race-free.
    if (customerId && promotion.rows[0].usage_limit_per_customer != null) {
      const perCustomer = await client.query(
        `SELECT count(*)::int AS count FROM tenant.pos_promotion_applications
         WHERE organization_id=$1 AND promotion_id=$2 AND customer_id=$3`,
        [context.organizationId, promotionId, customerId],
      );
      if (Number(perCustomer.rows[0].count) >= promotion.rows[0].usage_limit_per_customer) {
        throw posError(409, "A promotion in this cart reached its per-customer usage limit before checkout completed.", "POS_PROMOTION_CUSTOMER_LIMIT_REACHED");
      }
    }
    // Matrix item #18 (per-store half): same race, same fix -- re-checked
    // under this promotion's own row lock so two terminals AT THE SAME
    // STORE racing for its last remaining store-scoped use cannot both win.
    if (storeId && promotion.rows[0].usage_limit_per_store != null) {
      const perStore = await client.query(
        `SELECT count(*)::int AS count FROM tenant.pos_promotion_applications
         WHERE organization_id=$1 AND promotion_id=$2 AND store_id=$3`,
        [context.organizationId, promotionId, storeId],
      );
      if (Number(perStore.rows[0].count) >= promotion.rows[0].usage_limit_per_store) {
        throw posError(409, "A promotion in this cart reached its per-store usage limit before checkout completed.", "POS_PROMOTION_STORE_LIMIT_REACHED");
      }
    }
    await client.query(`UPDATE tenant.pos_promotions SET usage_count=usage_count+1 WHERE organization_id=$1 AND id=$2`, [
      context.organizationId,
      promotionId,
    ]);
    for (const item of items) {
      await client.query(
        `INSERT INTO tenant.pos_promotion_applications (organization_id,promotion_id,sale_id,sale_line_id,discount_amount,customer_id,store_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [context.organizationId, promotionId, saleId, saleLineByCartLineNumber.get(item.lineNumber) || null, item.amount, customerId || null, storeId || null],
      );
    }
  }
}
