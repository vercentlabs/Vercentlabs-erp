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
import { randomUUID } from "node:crypto";

import { requireCompanyRecord } from "../../../core/references.js";
import { decimal, div, mul, min, max, asDatabaseDecimal, formatDecimal } from "../../../core/decimal.js";
import { priceCartLines } from "./cart-pricing.js";
import { resolveActivePosLoyaltyProgram, getPosLoyaltyBalanceValue, requirePosLoyaltyRedemptionEligible } from "./loyalty.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";

const OPEN_STATUSES = ["draft", "priced"];
const HELD_CART_EXPIRY_MS = 24 * 60 * 60 * 1000;

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
  // F270/F271: every cart mutation goes through this one shared lock, so
  // checking terminal-level access here (not just at creation) means a
  // mid-shift access revocation takes effect on the very next cart action,
  // not just future cart creation -- see the mega-prompt's own "existing
  // sessions" requirement.
  await assertPosStoreAccess(client, context, cart.store_id, cart.terminal_id);
  if (cart.expires_at && new Date(cart.expires_at).getTime() < Date.now() && OPEN_STATUSES.includes(cart.status)) {
    await client.query(`UPDATE tenant.pos_carts SET status='expired' WHERE organization_id=$1 AND id=$2`, [context.organizationId, cartId]);
    cart.status = "expired";
  }
  // F287/F288: an abandoned held cart must not sit forever with no
  // resolution -- holdPosCart clears expires_at (a held cart isn't subject
  // to the ordinary draft/priced expiry window), so it needs its own,
  // longer-lived policy. Same lazy/on-read convention as the open-cart
  // check above: no background sweep, checked the next time anything
  // touches this row. Not yet a configurable per-organization setting
  // (would need its own pos_settings column) -- disclosed as a fixed
  // default rather than invented per-tenant configuration.
  if (cart.status === "held" && cart.held_at && Date.now() - new Date(cart.held_at).getTime() > HELD_CART_EXPIRY_MS) {
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

// F295: tracking_type is joined in from tenant.items purely for display --
// it is an item-master property, never persisted onto pos_cart_lines
// itself (there is nothing to persist: it cannot diverge from the item's
// own current value within a single cart's short lifetime), so the
// checkout UI can require a serial/batch to be set on a line BEFORE the
// cashier attempts to complete the sale, rather than only discovering the
// requirement from postStockMovement's rejection at that point.
async function loadLines(client, context, cartId) {
  const result = await client.query(
    `SELECT line.*, item.tracking_type
     FROM tenant.pos_cart_lines line
     LEFT JOIN tenant.items item ON item.organization_id=line.organization_id AND item.id=line.item_id
     WHERE line.organization_id=$1 AND line.cart_id=$2
     ORDER BY line.line_number`,
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
    `SELECT customer_id,coupon_code,cart_discount_type,cart_discount_value,cart_discount_reason,loyalty_redeem_points
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
    loyaltyRedeemPoints: cart.loyalty_redeem_points,
  });

  for (let i = 0; i < priced.lines.length; i++) {
    const line = priced.lines[i];
    const row = existingLines[i];
    await client.query(
      `UPDATE tenant.pos_cart_lines
       SET list_price=$3,unit_price=$4,gross_amount=$5,manual_discount_amount=$6,promotion_discount_amount=$7,
           coupon_discount_amount=$8,taxable_amount=$9,tax_amount=$10,line_total=$11,tax_components=$12::jsonb,
           applied_promotion_ids=$13::uuid[],description=$14,loyalty_redeem_amount=$15,updated_at=now()
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
        // BUG FIX (found via real E2E testing, apps/web/e2e/pos-hold-
        // resume.spec.ts): addPosCartLine never writes a `description`
        // (the frontend never sends one -- see PosCheckoutScreen's
        // addLine), so this column stayed NULL forever. cart-pricing.js's
        // priceCartLines already resolves the right display text
        // (rawLine.description || variant?.name || item.name) into
        // `line.description` on every reprice, but that resolved value
        // was only ever handed to pos_sale_lines at checkout completion
        // -- never persisted back onto pos_cart_lines itself. The result:
        // every cart line rendered with a genuinely blank description for
        // the ENTIRE lifetime of the cart (search results still showed
        // the product name, masking it), only ever showing the real item
        // name after the sale completed and the receipt read pos_sale_
        // lines instead. Persisting it here is the minimal fix -- reprice
        // already computes the correct value, it just wasn't saved.
        line.description,
        line.loyaltyRedeemAmount,
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

  return { ...(await getPosCart(client, context, cart.id)), promotionExplanations: priced.promotionExplanations, coupon: priced.coupon, loyalty: priced.loyalty };
}

export async function createPosCart(client, context, input) {
  requirePermission(context, "pos.sale.create");
  await assertPosStoreAccess(client, context, input.storeId, input.terminalId);
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

  // pos_carts_one_active_per_terminal_uidx enforces at most one
  // draft/priced cart per terminal -- resuming that existing cart (the
  // natural "continue where the cashier left off" behavior for a UI that
  // calls createPosCart every time it opens the checkout screen) is more
  // useful than surfacing a raw unique-constraint 409 to the frontend.
  const active = await client.query(
    `SELECT id FROM tenant.pos_carts WHERE organization_id=$1 AND company_id=$2 AND terminal_id=$3 AND status IN ('draft','priced')`,
    [context.organizationId, context.companyId, input.terminalId],
  );
  if (active.rows[0]) return getPosCart(client, context, active.rows[0].id);

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
  await assertPosStoreAccess(client, context, cart.store_id, cart.terminal_id);
  if (cart.status === "held" && cart.held_at && Date.now() - new Date(cart.held_at).getTime() > HELD_CART_EXPIRY_MS) {
    await client.query(`UPDATE tenant.pos_carts SET status='expired' WHERE organization_id=$1 AND id=$2`, [context.organizationId, cartId]);
    cart.status = "expired";
  }
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

// F295: lets the cashier set/change the batch or serial number on an
// already-added line -- the small, functional checkout affordance for a
// tracking_type='batch'|'serial' item (surfaced via loadLines' join
// above). This does not itself validate the value against
// tenant.stock_batches/stock_serials -- that authoritative check happens
// once, atomically, in Stock's own postStockMovement at sale completion
// (services/api/src/modules/stock/index.js) -- so a cashier gets to type
// ahead of scanning, but a wrong/already-sold serial still fails loudly at
// checkout rather than being silently accepted here.
export async function setPosCartLineTracking(client, context, cartId, lineId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId);
  checkVersion(cart, input.expectedVersion);
  const updated = await client.query(
    `UPDATE tenant.pos_cart_lines SET batch_id=$3,serial_id=$4 WHERE organization_id=$1 AND id=$2 AND cart_id=$5 RETURNING id`,
    [context.organizationId, lineId, input.batchId || null, input.serialId || null, cartId],
  );
  if (!updated.rows[0]) throw posError(404, "Cart line was not found.", "POS_CART_LINE_NOT_FOUND");
  return reprice(client, context, cart, policy);
}

export async function applyPosCartLineDiscount(client, context, cartId, lineId, input) {
  requirePermission(context, "pos.discount.apply");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId);
  checkVersion(cart, input.expectedVersion);
  if (!input.reason || !String(input.reason).trim()) throw posError(400, "A discount reason is required.", "POS_DISCOUNT_REASON_REQUIRED");
  const line = await client.query(`SELECT gross_amount FROM tenant.pos_cart_lines WHERE organization_id=$1 AND id=$2 AND cart_id=$3`, [
    context.organizationId,
    lineId,
    cartId,
  ]);
  if (!line.rows[0]) throw posError(404, "Cart line was not found.", "POS_CART_LINE_NOT_FOUND");
  const grossAmount = decimal(line.rows[0].gross_amount);
  // Store as an absolute amount either way -- reprice() reads
  // manual_discount_amount, not a type+value pair, so percent discounts
  // are resolved to a concrete amount once here using the line's current
  // gross_amount, then treated identically to an amount discount on every
  // future reprice (consistent with a cashier expecting "10% off this
  // shirt" to mean a fixed rupee amount once applied, not a moving target
  // if the price list changes later in the same cart's lifetime). All of
  // this is computed with fixed-point decimals (services/api/src/core/
  // decimal.js), never a JS float -- an authoritative discount/threshold
  // comparison on money must not be exposed to floating-point error.
  const clampedPercent = min(max(decimal(input.value), 0n), decimal(100));
  const amount = input.type === "percent" ? div(mul(grossAmount, clampedPercent), decimal(100)) : decimal(input.value);
  if (!(amount >= 0n)) throw posError(400, "Discount value is invalid.", "POS_DISCOUNT_INVALID");
  const reason = String(input.reason).trim();
  await client.query(
    `UPDATE tenant.pos_cart_lines SET manual_discount_amount=$3,manual_discount_reason=$4 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, lineId, asDatabaseDecimal(amount), reason],
  );
  // Effective-percent-of-gross is computed from the amount actually being
  // applied, regardless of whether the caller expressed it as "percent" or
  // "amount" -- a flat-amount discount that happens to equal 60% of the
  // line's gross amount must trigger approval exactly like a stated 60%
  // discount would. (This was the flat-amount threshold-bypass bug: the
  // cart-level equivalent below only ever checked input.type==="percent".)
  const percentOfGross = grossAmount > 0n ? div(mul(amount, decimal(100)), grossAmount) : 0n;
  if (percentOfGross > decimal(policy.discount_approval_threshold_percent)) {
    await ensureDiscountApprovalRequested(client, context, cart, lineId, amount, percentOfGross, reason);
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

// SECURITY (POS Session 3, F279): this used to be recordDiscountApproval()
// + requireApprover(), which trusted a client-supplied `approvedBy` field
// as if it were evidence that a different, authorized person had reviewed
// and approved the discount -- it never verified that person authenticated
// or made any decision at all. A discount above the policy threshold now
// creates a REAL pending request in the platform's own maker-checker
// engine (services/api/src/core/approvals.js's decideApproval(), the same
// engine that already handles sales quotation/order approvals) instead of
// persisting a self-asserted approval. The discount is applied to the
// cart immediately (the cashier/supervisor sees the discounted price), but
// completePosCart() (assertPosCartDiscountsApproved(), below) refuses to
// let the sale complete until a genuinely separate, permission-holding
// approver decides that request -- see approvePosCartDiscountApproval().
// Idempotent per (cart_id, cart_line_id, cart_version): repeated calls
// against the same not-yet-repriced cart version (e.g. a retried request)
// reuse the existing pending row instead of spawning duplicates.
async function ensureDiscountApprovalRequested(client, context, cart, cartLineId, amount, percentOfGross, reason) {
  // reprice() (called by every caller of this function right after) always
  // increments cart.version by exactly one -- bind the approval to the
  // version the cart will actually have once this transaction commits, so
  // assertPosCartDiscountsApproved()'s exact-version match lines up.
  const nextVersion = Number(cart.version) + 1;
  const existing = await client.query(
    `SELECT id FROM tenant.pos_cart_discount_approvals
      WHERE organization_id=$1 AND cart_id=$2 AND cart_version=$3 AND status='pending'
        AND cart_line_id IS NOT DISTINCT FROM $4`,
    [context.organizationId, cart.id, nextVersion, cartLineId || null],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const discountApprovalId = randomUUID();
  const approvalRequestId = randomUUID();
  // A supervisor deciding this from the generic /approvals inbox sees only
  // this title (and, on request, the note) -- it must carry enough to
  // decide without needing to separately open the cart, since the inbox
  // has no POS-specific rendering of the underlying pos_cart_discount
  // entity_type.
  const title =
    (cartLineId ? "Approve line discount" : "Approve cart discount") +
    `: ${formatDecimal(amount, 2)} (${formatDecimal(percentOfGross, 1)}%) -- "${reason}"`;
  await client.query(
    `INSERT INTO public.approval_requests (id,organization_id,entity_type,entity_id,title,status,requested_by,command_key,command_payload)
     VALUES ($1,$2,'pos_cart_discount',$3,$4,'pending',$5,'pos.discount.approve',$6::jsonb)`,
    [approvalRequestId, context.organizationId, cart.id, title, context.userId, JSON.stringify({ discountApprovalId })],
  );
  await client.query(
    `INSERT INTO tenant.pos_cart_discount_approvals
      (id,organization_id,cart_id,cart_version,cart_line_id,discount_amount_snapshot,discount_percent_snapshot,
       cart_subtotal_snapshot,reason,requested_by,status,approval_request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11)`,
    [
      discountApprovalId,
      context.organizationId,
      cart.id,
      nextVersion,
      cartLineId || null,
      asDatabaseDecimal(amount),
      formatDecimal(percentOfGross, 4),
      cart.subtotal,
      reason,
      context.userId,
      approvalRequestId,
    ],
  );
  return discountApprovalId;
}

// Registered in services/api/src/core/approvals.js's COMMAND_DISPATCH under
// "pos.discount.approve" -- reachable ONLY through decideApproval(), which
// (a) has already loaded the approval_requests row from the database, not
// from anything the deciding caller supplied, (b) derives the deciding
// user from the authenticated session, never a request body field, and
// (c) has already run assertSeparationOfDuties() to block the original
// requester from deciding their own request. `context` here is
// approvals.js's moduleContext(session) shape (organizationId, userId,
// activeCompanyId, allowAllCompanies, permissions, roleSlugs) -- NOT the
// PointOfSaleContext shape the rest of this file uses (that has
// `companyId`, not `activeCompanyId`), so this adapts it after looking up
// which company the cart actually belongs to (never trusting the caller
// for that either).
export async function approvePosCartDiscountApproval(client, context, payload) {
  const row = await lockDiscountApprovalForDecision(client, context, payload);
  requirePermission(posContextFor(context, row.company_id), "pos.discount.approve");
  // Defense in depth: decideApproval's assertSeparationOfDuties already
  // blocks the same session from deciding its own request; re-check here
  // too so this function is never accidentally safe to call in a way that
  // relies solely on that caller doing so correctly.
  if (row.requested_by === context.userId) {
    throw posError(409, "The person who requested a discount cannot also approve it.", "SELF_APPROVAL_BLOCKED");
  }
  await client.query(
    `UPDATE tenant.pos_cart_discount_approvals SET status='approved',approved_by=$3,approved_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, row.id, context.userId],
  );
  return { discountApprovalId: row.id, cartId: row.cart_id, status: "approved" };
}

