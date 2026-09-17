// F277 — the real server-side POS cart aggregate. Every mutation here
// follows the same shape: lock the cart row (serializes concurrent
// requests against the SAME cart), validate its current state/expiry,
// apply the requested change to the relational line rows, recompute
// authoritative pricing via cart-pricing.js's priceCartLines (the single
// pricing/tax/discount/promotion/coupon evaluator also used by legacy
// completePointOfSale), persist the recomputed snapshot, and bump
// version. Two concurrent requests against the same cart therefore
// cannot silently overwrite each other: the second one to acquire the
// row lock sees the first one's already-applied change.
import { requireCompanyRecord } from "../../../core/references.js";
import { priceCartLines } from "./cart-pricing.js";

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

const OPEN_STATUSES = ["draft", "priced"];

async function loadPolicy(client, context) {
  const result = await client.query(
    `SELECT allow_negative_stock,allow_price_override,max_line_discount_percent,max_cart_discount_percent,
            discount_approval_threshold_percent,cart_expiry_minutes
     FROM tenant.pos_settings WHERE organization_id=$1 AND company_id=$2`,
    [context.organizationId, context.companyId],
  );
  return (
    result.rows[0] || {
      allow_negative_stock: false,
      allow_price_override: false,
      max_line_discount_percent: 100,
      max_cart_discount_percent: 100,
      discount_approval_threshold_percent: 10,
      cart_expiry_minutes: 240,
    }
  );
}

async function lockCart(client, context, cartId, { requireOpen = true } = {}) {
  const result = await client.query(
    `SELECT cart.*,store.warehouse_id,store.currency_code,store.price_list_id
     FROM tenant.pos_carts cart
     JOIN tenant.pos_stores store ON store.organization_id=cart.organization_id AND store.id=cart.store_id
     WHERE cart.organization_id=$1 AND cart.company_id=$2 AND cart.id=$3 FOR UPDATE OF cart`,
    [context.organizationId, context.companyId, cartId],
  );
  const cart = result.rows[0];
  if (!cart) throw posError(404, "POS cart was not found.", "POS_CART_NOT_FOUND");
  if (cart.expires_at && new Date(cart.expires_at).getTime() < Date.now() && OPEN_STATUSES.includes(cart.status)) {
    await client.query(`UPDATE tenant.pos_carts SET status='expired' WHERE organization_id=$1 AND id=$2`, [context.organizationId, cartId]);
    cart.status = "expired";
  }
  if (requireOpen && !OPEN_STATUSES.includes(cart.status)) {
    throw posError(409, `This cart is ${cart.status} and cannot be modified.`, "POS_CART_NOT_OPEN");
  }
  return cart;
}

function checkVersion(cart, expectedVersion) {
  if (expectedVersion == null) return;
  if (Number(expectedVersion) !== Number(cart.version)) {
    throw posError(
      409,
      "This cart changed since you last loaded it. Refresh and try again.",
      "POS_CART_VERSION_CONFLICT",
    );
  }
}

async function loadLines(client, context, cartId) {
  const result = await client.query(
    `SELECT * FROM tenant.pos_cart_lines WHERE organization_id=$1 AND cart_id=$2 ORDER BY line_number`,
    [context.organizationId, cartId],
  );
  return result.rows;
}

function toPricingInputLines(rows) {
  return rows.map((row) => ({
    itemId: row.item_id,
    variantId: row.variant_id,
    quantity: row.quantity,
    unitPrice: row.price_override ? row.unit_price : undefined,
    priceOverride: row.price_override,
    description: row.description,
    warehouseId: row.warehouse_id,
    warehouseLocationId: row.warehouse_location_id,
    batchId: row.batch_id,
    serialId: row.serial_id,
    // alreadyAuthorized: permission + reason were already enforced by
    // applyPosCartLineDiscount at the moment this discount was first
    // applied (it calls requirePermission before touching the row) --
    // reprice() re-runs on every unrelated mutation too (change quantity,
    // set customer, ...), and the person triggering THAT particular
    // reprice may not personally hold pos.discount.apply even though the
    // discount already on the line is legitimately authorized. Only a
    // genuinely NEW discount request (applyPosCartLineDiscount's own
    // direct call into cart-pricing.js, not this pass-through) should
    // re-check the permission.
    manualDiscount:
      Number(row.manual_discount_amount) > 0
        ? { type: "amount", value: row.manual_discount_amount, reason: row.manual_discount_reason, alreadyAuthorized: true }
        : null,
  }));
}

