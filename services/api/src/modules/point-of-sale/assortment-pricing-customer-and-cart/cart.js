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

import { createHash } from "node:crypto";

import { requireOrganizationRecord } from "../../../core/references.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { decimal, div, mul, min, max, sub, asDatabaseDecimal, formatDecimal } from "../../../core/decimal.js";
import { priceCartLines, resolveListUnitPrice } from "./cart-pricing.js";
import { assertPosAction, authorizePosAction, sumAmounts } from "../permissions/index.js";
import { resolveTerminalStockSource, validateTerminalOperationAccess } from "../terminals/index.js";
import { posError } from "../shared/errors.js";
import { collectPosCartProductIssues, posProductError, resolvePosProductContext, validatePosProductSelection } from "../product-search/index.js";
import { normalizeQuantityToBase } from "../../products/uom.js";
import { allocateScannedBatch, validateScannedSerial } from "../barcode-scanning/index.js";
import { requirePermission, assertPosStoreAccess, accessiblePosStoreIds } from "../shared/access-control.js";

const OPEN_STATUSES = ["draft", "priced"];
const HELD_CART_EXPIRY_MS = 24 * 60 * 60 * 1000;

async function loadPolicy(client, context) {
  const result = await client.query(
    `SELECT allow_negative_stock,allow_price_override,max_line_discount_percent,max_cart_discount_percent,
            discount_approval_threshold_percent,cart_expiry_minutes,held_cart_retention_hours,checkout_lock_minutes
     FROM tenant.pos_settings WHERE organization_id=$1`,
    [context.organizationId],
  );
  return (
    result.rows[0] || {
      allow_negative_stock: false,
      allow_price_override: false,
      max_line_discount_percent: 100,
      max_cart_discount_percent: 100,
      discount_approval_threshold_percent: 10,
      cart_expiry_minutes: 240,
      held_cart_retention_hours: 24,
      checkout_lock_minutes: 15,
    }
  );
}


// ------------------------------------------------------------------ Cart (migration 0086): lifecycle, locks, history, idempotency
//
// DRAFT (status draft / priced) is the working bill; CHECKOUT_PENDING is a DRAFT holding the checkout lock; HELD, COMPLETED, CANCELLED and
// EXPIRED are what they say. Only a DRAFT without the lock can change. A lock lapses after the outlet's checkout window only when no payment
// on the cart is unresolved — a payment whose outcome is unknown, or one taken but not yet part of a sale, keeps the cart locked.

export const POS_CART_MESSAGES = Object.freeze({
  POS_CART_NOT_FOUND: "Cart not found.",
  POS_CART_NOT_EDITABLE: "This bill can no longer be edited.",
  POS_CART_EMPTY: "Add a product before checkout.",
  POS_CART_VERSION_CONFLICT: "This bill changed. Refresh to continue.",
  POS_CART_ALREADY_ACTIVE: "Finish or hold the current bill first.",
  POS_CART_ALREADY_HELD: "This bill is already on hold.",
  POS_CART_RESUME_DENIED: "You cannot resume this bill.",
  POS_CART_OUTLET_MISMATCH: "This bill belongs to another store.",
  POS_CART_QUANTITY_INVALID: "Enter a valid quantity.",
  POS_CART_PRICE_CHANGED: "Price changed. Please review the bill.",
  POS_CART_DISCOUNT_LIMIT_EXCEEDED: "Discount exceeds your permitted limit.",
  POS_CART_STOCK_INSUFFICIENT: "Not enough stock for this quantity.",
  POS_CART_TRACKING_REQUIRED: "Select the required batch or serial number.",
  POS_CART_TAX_CALCULATION_FAILED: "Tax could not be calculated. Please retry.",
  POS_CART_CHECKOUT_IN_PROGRESS: "Payment is being processed.",
  POS_CART_CHECKOUT_NOT_READY: "Review the highlighted issues before payment.",
  POS_CART_ACTION_ALREADY_PROCESSED: "This action has already been processed.",
  POS_CART_TOTAL_INVALID: "The amount payable must be more than zero.",
  POS_SESSION_REQUIRED: "Open a POS session to continue.",
  POS_PERMISSION_DENIED: "You do not have permission for this action.",
});
const cartError = (status, code, message = POS_CART_MESSAGES[code], details = undefined) => {
  const error = posError(status, message, code);
  if (details) error.details = details;
  return error;
};

export function cartLifecycle(cart) {
  if (OPEN_STATUSES.includes(cart.status)) return cart.checkout_started_at ? "CHECKOUT_PENDING" : "DRAFT";
  return String(cart.status).toUpperCase();
}

// A payment on this cart whose outcome is unknown, or taken but not yet part of a sale.
const UNRESOLVED_PAYMENT_SQL = `EXISTS (SELECT 1 FROM tenant.pos_payments payment WHERE payment.organization_id = cart.organization_id AND payment.cart_id = cart.id
  AND (payment.status IN ('initiated', 'pending', 'authorized') OR (payment.status = 'captured' AND payment.sale_id IS NULL)))`;