export async function rejectPosCartDiscountApproval(client, context, payload) {
  const row = await lockDiscountApprovalForDecision(client, context, payload);
  requirePermission(posContextFor(context, row.company_id), "pos.discount.approve");
  await client.query(`UPDATE tenant.pos_cart_discount_approvals SET status='rejected' WHERE organization_id=$1 AND id=$2`, [
    context.organizationId,
    row.id,
  ]);
  return { discountApprovalId: row.id, cartId: row.cart_id, status: "rejected" };
}

async function lockDiscountApprovalForDecision(client, context, payload) {
  const result = await client.query(
    `SELECT a.*, c.company_id FROM tenant.pos_cart_discount_approvals a
       JOIN tenant.pos_carts c ON c.organization_id=a.organization_id AND c.id=a.cart_id
      WHERE a.organization_id=$1 AND a.id=$2 FOR UPDATE OF a`,
    [context.organizationId, payload?.discountApprovalId],
  );
  const row = result.rows[0];
  if (!row) throw posError(404, "Discount approval request was not found.", "POS_DISCOUNT_APPROVAL_NOT_FOUND");
  if (row.status !== "pending") throw posError(409, `This discount approval was already ${row.status}.`, "POS_DISCOUNT_APPROVAL_NOT_PENDING");
  if (!context.allowAllCompanies && context.activeCompanyId && context.activeCompanyId !== row.company_id) {
    throw posError(403, "You are not authorized to decide discount approvals for this company.", "FORBIDDEN");
  }
  return row;
}