// Recomputes and persists authoritative pricing for the cart's CURRENT
// relational line set. Called after every mutation. Deleting and
// re-inserting cart lines (rather than diffing) keeps this simple and
// correct -- cart lines are not referenced by any other table until the
// cart completes, so there is no dangling-FK risk in doing this inside
// the same locked transaction.
async function reprice(client, context, cart, policy) {
  // Re-read the mutable cart fields fresh rather than trusting the
  // caller's `cart` object: every mutation function above locks the cart
  // BEFORE making its own field-specific UPDATE (customer_id, coupon_code,
  // cart_discount_*), then calls reprice() with that now-stale
  // pre-mutation object. Re-fetching here (a plain SELECT sees this same
  // transaction's own uncommitted writes -- no extra lock needed since
  // lockCart() already holds FOR UPDATE on this row) is far less
  // error-prone than requiring every call site to manually patch the
  // fields it just changed onto its local copy. store_id/terminal_id/
  // shift_id/warehouse_id/currency_code/price_list_id never change after
  // creation, so those are safe to keep from the passed-in `cart`.
  const current = await client.query(
    `SELECT customer_id,coupon_code,cart_discount_type,cart_discount_value,cart_discount_reason
     FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cart.id],
  );
  cart = { ...cart, ...current.rows[0] };

  const existingLines = await loadLines(client, context, cart.id);
  if (!existingLines.length) {
    await client.query(
      `UPDATE tenant.pos_carts
       SET status='draft',version=version+1,subtotal=0,manual_discount_total=0,promotion_discount_total=0,
           coupon_discount_total=0,discount_total=0,tax_total=0,rounding_adjustment=0,grand_total=0,
           tax_components='[]'::jsonb,updated_at=now(),updated_by=$4
       WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
      [context.organizationId, context.companyId, cart.id, context.userId],
    );
    return getPosCart(client, context, cart.id);
  }

  const store = { id: cart.store_id, warehouse_id: cart.warehouse_id, currency_code: cart.currency_code, price_list_id: cart.price_list_id };
  const cartDiscount = cart.cart_discount_type
    ? { type: cart.cart_discount_type, value: cart.cart_discount_value, reason: cart.cart_discount_reason }
    : null;
  const priced = await priceCartLines(client, context, {
    store,
    policy,
    customerId: cart.customer_id,
    lines: toPricingInputLines(existingLines),
    cartDiscount,
    couponCode: cart.coupon_code,
  });

  for (let i = 0; i < priced.lines.length; i++) {
    const line = priced.lines[i];
    const row = existingLines[i];
    await client.query(
      `UPDATE tenant.pos_cart_lines
       SET list_price=$3,unit_price=$4,gross_amount=$5,manual_discount_amount=$6,promotion_discount_amount=$7,
           coupon_discount_amount=$8,taxable_amount=$9,tax_amount=$10,line_total=$11,tax_components=$12::jsonb,
           applied_promotion_ids=$13::uuid[],updated_at=now()
       WHERE organization_id=$1 AND id=$2`,
      [
        context.organizationId,
        row.id,
        line.listPrice,
        line.unitPrice,
        line.grossAmount,
        line.manualDiscountAmount,
        line.promotionDiscountAmount,
        line.couponDiscountAmount,
        // taxable_amount is stored net of the cart-level discount share too
        // (cart_discount_amount has no dedicated column -- it is folded
        // into taxable_amount the same way it already reduces the tax
        // base -- see cart-pricing.js's documented before-tax discount
        // ordering), so no separate parameter is needed here.
        line.taxableAmount,
        line.taxAmount,
        line.lineTotal,
        JSON.stringify(line.taxComponents),
        priced.promotionApplications.filter((a) => a.lineNumber === line.lineNumber).map((a) => a.promotionId),
      ],
    );
  }

  const totals = priced.totals;
  await client.query(
    `UPDATE tenant.pos_carts
     SET status='priced',version=version+1,subtotal=$4,manual_discount_total=$5,promotion_discount_total=$6,
         coupon_discount_total=$7,discount_total=$8,tax_total=$9,rounding_adjustment=$10,grand_total=$11,
         priced_at=now(),updated_at=now(),updated_by=$12
     WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [
      context.organizationId,
      context.companyId,
      cart.id,
      totals.subtotal,
      totals.manualDiscountTotal,
      totals.promotionDiscountTotal,
      totals.couponDiscountTotal,
      totals.discountTotal,
      totals.taxTotal,
      totals.roundingAdjustment,
      totals.grandTotal,
      context.userId,
    ],
  );

  return { ...(await getPosCart(client, context, cart.id)), promotionExplanations: priced.promotionExplanations, coupon: priced.coupon };
}

export async function createPosCart(client, context, input) {
  requirePermission(context, "pos.sale.create");
  const store = await requireCompanyRecord(client, context, "pos_store", input.storeId);
  const terminal = await requireCompanyRecord(client, context, "pos_terminal", input.terminalId);
  if (terminal.store_id !== store.id) {
    throw posError(409, "The POS terminal does not belong to the selected store.", "POS_TERMINAL_STORE_MISMATCH");
  }
  const shiftResult = await client.query(
    `SELECT id FROM tenant.pos_shifts WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND terminal_id=$4 AND status='open'`,
    [context.organizationId, context.companyId, input.shiftId, input.terminalId],
  );
  if (!shiftResult.rows[0]) throw posError(409, "An open POS shift on this terminal is required.", "POS_SHIFT_NOT_OPEN");

  const policy = await loadPolicy(client, context);
  const result = await client.query(
    `INSERT INTO tenant.pos_carts
      (organization_id,company_id,store_id,terminal_id,shift_id,cashier_user_id,customer_id,
       currency_code,expires_at,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()+make_interval(mins=>$9),$10)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.storeId,
      input.terminalId,
      input.shiftId,
      context.userId,
      input.customerId || null,
      store.currency_code,
      policy.cart_expiry_minutes,
      context.userId,
    ],
  );
  return { ...result.rows[0], lines: [] };
}