// The cart's history: one row per material change, with who made it and the version it produced.
export async function cartEvent(client, context, cartId, eventType, summary, changes = {}) {
  await client.query(
    `INSERT INTO tenant.pos_cart_events (organization_id, cart_id, event_type, summary, changes, cart_version, terminal_id, actor_user_id)
     SELECT organization_id, id, $3, $4, $5::jsonb, version, terminal_id, $6 FROM tenant.pos_carts WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, cartId, eventType, String(summary).slice(0, 300), JSON.stringify(changes), context.userId ?? null]);
}

// Idempotent mutations: a request key seen before with the same request returns the cart as it is (that change already happened); the same
// key with a different request is refused. Checked before the version, since a retry carries the version from before its first success.
async function claimCartAction(client, context, cartId, input, operation) {
  if (!input?.idempotencyKey) return null;
  const key = String(input.idempotencyKey).slice(0, 100);
  if (key.length < 8) throw posError(400, "The request key is too short.", "POS_IDEMPOTENCY_KEY_INVALID");
  const { idempotencyKey: _key, expectedVersion: _version, ...payload } = input;
  void _key; void _version;
  const fingerprint = createHash("sha256").update(JSON.stringify([operation, payload])).digest("hex");
  const prior = (await client.query(`SELECT request_fingerprint FROM tenant.pos_cart_request_keys WHERE organization_id=$1 AND cart_id=$2 AND idempotency_key=$3`,
    [context.organizationId, cartId, key])).rows[0];
  if (prior) {
    if (prior.request_fingerprint && prior.request_fingerprint !== fingerprint) throw cartError(409, "POS_CART_ACTION_ALREADY_PROCESSED");
    return { replay: { ...(await getPosCart(client, context, cartId)), replayed: true } };
  }
  return { key, fingerprint, operation };
}
async function recordCartAction(client, context, cartId, claim, lineId = null) {
  if (!claim?.key) return;
  await client.query(
    `INSERT INTO tenant.pos_cart_request_keys (organization_id, cart_id, idempotency_key, operation, line_id, request_fingerprint, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [context.organizationId, cartId, claim.key, claim.operation, lineId, claim.fingerprint, context.userId ?? null]);
}

// Expiry, lazily when the cart is next touched: a draft idle past the outlet's window, a held cart past its retention. Never a cart in
// checkout; never with a stock or accounting effect.
async function applyExpiry(client, context, cart, policy) {
  const now = Date.now();
  const idleDraft = OPEN_STATUSES.includes(cart.status) && !cart.checkout_started_at && cart.expires_at && new Date(cart.expires_at).getTime() < now;
  const staleHeld = cart.status === "held" && cart.held_at && now - new Date(cart.held_at).getTime() > Number(policy.held_cart_retention_hours ?? 24) * 3600 * 1000;
  if (!idleDraft && !staleHeld) return cart;
  await client.query(`UPDATE tenant.pos_carts SET status='expired',expired_at=now(),version=version+1 WHERE organization_id=$1 AND id=$2`, [context.organizationId, cart.id]);
  await cartEvent(client, context, cart.id, "expired", staleHeld ? "Held bill expired" : "Idle bill expired");
  return { ...cart, status: "expired" };
}

async function lockCart(client, context, cartId, { requireOpen = true } = {}) {
  const result = await client.query(
    `SELECT cart.*,store.warehouse_id,store.currency_code,store.price_list_id,${UNRESOLVED_PAYMENT_SQL} AS payment_unresolved
     FROM tenant.pos_carts cart
     JOIN tenant.pos_stores store ON store.organization_id=cart.organization_id AND store.id=cart.store_id
     WHERE cart.organization_id=$1 AND cart.id=$2 FOR UPDATE OF cart`,
    [context.organizationId, cartId],
  );
  let cart = result.rows[0];
  if (!cart) throw cartError(404, "POS_CART_NOT_FOUND");
  // Every cart action goes through this one lock, so outlet access is checked on every action (a revocation mid-shift applies at once).
  await assertPosStoreAccess(client, context, cart.store_id, cart.terminal_id);
  const policy = await loadPolicy(client, context);
  // An idle checkout lock with nothing pending lapses; one with a payment whose outcome is unknown never does.
  if (cart.checkout_started_at && !cart.payment_unresolved && cart.checkout_expires_at && new Date(cart.checkout_expires_at).getTime() < Date.now()) {
    await client.query(`UPDATE tenant.pos_carts SET checkout_started_at=NULL,checkout_expires_at=NULL,checkout_started_by=NULL WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, cart.id]);
    await cartEvent(client, context, cart.id, "checkout_released", "Checkout lapsed with no payment pending");
    cart = { ...cart, checkout_started_at: null, checkout_expires_at: null };
  }
  cart = await applyExpiry(client, context, cart, policy);
  if (requireOpen) {
    if (!OPEN_STATUSES.includes(cart.status)) throw cartError(409, cart.status === "held" ? "POS_CART_ALREADY_HELD" : "POS_CART_NOT_EDITABLE",
      cart.status === "held" ? "This bill is on hold. Resume it to change it." : POS_CART_MESSAGES.POS_CART_NOT_EDITABLE);
    if (cart.checkout_started_at) throw cartError(409, "POS_CART_CHECKOUT_IN_PROGRESS");
  }
  return cart;
}

function checkVersion(cart, expectedVersion) {
  if (expectedVersion == null) return;
  if (Number(expectedVersion) !== Number(cart.version)) throw cartError(409, "POS_CART_VERSION_CONFLICT");
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
    `SELECT line.*, item.tracking_type, item.code AS sku, uom.code AS uom_code
     FROM tenant.pos_cart_lines line
     LEFT JOIN tenant.items item ON item.organization_id=line.organization_id AND item.id=line.item_id
     LEFT JOIN tenant.units_of_measure uom ON uom.organization_id=line.organization_id AND uom.id=line.uom_id
     WHERE line.organization_id=$1 AND line.cart_id=$2
     ORDER BY line.line_number`,
    [context.organizationId, cartId],
  );
  return result.rows;
}

function toPricingInputLines(rows) {
  return rows.map((row) => ({
    itemId: row.item_id,
    quantity: row.quantity,
    // The unit the line is sold in: its price is that unit's price, its stock the base quantity.
    uomId: row.uom_id,
    uomFactor: row.uom_factor,
    scannedBarcode: row.scanned_barcode ?? null,
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
           tax_components='[]'::jsonb,updated_at=now(),updated_by=$3,current_cashier_user_id=$3,expires_at=now()+make_interval(mins=>$4)
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, cart.id, context.userId, policy.cart_expiry_minutes],
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
        // (rawLine.description || item.name) into
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
     SET status='priced',version=version+1,subtotal=$3,manual_discount_total=$4,promotion_discount_total=$5,
         coupon_discount_total=$6,discount_total=$7,tax_total=$8,rounding_adjustment=$9,grand_total=$10,
         priced_at=now(),updated_at=now(),updated_by=$11,current_cashier_user_id=$11,expires_at=now()+make_interval(mins=>$12)
     WHERE organization_id=$1 AND id=$2`,
    [
      context.organizationId,
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
      policy.cart_expiry_minutes,
    ],
  );

  return { ...(await getPosCart(client, context, cart.id)), promotionExplanations: priced.promotionExplanations, coupon: priced.coupon, loyalty: priced.loyalty };
}



// The supervisor approvals asked for on this cart (Cashier Permissions), newest first, so the checkout screen can show "waiting for a
// supervisor", "approved — apply it now" or "rejected" from the same records the cart's actions consume.
async function loadCartDiscountApprovals(client, context, cartId) {
  const result = await client.query(
    `SELECT approval.id, approval.permission_code, approval.status, approval.requested_amount, approval.requested_percentage, approval.reason, approval.resource_version,
            approval.requested_action, approval.expires_at, approval.decided_at, approver.full_name AS approver_name
       FROM tenant.pos_permission_approvals approval LEFT JOIN public.users approver ON approver.id = approval.approver_user_id
      WHERE approval.organization_id=$1 AND approval.resource_type='pos_cart' AND approval.resource_id=$2
      ORDER BY approval.requested_at DESC`,
    [context.organizationId, cartId],
  );
  return result.rows;
}

// Add a product to the cart, or one more of it (Product Search). The exact product, unit and quantity are checked fresh against the Item
// Master, the outlet's assortment, the price list and Inventory (never trusted from a search result or the client); a price override also
// needs PRICE_OVERRIDE within the cashier's limits. A repeated request key (a retried request, a scanner firing one event twice) changes
// nothing and returns the cart. Lines merge only when everything that matters is the same: product, unit, no override, no manual discount,
// no batch or serial chosen, and the product is not serial-numbered.
export async function addPosCartLine(client, context, cartId, input) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId, { requireOpen: false });
  const key = input.idempotencyKey ? String(input.idempotencyKey).slice(0, 100) : null;
  if (key) {
    const seen = await client.query(`SELECT line_id FROM tenant.pos_cart_request_keys WHERE organization_id=$1 AND cart_id=$2 AND idempotency_key=$3`,
      [context.organizationId, cartId, key]);
    if (seen.rows[0]) return { ...(await getPosCart(client, context, cartId)), replayed: true };
  }
  assertEditable(cart);
  checkVersion(cart, input.expectedVersion);
  const shift = (await client.query(`SELECT status FROM tenant.pos_shifts WHERE organization_id=$1 AND id=$2`, [context.organizationId, cart.shift_id])).rows[0];
  if (shift?.status !== "open") throw posProductError("POS_SESSION_REQUIRED");
  await assertPosAction(client, context, { permission: "SALE_CREATE", outletId: cart.store_id });
  const quantity = input.quantity ?? 1;
  const existingLines = await loadLines(client, context, cartId);
  if (existingLines.length >= 200) throw posError(400, "A POS cart cannot contain more than 200 lines.", "POS_CART_LINE_LIMIT_EXCEEDED");
  const ctx = await resolvePosProductContext(client, context, { cartId });
  const inCart = existingLines.filter((line) => line.item_id === input.itemId).reduce((sum, line) => sum + decimal(line.base_quantity ?? line.quantity), decimal(0));
  const selection = await validatePosProductSelection(client, context, ctx, { itemId: input.itemId, uomId: input.uomId ?? null, quantity, alreadyInCartBase: inCart });
  let override = null;
  if (input.priceOverride) {
    const requested = decimal(input.unitPrice ?? 0);
    if (requested < 0n) throw posError(400, "POS unit price must be zero or greater.", "POS_UNIT_PRICE_INVALID");
    const listPrice = await resolveListUnitPrice(client, context, { price_list_id: cart.price_list_id, currency_code: cart.currency_code }, input.itemId, selection.uomId);
    const deviation = listPrice && listPrice > 0n ? div(mul(max(sub(requested, listPrice), sub(listPrice, requested)), decimal(100)), listPrice) : decimal(100);
    const decision = await assertPosAction(client, context, { permission: "PRICE_OVERRIDE", outletId: cart.store_id, percentage: formatDecimal(deviation),
      reason: input.reason, approvalId: input.approvalId, resource: { type: "pos_cart", id: cart.id, version: cart.version } });
    override = { reason: String(input.reason ?? "").trim() || null, approvalId: decision.approvalId ?? null };
  }
  // A batch line merges only with a line of the same batch; a serial-numbered unit is always its own line.
  const mergeable = !input.priceOverride && !input.serialId && selection.item.tracking_type !== "serial";
  const existing = mergeable && existingLines.find((line) => line.item_id === input.itemId && line.uom_id === selection.uomId && !line.price_override
    && Number(line.manual_discount_amount) === 0 && (line.batch_id ?? null) === (input.batchId || null) && !line.serial_id);
  let lineId;
  if (existing) {
    lineId = existing.id;
    await client.query(`UPDATE tenant.pos_cart_lines SET quantity=quantity+$3, base_quantity=COALESCE(base_quantity, quantity)+$4 WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, existing.id, asDatabaseDecimal(selection.quantity), asDatabaseDecimal(selection.baseQuantity)]);
  } else {
    const nextLineNumber = existingLines.reduce((highest, line) => Math.max(highest, line.line_number), 0) + 1;
    // Stock comes from the outlet's warehouse, at the terminal's selling location (else the outlet's): a cashier never picks a warehouse.
    if (input.warehouseId && input.warehouseId !== cart.warehouse_id)
      throw posError(409, "Stock is sold from this outlet's selling warehouse only.", "INVALID_SELLING_LOCATION");
    const source = await resolveTerminalStockSource(client, context.organizationId, cart.terminal_id, input.warehouseLocationId || null);
    lineId = (await client.query(
      `INSERT INTO tenant.pos_cart_lines
        (organization_id,cart_id,line_number,item_id,description,quantity,unit_price,price_override,
         warehouse_id,warehouse_location_id,batch_id,serial_id,price_override_reason,price_override_approval_id,uom_id,uom_factor,base_quantity,scanned_barcode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [
        context.organizationId,
        cartId,
        nextLineNumber,
        input.itemId,
        input.description || null,
        asDatabaseDecimal(selection.quantity),
        input.unitPrice || 0,
        Boolean(input.priceOverride),
        source.warehouseId,
        source.locationId,
        input.batchId || null,
        input.serialId || null,
        override?.reason ?? null,
        override?.approvalId ?? null,
        selection.uomId,
        asDatabaseDecimal(selection.factor),
        asDatabaseDecimal(selection.baseQuantity),
        input.barcode ? String(input.barcode).slice(0, 64) : null,
      ],
    )).rows[0].id;
  }
  if (key) {
    await client.query(`INSERT INTO tenant.pos_cart_request_keys (organization_id,cart_id,idempotency_key,line_id,created_by) VALUES ($1,$2,$3,$4,$5)`,
      [context.organizationId, cartId, key, lineId, context.userId ?? null]);
  }
  const result = await reprice(client, context, cart, policy);
  await cartEvent(client, context, cartId, "item_added", `${selection.item.name} × ${asDatabaseDecimal(selection.quantity).replace(/\.?0+$/, "")} ${selection.product.saleUomCode ?? ""}`.trim(),
    { lineId, itemId: input.itemId, uomId: selection.uomId, quantity: asDatabaseDecimal(selection.quantity), barcode: input.barcode ?? null, merged: Boolean(existing) });
  return result;
}

// The Product Search name for the same operation.
export const addProductToPosCart = addPosCartLine;

export async function updatePosCartLineQuantity(client, context, cartId, lineId, input) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, { ...input, lineId }, "quantity");
  if (replay) return replay;
  const quantity = Number(input.quantity);
  if (!(quantity > 0) || !Number.isFinite(quantity)) throw cartError(400, "POS_CART_QUANTITY_INVALID", "Enter a quantity greater than zero.");
  // The unit's precision and the base quantity always; stock (and that the product is still sellable) on an increase.
  const lines = await loadLines(client, context, cartId);
  const line = lines.find((candidate) => candidate.id === lineId);
  if (!line) throw posError(404, "Cart line was not found.", "POS_CART_LINE_NOT_FOUND");
  let baseQuantity;
  if (decimal(String(quantity)) > decimal(line.quantity)) {
    const others = lines.filter((candidate) => candidate.item_id === line.item_id && candidate.id !== line.id)
      .reduce((sum, candidate) => sum + decimal(candidate.base_quantity ?? candidate.quantity), decimal(0));
    const ctx = await resolvePosProductContext(client, context, { cartId });
    baseQuantity = (await validatePosProductSelection(client, context, ctx, { itemId: line.item_id, uomId: line.uom_id, quantity: String(quantity), alreadyInCartBase: others })).baseQuantity;
  } else {
    const normalized = await normalizeQuantityToBase(client, context.organizationId, line.item_id, line.uom_id, String(quantity), { allowInactive: true });
    if (!normalized.ok) throw posProductError("POS_PRODUCT_UOM_INVALID", { itemId: line.item_id }, normalized.message);
    baseQuantity = normalized.baseQuantity;
  }
  if (line.serial_id && quantity !== 1) throw posError(409, "A line with a serial number sells exactly one unit.", "POS_SERIAL_QUANTITY_INVALID");
  await client.query(`UPDATE tenant.pos_cart_lines SET quantity=$3, base_quantity=$4 WHERE organization_id=$1 AND id=$2 AND cart_id=$5`,
    [context.organizationId, lineId, String(quantity), asDatabaseDecimal(baseQuantity), cartId]);
  const result = await reprice(client, context, cart, policy);
  await cartEvent(client, context, cartId, "quantity_changed", `${line.description ?? "Item"}: quantity ${Number(line.quantity)} → ${quantity}`, { lineId, from: line.quantity, to: String(quantity) });
  await recordCartAction(client, context, cartId, claim, lineId);
  return result;
}


