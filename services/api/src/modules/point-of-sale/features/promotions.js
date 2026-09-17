// F280 — promotion definition CRUD. Evaluation/application happens in
// cart-pricing.js; this file only owns configuration, gated on
// pos.settings.manage (the same permission that already gates every other
// POS store-level configuration action) so an ordinary cashier can apply
// an eligible promotion during checkout but cannot invent new ones.
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
  if (!code || code.length > 40) throw posError(400, "A valid promotion code is required.", "POS_PROMOTION_CODE_INVALID");
  return code;
}

export async function listPosPromotions(client, context, { status } = {}) {
  requirePermission(context, "pos.view");
  const values = [context.organizationId, context.companyId];
  let filter = "";
  if (status) {
    values.push(status);
    filter = ` AND status=$${values.length}`;
  }
  const result = await client.query(
    `SELECT * FROM tenant.pos_promotions WHERE organization_id=$1 AND (company_id IS NULL OR company_id=$2)${filter} ORDER BY priority,code`,
    values,
  );
  return result.rows;
}

export async function createPosPromotion(client, context, input) {
  requirePermission(context, "pos.settings.manage");
  const code = normalizedCode(input.code);
  if (!input.name || !String(input.name).trim()) throw posError(400, "A promotion name is required.", "POS_PROMOTION_NAME_REQUIRED");
  if (!["percent", "amount"].includes(input.discountType)) throw posError(400, "Discount type must be percent or amount.", "POS_PROMOTION_TYPE_INVALID");
  if (!(Number(input.discountValue) > 0)) throw posError(400, "Discount value must be greater than zero.", "POS_PROMOTION_VALUE_INVALID");
  const result = await client.query(
    `INSERT INTO tenant.pos_promotions
      (organization_id,company_id,store_id,code,name,description,effective_from,effective_to,discount_type,
       discount_value,max_discount_amount,min_quantity,min_basket_amount,eligible_item_ids,eligible_item_group_ids,
       eligible_customer_ids,priority,stackable,exclusive,usage_limit_total,usage_limit_per_customer,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.storeId || null,
      code,
      String(input.name).trim(),
      input.description || null,
      input.effectiveFrom || null,
      input.effectiveTo || null,
      input.discountType,
      input.discountValue,
      input.maxDiscountAmount || null,
      input.minQuantity || null,
      input.minBasketAmount || null,
      input.eligibleItemIds || [],
      input.eligibleItemGroupIds || [],
      input.eligibleCustomerIds || [],
      Number.isFinite(Number(input.priority)) ? Number(input.priority) : 100,
      Boolean(input.stackable),
      Boolean(input.exclusive),
      input.usageLimitTotal || null,
      input.usageLimitPerCustomer || null,
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function updatePosPromotion(client, context, id, input) {
  requirePermission(context, "pos.settings.manage");
  const fields = [];
  const values = [context.organizationId, context.companyId, id];
  function set(column, value) {
    values.push(value);
    fields.push(`${column}=$${values.length}`);
  }
  if (input.name != null) set("name", String(input.name).trim());
  if (input.description !== undefined) set("description", input.description || null);
  if (input.effectiveFrom !== undefined) set("effective_from", input.effectiveFrom || null);
  if (input.effectiveTo !== undefined) set("effective_to", input.effectiveTo || null);
  if (input.discountValue != null) set("discount_value", input.discountValue);
  if (input.maxDiscountAmount !== undefined) set("max_discount_amount", input.maxDiscountAmount || null);
  if (input.minQuantity !== undefined) set("min_quantity", input.minQuantity || null);
  if (input.minBasketAmount !== undefined) set("min_basket_amount", input.minBasketAmount || null);
  if (input.eligibleItemIds !== undefined) set("eligible_item_ids", input.eligibleItemIds || []);
  if (input.eligibleItemGroupIds !== undefined) set("eligible_item_group_ids", input.eligibleItemGroupIds || []);
  if (input.eligibleCustomerIds !== undefined) set("eligible_customer_ids", input.eligibleCustomerIds || []);
  if (input.priority != null) set("priority", Number(input.priority));
  if (input.stackable != null) set("stackable", Boolean(input.stackable));
  if (input.exclusive != null) set("exclusive", Boolean(input.exclusive));
  if (input.usageLimitTotal !== undefined) set("usage_limit_total", input.usageLimitTotal || null);
  if (input.usageLimitPerCustomer !== undefined) set("usage_limit_per_customer", input.usageLimitPerCustomer || null);
  if (!fields.length) throw posError(400, "No fields to update.", "POS_PROMOTION_UPDATE_EMPTY");
  // SECURITY (audit-field integrity): this used to push a literal
  // "updated_by=$3" -- but $3 is `id` (the promotion's own record id, see
  // `values` above), not the acting user. Every update silently stamped
  // the promotion's own id into updated_by instead of who edited it. The
  // actor must always come from the authenticated context, never reused
  // from an unrelated positional parameter.
  values.push(context.userId);
  fields.push(`updated_by=$${values.length}`, "updated_at=now()");
  const result = await client.query(
    `UPDATE tenant.pos_promotions SET ${fields.join(",")} WHERE organization_id=$1 AND (company_id IS NULL OR company_id=$2) AND id=$3 RETURNING *`,
    values,
  );
  if (!result.rows[0]) throw posError(404, "POS promotion was not found.", "POS_PROMOTION_NOT_FOUND");
  return result.rows[0];
}

export async function setPosPromotionActive(client, context, id, active) {
  requirePermission(context, "pos.settings.manage");
  // Same audit-field bug as updatePosPromotion above -- updated_by must be
  // the acting user, not the record id being flipped.
  const result = await client.query(
    `UPDATE tenant.pos_promotions SET status=$4,updated_by=$5,updated_at=now()
     WHERE organization_id=$1 AND (company_id IS NULL OR company_id=$2) AND id=$3::uuid RETURNING *`,
    [context.organizationId, context.companyId, id, active ? "active" : "inactive", context.userId],
  );
  if (!result.rows[0]) throw posError(404, "POS promotion was not found.", "POS_PROMOTION_NOT_FOUND");
  return result.rows[0];
}

// Called once per completed sale (inside the same completion transaction)
// to turn this session's in-memory promotion applications into immutable
// evidence and bump each promotion's usage_count atomically under its own
// row lock -- mirrors the coupon commit pattern in coupons.js.
export async function commitPosPromotionApplications(client, context, saleId, saleLineByCartLineNumber, applications, customerId) {
  const byPromotion = new Map();
  for (const application of applications) {
    if (!byPromotion.has(application.promotionId)) byPromotion.set(application.promotionId, []);
    byPromotion.get(application.promotionId).push(application);
  }
  for (const [promotionId, items] of byPromotion) {
    const promotion = await client.query(
      `SELECT id,usage_limit_total,usage_limit_per_customer,usage_count FROM tenant.pos_promotions WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
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
    await client.query(`UPDATE tenant.pos_promotions SET usage_count=usage_count+1 WHERE organization_id=$1 AND id=$2`, [
      context.organizationId,
      promotionId,
    ]);
    for (const item of items) {
      await client.query(
        `INSERT INTO tenant.pos_promotion_applications (organization_id,promotion_id,sale_id,sale_line_id,discount_amount,customer_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [context.organizationId, promotionId, saleId, saleLineByCartLineNumber.get(item.lineNumber) || null, item.amount, customerId || null],
      );
    }
  }
}