export async function getPosCart(client, context, cartId) {
  requirePermission(context, "pos.view");
  const cartResult = await client.query(`SELECT * FROM tenant.pos_carts WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [
    context.organizationId,
    context.companyId,
    cartId,
  ]);
  const cart = cartResult.rows[0];
  if (!cart) throw posError(404, "POS cart was not found.", "POS_CART_NOT_FOUND");
  const lines = await loadLines(client, context, cartId);
  return { ...cart, lines };
}

export async function addPosCartLine(client, context, cartId, input) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId);
  checkVersion(cart, input.expectedVersion);
  const existingLines = await loadLines(client, context, cartId);
  if (existingLines.length >= 200) throw posError(400, "A POS cart cannot contain more than 200 lines.", "POS_CART_LINE_LIMIT_EXCEEDED");
  const existing = existingLines.find(
    (line) => line.item_id === input.itemId && (line.variant_id || null) === (input.variantId || null) && !line.price_override && !input.priceOverride,
  );
  if (existing) {
    const nextQuantity = Number(existing.quantity) + Number(input.quantity);
    await client.query(`UPDATE tenant.pos_cart_lines SET quantity=$3 WHERE organization_id=$1 AND id=$2`, [
      context.organizationId,
      existing.id,
      nextQuantity,
    ]);
  } else {
    const nextLineNumber = existingLines.reduce((max, line) => Math.max(max, line.line_number), 0) + 1;
    await client.query(
      `INSERT INTO tenant.pos_cart_lines
        (organization_id,cart_id,line_number,item_id,variant_id,description,quantity,unit_price,price_override,
         warehouse_id,warehouse_location_id,batch_id,serial_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        context.organizationId,
        cartId,
        nextLineNumber,
        input.itemId,
        input.variantId || null,
        input.description || null,
        input.quantity,
        input.unitPrice || 0,
        Boolean(input.priceOverride),
        input.warehouseId || cart.warehouse_id,
        input.warehouseLocationId || null,
        input.batchId || null,
        input.serialId || null,
      ],
    );
  }
  return reprice(client, context, cart, policy);
}