// The batch or serial number of a tracked line, given as the number the cashier scans or types (or its id), checked by Inventory before it is
// recorded: a serial must be this product's, in this store's selling stock, usable, unreserved and on no other open sale (and the line must
// be one unit); a batch must be eligible here and cover the line. Clearing (no value) leaves the line needing one before the sale completes.
export async function setPosCartLineTracking(client, context, cartId, lineId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, { ...input, lineId }, "tracking");
  if (replay) return replay;
  const line = (await loadLines(client, context, cartId)).find((candidate) => candidate.id === lineId);
  if (!line) throw posError(404, "Cart line was not found.", "POS_CART_LINE_NOT_FOUND");
  const ctx = await resolvePosProductContext(client, context, { cartId });
  let serialId = null;
  let batchId = null;
  const serialInput = input.serialNumber ?? (input.serialId ? (await client.query(`SELECT serial_number FROM tenant.stock_serials WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, input.serialId])).rows[0]?.serial_number ?? "?" : null);
  const batchInput = input.batchNumber ?? null;
  if (line.tracking_type === "serial" && serialInput) {
    if (Number(line.quantity) !== 1) throw posError(409, "A serial-numbered line sells one unit: set its quantity to 1 first.", "POS_SERIAL_QUANTITY_INVALID");
    const serial = await validateScannedSerial(client, context, ctx, { itemId: line.item_id, serialNumber: serialInput, cartId, lineId });
    serialId = serial.serialId;
    batchId = serial.batchId;
  } else if (line.tracking_type === "batch" && (input.batchId || batchInput)) {
    const batch = (await client.query(
      `SELECT id FROM tenant.stock_batches WHERE organization_id=$1 AND item_id=$2 AND (id::text=$3 OR upper(batch_number)=upper($4))`,
      [context.organizationId, line.item_id, input.batchId ?? "", batchInput ?? ""])).rows[0];
    if (!batch) throw posError(409, "That batch is not one of this product's batches.", "POS_BATCH_UNAVAILABLE");
    await client.query(`UPDATE tenant.pos_cart_lines SET batch_id=NULL WHERE organization_id=$1 AND id=$2`, [context.organizationId, lineId]);
    batchId = (await allocateScannedBatch(client, context, ctx, { itemId: line.item_id, baseQuantity: line.base_quantity ?? line.quantity, batchId: batch.id, cartId })).batchId;
  } else if (line.tracking_type !== "serial" && line.tracking_type !== "batch" && (serialInput || input.batchId || batchInput)) {
    throw posError(409, "This product is not tracked by batch or serial number.", "POS_TRACKING_NOT_REQUIRED");
  }
  await client.query(`UPDATE tenant.pos_cart_lines SET batch_id=$3,serial_id=$4 WHERE organization_id=$1 AND id=$2 AND cart_id=$5`,
    [context.organizationId, lineId, batchId, serialId, cartId]);
  const result = await reprice(client, context, cart, policy);
  await cartEvent(client, context, cartId, "tracking_set", `${line.description ?? "Item"}: ${serialId ? "serial" : batchId ? "batch" : "tracking cleared"}`, { lineId, serialId, batchId });
  await recordCartAction(client, context, cartId, claim, lineId);
  return result;
}

export async function applyPosCartLineDiscount(client, context, cartId, lineId, input) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, { ...input, lineId }, "line_discount");
  if (replay) return replay;
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
  const percentOfGross = grossAmount > 0n ? div(mul(amount, decimal(100)), grossAmount) : 0n;
  const total = await manualDiscountTotal(client, context, cart, { lineId, lineAmount: amount });
  const decision = await assertPosAction(client, context, { permission: "DISCOUNT_LINE_MANUAL", outletId: cart.store_id, percentage: formatDecimal(percentOfGross),
    amount: formatDecimal(total), reason, approvalId: input.approvalId, resource: { type: "pos_cart", id: cart.id, version: cart.version } });
  await client.query(
    `UPDATE tenant.pos_cart_lines SET manual_discount_amount=$3,manual_discount_reason=$4,manual_discount_approval_id=$5 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, lineId, asDatabaseDecimal(amount), reason, decision.approvalId ?? null],
  );
  // Effective-percent-of-gross is computed from the amount actually being
  // applied, regardless of whether the caller expressed it as "percent" or
  // "amount" -- a flat-amount discount that happens to equal 60% of the
  // line's gross amount must trigger approval exactly like a stated 60%
  // discount would. (This was the flat-amount threshold-bypass bug: the
  // cart-level equivalent below only ever checked input.type==="percent".)
  const result = await reprice(client, context, cart, policy);
  await cartEvent(client, context, cartId, "line_discount_applied", `Line discount ${formatDecimal(amount)} (${reason})`, { lineId, amount: formatDecimal(amount), approvalId: decision.approvalId ?? null });
  await recordCartAction(client, context, cartId, claim, lineId);
  return result;
}

export async function removePosCartLineDiscount(client, context, cartId, lineId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, { ...input, lineId }, "remove_line_discount");
  if (replay) return replay;
  await client.query(
    `UPDATE tenant.pos_cart_lines SET manual_discount_amount=0,manual_discount_reason=NULL,manual_discount_approval_id=NULL WHERE organization_id=$1 AND id=$2 AND cart_id=$3`,
    [context.organizationId, lineId, cartId],
  );
  const result = await reprice(client, context, cart, policy);
  await cartEvent(client, context, cartId, "line_discount_removed", "Line discount removed", { lineId });
  await recordCartAction(client, context, cartId, claim, lineId);
  return result;
}

// The sale's total manual discount (every line's plus the order discount), with one line's or the order's amount replaced by what is being
// applied — the figure the cashier's per-sale amount limit caps, so a discount cannot be split across lines to get past it.
async function manualDiscountTotal(client, context, cart, { lineId = null, lineAmount = null, orderAmount = null } = {}) {
  const lines = (await client.query(`SELECT id, manual_discount_amount FROM tenant.pos_cart_lines WHERE organization_id=$1 AND cart_id=$2`, [context.organizationId, cart.id])).rows;
  const lineAmounts = lines.map((line) => (line.id === lineId ? lineAmount : line.manual_discount_amount));
  const order = orderAmount !== null ? orderAmount : cart.cart_discount_type ? orderDiscountAmount(cart.cart_discount_type, cart.cart_discount_value, decimal(cart.subtotal)) : decimal(0);
  return sumAmounts([...lineAmounts.map((value) => (typeof value === "bigint" ? formatDecimal(value) : value ?? 0)), formatDecimal(order)]);
}

function orderDiscountAmount(type, value, subtotal) {
  const raw = decimal(value ?? 0);
  return type === "percent" ? div(mul(subtotal, min(max(raw, 0n), decimal(100))), decimal(100)) : min(max(raw, 0n), subtotal);
}

// At checkout, every manual discount and price override on the cart is authorized again as of now (a permission revoked during the session
// counts): within the cashier's current limits, or allowed by the approval recorded when it was applied.
export async function assertPosCartDiscountsAuthorized(client, context, cart) {
  const lines = (await client.query(
    `SELECT line.id, line.item_id, line.gross_amount, line.manual_discount_amount, line.manual_discount_approval_id, line.price_override, line.unit_price,
            line.price_override_reason, line.price_override_approval_id
       FROM tenant.pos_cart_lines line WHERE line.organization_id=$1 AND line.cart_id=$2`, [context.organizationId, cart.id])).rows;
  const approved = lines.some((line) => line.manual_discount_approval_id) || Boolean(cart.cart_discount_approval_id);
  const total = await manualDiscountTotal(client, context, cart);
  for (const line of lines) {
    const amount = decimal(line.manual_discount_amount);
    if (amount > 0n && !line.manual_discount_approval_id) {
      const gross = decimal(line.gross_amount);
      await assertPosAction(client, context, { permission: "DISCOUNT_LINE_MANUAL", outletId: cart.store_id, reason: "recorded",
        percentage: formatDecimal(gross > 0n ? div(mul(amount, decimal(100)), gross) : 0n), amount: approved ? undefined : formatDecimal(total) });
    }
    if (line.price_override && !line.price_override_approval_id) {
      const listPrice = await resolveListUnitPrice(client, context, { price_list_id: cart.price_list_id, currency_code: cart.currency_code }, line.item_id);
      const requested = decimal(line.unit_price);
      const deviation = listPrice && listPrice > 0n ? div(mul(max(sub(requested, listPrice), sub(listPrice, requested)), decimal(100)), listPrice) : decimal(100);
      await assertPosAction(client, context, { permission: "PRICE_OVERRIDE", outletId: cart.store_id, reason: line.price_override_reason, percentage: formatDecimal(deviation) });
    }
  }
  if (cart.cart_discount_type && !cart.cart_discount_approval_id) {
    const subtotal = decimal(cart.subtotal);
    const amount = orderDiscountAmount(cart.cart_discount_type, cart.cart_discount_value, subtotal);
    await assertPosAction(client, context, { permission: "DISCOUNT_ORDER_MANUAL", outletId: cart.store_id, reason: "recorded",
      percentage: formatDecimal(subtotal > 0n ? div(mul(amount, decimal(100)), subtotal) : 0n), amount: approved ? undefined : formatDecimal(total) });
  }
}