function posContextFor(approvalsModuleContext, companyId) {
  return {
    organizationId: approvalsModuleContext.organizationId,
    companyId,
    userId: approvalsModuleContext.userId,
    roleSlugs: approvalsModuleContext.roleSlugs,
    permissions: approvalsModuleContext.permissions,
  };
}

// Checkout-time enforcement (F279 requirement K: "a checkout with an
// unapproved above-threshold discount must fail closed"). Recomputes,
// from the authoritative current line/cart rows, which discounts exceed
// the policy threshold, then requires an 'approved' row in
// tenant.pos_cart_discount_approvals bound to the CART'S CURRENT VERSION
// for each one. Binding to the exact current version is what makes a
// material cart change after approval (any mutation -- reprice() always
// bumps version) invalidate the old approval: it simply no longer matches.
export async function assertPosCartDiscountsApproved(client, context, cart, policy) {
  const threshold = decimal(policy.discount_approval_threshold_percent);
  const lines = await client.query(`SELECT id,gross_amount,manual_discount_amount FROM tenant.pos_cart_lines WHERE organization_id=$1 AND cart_id=$2`, [
    context.organizationId,
    cart.id,
  ]);
  const offendingLineIds = [];
  for (const line of lines.rows) {
    const gross = decimal(line.gross_amount);
    const amount = decimal(line.manual_discount_amount);
    if (amount <= 0n || gross <= 0n) continue;
    if (div(mul(amount, decimal(100)), gross) > threshold) offendingLineIds.push(line.id);
  }

  let cartLevelOffends = false;
  if (cart.cart_discount_type) {
    const subtotal = decimal(cart.subtotal);
    const value = decimal(cart.cart_discount_value);
    const amount =
      cart.cart_discount_type === "percent" ? div(mul(subtotal, min(max(value, 0n), decimal(100))), decimal(100)) : min(max(value, 0n), subtotal);
    const percentOfSubtotal = subtotal > 0n ? div(mul(amount, decimal(100)), subtotal) : cart.cart_discount_type === "percent" ? value : 0n;
    cartLevelOffends = percentOfSubtotal > threshold;
  }

  if (!offendingLineIds.length && !cartLevelOffends) return;

  const approvals = await client.query(
    `SELECT cart_line_id FROM tenant.pos_cart_discount_approvals
      WHERE organization_id=$1 AND cart_id=$2 AND cart_version=$3 AND status='approved' AND approved_by IS NOT NULL`,
    [context.organizationId, cart.id, cart.version],
  );
  const approvedLineIds = new Set(approvals.rows.filter((row) => row.cart_line_id).map((row) => row.cart_line_id));
  const cartLevelApproved = approvals.rows.some((row) => row.cart_line_id === null);

  const missingLineApproval = offendingLineIds.some((id) => !approvedLineIds.has(id));
  if (missingLineApproval || (cartLevelOffends && !cartLevelApproved)) {
    throw posError(
      409,
      `A discount above ${policy.discount_approval_threshold_percent}% requires supervisor approval before this sale can be completed.`,
      "POS_DISCOUNT_APPROVAL_REQUIRED",
    );
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
  const reason = String(input.reason).trim();
  await client.query(
    `UPDATE tenant.pos_carts SET cart_discount_type=$3,cart_discount_value=$4,cart_discount_reason=$5
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cartId, input.type, input.value, reason],
  );
  // Effective-percent-of-subtotal is computed the same way for BOTH
  // discount types -- a flat-amount cart discount that happens to equal
  // (say) 60% of the subtotal must require approval exactly like a stated
  // 60% discount would. Previously this only ever checked
  // `input.type === "percent"`, so an amount-type cart discount of any
  // size bypassed approval entirely regardless of how large a share of the
  // sale it represented -- the flat-amount threshold-bypass this session
  // was asked to find and fix.
  const subtotal = decimal(cart.subtotal);
  const value = decimal(input.value);
  const amount = input.type === "percent" ? div(mul(subtotal, min(max(value, 0n), decimal(100))), decimal(100)) : min(max(value, 0n), subtotal);
  const percentOfSubtotal = subtotal > 0n ? div(mul(amount, decimal(100)), subtotal) : input.type === "percent" ? value : 0n;
  if (percentOfSubtotal > decimal(policy.discount_approval_threshold_percent)) {
    await ensureDiscountApprovalRequested(client, context, cart, null, amount, percentOfSubtotal, reason);
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
  // F306: a loyalty redemption is validated against ONE specific
  // customer's balance -- changing (or clearing) the cart's customer
  // invalidates that validation, so any pending redemption request is
  // cleared rather than silently re-evaluating against a different
  // customer's balance.
  await client.query(`UPDATE tenant.pos_carts SET customer_id=$3,loyalty_redeem_points=NULL WHERE organization_id=$1 AND id=$2`, [
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

// F287/F288: resume stays on the SAME terminal/shift the cart was held on
// -- cross-terminal transfer would mean rewriting terminal_id/shift_id on
// an already-priced cart, which needs its own authorization-checked
// claim/transfer operation (ownership, active-shift, inventory, conflict
// checks) that the canonical dossier does not clearly require; deferred
// rather than built as an unsafe shortcut. pos_carts_one_active_per_terminal_uidx
// means resuming can collide with a DIFFERENT cart the cashier started on
// this terminal after holding this one -- checked explicitly here so that
// shows up as a clear conflict, not a raw unique-constraint 500. reprice()
// (below) fully recomputes pricing/promotions/coupon eligibility from
// scratch, the same as any other cart mutation -- there is no stale
// snapshot left over from when it was held.
export async function resumePosCart(client, context, cartId) {
  requirePermission(context, "pos.sale.create");
  const cart = await lockCart(client, context, cartId, { requireOpen: false });
  if (cart.status !== "held") throw posError(409, "Only a held cart can be resumed.", "POS_CART_NOT_HELD");
  const conflict = await client.query(
    `SELECT id FROM tenant.pos_carts WHERE organization_id=$1 AND company_id=$2 AND terminal_id=$3 AND status IN ('draft','priced') AND id<>$4`,
    [context.organizationId, context.companyId, cart.terminal_id, cartId],
  );
  if (conflict.rows[0]) {
    throw posError(409, "This terminal already has another active cart. Hold or complete it before resuming this one.", "POS_TERMINAL_CART_CONFLICT");
  }
  const policy = await loadPolicy(client, context);
  await client.query(
    `UPDATE tenant.pos_carts SET status='priced',version=version+1,expires_at=now()+make_interval(mins=>$4),updated_at=now(),updated_by=$5
     WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, cartId, policy.cart_expiry_minutes, context.userId],
  );
  return reprice(client, context, { ...cart, status: "priced" }, policy);
}