export async function updatePosCartLineQuantity(client, context, cartId, lineId, input) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId);
  checkVersion(cart, input.expectedVersion);
  const quantity = Number(input.quantity);
  if (!(quantity > 0)) throw posError(400, "POS sale quantity must be greater than zero.", "POS_SALE_QUANTITY_INVALID");
  const updated = await client.query(
    `UPDATE tenant.pos_cart_lines SET quantity=$3 WHERE organization_id=$1 AND id=$2 AND cart_id=$4 RETURNING id`,
    [context.organizationId, lineId, quantity, cartId],
  );
  if (!updated.rows[0]) throw posError(404, "Cart line was not found.", "POS_CART_LINE_NOT_FOUND");
  return reprice(client, context, cart, policy);
}

export async function removePosCartLine(client, context, cartId, lineId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId);
  checkVersion(cart, input.expectedVersion);
  const deleted = await client.query(`DELETE FROM tenant.pos_cart_lines WHERE organization_id=$1 AND id=$2 AND cart_id=$3 RETURNING id`, [
    context.organizationId,
    lineId,
    cartId,
  ]);
  if (!deleted.rows[0]) throw posError(404, "Cart line was not found.", "POS_CART_LINE_NOT_FOUND");
  return reprice(client, context, cart, policy);
}

export async function applyPosCartLineDiscount(client, context, cartId, lineId, input) {
  requirePermission(context, "pos.discount.apply");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId);
  checkVersion(cart, input.expectedVersion);
  if (!input.reason || !String(input.reason).trim()) throw posError(400, "A discount reason is required.", "POS_DISCOUNT_REASON_REQUIRED");
  const amountColumn = input.type === "percent" ? null : Number(input.value);
  // Store as an absolute amount either way -- reprice() reads
  // manual_discount_amount, not a type+value pair, so percent discounts
  // are resolved to a concrete amount once here using the line's current
  // gross_amount, then treated identically to an amount discount on every
  // future reprice (consistent with a cashier expecting "10% off this
  // shirt" to mean a fixed rupee amount once applied, not a moving target
  // if the price list changes later in the same cart's lifetime).
  const line = await client.query(`SELECT gross_amount FROM tenant.pos_cart_lines WHERE organization_id=$1 AND id=$2 AND cart_id=$3`, [
    context.organizationId,
    lineId,
    cartId,
  ]);
  if (!line.rows[0]) throw posError(404, "Cart line was not found.", "POS_CART_LINE_NOT_FOUND");
  const amount =
    input.type === "percent" ? (Number(line.rows[0].gross_amount) * Math.min(Math.max(Number(input.value), 0), 100)) / 100 : amountColumn;
  if (!(amount >= 0)) throw posError(400, "Discount value is invalid.", "POS_DISCOUNT_INVALID");
  await client.query(
    `UPDATE tenant.pos_cart_lines SET manual_discount_amount=$3,manual_discount_reason=$4 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, lineId, amount, String(input.reason).trim()],
  );
  const percentOfGross = Number(line.rows[0].gross_amount) > 0 ? (amount / Number(line.rows[0].gross_amount)) * 100 : 0;
  if (percentOfGross > Number(policy.discount_approval_threshold_percent)) {
    if (!input.approvedBy) {
      throw posError(
        409,
        `A line discount above ${policy.discount_approval_threshold_percent}% requires supervisor approval.`,
        "POS_DISCOUNT_APPROVAL_REQUIRED",
      );
    }
    await recordDiscountApproval(client, context, cart, lineId, amount, input);
  }
  return reprice(client, context, cart, policy);
}

export async function removePosCartLineDiscount(client, context, cartId, lineId, input = {}) {
  requirePermission(context, "pos.discount.apply");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId);
  checkVersion(cart, input.expectedVersion);
  await client.query(
    `UPDATE tenant.pos_cart_lines SET manual_discount_amount=0,manual_discount_reason=NULL WHERE organization_id=$1 AND id=$2 AND cart_id=$3`,
    [context.organizationId, lineId, cartId],
  );
  return reprice(client, context, cart, policy);
}

async function recordDiscountApproval(client, context, cart, cartLineId, amount, input) {
  requireApprover(context, input.approvedBy);
  await client.query(
    `INSERT INTO tenant.pos_cart_discount_approvals
      (organization_id,cart_id,cart_version,cart_line_id,discount_amount_snapshot,discount_percent_snapshot,
       cart_subtotal_snapshot,reason,requested_by,approved_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      context.organizationId,
      cart.id,
      cart.version,
      cartLineId,
      amount,
      input.type === "percent" ? input.value : null,
      cart.subtotal,
      String(input.reason).trim(),
      context.userId,
      input.approvedBy,
    ],
  );
}