// Only a DRAFT without the checkout lock changes. A held bill says so (resume it); a bill in checkout says payment is being processed.
function assertEditable(cart) {
  if (!OPEN_STATUSES.includes(cart.status)) throw cartError(409, cart.status === "held" ? "POS_CART_ALREADY_HELD" : "POS_CART_NOT_EDITABLE",
    cart.status === "held" ? "This bill is on hold. Resume it to change it." : POS_CART_MESSAGES.POS_CART_NOT_EDITABLE);
  if (cart.checkout_started_at) throw cartError(409, "POS_CART_CHECKOUT_IN_PROGRESS");
}

// Lock, then (serialised by the lock) replay a repeated request, then require an editable cart at the version the cashier last saw.
async function beginCartAction(client, context, cartId, input, operation, { requireEditable = true } = {}) {
  const cart = await lockCart(client, context, cartId, { requireOpen: false });
  const claim = await claimCartAction(client, context, cartId, input, operation);
  if (claim?.replay) return { cart, claim, replay: claim.replay };
  if (requireEditable) assertEditable(cart);
  checkVersion(cart, input?.expectedVersion);
  return { cart, claim, replay: null };
}

export async function createPosCart(client, context, input) {
  requirePermission(context, "pos.sale.create");
  await assertPosStoreAccess(client, context, input.storeId, input.terminalId);
  const store = await requireOrganizationRecord(client, context, "pos_store", input.storeId);
  const terminal = await requireOrganizationRecord(client, context, "pos_terminal", input.terminalId);
  if (terminal.store_id !== store.id) {
    throw posError(409, "The POS terminal does not belong to the selected store.", "POS_TERMINAL_STORE_MISMATCH");
  }
  // No sale without an active terminal at an active outlet, operated by someone with access to it, in an open session.
  await validateTerminalOperationAccess(client, context, terminal.id);
  await assertPosAction(client, context, { permission: "SALE_CREATE", outletId: store.id });
  const shiftResult = await client.query(
    `SELECT id FROM tenant.pos_shifts WHERE organization_id=$1 AND id=$2 AND terminal_id=$3 AND status='open'`,
    [context.organizationId, input.shiftId, input.terminalId],
  );
  if (!shiftResult.rows[0]) throw cartError(409, "POS_SESSION_REQUIRED");

  // One working bill per terminal (pos_carts_one_active_per_terminal_uidx): opening the sale screen again continues it.
  const active = await client.query(
    `SELECT id FROM tenant.pos_carts WHERE organization_id=$1 AND terminal_id=$2 AND status IN ('draft','priced')`,
    [context.organizationId, input.terminalId],
  );
  if (active.rows[0]) return getPosCart(client, context, active.rows[0].id);

  const policy = await loadPolicy(client, context);
  // A short reference for people; the UUID stays the identity. No receipt or invoice number until the sale completes.
  const reference = await nextDocumentNumber(client, context, { documentType: "pos_cart", prefix: "CART" });
  const result = await client.query(
    `INSERT INTO tenant.pos_carts
      (organization_id,store_id,terminal_id,shift_id,cashier_user_id,current_cashier_user_id,customer_id,currency_code,expires_at,created_by,cart_reference)
     VALUES ($1,$2,$3,$4,$5,$5,$6,$7,now()+make_interval(mins=>$8),$5,$9)
     RETURNING id`,
    [context.organizationId, input.storeId, input.terminalId, input.shiftId, context.userId, input.customerId || null, store.currency_code, policy.cart_expiry_minutes, reference],
  );
  await cartEvent(client, context, result.rows[0].id, "created", `Bill ${reference} started`);
  return getPosCart(client, context, result.rows[0].id);
}

export async function getPosCart(client, context, cartId) {
  requirePermission(context, "pos.view");
  const cartResult = await client.query(
    `SELECT cart.*, party.display_name AS customer_name, party.phone AS customer_phone, party.gstin AS customer_gstin,
            ${UNRESOLVED_PAYMENT_SQL} AS payment_unresolved
       FROM tenant.pos_carts cart
       LEFT JOIN tenant.business_parties party ON party.organization_id = cart.organization_id AND party.id = cart.customer_id
      WHERE cart.organization_id=$1 AND cart.id=$2`, [context.organizationId, cartId]);
  let cart = cartResult.rows[0];
  if (!cart) throw cartError(404, "POS_CART_NOT_FOUND");
  await assertPosStoreAccess(client, context, cart.store_id, cart.terminal_id);
  cart = await applyExpiry(client, context, cart, await loadPolicy(client, context));
  const lines = await loadLines(client, context, cartId);
  const discountApprovals = await loadCartDiscountApprovals(client, context, cartId);
  return { ...cart, lifecycle: cartLifecycle(cart), lines, discountApprovals };
}

// The person's working bill: their open session's terminal's DRAFT (or the one in checkout), and how many bills are held at that outlet.
export async function getActivePosCart(client, context) {
  requirePermission(context, "pos.view");
  const session = (await client.query(
    `SELECT id, store_id, terminal_id FROM tenant.pos_shifts WHERE organization_id=$1 AND cashier_user_id=$2 AND status='open' ORDER BY opened_at DESC NULLS LAST LIMIT 1`,
    [context.organizationId, context.userId])).rows[0];
  if (!session) return { session: null, cart: null, heldCount: 0 };
  const active = (await client.query(`SELECT id FROM tenant.pos_carts WHERE organization_id=$1 AND terminal_id=$2 AND status IN ('draft','priced')`,
    [context.organizationId, session.terminal_id])).rows[0];
  const policy = await loadPolicy(client, context);
  const held = (await client.query(
    `SELECT count(*)::int AS n FROM tenant.pos_carts WHERE organization_id=$1 AND store_id=$2 AND status='held' AND held_at > now() - make_interval(hours=>$3)`,
    [context.organizationId, session.store_id, policy.held_cart_retention_hours])).rows[0].n;
  return { session: { id: session.id, storeId: session.store_id, terminalId: session.terminal_id }, cart: active ? await getPosCart(client, context, active.id) : null, heldCount: held };
}

export async function removePosCartLine(client, context, cartId, lineId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, { ...input, lineId }, "remove_line");
  if (replay) return replay;
  await assertPosAction(client, context, { permission: "SALE_CREATE", outletId: cart.store_id });
  const deleted = await client.query(`DELETE FROM tenant.pos_cart_lines WHERE organization_id=$1 AND id=$2 AND cart_id=$3 RETURNING description, quantity::text`, [
    context.organizationId, lineId, cartId,
  ]);
  if (!deleted.rows[0]) throw posError(404, "Cart line was not found.", "POS_CART_LINE_NOT_FOUND");
  // The line's serial or batch choice goes with it; nothing was reserved, so nothing in Inventory changes.
  const result = await reprice(client, context, cart, await loadPolicy(client, context));
  await cartEvent(client, context, cartId, "item_removed", `${deleted.rows[0].description ?? "Item"} removed`, { lineId, quantity: deleted.rows[0].quantity });
  await recordCartAction(client, context, cartId, claim, lineId);
  return result;
}

export async function setPosCartDiscount(client, context, cartId, input) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, input, "cart_discount");
  if (replay) return replay;
  if (input.type == null) {
    await client.query(
      `UPDATE tenant.pos_carts SET cart_discount_type=NULL,cart_discount_value=NULL,cart_discount_reason=NULL,cart_discount_approval_id=NULL
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, cartId],
    );
    const result = await reprice(client, context, cart, policy);
    await cartEvent(client, context, cartId, "cart_discount_removed", "Bill discount removed");
    await recordCartAction(client, context, cartId, claim);
    return result;
  }
  if (!input.reason || !String(input.reason).trim()) throw posError(400, "A discount reason is required.", "POS_DISCOUNT_REASON_REQUIRED");
  const reason = String(input.reason).trim();
  const subtotal = decimal(cart.subtotal);
  const orderAmount = orderDiscountAmount(input.type, input.value, subtotal);
  const total = await manualDiscountTotal(client, context, cart, { orderAmount });
  const decision = await assertPosAction(client, context, { permission: "DISCOUNT_ORDER_MANUAL", outletId: cart.store_id,
    percentage: formatDecimal(subtotal > 0n ? div(mul(orderAmount, decimal(100)), subtotal) : 0n), amount: formatDecimal(total), reason,
    approvalId: input.approvalId, resource: { type: "pos_cart", id: cart.id, version: cart.version } });
  await client.query(
    `UPDATE tenant.pos_carts SET cart_discount_type=$3,cart_discount_value=$4,cart_discount_reason=$5,cart_discount_approval_id=$6
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cartId, input.type, input.value, reason, decision.approvalId ?? null],
  );
  const result = await reprice(client, context, cart, policy);
  await cartEvent(client, context, cartId, "cart_discount_applied", `Bill discount ${input.type === "percent" ? `${input.value}%` : input.value} (${reason})`,
    { type: input.type, value: String(input.value), approvalId: decision.approvalId ?? null });
  await recordCartAction(client, context, cartId, claim);
  return result;
}

