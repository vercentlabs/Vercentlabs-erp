// F281 — coupon definition CRUD plus the reservation/commit/release
// redemption lifecycle. Configuration is gated on pos.settings.manage;
// attaching an already-configured coupon to a cart during checkout only
// needs pos.sale.create (cart.js) since eligibility is enforced by the
// coupon's own rules, not by cashier authority.
function posError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function requirePermission(context, permission) {
  if (!context.roleSlugs?.includes("organization_owner") && !context.permissions?.includes(permission)) {
    const error = new Error(`Missing permission: ${permission}`);
    error.code = "FORBIDDEN";
    throw error;
  }
}

function normalizedCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!code || code.length > 40) throw posError(400, "A valid coupon code is required.", "POS_COUPON_CODE_INVALID");
  return code;
}

export async function listPosCoupons(client, context, { status } = {}) {
  requirePermission(context, "pos.view");
  const values = [context.organizationId, context.companyId];
  let filter = "";
  if (status) {
    values.push(status);
    filter = ` AND status=$${values.length}`;
  }
  const result = await client.query(
    `SELECT * FROM tenant.pos_coupons WHERE organization_id=$1 AND (company_id IS NULL OR company_id=$2)${filter} ORDER BY code`,
    values,
  );
  return result.rows;
}

export async function createPosCoupon(client, context, input) {
  requirePermission(context, "pos.settings.manage");
  const code = normalizedCode(input.code);
  if (!["percent", "amount"].includes(input.discountType)) throw posError(400, "Discount type must be percent or amount.", "POS_COUPON_TYPE_INVALID");
  if (!(Number(input.discountValue) > 0)) throw posError(400, "Discount value must be greater than zero.", "POS_COUPON_VALUE_INVALID");
  try {
    const result = await client.query(
      `INSERT INTO tenant.pos_coupons
        (organization_id,company_id,store_id,code,name,effective_from,effective_to,discount_type,discount_value,
         max_discount_amount,min_basket_amount,eligible_item_ids,eligible_customer_ids,usage_limit_total,
         usage_limit_per_customer,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        context.organizationId,
        context.companyId,
        input.storeId || null,
        code,
        input.name || null,
        input.effectiveFrom || null,
        input.effectiveTo || null,
        input.discountType,
        input.discountValue,
        input.maxDiscountAmount || null,
        input.minBasketAmount || null,
        input.eligibleItemIds || [],
        input.eligibleCustomerIds || [],
        input.usageLimitTotal || null,
        input.usageLimitPerCustomer || null,
        context.userId,
      ],
    );
    return result.rows[0];
  } catch (error) {
    if (error.code === "23505") throw posError(409, "A coupon with this code already exists.", "POS_COUPON_CODE_DUPLICATE");
    throw error;
  }
}

export async function updatePosCoupon(client, context, id, input) {
  requirePermission(context, "pos.settings.manage");
  const fields = [];
  const values = [context.organizationId, context.companyId, id];
  function set(column, value) {
    values.push(value);
    fields.push(`${column}=$${values.length}`);
  }
  if (input.name !== undefined) set("name", input.name || null);
  if (input.effectiveFrom !== undefined) set("effective_from", input.effectiveFrom || null);
  if (input.effectiveTo !== undefined) set("effective_to", input.effectiveTo || null);
  if (input.discountValue != null) set("discount_value", input.discountValue);
  if (input.maxDiscountAmount !== undefined) set("max_discount_amount", input.maxDiscountAmount || null);
  if (input.minBasketAmount !== undefined) set("min_basket_amount", input.minBasketAmount || null);
  if (input.eligibleItemIds !== undefined) set("eligible_item_ids", input.eligibleItemIds || []);
  if (input.eligibleCustomerIds !== undefined) set("eligible_customer_ids", input.eligibleCustomerIds || []);
  if (input.usageLimitTotal !== undefined) set("usage_limit_total", input.usageLimitTotal || null);
  if (input.usageLimitPerCustomer !== undefined) set("usage_limit_per_customer", input.usageLimitPerCustomer || null);
  if (!fields.length) throw posError(400, "No fields to update.", "POS_COUPON_UPDATE_EMPTY");
  fields.push("updated_by=$3", "updated_at=now()");
  const result = await client.query(
    `UPDATE tenant.pos_coupons SET ${fields.join(",")} WHERE organization_id=$1 AND (company_id IS NULL OR company_id=$2) AND id=$3 RETURNING *`,
    values,
  );
  if (!result.rows[0]) throw posError(404, "POS coupon was not found.", "POS_COUPON_NOT_FOUND");
  return result.rows[0];
}

export async function setPosCouponActive(client, context, id, active) {
  requirePermission(context, "pos.settings.manage");
  const result = await client.query(
    `UPDATE tenant.pos_coupons SET status=$4,updated_by=$3,updated_at=now()
     WHERE organization_id=$1 AND (company_id IS NULL OR company_id=$2) AND id=$3::uuid RETURNING *`,
    [context.organizationId, context.companyId, id, active ? "active" : "inactive"],
  );
  if (!result.rows[0]) throw posError(404, "POS coupon was not found.", "POS_COUPON_NOT_FOUND");
  return result.rows[0];
}

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
  const coupon = await client.query(`SELECT id,usage_limit_total,committed_count FROM tenant.pos_coupons WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [
    context.organizationId,
    row.coupon_id,
  ]);
  if (!coupon.rows[0]) throw posError(409, "The applied coupon no longer exists.", "POS_COUPON_NOT_FOUND");
  if (coupon.rows[0].usage_limit_total != null && coupon.rows[0].committed_count >= coupon.rows[0].usage_limit_total) {
    throw posError(409, "This coupon reached its usage limit before checkout completed.", "POS_COUPON_USAGE_LIMIT_REACHED");
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
// committed as-is -- proportional partial-reversal is intentionally left
// PARTIAL (documented in the tracker) since it would require deciding how
// to re-derive a *fractional* coupon usage credit, which the dossier does
// not specify and which risks an unsafe, under-specified scope expansion.
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