function requireApprover(context, approvedBy) {
  if (!approvedBy) throw posError(400, "An approver is required for this discount.", "POS_DISCOUNT_APPROVAL_REQUIRED");
  if (approvedBy === context.userId) {
    throw posError(409, "The person applying a discount cannot also approve it.", "SELF_APPROVAL_BLOCKED");
  }
}

export async function setPosCartDiscount(client, context, cartId, input) {
  requirePermission(context, "pos.discount.apply");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId);
  checkVersion(cart, input.expectedVersion);
  if (input.type == null) {
    await client.query(
      `UPDATE tenant.pos_carts SET cart_discount_type=NULL,cart_discount_value=NULL,cart_discount_reason=NULL
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, cartId],
    );
    return reprice(client, context, cart, policy);
  }
  if (!input.reason || !String(input.reason).trim()) throw posError(400, "A discount reason is required.", "POS_DISCOUNT_REASON_REQUIRED");
  await client.query(
    `UPDATE tenant.pos_carts SET cart_discount_type=$3,cart_discount_value=$4,cart_discount_reason=$5
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cartId, input.type, input.value, String(input.reason).trim()],
  );
  if (Number(input.value) > Number(policy.discount_approval_threshold_percent) && input.type === "percent") {
    if (!input.approvedBy) {
      throw posError(
        409,
        `A cart discount above ${policy.discount_approval_threshold_percent}% requires supervisor approval.`,
        "POS_DISCOUNT_APPROVAL_REQUIRED",
      );
    }
    requireApprover(context, input.approvedBy);
    await client.query(
      `INSERT INTO tenant.pos_cart_discount_approvals
        (organization_id,cart_id,cart_version,discount_amount_snapshot,discount_percent_snapshot,
         cart_subtotal_snapshot,reason,requested_by,approved_by)
       VALUES ($1,$2,$3,0,$4,$5,$6,$7,$8)`,
      [context.organizationId, cartId, cart.version, input.value, cart.subtotal, String(input.reason).trim(), context.userId, input.approvedBy],
    );
  }
  return reprice(client, context, cart, policy);
}

export async function setPosCartCustomer(client, context, cartId, input) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId);
  checkVersion(cart, input.expectedVersion);
  if (input.customerId) {
    const customer = await client.query(
      `SELECT id FROM tenant.business_parties
       WHERE organization_id=$1 AND (company_id IS NULL OR company_id=$2) AND id=$3 AND party_type IN ('customer','both') AND status='active'`,
      [context.organizationId, context.companyId, input.customerId],
    );
    if (!customer.rows[0]) throw posError(404, "Selected customer was not found or is not an active customer for this company.", "POS_CUSTOMER_NOT_FOUND");
  }
  await client.query(`UPDATE tenant.pos_carts SET customer_id=$3 WHERE organization_id=$1 AND id=$2`, [
    context.organizationId,
    cartId,
    input.customerId || null,
  ]);
  return reprice(client, context, cart, policy);
}

export async function holdPosCart(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const cart = await lockCart(client, context, cartId);
  checkVersion(cart, input.expectedVersion);
  if (cart.status !== "priced") throw posError(409, "Only a priced cart can be held.", "POS_CART_NOT_PRICED");
  await client.query(
    `UPDATE tenant.pos_carts SET status='held',held_at=now(),version=version+1,expires_at=NULL,updated_at=now(),updated_by=$4
     WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, cartId, context.userId],
  );
  return getPosCart(client, context, cartId);
}

export async function resumePosCart(client, context, cartId) {
  requirePermission(context, "pos.sale.create");
  const cart = await lockCart(client, context, cartId, { requireOpen: false });
  if (cart.status !== "held") throw posError(409, "Only a held cart can be resumed.", "POS_CART_NOT_HELD");
  const policy = await loadPolicy(client, context);
  await client.query(
    `UPDATE tenant.pos_carts SET status='priced',version=version+1,expires_at=now()+make_interval(mins=>$4),updated_at=now(),updated_by=$5
     WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, cartId, policy.cart_expiry_minutes, context.userId],
  );
  return reprice(client, context, { ...cart, status: "priced" }, policy);
}