export async function setPosCartCustomer(client, context, cartId, input) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, input, "customer");
  if (replay) return replay;
  let name = null;
  if (input.customerId) {
    // Selecting a registered customer needs CUSTOMER_SELECT; the default walk-in context never does.
    try { await assertPosAction(client, context, { permission: "CUSTOMER_SELECT", outletId: cart.store_id }); }
    catch (error) { if (error.code === "POS_PERMISSION_DENIED") throw customerError(403, "POS_CUSTOMER_SELECTION_DENIED"); throw error; }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(input.customerId))) throw customerError(404, "POS_CUSTOMER_NOT_FOUND");
    const customer = (await client.query(
      `SELECT id, display_name, status, party_type FROM tenant.business_parties WHERE organization_id=$1 AND id=$2`, [context.organizationId, input.customerId])).rows[0];
    if (!customer || !["customer", "both"].includes(customer.party_type)) throw customerError(404, "POS_CUSTOMER_NOT_FOUND");
    if (customer.status !== "active") throw customerError(409, "POS_CUSTOMER_INACTIVE");
    name = customer.display_name;
  } else if (cart.customer_mode === "registered") {
    const customerPolicy = await outletCustomerPolicy(client, context, cart.store_id);
    if (!customerPolicy.allowWalkIn) throw customerError(409, "POS_WALK_IN_NOT_ALLOWED");
  }
  // One change: the customer link and its mode, walk-in buyer details cleared (a registered customer's come from their record), the context
  // version moved, and approvals given for the earlier customer no longer count — a discount above the cashier's own limit is flagged at
  // checkout again. A loyalty redemption was checked against one customer's balance, so it goes too. Customer pricing rules and the place of
  // supply are worked out again by the reprice.
  const linesBefore = await loadLines(client, context, cartId);
  await client.query(
    `UPDATE tenant.pos_carts SET customer_id=$3,customer_mode=$4,buyer_name=NULL,buyer_address='{}'::jsonb,loyalty_redeem_points=NULL,cart_discount_approval_id=NULL,
            customer_context_version=customer_context_version+1 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cartId, input.customerId || null, input.customerId ? "registered" : "walk_in"]);
  const approvalsCleared = (await client.query(
    `UPDATE tenant.pos_cart_lines SET manual_discount_approval_id=NULL,price_override_approval_id=NULL WHERE organization_id=$1 AND cart_id=$2
        AND (manual_discount_approval_id IS NOT NULL OR price_override_approval_id IS NOT NULL) RETURNING id`, [context.organizationId, cartId])).rowCount
    + (cart.cart_discount_approval_id ? 1 : 0);
  const before = cart.grand_total;
  const result = await reprice(client, context, cart, policy);
  const customerChanges = [];
  for (const line of result.lines) {
    const old = linesBefore.find((entry) => entry.id === line.id);
    if (old && decimal(old.unit_price) !== decimal(line.unit_price))
      customerChanges.push({ code: "POS_CUSTOMER_PRICING_CHANGED", lineId: line.id, message: `${line.description}: ${formatDecimal(decimal(old.unit_price))} → ${formatDecimal(decimal(line.unit_price))}` });
  }
  if (decimal(before ?? 0) !== decimal(result.grand_total ?? 0))
    customerChanges.push({ code: "POS_CUSTOMER_PRICING_CHANGED", message: `Total ${formatDecimal(decimal(before ?? 0))} → ${formatDecimal(decimal(result.grand_total ?? 0))}` });
  if (approvalsCleared) customerChanges.push({ code: "POS_CUSTOMER_PRICING_CHANGED", message: "Supervisor approvals given for the earlier customer no longer apply; discounts above your limit need approval again." });
  await cartEvent(client, context, cartId, "customer_changed", name ? `Customer ${name}` : "Walk-in customer",
    { customerId: input.customerId || null, mode: input.customerId ? "registered" : "walk_in", totalBefore: before, totalAfter: result.grand_total, approvalsCleared });
  await recordCartAction(client, context, cartId, claim);
  return { ...result, customerChanges };
}

// An optional note on the sale (not printed unless the receipt is set to).
export async function setPosCartNotes(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const { claim, replay } = await beginCartAction(client, context, cartId, input, "notes");
  if (replay) return replay;
  const notes = String(input.notes ?? "").trim().slice(0, 500) || null;
  await client.query(`UPDATE tenant.pos_carts SET notes=$3,version=version+1,updated_at=now(),updated_by=$4 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cartId, notes, context.userId]);
  await cartEvent(client, context, cartId, "notes_changed", notes ? "Note changed" : "Note cleared", { notes });
  await recordCartAction(client, context, cartId, claim);
  return getPosCart(client, context, cartId);
}

// An authorized price for one line (PRICE_OVERRIDE within the cashier's deviation limit, with a reason, or with a supervisor's approval for
// this cart version). Changes only this sale's price — never the item or the price list; tax is worked out from the new price. unitPrice null
// returns the line to the price list's price.
export async function overridePosCartLinePrice(client, context, cartId, lineId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, { ...input, lineId }, "price_override");
  if (replay) return replay;
  const line = (await client.query(`SELECT id, item_id, uom_id, unit_price, list_price, description, price_override FROM tenant.pos_cart_lines WHERE organization_id=$1 AND id=$2 AND cart_id=$3`,
    [context.organizationId, lineId, cartId])).rows[0];
  if (!line) throw posError(404, "Cart line was not found.", "POS_CART_LINE_NOT_FOUND");
  if (input.unitPrice === null || input.unitPrice === undefined) {
    await client.query(`UPDATE tenant.pos_cart_lines SET price_override=false,price_override_reason=NULL,price_override_approval_id=NULL WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, lineId]);
    const result = await reprice(client, context, cart, policy);
    await cartEvent(client, context, cartId, "price_overridden", `${line.description ?? "Item"}: back to the list price`, { lineId, unitPrice: null });
    await recordCartAction(client, context, cartId, claim, lineId);
    return result;
  }
  const requested = decimal(input.unitPrice);
  if (requested < 0n) throw posError(400, "POS unit price must be zero or greater.", "POS_UNIT_PRICE_INVALID");
  const reason = String(input.reason ?? "").trim();
  if (!reason) throw posError(400, "Give the reason for changing the price.", "POS_REASON_REQUIRED");
  const listPrice = await resolveListUnitPrice(client, context, { price_list_id: cart.price_list_id, currency_code: cart.currency_code }, line.item_id, line.uom_id);
  const deviation = listPrice && listPrice > 0n ? div(mul(max(sub(requested, listPrice), sub(listPrice, requested)), decimal(100)), listPrice) : decimal(100);
  const decision = await assertPosAction(client, context, { permission: "PRICE_OVERRIDE", outletId: cart.store_id, percentage: formatDecimal(deviation), reason,
    approvalId: input.approvalId, resource: { type: "pos_cart", id: cart.id, version: cart.version } });
  await client.query(
    `UPDATE tenant.pos_cart_lines SET price_override=true,unit_price=$3,price_override_reason=$4,price_override_approval_id=$5 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, lineId, asDatabaseDecimal(requested), reason, decision.approvalId ?? null]);
  const result = await reprice(client, context, cart, policy);
  await cartEvent(client, context, cartId, "price_overridden", `${line.description ?? "Item"}: price ${formatDecimal(requested)} (${reason})`,
    { lineId, from: line.unit_price, to: formatDecimal(requested), listPrice: listPrice === null ? null : formatDecimal(listPrice), approvalId: decision.approvalId ?? null });
  await recordCartAction(client, context, cartId, claim, lineId);
  return result;
}

// Hold the working bill (SALE_HOLD): it keeps its lines, reserves no stock and locks no price; it can be resumed later, in a later session
// too, after everything is checked again. input: note (optional, short).
export async function holdPosCart(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, input, "hold");
  if (replay) return replay;
  const lines = (await client.query(`SELECT count(*)::int AS n FROM tenant.pos_cart_lines WHERE organization_id=$1 AND cart_id=$2`, [context.organizationId, cartId])).rows[0].n;
  if (!lines) throw cartError(409, "POS_CART_EMPTY", "Add a product before holding the bill.");
  await assertPosAction(client, context, { permission: "SALE_HOLD", outletId: cart.store_id });
  const note = String(input.note ?? input.reason ?? "").trim().slice(0, 200) || null;
  await client.query(
    `UPDATE tenant.pos_carts SET status='held',held_at=now(),held_by=$4,hold_note=$3,version=version+1,expires_at=NULL,updated_at=now(),updated_by=$4
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cartId, note, context.userId],
  );
  await cartEvent(client, context, cartId, "held", note ? `Held: ${note}` : "Held", { note });
  await recordCartAction(client, context, cartId, claim);
  return getPosCart(client, context, cartId);
}

// Resume a held bill onto the person's own open session (SALE_RESUME_OWN for a bill they held, SALE_RESUME_ANY for anyone else's), at the
// same outlet, when that terminal has no other working bill. The status change under the row lock makes one resume win: a second terminal
// finds it no longer held. Prices, promotions, tax and stock are worked out again; what changed is returned for the cashier to review.
export async function resumePosCart(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, input, "resume", { requireEditable: false });
  if (replay) return replay;
  if (OPEN_STATUSES.includes(cart.status)) throw cartError(409, "POS_CART_RESUME_DENIED", "This bill is already open on a terminal.");
  if (cart.status !== "held") throw cartError(409, "POS_CART_NOT_EDITABLE", cart.status === "expired" ? "This held bill has expired and cannot be resumed." : POS_CART_MESSAGES.POS_CART_NOT_EDITABLE);
  const owner = cart.held_by ?? cart.cashier_user_id;
  await assertPosAction(client, context, { permission: owner === context.userId ? "SALE_RESUME_OWN" : "SALE_RESUME_ANY", outletId: cart.store_id });
  const session = (await client.query(
    `SELECT id, store_id, terminal_id FROM tenant.pos_shifts WHERE organization_id=$1 AND cashier_user_id=$2 AND status='open' ORDER BY opened_at DESC NULLS LAST LIMIT 1`,
    [context.organizationId, context.userId])).rows[0];
  if (!session) throw cartError(409, "POS_SESSION_REQUIRED");
  if (session.store_id !== cart.store_id) throw cartError(409, "POS_CART_OUTLET_MISMATCH");
  const conflict = await client.query(
    `SELECT id FROM tenant.pos_carts WHERE organization_id=$1 AND terminal_id=$2 AND status IN ('draft','priced') AND id<>$3`,
    [context.organizationId, session.terminal_id, cartId],
  );
  if (conflict.rows[0]) throw cartError(409, "POS_CART_ALREADY_ACTIVE");
  const before = await loadLines(client, context, cartId);
  const totalBefore = cart.grand_total;
  const policy = await loadPolicy(client, context);
  await client.query(
    `UPDATE tenant.pos_carts SET status='priced',terminal_id=$3,shift_id=$4,current_cashier_user_id=$5,resumed_at=now(),resumed_by=$5,held_at=NULL,
            version=version+1,expires_at=now()+make_interval(mins=>$6),updated_at=now(),updated_by=$5
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cartId, session.terminal_id, session.id, context.userId, policy.cart_expiry_minutes],
  );
  let repriced;
  const changes = [];
  try {
    repriced = await reprice(client, context, { ...cart, status: "priced", terminal_id: session.terminal_id, shift_id: session.id }, policy);
  } catch (error) {
    // A product no longer priced or sellable: the bill still resumes so the cashier can fix it; the problem is listed.
    repriced = await getPosCart(client, context, cartId);
    changes.push({ code: error.code ?? "POS_CART_PRICE_CHANGED", message: error.message });
  }
  for (const line of repriced.lines) {
    const old = before.find((entry) => entry.id === line.id);
    if (old && decimal(old.unit_price) !== decimal(line.unit_price))
      changes.push({ code: "POS_CART_PRICE_CHANGED", lineId: line.id, message: `${line.description}: price ${formatDecimal(decimal(old.unit_price))} → ${formatDecimal(decimal(line.unit_price))}` });
  }
  for (const issue of await collectPosCartProductIssues(client, context, cartId)) changes.push(issue);
  if (decimal(totalBefore) !== decimal(repriced.grand_total)) changes.push({ code: "POS_CART_PRICE_CHANGED", message: `Total ${formatDecimal(decimal(totalBefore))} → ${formatDecimal(decimal(repriced.grand_total))}` });
  await cartEvent(client, context, cartId, "resumed", changes.length ? `Resumed (${changes.length} change${changes.length === 1 ? "" : "s"} to review)` : "Resumed",
    { fromHeldBy: owner, changes: changes.map((change) => change.message) });
  await recordCartAction(client, context, cartId, claim);
  return { ...(await getPosCart(client, context, cartId)), resumeChanges: changes };
}