// F287/F288: the held-cart queue an operator browses to pick up a
// suspended sale. Store-access-scoped the same way every other cart read
// is (assertPosStoreAccess, via getPosCart's per-row check would be
// wasteful here -- filtered directly in the query instead since this is a
// list, not a single-row lookup).
export async function listHeldPosCarts(client, context, { search } = {}) {
  requirePermission(context, "pos.view");
  const configured = await client.query(`SELECT 1 FROM tenant.pos_store_access WHERE organization_id=$1 AND company_id=$2 LIMIT 1`, [
    context.organizationId,
    context.companyId,
  ]);
  const bypass = context.roleSlugs?.includes("organization_owner") || context.roleSlugs?.includes("system_administrator") || context.permissions?.includes("pos.store.manage") || context.permissions?.includes("pos.settings.manage");
  let storeFilter = "";
  const values = [context.organizationId, context.companyId];
  if (configured.rows[0] && !bypass) {
    values.push(context.userId);
    storeFilter = ` AND cart.store_id IN (SELECT store_id FROM tenant.pos_store_access WHERE organization_id=$1 AND user_id=$${values.length})`;
  }
  let searchFilter = "";
  if (search && String(search).trim()) {
    values.push(`%${String(search).trim().toLowerCase()}%`);
    searchFilter = ` AND (lower(store.name) LIKE $${values.length} OR lower(terminal.name) LIKE $${values.length} OR lower(coalesce(party.display_name,'')) LIKE $${values.length})`;
  }
  const result = await client.query(
    `SELECT cart.id, cart.store_id, cart.terminal_id, cart.customer_id, cart.grand_total, cart.held_at, cart.version, cart.cashier_user_id,
            store.name AS store_name, terminal.name AS terminal_name, party.display_name AS customer_name,
            (SELECT count(*)::int FROM tenant.pos_cart_lines line WHERE line.organization_id=cart.organization_id AND line.cart_id=cart.id) AS line_count
       FROM tenant.pos_carts cart
       JOIN tenant.pos_stores store ON store.organization_id=cart.organization_id AND store.id=cart.store_id
       JOIN tenant.pos_terminals terminal ON terminal.organization_id=cart.organization_id AND terminal.id=cart.terminal_id
       LEFT JOIN tenant.business_parties party ON party.organization_id=cart.organization_id AND party.id=cart.customer_id
      WHERE cart.organization_id=$1 AND cart.company_id=$2 AND cart.status='held' AND cart.held_at > now() - interval '24 hours'${storeFilter}${searchFilter}
      ORDER BY cart.held_at DESC
      LIMIT 100`,
    values,
  );
  return result.rows;
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
  // Matrix item #18 (per-store half): store_id is stamped onto the
  // reservation here, at attach time, the same way customer_id already is
  // -- commitPosCouponRedemption (coupons.js) later reads it straight off
  // this same row rather than re-deriving it, and evaluateCoupon
  // (cart-pricing.js) counts committed redemptions by it.
  await client.query(
    `INSERT INTO tenant.pos_coupon_redemptions (organization_id,coupon_id,cart_id,customer_id,store_id,status,created_by)
     VALUES ($1,$2,$3,$4,$5,'reserved',$6)`,
    [context.organizationId, coupon.rows[0].id, cartId, cart.customer_id, cart.store_id, context.userId],
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

// F306: the cashier requests a specific number of points to redeem
// against this cart. Validated against the customer's CURRENT (preview)
// balance and the program's min/max rules immediately, so an obviously
// invalid request is rejected right here with a clear error rather than
// surfacing as a confusing failure only once the cart is repriced -- the
// authoritative, concurrency-safe recheck still happens again at
// completePosCart's commit step under the balance row's own lock (see
// loyalty.js's commitPosLoyaltyForSale).
export async function redeemPosCartLoyaltyPoints(client, context, cartId, input = {}) {
  requirePermission(context, "pos.loyalty.redeem");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId);
  checkVersion(cart, input.expectedVersion);
  if (!cart.customer_id) {
    throw posError(409, "A customer must be attached to this cart before redeeming loyalty points.", "POS_LOYALTY_CUSTOMER_REQUIRED");
  }
  const requestedPoints = decimal(input.points);
  if (requestedPoints <= 0n) throw posError(400, "Points to redeem must be greater than zero.", "POS_LOYALTY_POINTS_INVALID");
  const program = await resolveActivePosLoyaltyProgram(client, context);
  const balance = await getPosLoyaltyBalanceValue(client, context, cart.customer_id);
  requirePosLoyaltyRedemptionEligible(program, balance, requestedPoints);
  await client.query(`UPDATE tenant.pos_carts SET loyalty_redeem_points=$3 WHERE organization_id=$1 AND id=$2`, [
    context.organizationId,
    cartId,
    input.points,
  ]);
  return reprice(client, context, cart, policy);
}

export async function removePosCartLoyaltyRedemption(client, context, cartId, input = {}) {
  requirePermission(context, "pos.loyalty.redeem");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId);
  checkVersion(cart, input.expectedVersion);
  await client.query(`UPDATE tenant.pos_carts SET loyalty_redeem_points=NULL WHERE organization_id=$1 AND id=$2`, [context.organizationId, cartId]);
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