// F281: attaching a coupon reserves it against this cart (does not touch
// committed_count) and prices it in the same step so the cashier sees the
// real discount immediately. reserveOrValidatePosCoupon in coupons.js does
// the actual eligibility/limit checks; this function's job is only to
// record the reservation and trigger a reprice.
export async function applyPosCartCoupon(client, context, cartId, input) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId);
  checkVersion(cart, input.expectedVersion);
  const normalized = String(input.code || "").trim().toUpperCase();
  if (!normalized) throw posError(400, "A coupon code is required.", "POS_COUPON_CODE_REQUIRED");
  const coupon = await client.query(
    `SELECT id FROM tenant.pos_coupons
     WHERE organization_id=$1 AND upper(code)=$2 AND status='active'
       AND (company_id IS NULL OR company_id=$3) AND (store_id IS NULL OR store_id=$4)
       AND (effective_from IS NULL OR effective_from<=current_date)
       AND (effective_to IS NULL OR effective_to>=current_date)`,
    [context.organizationId, normalized, context.companyId, cart.store_id],
  );
  if (!coupon.rows[0]) throw posError(404, "Coupon code is invalid, inactive or expired.", "POS_COUPON_NOT_FOUND");
  await client.query(
    `DELETE FROM tenant.pos_coupon_redemptions WHERE organization_id=$1 AND cart_id=$2 AND status='reserved'`,
    [context.organizationId, cartId],
  );
  await client.query(
    `INSERT INTO tenant.pos_coupon_redemptions (organization_id,coupon_id,cart_id,customer_id,status,created_by)
     VALUES ($1,$2,$3,$4,'reserved',$5)`,
    [context.organizationId, coupon.rows[0].id, cartId, cart.customer_id, context.userId],
  );
  await client.query(`UPDATE tenant.pos_carts SET coupon_code=$3 WHERE organization_id=$1 AND id=$2`, [
    context.organizationId,
    cartId,
    normalized,
  ]);
  return reprice(client, context, cart, policy);
}

export async function removePosCartCoupon(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId);
  checkVersion(cart, input.expectedVersion);
  await client.query(
    `UPDATE tenant.pos_coupon_redemptions SET status='released',released_at=now()
     WHERE organization_id=$1 AND cart_id=$2 AND status='reserved'`,
    [context.organizationId, cartId],
  );
  await client.query(`UPDATE tenant.pos_carts SET coupon_code=NULL WHERE organization_id=$1 AND id=$2`, [context.organizationId, cartId]);
  return reprice(client, context, cart, policy);
}

export async function cancelPosCart(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const cart = await lockCart(client, context, cartId, { requireOpen: false });
  if (!["draft", "priced", "held"].includes(cart.status)) {
    throw posError(409, `This cart is ${cart.status} and cannot be cancelled.`, "POS_CART_NOT_CANCELLABLE");
  }
  await client.query(
    `UPDATE tenant.pos_carts SET status='cancelled',cancelled_at=now(),cancel_reason=$4,version=version+1,updated_at=now(),updated_by=$5
     WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, cartId, input.reason || null, context.userId],
  );
  await client.query(
    `UPDATE tenant.pos_coupon_redemptions SET status='released',released_at=now()
     WHERE organization_id=$1 AND cart_id=$2 AND status='reserved'`,
    [context.organizationId, cartId],
  );
  return getPosCart(client, context, cartId);
}

export {
  loadPolicy as loadPosSettingsPolicy,
  lockCart as lockPosCart,
  reprice as repricePosCartInternal,
  loadLines as loadPosCartLines,
  toPricingInputLines as toPosCartPricingInputLines,
};