// Held bills at the outlets the person works at, newest first. input: scope ("mine" | "all"), search (reference, customer, terminal), from /
// to (held date). Resuming another cashier's bill still needs SALE_RESUME_ANY.
export async function listHeldPosCarts(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const policy = await loadPolicy(client, context);
  const accessible = await accessiblePosStoreIds(client, context);
  const values = [context.organizationId, policy.held_cart_retention_hours];
  const filters = [];
  const add = (value) => { values.push(value); return `$${values.length}`; };
  if (accessible) filters.push(`cart.store_id = ANY(${add(accessible)}::uuid[])`);
  if (input.scope === "mine") filters.push(`COALESCE(cart.held_by, cart.cashier_user_id) = ${add(context.userId)}::uuid`);
  if (input.search && String(input.search).trim()) {
    const like = add(`%${String(input.search).trim().toLowerCase()}%`);
    filters.push(`(lower(COALESCE(cart.cart_reference,'')) LIKE ${like} OR lower(terminal.name) LIKE ${like} OR lower(COALESCE(party.display_name,'')) LIKE ${like}
      OR lower(COALESCE(cart.hold_note,'')) LIKE ${like})`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.from ?? ""))) filters.push(`cart.held_at >= ${add(input.from)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.to ?? ""))) filters.push(`cart.held_at < ${add(input.to)}::date + 1`);
  const result = await client.query(
    `SELECT cart.id, cart.cart_reference, cart.store_id, cart.terminal_id, cart.customer_id, cart.grand_total, cart.currency_code, cart.held_at, cart.created_at, cart.version,
            cart.cashier_user_id, cart.hold_note, COALESCE(cart.held_by, cart.cashier_user_id) AS held_by, holder.full_name AS cashier_name,
            store.name AS store_name, terminal.name AS terminal_name, party.display_name AS customer_name,
            (SELECT count(*)::int FROM tenant.pos_cart_lines line WHERE line.organization_id=cart.organization_id AND line.cart_id=cart.id) AS line_count
       FROM tenant.pos_carts cart
       JOIN tenant.pos_stores store ON store.organization_id=cart.organization_id AND store.id=cart.store_id
       JOIN tenant.pos_terminals terminal ON terminal.organization_id=cart.organization_id AND terminal.id=cart.terminal_id
       LEFT JOIN tenant.business_parties party ON party.organization_id=cart.organization_id AND party.id=cart.customer_id
       LEFT JOIN public.users holder ON holder.id = COALESCE(cart.held_by, cart.cashier_user_id)
      WHERE cart.organization_id=$1 AND cart.status='held' AND cart.held_at > now() - make_interval(hours=>$2)${filters.length ? ` AND ${filters.join(" AND ")}` : ""}
      ORDER BY cart.held_at DESC
      LIMIT 100`,
    values,
  );
  return result.rows.map((row) => ({ ...row, own: row.held_by === context.userId }));
}

// Cancel an unpaid bill (SALE_CANCEL_UNPAID): kept with its history, never deleted; not possible while a payment on it is in progress or once
// it is a sale (a sale is changed only by a return).
export async function cancelPosCart(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, input, "cancel", { requireEditable: false });
  if (replay) return replay;
  if (cart.checkout_started_at) throw cartError(409, "POS_CART_CHECKOUT_IN_PROGRESS");
  if (!["draft", "priced", "held"].includes(cart.status)) {
    throw cartError(409, "POS_CART_NOT_EDITABLE", cart.status === "completed" ? "This bill is a completed sale: use a return instead." : POS_CART_MESSAGES.POS_CART_NOT_EDITABLE);
  }
  await assertPosAction(client, context, { permission: "SALE_CANCEL_UNPAID", outletId: cart.store_id });
  await client.query(
    `UPDATE tenant.pos_carts SET status='cancelled',cancelled_at=now(),cancel_reason=$3,version=version+1,updated_at=now(),updated_by=$4
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cartId, input.reason || null, context.userId],
  );
  await client.query(
    `UPDATE tenant.pos_coupon_redemptions SET status='released',released_at=now()
     WHERE organization_id=$1 AND cart_id=$2 AND status='reserved'`,
    [context.organizationId, cartId],
  );
  await cartEvent(client, context, cartId, "cancelled", input.reason ? `Cancelled: ${input.reason}` : "Cancelled");
  await recordCartAction(client, context, cartId, claim);
  return getPosCart(client, context, cartId);
}

// ------------------------------------------------------------------ checkout readiness

// Everything that must hold before payment, checked on the server: the bill is a DRAFT with lines, the person may complete sales in an open
// session, every product is still sellable here with stock, quantities and units are valid, tracked lines have a valid batch / serial,
// prices and tax resolve, discounts and overrides are within limits (or approved for this version), the customer is active, and the total is
// what the cashier saw and more than zero.
async function checkoutIssues(client, context, cart, policy) {
  const issues = [];
  const push = (code, message = POS_CART_MESSAGES[code] ?? code, extra = {}) => issues.push({ code, message, ...extra });
  const lines = await loadLines(client, context, cart.id);
  if (!lines.length) push("POS_CART_EMPTY");
  const shift = (await client.query(`SELECT status FROM tenant.pos_shifts WHERE organization_id=$1 AND id=$2`, [context.organizationId, cart.shift_id])).rows[0];
  if (shift?.status !== "open") push("POS_SESSION_REQUIRED");
  const decision = await authorizePosAction(client, context, { permission: "SALE_COMPLETE", outletId: cart.store_id });
  if (decision.decision !== "ALLOW") push("POS_PERMISSION_DENIED", decision.message ?? "You do not have permission to complete sales.");
  for (const issue of await collectPosCartProductIssues(client, context, cart.id)) push(issue.code, issue.message, { itemId: issue.itemId });
  const ctx = lines.length ? await resolvePosProductContext(client, context, { cartId: cart.id }) : null;
  for (const line of lines) {
    const normalized = await normalizeQuantityToBase(client, context.organizationId, line.item_id, line.uom_id, String(line.quantity), { purpose: "sales" });
    if (!normalized.ok) push("POS_CART_QUANTITY_INVALID", `${line.description}: ${normalized.message}`, { lineId: line.id });
    if ((line.tracking_type === "serial" && !line.serial_id) || (line.tracking_type === "batch" && !line.batch_id)) {
      push("POS_CART_TRACKING_REQUIRED", `${line.description}: ${POS_CART_MESSAGES.POS_CART_TRACKING_REQUIRED}`, { lineId: line.id });
    } else if (line.serial_id && ctx) {
      const number = (await client.query(`SELECT serial_number FROM tenant.stock_serials WHERE organization_id=$1 AND id=$2`, [context.organizationId, line.serial_id])).rows[0]?.serial_number;
      try { await validateScannedSerial(client, context, ctx, { itemId: line.item_id, serialNumber: number ?? "", cartId: cart.id, lineId: line.id }); }
      catch (error) { push(error.code ?? "POS_SERIAL_UNAVAILABLE", `${line.description}: ${error.message}`, { lineId: line.id }); }
    }
  }
  let priced = null;
  if (lines.length) {
    try {
      priced = await priceCartLines(client, context, {
        store: { id: cart.store_id, warehouse_id: cart.warehouse_id, currency_code: cart.currency_code, price_list_id: cart.price_list_id }, policy, customerId: cart.customer_id,
        lines: toPricingInputLines(lines), cartDiscount: cart.cart_discount_type ? { type: cart.cart_discount_type, value: cart.cart_discount_value, reason: cart.cart_discount_reason } : null,
        couponCode: cart.coupon_code, loyaltyRedeemPoints: cart.loyalty_redeem_points,
      });
    } catch (error) {
      const priceProblem = ["POS_PRICE_NOT_FOUND", "POS_PRICE_LIST_REQUIRED", "POS_SALE_ITEM_NOT_FOUND"].includes(error.code);
      push(priceProblem ? "POS_PRODUCT_PRICE_MISSING" : "POS_CART_TAX_CALCULATION_FAILED", error.message);
    }
  }
  if (priced) {
    if (decimal(priced.totals.grandTotal) !== decimal(cart.grand_total))
      push("POS_CART_PRICE_CHANGED", `${POS_CART_MESSAGES.POS_CART_PRICE_CHANGED} Total ${formatDecimal(decimal(cart.grand_total))} → ${formatDecimal(decimal(priced.totals.grandTotal))}.`,
        { previousTotal: cart.grand_total, currentTotal: priced.totals.grandTotal });
    if (decimal(priced.totals.grandTotal) <= 0n) push("POS_CART_TOTAL_INVALID");
  }
  try { await assertPosCartDiscountsAuthorized(client, context, cart); }
  catch (error) { push(error.code === "POS_APPROVAL_REQUIRED" ? "POS_CART_DISCOUNT_LIMIT_EXCEEDED" : error.code ?? "POS_CART_DISCOUNT_LIMIT_EXCEEDED", error.message); }
  if (cart.customer_id) {
    const customer = (await client.query(`SELECT status FROM tenant.business_parties WHERE organization_id=$1 AND id=$2`, [context.organizationId, cart.customer_id])).rows[0];
    if (customer?.status !== "active") push("POS_CUSTOMER_INACTIVE", "The selected customer is no longer active. Choose another customer or a walk-in sale.");
  }
  // Walk-in: allowed at this outlet, and from the company's amount the invoice needs the buyer's name and address.
  const customerPolicy = await outletCustomerPolicy(client, context, cart.store_id);
  if (cart.customer_mode !== "registered" && !customerPolicy.allowWalkIn) push("POS_WALK_IN_NOT_ALLOWED", `${POS_CUSTOMER_MESSAGES.POS_WALK_IN_NOT_ALLOWED} Select or add a customer.`);
  const totalNow = priced ? priced.totals.grandTotal : cart.grand_total;
  if (buyerDetailsRequired({ ...cart, grand_total: totalNow }, customerPolicy) && !buyerDetailsComplete(cart))
    push("POS_BUYER_DETAILS_REQUIRED", `A bill of ${formatDecimal(decimal(customerPolicy.buyerDetailsRequiredAbove))} or more needs the buyer's name, address and state on the invoice.`);
  return { issues, lines, priced };
}

// Read-only: is this bill ready for payment, and if not, what to fix. { ready, lifecycle, version, issues }.
export async function validatePosCartForCheckout(client, context, cartId) {
  requirePermission(context, "pos.view");
  const cart = await lockCart(client, context, cartId, { requireOpen: false });
  const lifecycle = cartLifecycle(cart);
  if (lifecycle !== "DRAFT") {
    const code = lifecycle === "CHECKOUT_PENDING" ? "POS_CART_CHECKOUT_IN_PROGRESS" : lifecycle === "HELD" ? "POS_CART_ALREADY_HELD" : "POS_CART_NOT_EDITABLE";
    return { ready: false, lifecycle, version: Number(cart.version), issues: [{ code, message: POS_CART_MESSAGES[code] }] };
  }
  const { issues } = await checkoutIssues(client, context, cart, await loadPolicy(client, context));
  return { ready: issues.length === 0, lifecycle, version: Number(cart.version), issues };
}

// What checkout receives: the exact bill as it stands — identity and version, lines with units, base quantities, prices, discounts and tax,
// totals, customer, approvals and the checkout reference.
function checkoutSnapshot(cart) {
  return {
    cartId: cart.id, cartReference: cart.cart_reference, version: Number(cart.version), checkoutReference: cart.checkout_reference, currency: cart.currency_code,
    customer: cart.customer_id ? { id: cart.customer_id, name: cart.customer_name ?? null, gstin: cart.customer_gstin ?? null } : null,
    lines: cart.lines.map((line) => ({
      lineId: line.id, itemId: line.item_id, sku: line.sku, description: line.description, uomId: line.uom_id, uom: line.uom_code, quantity: line.quantity,
      baseQuantity: line.base_quantity, unitPrice: line.unit_price, priceOverride: line.price_override, manualDiscount: line.manual_discount_amount,
      promotionDiscount: line.promotion_discount_amount, taxableAmount: line.taxable_amount, taxAmount: line.tax_amount, lineTotal: line.line_total, taxComponents: line.tax_components,
      batchId: line.batch_id, serialId: line.serial_id,
    })),
    totals: { subtotal: cart.subtotal, discountTotal: cart.discount_total, taxTotal: cart.tax_total, roundingAdjustment: cart.rounding_adjustment, grandTotal: cart.grand_total },
    approvals: [...cart.lines.flatMap((line) => [line.manual_discount_approval_id, line.price_override_approval_id]), cart.cart_discount_approval_id].filter(Boolean),
    inventory: "Stock is checked now and again, atomically, when the sale completes; nothing is reserved by the bill itself.",
  };
}

// Lock the bill for payment (CHECKOUT_PENDING) once every check passes. A changed total is saved and reported instead, so the cashier sees
// the new amount before paying. { ready, issues, cart, snapshot? } — a not-ready answer changes nothing else.
export async function beginPosCheckout(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, input, "begin_checkout", { requireEditable: false });
  if (replay) return { ready: true, issues: [], cart: replay, snapshot: checkoutSnapshot(replay), replayed: true };
  assertEditable(cart);
  checkVersion(cart, input.expectedVersion);
  const { issues } = await checkoutIssues(client, context, cart, policy);
  if (issues.length) {
    const refreshed = issues.some((issue) => issue.code === "POS_CART_PRICE_CHANGED") ? await reprice(client, context, cart, policy).catch(() => getPosCart(client, context, cartId))
      : await getPosCart(client, context, cartId);
    return { ready: false, code: "POS_CART_CHECKOUT_NOT_READY", message: POS_CART_MESSAGES.POS_CART_CHECKOUT_NOT_READY, issues, cart: refreshed };
  }
  await client.query(
    `UPDATE tenant.pos_carts SET checkout_started_at=now(),checkout_reference=gen_random_uuid(),checkout_expires_at=now()+make_interval(mins=>$3),checkout_started_by=$4,
            version=version+1,updated_at=now(),updated_by=$4 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cartId, policy.checkout_lock_minutes, context.userId]);
  await cartEvent(client, context, cartId, "checkout_started", "Checkout started");
  await recordCartAction(client, context, cartId, claim);
  const locked = await getPosCart(client, context, cartId);
  return { ready: true, issues: [], cart: locked, snapshot: checkoutSnapshot(locked) };
}

// Before a card / UPI / wallet payment: the bill must be in checkout (started here when it is not, with the same checks).
export async function ensurePosCheckoutStarted(client, context, cartId) {
  const cart = await lockCart(client, context, cartId, { requireOpen: false });
  if (cart.checkout_started_at) return cart;
  const result = await beginPosCheckout(client, context, cartId, {});
  if (!result.ready) throw cartError(409, "POS_CART_CHECKOUT_NOT_READY", result.issues[0]?.message ?? POS_CART_MESSAGES.POS_CART_CHECKOUT_NOT_READY, { issues: result.issues });
  return result.cart;
}

// Back to editing (CHECKOUT_PENDING → DRAFT) — only when no payment on it is pending or taken; an unknown payment outcome keeps the bill locked
// until it is resolved.
export async function releasePosCheckout(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const cart = await lockCart(client, context, cartId, { requireOpen: false });
  if (!cart.checkout_started_at) return getPosCart(client, context, cartId);
  if (cart.payment_unresolved) throw cartError(409, "POS_CART_CHECKOUT_IN_PROGRESS",
    "A payment on this bill is still being processed or was already taken. Complete the sale, or void the payment, before changing the bill.");
  await client.query(`UPDATE tenant.pos_carts SET checkout_started_at=NULL,checkout_expires_at=NULL,checkout_started_by=NULL,version=version+1,updated_at=now(),updated_by=$3
                       WHERE organization_id=$1 AND id=$2`, [context.organizationId, cartId, context.userId]);
  await cartEvent(client, context, cartId, "checkout_released", input.reason ? `Back to the bill: ${String(input.reason).slice(0, 200)}` : "Back to the bill");
  return getPosCart(client, context, cartId);
}

// The bill's history: every material change, who made it, on which terminal, and the version it produced.
export async function getPosCartHistory(client, context, cartId) {
  await getPosCart(client, context, cartId);
  const { rows } = await client.query(
    `SELECT event.id, event.event_type, event.summary, event.changes, event.cart_version, event.created_at, person.full_name AS actor_name, terminal.code AS terminal_code
       FROM tenant.pos_cart_events event
       LEFT JOIN public.users person ON person.id = event.actor_user_id
       LEFT JOIN tenant.pos_terminals terminal ON terminal.organization_id = event.organization_id AND terminal.id = event.terminal_id
      WHERE event.organization_id=$1 AND event.cart_id=$2 ORDER BY event.created_at, event.id`, [context.organizationId, cartId]);
  return rows.map((row) => ({ id: row.id, eventType: row.event_type, summary: row.summary, changes: row.changes, version: row.cart_version, at: row.created_at,
    actor: row.actor_name, terminal: row.terminal_code }));
}

// ------------------------------------------------------------------ Walk-In Customer (migration 0087)
//
// A bill is WALK_IN (no customer_id — the default, no customer record, no placeholder) or REGISTERED (a Customer Master customer). A walk-in
// bill may carry an optional buyer name and address for the invoice and, with the customer's consent, a phone / email for a digital receipt
// — none of it ever becomes a customer profile or a marketing consent. A business invoice (GSTIN) is a registered business customer's.

export const POS_CUSTOMER_MESSAGES = Object.freeze({
  POS_WALK_IN_NOT_ALLOWED: "Walk-in sales are not enabled for this store.",
  POS_CUSTOMER_MODE_INVALID: "Customer selection is invalid.",
  POS_CUSTOMER_NOT_FOUND: "Customer not found.",
  POS_CUSTOMER_INACTIVE: "This customer is inactive.",
  POS_CUSTOMER_COMPANY_MISMATCH: "This customer cannot be used for this company.",
  POS_CUSTOMER_SELECTION_DENIED: "You cannot change the customer.",
  POS_CUSTOMER_CREATION_DENIED: "You cannot create a customer.",
  POS_BUYER_DETAILS_REQUIRED: "Enter the required billing details.",
  POS_BUYER_TAX_DETAILS_INVALID: "Check the buyer's tax details.",
  POS_RECEIPT_CONTACT_INVALID: "Enter a valid phone number or email.",
  POS_WALK_IN_CREDIT_NOT_ALLOWED: "Select an eligible registered customer for credit sales.",
  POS_CUSTOMER_PRICING_CHANGED: "Prices changed. Please review the bill.",
  POS_CHECKOUT_CUSTOMER_REQUIREMENT: "Customer details are required for this transaction.",
});
const customerError = (status, code, message = POS_CUSTOMER_MESSAGES[code], details = undefined) => cartError(status, code, message, details);

// Who may read a receipt contact or a customer's phone in full: customer-master readers and POS administrators. Everyone else sees it masked.
const canSeeContacts = (context) => context.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug))
  || ["sales.customers.view", "pos.settings.manage", "pos.reports.view"].some((key) => context.permissions?.includes(key));
const maskPhone = (value) => (value ? `${"•".repeat(Math.max(String(value).length - 4, 0))}${String(value).slice(-4)}` : null);
const maskEmail = (value) => (value ? String(value).replace(/^(.)[^@]*(@.*)$/, "$1•••$2") : null);

async function outletCustomerPolicy(client, context, storeId) {
  const row = (await client.query(`SELECT allow_walk_in_sales, allow_optional_buyer_name, allow_receipt_contact_capture FROM tenant.pos_stores WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, storeId])).rows[0] ?? {};
  const settings = (await client.query(`SELECT walk_in_buyer_details_required_above FROM tenant.pos_settings WHERE organization_id=$1`, [context.organizationId])).rows[0];
  return {
    allowWalkIn: row.allow_walk_in_sales !== false, allowBuyerName: row.allow_optional_buyer_name !== false, allowReceiptContact: row.allow_receipt_contact_capture !== false,
    buyerDetailsRequiredAbove: settings ? settings.walk_in_buyer_details_required_above : "50000",
  };
}

// A walk-in bill at or above the company's amount needs the buyer's name and address (and state) on the invoice.
const buyerDetailsRequired = (cart, policy) => cart.customer_mode === "walk_in" && policy.buyerDetailsRequiredAbove !== null && policy.buyerDetailsRequiredAbove !== undefined
  && decimal(cart.grand_total ?? 0) >= decimal(policy.buyerDetailsRequiredAbove);
const buyerDetailsComplete = (cart) => Boolean(cart.buyer_name && cart.buyer_address?.line1 && cart.buyer_address?.stateCode);

// The bill's customer context: mode, the registered customer (contacts masked unless allowed), walk-in buyer details, the receipt contact,
// the outlet's policy and whether this bill needs buyer details.
export async function getPosCustomerContext(client, context, cartId) {
  const cart = await getPosCart(client, context, cartId);
  const policy = await outletCustomerPolicy(client, context, cart.store_id);
  const full = canSeeContacts(context);
  return {
    cartId: cart.id, cartVersion: Number(cart.version), contextVersion: Number(cart.customer_context_version ?? 1), mode: cart.customer_mode === "registered" ? "REGISTERED" : "WALK_IN",
    displayName: cart.customer_mode === "registered" ? cart.customer_name : "Walk-In Customer",
    customer: cart.customer_mode === "registered" ? { id: cart.customer_id, name: cart.customer_name, phone: full ? cart.customer_phone ?? null : maskPhone(cart.customer_phone), gstin: cart.customer_gstin ?? null } : null,
    buyerDetails: cart.customer_mode === "walk_in" ? { name: cart.buyer_name ?? null, address: cart.buyer_address ?? {} } : null,
    receiptContact: {
      phone: full ? cart.receipt_contact_phone ?? null : maskPhone(cart.receipt_contact_phone), email: full ? cart.receipt_contact_email ?? null : maskEmail(cart.receipt_contact_email),
      consent: Boolean(cart.receipt_delivery_consent), masked: !full,
    },
    policy, buyerDetailsRequired: buyerDetailsRequired(cart, policy), buyerDetailsComplete: buyerDetailsComplete(cart),
  };
}

// Switch the bill back to walk-in (registered → walk-in): the customer link goes, the retail price list and the cashier's own limits apply
// again. Allowed only where the outlet takes walk-in sales.
export async function setWalkInCustomer(client, context, cartId, input = {}) {
  return setPosCartCustomer(client, context, cartId, { ...input, customerId: null });
}

// Link a Customer Master customer (CUSTOMER_SELECT): customer pricing and tax are worked out again and earlier approvals no longer count.
export async function selectPosCustomer(client, context, cartId, input = {}) {
  if (!input.customerId) throw customerError(400, "POS_CUSTOMER_MODE_INVALID", "Choose the customer to link.");
  return setPosCartCustomer(client, context, cartId, input);
}

// The buyer's name and address for a walk-in invoice — transaction details, not a customer. A GSTIN is never taken here: a business invoice
// needs a registered business customer, whose GSTIN the Customer Master checks. input: name, address { line1, line2, city, stateCode,
// postalCode }, expectedVersion, idempotencyKey.
export async function updateWalkInBuyerDetails(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, input, "buyer_details");
  if (replay) return replay;
  if (cart.customer_mode !== "walk_in") throw customerError(409, "POS_CUSTOMER_MODE_INVALID", "This bill has a registered customer: their billing details come from their record.");
  if (input.gstin) throw customerError(400, "POS_BUYER_TAX_DETAILS_INVALID", "A business invoice needs a registered business customer: select or add the customer, whose GSTIN is checked there.");
  const policy = await outletCustomerPolicy(client, context, cart.store_id);
  const text = (value, max) => { const out = String(value ?? "").trim().replace(/\s+/g, " "); return out ? out.slice(0, max) : null; };
  const name = text(input.name, 200);
  if (name && !policy.allowBuyerName && !buyerDetailsRequired(cart, policy)) throw customerError(409, "POS_CUSTOMER_MODE_INVALID", "This store does not record buyer names on walk-in bills.");
  const raw = input.address ?? {};
  const address = Object.fromEntries(Object.entries({ line1: text(raw.line1, 200), line2: text(raw.line2, 200), city: text(raw.city, 100), stateCode: text(raw.stateCode, 2),
    postalCode: text(raw.postalCode, 10) }).filter(([, value]) => value));
  const issues = [];
  if (address.stateCode && !/^\d{2}$/.test(address.stateCode)) issues.push({ field: "address.stateCode", message: "Choose the state." });
  if (address.postalCode && !/^\d{6}$/.test(address.postalCode)) issues.push({ field: "address.postalCode", message: "Enter the 6-digit PIN code." });
  if (issues.length) throw customerError(400, "POS_BUYER_DETAILS_REQUIRED", issues[0].message, { issues });
  await client.query(`UPDATE tenant.pos_carts SET buyer_name=$3,buyer_address=$4::jsonb,customer_context_version=customer_context_version+1,version=version+1,updated_at=now(),updated_by=$5
                       WHERE organization_id=$1 AND id=$2`, [context.organizationId, cartId, name, JSON.stringify(address), context.userId]);
  await cartEvent(client, context, cartId, "customer_changed", name || Object.keys(address).length ? "Walk-in buyer details recorded" : "Walk-in buyer details cleared",
    { buyerName: Boolean(name), address: Object.keys(address) });
  await recordCartAction(client, context, cartId, claim);
  return getPosCart(client, context, cartId);
}

// Where to send a digital receipt, with the customer's consent to receive it there — receipt delivery only, never marketing, never a customer
// record. Empty clears it. input: phone, email, consent, expectedVersion, idempotencyKey.
export async function setReceiptDeliveryContact(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, input, "receipt_contact");
  if (replay) return replay;
  const phone = String(input.phone ?? "").replace(/[\s()-]/g, "") || null;
  const email = String(input.email ?? "").trim().toLowerCase() || null;
  const policy = await outletCustomerPolicy(client, context, cart.store_id);
  if ((phone || email) && !policy.allowReceiptContact) throw customerError(409, "POS_RECEIPT_CONTACT_INVALID", "This store does not collect contacts for digital receipts.");
  if (phone && !/^\+?[0-9]{7,15}$/.test(phone)) throw customerError(400, "POS_RECEIPT_CONTACT_INVALID", "Enter a valid phone number.", { issues: [{ field: "phone", message: "Enter a valid phone number." }] });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw customerError(400, "POS_RECEIPT_CONTACT_INVALID", "Enter a valid email address.", { issues: [{ field: "email", message: "Enter a valid email address." }] });
  if ((phone || email) && input.consent !== true) throw customerError(400, "POS_RECEIPT_CONTACT_INVALID", "Confirm the customer agreed to receive the receipt there.",
    { issues: [{ field: "consent", message: "The customer's agreement is needed." }] });
  await client.query(
    `UPDATE tenant.pos_carts SET receipt_contact_phone=$3,receipt_contact_email=$4,receipt_delivery_consent=$5,customer_context_version=customer_context_version+1,version=version+1,
            updated_at=now(),updated_by=$6 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cartId, phone, email, Boolean(phone || email), context.userId]);
  await cartEvent(client, context, cartId, "customer_changed", phone || email ? "Receipt contact recorded" : "Receipt contact cleared", { phone: Boolean(phone), email: Boolean(email) });
  await recordCartAction(client, context, cartId, claim);
  return getPosCart(client, context, cartId);
}

// What a finished sale keeps about its buyer, as it is now (never updated later): mode, name, tax details, billing address and the tax
// treatment — B2B only for a registered customer whose GSTIN the Customer Master holds as a registered business; B2C otherwise.
export async function buildPosBuyerSnapshot(client, context, cart) {
  if (cart.customer_mode !== "registered" || !cart.customer_id) {
    const address = cart.buyer_address && Object.keys(cart.buyer_address).length ? cart.buyer_address : null;
    return { mode: "walk_in", name: cart.buyer_name ?? null, taxDetails: null, billingAddress: address, taxTreatment: "b2c" };
  }
  const party = (await client.query(`SELECT display_name, legal_name, gstin, tax_treatment AS gst_registration_type, gst_state_code FROM tenant.business_parties WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cart.customer_id])).rows[0] ?? {};
  const billing = (await client.query(
    `SELECT line1, line2, city, state, state_code, postal_code, country_code, gstin FROM tenant.addresses WHERE organization_id=$1 AND party_id=$2 AND address_type='billing' AND status='active'
      ORDER BY is_default_billing DESC, is_primary DESC, created_at LIMIT 1`, [context.organizationId, cart.customer_id])).rows[0];
  const gstin = billing?.gstin || party.gstin || null;
  const business = Boolean(gstin) && ["registered_regular", "registered_composition", "sez"].includes(party.gst_registration_type ?? "");
  return {
    mode: "registered", name: party.legal_name || party.display_name || null,
    taxDetails: { gstin, registrationType: party.gst_registration_type ?? null, stateCode: billing?.state_code ?? party.gst_state_code ?? null },
    billingAddress: billing ? { line1: billing.line1, line2: billing.line2, city: billing.city, state: billing.state, stateCode: billing.state_code, postalCode: billing.postal_code,
      countryCode: billing.country_code } : null,
    taxTreatment: business ? "b2b" : "b2c",
  };
}

export {
  loadPolicy as loadPosSettingsPolicy,
  lockCart as lockPosCart,
  reprice as repricePosCartInternal,
  loadLines as loadPosCartLines,
  toPricingInputLines as toPosCartPricingInputLines,
};
