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
import { formatPosInvoicePreview, invoiceCheckoutIssues } from "../transaction-continuity-and-documents/gst-invoices.js";

import { requireOrganizationRecord } from "../../../core/references.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { add, decimal, div, mul, min, max, sub, asDatabaseDecimal, formatDecimal } from "../../../core/decimal.js";
import { POS_CART_DISCOUNT_MESSAGES, POS_ITEM_DISCOUNT_MESSAGES, assertPosProductTaxable, priceCartLines, resolveListUnitPrice } from "./cart-pricing.js";
import { assertPosAction, authorizePosAction, sumAmounts } from "../permissions/index.js";
import { resolveTerminalStockSource, validateTerminalOperationAccess } from "../terminals/index.js";
import { posError } from "../shared/errors.js";
import { collectPosCartProductIssues, posProductError, resolvePosProductContext, validatePosProductSelection } from "../product-search/index.js";
import { normalizeQuantityToBase } from "../../products/uom.js";
import { allocateScannedBatch, validateScannedSerial } from "../barcode-scanning/index.js";
import { requirePermission, assertPosStoreAccess, accessiblePosStoreIds } from "../shared/access-control.js";
import {
  isPosStockFailure, releasePosCheckoutStock, renewPosCheckoutStock, reservePosCheckoutStock, resolvePosStockRecovery,
} from "../inventory-and-offline-continuity/stock-reduction.js";

const OPEN_STATUSES = ["draft", "priced"];
const HELD_CART_EXPIRY_MS = 24 * 60 * 60 * 1000;

async function loadPolicy(client, context) {
  const result = await client.query(
    `SELECT allow_negative_stock,allow_price_override,max_line_discount_percent,max_cart_discount_percent,
            discount_approval_threshold_percent,cart_expiry_minutes,held_cart_retention_hours,checkout_lock_minutes,
            manual_discount_stacking,allow_full_line_discount,discount_reason_required,discount_reasons,allow_zero_total_sale,cart_discount_reasons
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
      manual_discount_stacking: "non_stackable",
      allow_full_line_discount: false,
      discount_reason_required: false,
      discount_reasons: DEFAULT_DISCOUNT_REASONS,
      allow_zero_total_sale: false,
      cart_discount_reasons: null,
    }
  );
}

// The bill discount as stored on the cart, for the pricing engine.
const cartDiscountOf = (cart) => (cart?.cart_discount_type ? { type: cart.cart_discount_type, value: cart.cart_discount_value, reason: cart.cart_discount_reason } : null);

const DEFAULT_DISCOUNT_REASONS = Object.freeze([
  { code: "CUSTOMER_GOODWILL", label: "Customer goodwill" }, { code: "DAMAGED_PACKAGING", label: "Damaged packaging" }, { code: "MINOR_DEFECT", label: "Minor product defect" },
  { code: "PRICE_MATCH", label: "Price matching" }, { code: "COMPLAINT", label: "Customer complaint resolution" }, { code: "MANAGER_SPECIAL", label: "Manager-approved special discount" },
  { code: "OTHER", label: "Other", requiresNote: true },
]);


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
    await client.query(`UPDATE tenant.pos_carts SET checkout_started_at=NULL,checkout_expires_at=NULL,checkout_started_by=NULL,checkout_tax_hash=NULL WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, cart.id]);
    await releasePosCheckoutStock(client, context, cart.checkout_reference, { reasonCode: "expired", reason: "POS checkout lapsed with no payment pending", cartId: cart.id });
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
    lineId: row.id,
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
    manualDiscount: row.manual_discount_type
      ? { type: row.manual_discount_type, value: row.manual_discount_value, reason: row.manual_discount_reason, alreadyAuthorized: true }
      : Number(row.manual_discount_amount) > 0
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
    `SELECT customer_id,billing_address_id,supply_mode,delivery_state_code,coupon_code,cart_discount_type,cart_discount_value,cart_discount_reason,loyalty_redeem_points,
            cart_discount_approval_id,cart_discount_approved_amount
     FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cart.id],
  );
  cart = { ...cart, ...current.rows[0] };

  const existingLines = await loadLines(client, context, cart.id);
  if (!existingLines.length) {
    await client.query(
      `UPDATE tenant.pos_carts
       SET status='draft',version=version+1,subtotal=0,manual_discount_total=0,promotion_discount_total=0,
           coupon_discount_total=0,discount_total=0,tax_total=0,rounding_adjustment=0,grand_total=0,cart_discount_total=0,cart_discount_eligible_base=NULL,
           cart_discount_issue_code=NULL,cart_discount_issue_message=NULL,
           tax_components='[]'::jsonb,updated_at=now(),updated_by=$3,current_cashier_user_id=$3,expires_at=now()+make_interval(mins=>$4)
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, cart.id, context.userId, policy.cart_expiry_minutes],
    );
    return getPosCart(client, context, cart.id);
  }

  const store = { id: cart.store_id, warehouse_id: cart.warehouse_id, currency_code: cart.currency_code, price_list_id: cart.price_list_id };
  const cartDiscount = cartDiscountOf(cart);
  const priced = await priceCartLines(client, context, {
    store,
    policy,
    customerId: cart.customer_id,
    billingAddressId: cart.billing_address_id,
    supplyMode: cart.supply_mode ?? "in_store",
    deliveryStateCode: cart.delivery_state_code ?? null,
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
           applied_promotion_ids=$13::uuid[],description=$14,loyalty_redeem_amount=$15,tax_classification=$16,hsn_sac_code=$17,tax_rate=$18,
           price_includes_tax=$19,cart_discount_amount=$20,cart_discount_excluded_reason=$21,updated_at=now()
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
        line.taxClassification ?? null,
        line.hsnSac ?? null,
        line.taxRatePercent ?? null,
        Boolean(line.taxInclusive),
        line.cartDiscountAmount,
        line.cartDiscountExcludedReason,
      ],
    );
  }

  const totals = priced.totals;
  await client.query(
    `UPDATE tenant.pos_carts
     SET status='priced',version=version+1,subtotal=$3,manual_discount_total=$4,promotion_discount_total=$5,
         coupon_discount_total=$6,discount_total=$7,tax_total=$8,rounding_adjustment=$9,grand_total=$10,
         priced_at=now(),updated_at=now(),updated_by=$11,current_cashier_user_id=$11,expires_at=now()+make_interval(mins=>$12),
         effective_price_list_id=$13,taxable_total=$14,tax_calculation_hash=$15,tax_error_code=NULL,tax_error_message=NULL,
         cart_discount_total=$16,cart_discount_eligible_base=$17,cart_discount_issue_code=$18,cart_discount_issue_message=$19
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
      priced.effectivePriceListId,
      totals.taxableTotal,
      priced.tax.hash,
      priced.cartDiscount.amount,
      priced.cartDiscount.type ? priced.cartDiscount.eligibleBase : null,
      priced.cartDiscount.issues[0]?.code ?? null,
      priced.cartDiscount.issues[0]?.message ?? null,
    ],
  );
  // The bill discount's current figures follow the bill (a percentage grows with it; the shares move with the lines).
  await client.query(
    `UPDATE tenant.pos_cart_adjustments SET eligible_base_amount=$3, calculated_discount_amount=$4, allocations=$5::jsonb, allocation_version=allocation_version+1, updated_at=now()
      WHERE organization_id=$1 AND cart_id=$2 AND status='active'
        AND (eligible_base_amount IS DISTINCT FROM $3::numeric OR calculated_discount_amount IS DISTINCT FROM $4::numeric OR allocations IS DISTINCT FROM $5::jsonb)`,
    [context.organizationId, cart.id, priced.cartDiscount.eligibleBase, priced.cartDiscount.amount, JSON.stringify(priced.cartDiscount.allocations)]);
  // An approval covers the amount it was given for: once the bill discount is larger, it must be within the cashier's own limits or approved again.
  if (cart.cart_discount_approval_id && cart.cart_discount_approved_amount !== null && cart.cart_discount_approved_amount !== undefined
      && decimal(priced.cartDiscount.amount) > decimal(cart.cart_discount_approved_amount)) {
    await client.query(`UPDATE tenant.pos_carts SET cart_discount_approval_id=NULL, cart_discount_approved_amount=NULL WHERE organization_id=$1 AND id=$2`, [context.organizationId, cart.id]);
    await cartEvent(client, context, cart.id, "cart_discount_applied",
      `Bill discount is now ${formatDecimal(decimal(priced.cartDiscount.amount))}, above the ${formatDecimal(decimal(cart.cart_discount_approved_amount))} the supervisor approved — it is checked again`,
      { action: "approval_invalidated", approvalId: cart.cart_discount_approval_id, approvedAmount: cart.cart_discount_approved_amount, amount: priced.cartDiscount.amount });
  }

  return { ...(await getPosCart(client, context, cart.id)), promotionExplanations: priced.promotionExplanations, coupon: priced.coupon, loyalty: priced.loyalty, tax: priced.tax,
    cartDiscount: priced.cartDiscount };
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
  const shift = (await client.query(`SELECT status, lifecycle_status FROM tenant.pos_shifts WHERE organization_id=$1 AND id=$2`, [context.organizationId, cart.shift_id])).rows[0];
  if (shift?.status !== "open" || shift.lifecycle_status !== "OPEN") throw posProductError("POS_SESSION_REQUIRED");
  await assertPosAction(client, context, { permission: "SALE_CREATE", outletId: cart.store_id });
  const quantity = input.quantity ?? 1;
  const existingLines = await loadLines(client, context, cartId);
  if (existingLines.length >= 200) throw posError(400, "A POS cart cannot contain more than 200 lines.", "POS_CART_LINE_LIMIT_EXCEEDED");
  const ctx = await resolvePosProductContext(client, context, { cartId });
  const inCart = existingLines.filter((line) => line.item_id === input.itemId).reduce((sum, line) => sum + decimal(line.base_quantity ?? line.quantity), decimal(0));
  const selection = await validatePosProductSelection(client, context, ctx, { itemId: input.itemId, uomId: input.uomId ?? null, quantity, alreadyInCartBase: inCart });
  await assertPosProductTaxable(client, context, cart, input.itemId);
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
  if (line.manual_discount_type === "amount" && mul(decimal(String(quantity)), decimal(line.unit_price ?? 0)) < decimal(line.manual_discount_value ?? 0))
    throw itemDiscountError(409, "POS_ITEM_DISCOUNT_QUANTITY_CHANGED",
      `${POS_ITEM_DISCOUNT_MESSAGES.POS_ITEM_DISCOUNT_QUANTITY_CHANGED} The line's ${formatDecimal(decimal(line.manual_discount_value))} discount would be more than its new value: change or remove the discount first.`);
  await client.query(`UPDATE tenant.pos_cart_lines SET quantity=$3, base_quantity=$4,
                       manual_discount_approval_id=CASE WHEN manual_discount_type IS NULL THEN manual_discount_approval_id ELSE NULL END
                       WHERE organization_id=$1 AND id=$2 AND cart_id=$5`,
    [context.organizationId, lineId, String(quantity), asDatabaseDecimal(baseQuantity), cartId]);
  if (line.manual_discount_approval_id && line.manual_discount_type)
    await cartEvent(client, context, cartId, "line_discount_applied", `${line.description ?? "Item"}: the supervisor's approval no longer applies after the quantity changed`,
      { lineId, approvalInvalidated: line.manual_discount_approval_id });
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

// ------------------------------------------------------------------ Item Discounts (migration 0090)
//
// A cashier's discount on one line: a percentage of the line (after any promotion it can stack with) or a fixed amount off the whole line,
// with a reason code. Checked by the pricing engine (the product's policy, the stacking rule, never above the line or below the lowest price)
// and by the cashier's profile (percentage, the line's amount, and all manual discounts on the sale); beyond those limits a supervisor's
// approval for exactly this line and amount is needed. Changing it replaces it; 0 removes it. The line's history keeps every change.

const itemDiscountError = (status, code, message = POS_ITEM_DISCOUNT_MESSAGES[code], details = undefined) => cartError(status, code, message, details);
const storeOf = (cart) => ({ id: cart.store_id, warehouse_id: cart.warehouse_id, currency_code: cart.currency_code, price_list_id: cart.price_list_id });

function readItemDiscount(input, policy) {
  const type = input.type === "percent" || input.type === "percentage" ? "percent" : input.type === "amount" || input.type === "fixed" ? "amount" : null;
  const invalid = type === "percent" ? "POS_ITEM_DISCOUNT_PERCENT_INVALID" : "POS_ITEM_DISCOUNT_AMOUNT_INVALID";
  if (!type) throw itemDiscountError(400, "POS_ITEM_DISCOUNT_AMOUNT_INVALID", "Choose a percentage or a fixed amount.");
  const raw = String(input.value ?? "").trim();
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) throw itemDiscountError(400, invalid);
  const value = decimal(raw);
  if (type === "percent" && value > decimal(100)) throw itemDiscountError(400, invalid, "A discount cannot be more than 100%.");
  const reasons = Array.isArray(policy.discount_reasons) && policy.discount_reasons.length ? policy.discount_reasons : DEFAULT_DISCOUNT_REASONS;
  const reasonCode = input.reasonCode ? String(input.reasonCode).trim().toUpperCase() : null;
  const reason = reasonCode ? reasons.find((entry) => entry.code === reasonCode) : null;
  if (reasonCode && !reason) throw itemDiscountError(400, "POS_ITEM_DISCOUNT_REASON_REQUIRED", "Choose one of the listed reasons.");
  const note = String(input.note ?? input.reason ?? "").trim().slice(0, 500) || null;
  if (reason?.requiresNote && !note) throw itemDiscountError(400, "POS_ITEM_DISCOUNT_REASON_REQUIRED", `Explain the reason "${reason.label}".`);
  return { type, value, zero: value === 0n, reasonCode, reasonLabel: reason?.label ?? null, note, hasReason: Boolean(reasonCode || note) };
}

// The bill priced with one line's proposed manual discount, by the pricing engine, without saving anything.
async function priceWithLineDiscount(client, context, cart, policy, lineId, proposal) {
  const lines = await loadLines(client, context, cart.id);
  const index = lines.findIndex((line) => line.id === lineId);
  if (index < 0) throw posError(404, "Cart line was not found.", "POS_CART_LINE_NOT_FOUND");
  // proposal: a discount to try on the line; null: none; undefined: the line as it is.
  const input = toPricingInputLines(lines).map((line, position) => (position === index && proposal !== undefined
    ? { ...line, manualDiscount: proposal ? { type: proposal.type, value: asDatabaseDecimal(proposal.value), reason: proposal.reasonLabel ?? proposal.note, alreadyAuthorized: true } : null }
    : line));
  const current = (await client.query(`SELECT customer_id,billing_address_id,supply_mode,delivery_state_code,coupon_code,cart_discount_type,cart_discount_value,cart_discount_reason,loyalty_redeem_points
    FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`, [context.organizationId, cart.id])).rows[0];
  const priced = await priceCartLines(client, context, {
    store: storeOf(cart), policy, customerId: current.customer_id, billingAddressId: current.billing_address_id, supplyMode: current.supply_mode ?? "in_store",
    deliveryStateCode: current.delivery_state_code ?? null, lines: input,
    cartDiscount: cartDiscountOf(current),
    couponCode: current.coupon_code, loyaltyRedeemPoints: current.loyalty_redeem_points,
  });
  return { target: lines[index], lines, priced, line: priced.lines[index] };
}

// The cashier's authority for a line discount: percentage (of the line's value), the line's amount, and all manual discounts on the sale.
async function lineDiscountRequest(client, context, cart, lineId, amount, gross, extra = {}) {
  const total = await manualDiscountTotal(client, context, cart, { lineId, lineAmount: amount });
  return {
    permission: "DISCOUNT_LINE_MANUAL", outletId: cart.store_id, lineId,
    percentage: formatDecimal(gross > 0n ? div(mul(amount, decimal(100)), gross) : decimal(100)), amount: formatDecimal(amount), aggregateAmount: total,
    resource: { type: "pos_cart", id: cart.id, version: cart.version }, ...extra,
  };
}

function mapDiscountAuthorityError(error, request, proposal) {
  const kind = error.details?.limit;
  if (error.code === "POS_PERMISSION_DENIED") return itemDiscountError(403, "POS_ITEM_DISCOUNT_PERMISSION_DENIED");
  // A limit exceeded (the details name the approval to ask for) — not an approval that is still pending or not usable.
  if (error.code === "POS_APPROVAL_REQUIRED" && error.details?.approvalCode) {
    const limit = { percentage: "POS_ITEM_DISCOUNT_PERCENT_LIMIT", amount: "POS_ITEM_DISCOUNT_AMOUNT_LIMIT", aggregate: "POS_ITEM_DISCOUNT_AGGREGATE_LIMIT" }[kind];
    return itemDiscountError(409, "POS_ITEM_DISCOUNT_APPROVAL_REQUIRED", `${limit ? POS_ITEM_DISCOUNT_MESSAGES[limit] : ""} ${POS_ITEM_DISCOUNT_MESSAGES.POS_ITEM_DISCOUNT_APPROVAL_REQUIRED}`.trim(), {
      ...error.details, limitCode: limit ?? null, lineId: request.lineId,
      action: { lineId: request.lineId, type: proposal.type, value: asDatabaseDecimal(proposal.value), aggregateAmount: request.aggregateAmount },
    });
  }
  if (error.code === "POS_PERMISSION_LIMIT_EXCEEDED")
    return itemDiscountError(403, { percentage: "POS_ITEM_DISCOUNT_PERCENT_LIMIT", amount: "POS_ITEM_DISCOUNT_AMOUNT_LIMIT", aggregate: "POS_ITEM_DISCOUNT_AGGREGATE_LIMIT" }[kind] ?? "POS_ITEM_DISCOUNT_PERMISSION_DENIED");
  if (error.code === "POS_APPROVAL_EXPIRED") return itemDiscountError(409, "POS_ITEM_DISCOUNT_APPROVAL_EXPIRED");
  if (["POS_APPROVAL_TRANSACTION_CHANGED", "POS_APPROVAL_ALREADY_CONSUMED", "POS_APPROVAL_NOT_FOUND", "POS_APPROVER_NOT_AUTHORIZED", "POS_APPROVAL_REQUIRED"].includes(error.code))
    return itemDiscountError(409, "POS_ITEM_DISCOUNT_APPROVAL_INVALID", `${POS_ITEM_DISCOUNT_MESSAGES.POS_ITEM_DISCOUNT_APPROVAL_INVALID} ${error.message}`);
  return error;
}

// Apply or change a line's manual discount. input: type ("percent" | "amount"), value, reasonCode, note, approvalId, expectedVersion,
// idempotencyKey. A value of 0 removes the discount.
export async function applyPosCartLineDiscount(client, context, cartId, lineId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, { ...input, lineId }, "line_discount");
  if (replay) return replay;
  const proposal = readItemDiscount(input, policy);
  if (proposal.zero) return removeLineDiscountWithin(client, context, cart, policy, lineId, claim, "Discount set to 0");
  const { target, line } = await priceWithLineDiscount(client, context, cart, policy, lineId, proposal);
  if (target.price_override) throw itemDiscountError(409, "POS_ITEM_DISCOUNT_OVERRIDE_CONFLICT");
  if (line.discountIssues?.length) throw itemDiscountError(409, line.discountIssues[0].code, line.discountIssues[0].message, { issues: line.discountIssues });
  if ((policy.discount_reason_required || input.approvalId) && !proposal.hasReason) throw itemDiscountError(400, "POS_ITEM_DISCOUNT_REASON_REQUIRED");
  const amount = decimal(line.manualDiscountAmount);
  const request = await lineDiscountRequest(client, context, cart, lineId, amount, decimal(line.grossAmount),
    { reason: proposal.reasonLabel ?? proposal.note ?? "recorded", approvalId: input.approvalId });
  let decision;
  try { decision = await assertPosAction(client, context, request); } catch (error) { throw mapDiscountAuthorityError(error, request, proposal); }
  const previous = target.manual_discount_type ? { type: target.manual_discount_type, value: target.manual_discount_value, amount: target.manual_discount_amount,
    reasonCode: target.manual_discount_reason_code ?? null } : null;
  await client.query(
    `UPDATE tenant.pos_cart_lines SET manual_discount_type=$3,manual_discount_value=$4,manual_discount_amount=$5,manual_discount_reason=$6,manual_discount_reason_code=$7,
            manual_discount_note=$8,manual_discount_approval_id=$9 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, lineId, proposal.type, asDatabaseDecimal(proposal.value), asDatabaseDecimal(amount), proposal.reasonLabel ?? proposal.note, proposal.reasonCode,
      proposal.note, decision.approvalId ?? null]);
  const result = await reprice(client, context, cart, policy);
  const label = proposal.type === "percent" ? `${formatDecimal(proposal.value)}%` : formatDecimal(proposal.value);
  await cartEvent(client, context, cartId, "line_discount_applied",
    `${target.description ?? "Item"}: ${previous ? "discount changed to" : "discount"} ${label} (${formatDecimal(amount)})${proposal.reasonLabel ? ` — ${proposal.reasonLabel}` : ""}${decision.approvalId ? " — approved" : ""}`,
    { lineId, previous, type: proposal.type, value: asDatabaseDecimal(proposal.value), amount: asDatabaseDecimal(amount), reasonCode: proposal.reasonCode, note: proposal.note,
      approvalId: decision.approvalId ?? null });
  await recordCartAction(client, context, cartId, claim, lineId);
  return result;
}

async function removeLineDiscountWithin(client, context, cart, policy, lineId, claim, why = "Discount removed") {
  const target = (await client.query(`SELECT id, description, manual_discount_type, manual_discount_value, manual_discount_amount, manual_discount_reason_code, manual_discount_approval_id
    FROM tenant.pos_cart_lines WHERE organization_id=$1 AND id=$2 AND cart_id=$3`, [context.organizationId, lineId, cart.id])).rows[0];
  if (!target) throw posError(404, "Cart line was not found.", "POS_CART_LINE_NOT_FOUND");
  await client.query(
    `UPDATE tenant.pos_cart_lines SET manual_discount_type=NULL,manual_discount_value=NULL,manual_discount_amount=0,manual_discount_reason=NULL,manual_discount_reason_code=NULL,
            manual_discount_note=NULL,manual_discount_approval_id=NULL WHERE organization_id=$1 AND id=$2 AND cart_id=$3`, [context.organizationId, lineId, cart.id]);
  const result = await reprice(client, context, cart, policy);
  await cartEvent(client, context, cart.id, "line_discount_removed", `${target.description ?? "Item"}: ${why.toLowerCase()}`,
    { lineId, previous: target.manual_discount_type || Number(target.manual_discount_amount) > 0 ? { type: target.manual_discount_type, value: target.manual_discount_value,
      amount: target.manual_discount_amount, reasonCode: target.manual_discount_reason_code ?? null, approvalId: target.manual_discount_approval_id ?? null } : null });
  await recordCartAction(client, context, cart.id, claim, lineId);
  return result;
}

// Remove a line's manual discount: any promotion still applies, prices and tax are worked out again, the history keeps what was there.
export async function removePosCartLineDiscount(client, context, cartId, lineId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, { ...input, lineId }, "remove_line_discount");
  if (replay) return replay;
  return removeLineDiscountWithin(client, context, cart, policy, lineId, claim);
}

// What a proposed discount would do, before it is applied: the line's value, the promotion, the discount, taxable value, tax and line total,
// the bill's new total, and whether the cashier may give it (ALLOWED), needs a supervisor (REQUIRES_APPROVAL), may not (DENIED) or it is
// not a valid discount for this line (INVALID, with the reasons). Changes nothing. input: type, value.
export async function previewPosCartLineDiscount(client, context, cartId, lineId, input = {}) {
  requirePermission(context, "pos.view");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId, { requireOpen: false });
  let proposal;
  try { proposal = readItemDiscount({ ...input, reasonCode: undefined, note: undefined, reason: undefined }, policy); }
  catch (error) { return { status: "INVALID", issues: [{ code: error.code, message: error.message }] }; }
  const before = await priceWithLineDiscount(client, context, cart, policy, lineId, undefined);
  const after = await priceWithLineDiscount(client, context, cart, policy, lineId, proposal.zero ? null : proposal);
  const line = after.line;
  const issues = [...(line.discountIssues ?? [])];
  if (after.target.price_override && !proposal.zero) issues.push({ code: "POS_ITEM_DISCOUNT_OVERRIDE_CONFLICT", message: POS_ITEM_DISCOUNT_MESSAGES.POS_ITEM_DISCOUNT_OVERRIDE_CONFLICT });
  const amount = decimal(line.manualDiscountAmount);
  let status = issues.length ? "INVALID" : "ALLOWED";
  let authority = null;
  if (!issues.length && !proposal.zero) {
    const request = await lineDiscountRequest(client, context, cart, lineId, amount, decimal(line.grossAmount), { reason: "preview" });
    const decision = await authorizePosAction(client, context, request);
    status = decision.decision === "ALLOW" ? "ALLOWED" : decision.decision === "REQUIRES_APPROVAL" ? "REQUIRES_APPROVAL" : "DENIED";
    authority = { percentage: request.percentage, amount: request.amount, aggregateAmount: request.aggregateAmount, limit: decision.details?.limit ?? null,
      message: decision.decision === "ALLOW" ? "Within your limits." : decision.message ?? null,
      approval: decision.decision === "REQUIRES_APPROVAL" ? { permission: "DISCOUNT_LINE_MANUAL", amount: request.amount, percentage: request.percentage,
        resource: { type: "pos_cart", id: cart.id }, action: { lineId, type: proposal.type, value: asDatabaseDecimal(proposal.value), aggregateAmount: request.aggregateAmount } } : null };
  }
  return {
    status, issues, authority, cartVersion: Number(cart.version), reasonRequired: Boolean(policy.discount_reason_required),
    line: {
      lineId, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, grossAmount: line.grossAmount, promotionAmount: line.promotionDiscountAmount,
      manualDiscountAmount: line.manualDiscountAmount, cartDiscountAmount: line.cartDiscountAmount, taxableAmount: line.taxableAmount, taxAmount: line.taxAmount,
      lineTotal: line.lineTotal, priceIncludesTax: Boolean(line.taxInclusive),
    },
    bill: { totalBefore: before.priced.totals.grandTotal, totalAfter: after.priced.totals.grandTotal, taxBefore: before.priced.totals.taxTotal, taxAfter: after.priced.totals.taxTotal },
  };
}

// Whether a line can take a manual discount and on what terms: the product's policy, the stacking rule and any promotion on it, the price
// override, the current discount, the reasons, and the cashier's limits with what is left of the sale total.
export async function getPosCartLineDiscountEligibility(client, context, cartId, lineId) {
  requirePermission(context, "pos.view");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId, { requireOpen: false });
  const { target, line } = await priceWithLineDiscount(client, context, cart, policy, lineId, undefined);
  const item = (await client.query(
    `SELECT item.manual_discount_allowed, item.max_manual_discount_percent, item.min_selling_price, item_group.name AS group_name, item_group.manual_discount_allowed AS group_allowed,
            item_group.max_manual_discount_percent AS group_max
       FROM tenant.items item LEFT JOIN tenant.item_groups item_group ON item_group.organization_id = item.organization_id AND item_group.id = item.group_id
      WHERE item.organization_id=$1 AND item.id=$2`, [context.organizationId, target.item_id])).rows[0] ?? {};
  const decision = await authorizePosAction(client, context, { permission: "DISCOUNT_LINE_MANUAL", outletId: cart.store_id });
  const grant = decision.grant ?? null;
  const used = await manualDiscountTotal(client, context, cart, { lineId, lineAmount: decimal(0) });
  const aggregateLimit = grant?.limitMode === "limited" ? grant.maxAggregateAmount ?? grant.maxAmount ?? null : null;
  const maxPercents = [item.max_manual_discount_percent, item.group_max, policy.max_line_discount_percent].filter((value) => value !== null && value !== undefined).map(Number);
  const promotion = Number(line.promotionDiscountAmount);
  return {
    lineId, cartVersion: Number(cart.version),
    discountable: item.manual_discount_allowed !== false && item.group_allowed !== false && !target.price_override
      && !(promotion > 0 && (policy.manual_discount_stacking ?? "non_stackable") === "non_stackable"),
    blockedBy: item.manual_discount_allowed === false ? "product" : item.group_allowed === false ? `category ${item.group_name ?? ""}`.trim()
      : target.price_override ? "price override" : promotion > 0 && (policy.manual_discount_stacking ?? "non_stackable") === "non_stackable" ? "promotion" : null,
    maxPercent: maxPercents.length ? Math.min(...maxPercents) : null, minSellingPrice: item.min_selling_price === null || item.min_selling_price === undefined ? null : Number(item.min_selling_price),
    stacking: policy.manual_discount_stacking ?? "non_stackable", allowFullDiscount: Boolean(policy.allow_full_line_discount),
    line: { grossAmount: line.grossAmount, promotionAmount: line.promotionDiscountAmount, unitPrice: line.unitPrice, quantity: line.quantity, priceIncludesTax: Boolean(line.taxInclusive) },
    current: target.manual_discount_type ? { type: target.manual_discount_type, value: target.manual_discount_value, amount: target.manual_discount_amount,
      reasonCode: target.manual_discount_reason_code ?? null, note: target.manual_discount_note ?? null, approved: Boolean(target.manual_discount_approval_id) } : null,
    reasons: Array.isArray(policy.discount_reasons) && policy.discount_reasons.length ? policy.discount_reasons : DEFAULT_DISCOUNT_REASONS,
    reasonRequired: Boolean(policy.discount_reason_required),
    authority: {
      canDiscount: decision.decision === "ALLOW", denied: decision.decision === "DENY" ? decision.message ?? "You cannot apply Item Discounts." : null,
      mode: grant?.limitMode ?? null, maxPercentage: grant?.maxPercentage ?? null, maxAmount: grant?.maxAmount ?? null, maxAggregateAmount: aggregateLimit,
      usedOnSale: used, remainingOnSale: aggregateLimit === null ? null : formatDecimal(max(sub(decimal(aggregateLimit), decimal(used)), decimal(0))),
    },
  };
}

// Every discount on the bill, line by line, kept apart: promotion, manual (type, value, amount, reason), the line's share of the order
// discount, and any problem — with the totals of each kind.
export async function listPosCartDiscounts(client, context, cartId) {
  requirePermission(context, "pos.view");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId, { requireOpen: false });
  const lines = await loadLines(client, context, cartId);
  if (!lines.length) return { cartVersion: Number(cart.version), lines: [], totals: { promotion: "0", manual: "0", cart: "0" } };
  const { priced } = await priceWithLineDiscount(client, context, cart, policy, lines[0].id, undefined);
  const sum = (key) => formatDecimal(priced.lines.reduce((total, line) => add(total, decimal(line[key] ?? 0)), decimal(0)));
  return {
    cartVersion: Number(cart.version),
    lines: priced.lines.map((line, index) => ({
      lineId: lines[index].id, description: line.description, grossAmount: line.grossAmount, promotionAmount: line.promotionDiscountAmount,
      manual: lines[index].manual_discount_type ? { type: lines[index].manual_discount_type, value: lines[index].manual_discount_value, amount: line.manualDiscountAmount,
        reasonCode: lines[index].manual_discount_reason_code ?? null, approved: Boolean(lines[index].manual_discount_approval_id) } : null,
      cartDiscountAmount: line.cartDiscountAmount, taxableAmount: line.taxableAmount, lineTotal: line.lineTotal, issues: line.discountIssues ?? [],
    })),
    totals: { promotion: sum("promotionDiscountAmount"), manual: sum("manualDiscountAmount"), cart: sum("cartDiscountAmount") },
  };
}

// The sale's total manual discount (every line's plus the order discount), with one line's or the order's amount replaced by what is being
// applied — the figure the cashier's per-sale amount limit caps, so a discount cannot be split across lines to get past it.
async function manualDiscountTotal(client, context, cart, { lineId = null, lineAmount = null, orderAmount = null } = {}) {
  const lines = (await client.query(`SELECT id, manual_discount_amount FROM tenant.pos_cart_lines WHERE organization_id=$1 AND cart_id=$2`, [context.organizationId, cart.id])).rows;
  const lineAmounts = lines.map((line) => (line.id === lineId ? lineAmount : line.manual_discount_amount));
  const stored = (await client.query(`SELECT cart_discount_total FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`, [context.organizationId, cart.id])).rows[0]?.cart_discount_total ?? 0;
  const order = orderAmount !== null ? orderAmount : decimal(stored);
  return formatDecimal(sumAmounts([...lineAmounts.map((value) => (typeof value === "bigint" ? formatDecimal(value) : value ?? 0)), formatDecimal(order)]));
}

// At checkout, every manual discount and price override on the cart is authorized again as of now (a permission revoked during the session
// counts): within the cashier's current limits, or allowed by the approval recorded when it was applied.
export async function assertPosCartDiscountsAuthorized(client, context, cart) {
  const lines = (await client.query(
    `SELECT line.id, line.item_id, line.gross_amount, line.manual_discount_amount, line.manual_discount_approval_id, line.price_override, line.unit_price,
            line.price_override_reason, line.price_override_approval_id
       FROM tenant.pos_cart_lines line WHERE line.organization_id=$1 AND line.cart_id=$2`, [context.organizationId, cart.id])).rows;
  const fresh = (await client.query(
    `SELECT cart_discount_type, cart_discount_value, cart_discount_total, cart_discount_eligible_base, cart_discount_approval_id, cart_discount_reason
       FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`, [context.organizationId, cart.id])).rows[0] ?? {};
  const approved = lines.some((line) => line.manual_discount_approval_id) || Boolean(fresh.cart_discount_approval_id);
  const total = await manualDiscountTotal(client, context, cart);
  for (const line of lines) {
    const amount = decimal(line.manual_discount_amount);
    if (amount > 0n && !line.manual_discount_approval_id) {
      const gross = decimal(line.gross_amount);
      await assertPosAction(client, context, { permission: "DISCOUNT_LINE_MANUAL", outletId: cart.store_id, reason: "recorded",
        percentage: formatDecimal(gross > 0n ? div(mul(amount, decimal(100)), gross) : 0n), amount: formatDecimal(amount), aggregateAmount: approved ? undefined : total });
    }
    if (line.price_override && !line.price_override_approval_id) {
      const listPrice = await resolveListUnitPrice(client, context, { price_list_id: cart.price_list_id, currency_code: cart.currency_code }, line.item_id);
      const requested = decimal(line.unit_price);
      const deviation = listPrice && listPrice > 0n ? div(mul(max(sub(requested, listPrice), sub(listPrice, requested)), decimal(100)), listPrice) : decimal(100);
      await assertPosAction(client, context, { permission: "PRICE_OVERRIDE", outletId: cart.store_id, reason: line.price_override_reason, percentage: formatDecimal(deviation) });
    }
  }
  const orderAmount = decimal(fresh.cart_discount_total ?? 0);
  if (fresh.cart_discount_type && orderAmount > 0n && !fresh.cart_discount_approval_id) {
    const base = decimal(fresh.cart_discount_eligible_base ?? 0);
    const request = { permission: "DISCOUNT_ORDER_MANUAL", outletId: cart.store_id, reason: fresh.cart_discount_reason ?? "recorded",
      percentage: formatDecimal(base > 0n ? div(mul(orderAmount, decimal(100)), base) : decimal(100)), amount: formatDecimal(orderAmount), aggregateAmount: approved ? undefined : total };
    try { await assertPosAction(client, context, request); }
    catch (error) {
      throw mapCartAuthorityError(error, request, null, { type: fresh.cart_discount_type, value: formatDecimal(decimal(fresh.cart_discount_value)), eligibleBase: formatDecimal(base) });
    }
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
    `SELECT id FROM tenant.pos_shifts WHERE organization_id=$1 AND id=$2 AND terminal_id=$3 AND status='open' AND lifecycle_status='OPEN'`,
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

// ------------------------------------------------------------------ Cart Discounts (migration 0091)
//
// One cashier discount on the whole bill: a percentage of the eligible value, or a fixed amount off it. The pricing engine decides which lines
// are eligible and allocates it (see cart-pricing.js); this checks the cashier's profile (DISCOUNT_ORDER_MANUAL: percentage of the eligible
// value, the amount, and all manual discounts on the sale) and, beyond those limits, a supervisor's approval for exactly this discount on this
// version of the bill. Changing it replaces it (the history keeps the old one); 0 or no type removes it. A percentage follows the bill; a
// fixed amount stays fixed and is reported when the eligible value falls below it. An approval covers the amount it was given for: if the
// bill grows and the discount with it, the larger amount must be within the cashier's own limits or approved again.

const DEFAULT_CART_DISCOUNT_REASONS = Object.freeze([
  { code: "CUSTOMER_GOODWILL", label: "Customer goodwill" }, { code: "BULK_PURCHASE", label: "Bulk purchase" }, { code: "COMPLAINT", label: "Customer complaint" },
  { code: "SPECIAL_NEGOTIATION", label: "Special negotiation" }, { code: "PROMOTIONAL_EXCEPTION", label: "Promotional exception" }, { code: "PRICE_MATCH", label: "Price matching" },
  { code: "OTHER", label: "Other", requiresNote: true },
]);
const cartDiscountError = (status, code, message = POS_CART_DISCOUNT_MESSAGES[code], details = undefined) => cartError(status, code, message, details);
const cartDiscountReasons = (policy) => (Array.isArray(policy.cart_discount_reasons) && policy.cart_discount_reasons.length ? policy.cart_discount_reasons : DEFAULT_CART_DISCOUNT_REASONS);

function readCartDiscount(input, policy) {
  const raw = String(input.type ?? input.discountType ?? input.discount_type ?? "").trim().toLowerCase();
  const type = ["percent", "percentage"].includes(raw) ? "percent" : ["amount", "fixed", "fixed_amount"].includes(raw) ? "amount" : null;
  if (!type) throw cartDiscountError(400, "POS_CART_DISCOUNT_AMOUNT_INVALID", "Choose a percentage or a fixed amount.");
  const invalid = type === "percent" ? "POS_CART_DISCOUNT_PERCENT_INVALID" : "POS_CART_DISCOUNT_AMOUNT_INVALID";
  const text = String(input.value ?? "").trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text)) throw cartDiscountError(400, invalid);
  const value = decimal(text);
  if (type === "percent" && value > decimal(100)) throw cartDiscountError(400, invalid, "A discount cannot be more than 100%.");
  const reasonCode = String(input.reasonCode ?? input.reason_code ?? "").trim().toUpperCase() || null;
  const reason = reasonCode ? cartDiscountReasons(policy).find((entry) => entry.code === reasonCode) : null;
  if (reasonCode && !reason) throw cartDiscountError(400, "POS_CART_DISCOUNT_REASON_REQUIRED", "Choose one of the listed reasons.");
  const note = String(input.note ?? input.reason ?? "").trim().slice(0, 500) || null;
  if (reason?.requiresNote && !note) throw cartDiscountError(400, "POS_CART_DISCOUNT_REASON_REQUIRED", `Explain the reason "${reason.label}".`);
  return { type, value, zero: value === 0n, reasonCode, reasonLabel: reason?.label ?? null, note, hasReason: Boolean(reasonCode || note) };
}

// The bill priced with a proposed bill discount (undefined: as stored; null: none), by the pricing engine, without saving anything.
async function priceWithCartDiscount(client, context, cart, policy, proposal) {
  const lines = await loadLines(client, context, cart.id);
  if (!lines.length) throw cartDiscountError(409, "POS_CART_DISCOUNT_NO_ELIGIBLE_ITEMS", "Add products to the bill before a Cart Discount.");
  const current = (await client.query(
    `SELECT customer_id,billing_address_id,supply_mode,delivery_state_code,coupon_code,cart_discount_type,cart_discount_value,cart_discount_reason,loyalty_redeem_points,
            cart_discount_reason_code,cart_discount_note,cart_discount_approval_id,cart_discount_total
       FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`, [context.organizationId, cart.id])).rows[0];
  const discount = proposal === undefined ? cartDiscountOf(current)
    : proposal ? { type: proposal.type, value: asDatabaseDecimal(proposal.value), reason: proposal.reasonLabel ?? proposal.note } : null;
  const priced = await priceCartLines(client, context, {
    store: storeOf(cart), policy, customerId: current.customer_id, billingAddressId: current.billing_address_id, supplyMode: current.supply_mode ?? "in_store",
    deliveryStateCode: current.delivery_state_code ?? null, lines: toPricingInputLines(lines), cartDiscount: discount, couponCode: current.coupon_code,
    loyaltyRedeemPoints: current.loyalty_redeem_points,
  });
  return { lines, current, priced };
}

// The cashier's authority for a bill discount: percentage of the eligible value, the amount, and all manual discounts on the sale.
async function cartDiscountRequest(client, context, cart, priced, extra = {}) {
  const amount = decimal(priced.cartDiscount.amount);
  const base = decimal(priced.cartDiscount.eligibleBase);
  const lineTotal = priced.lines.reduce((sum, line) => add(sum, decimal(line.manualDiscountAmount)), decimal(0));
  return {
    permission: "DISCOUNT_ORDER_MANUAL", outletId: cart.store_id,
    percentage: formatDecimal(base > 0n ? div(mul(amount, decimal(100)), base) : decimal(100)), amount: formatDecimal(amount), aggregateAmount: formatDecimal(add(lineTotal, amount)),
    fingerprint: priced.cartDiscount.fingerprint, resource: { type: "pos_cart", id: cart.id, version: cart.version }, ...extra,
  };
}

const CART_LIMIT_CODES = { percentage: "POS_CART_DISCOUNT_PERCENT_LIMIT", amount: "POS_CART_DISCOUNT_AMOUNT_LIMIT", aggregate: "POS_CART_DISCOUNT_AGGREGATE_LIMIT" };
function cartApprovalAction(request, proposal, summary) {
  return { scope: "cart", type: proposal?.type ?? summary.type, value: proposal ? asDatabaseDecimal(proposal.value) : summary.value, amount: request.amount,
    eligibleBase: summary.eligibleBase, aggregateAmount: request.aggregateAmount, fingerprint: request.fingerprint ?? null };
}
function mapCartAuthorityError(error, request, proposal, summary) {
  const kind = error.details?.limit;
  if (["POS_PERMISSION_DENIED", "POS_PERMISSION_PROFILE_MISSING", "POS_PERMISSION_PROFILE_INACTIVE"].includes(error.code)) return cartDiscountError(403, "POS_CART_DISCOUNT_PERMISSION_DENIED");
  if (error.code === "POS_APPROVAL_REQUIRED" && error.details?.approvalCode) {
    const limit = CART_LIMIT_CODES[kind];
    return cartDiscountError(409, "POS_CART_DISCOUNT_APPROVAL_REQUIRED", `${limit ? POS_CART_DISCOUNT_MESSAGES[limit] : ""} ${POS_CART_DISCOUNT_MESSAGES.POS_CART_DISCOUNT_APPROVAL_REQUIRED}`.trim(), {
      ...error.details, limitCode: limit ?? null, action: cartApprovalAction(request, proposal, summary),
    });
  }
  if (error.code === "POS_PERMISSION_LIMIT_EXCEEDED") return cartDiscountError(403, CART_LIMIT_CODES[kind] ?? "POS_CART_DISCOUNT_PERMISSION_DENIED");
  if (error.code === "POS_APPROVAL_EXPIRED") return cartDiscountError(409, "POS_CART_DISCOUNT_APPROVAL_EXPIRED");
  if (["POS_APPROVAL_TRANSACTION_CHANGED", "POS_APPROVAL_ALREADY_CONSUMED", "POS_APPROVAL_NOT_FOUND", "POS_APPROVER_NOT_AUTHORIZED", "POS_APPROVAL_REQUIRED"].includes(error.code))
    return cartDiscountError(409, "POS_CART_DISCOUNT_APPROVAL_INVALID", `${POS_CART_DISCOUNT_MESSAGES.POS_CART_DISCOUNT_APPROVAL_INVALID} ${error.message}`);
  return error;
}

// May this person give (or take off) a bill discount at all — the permission, not a limit.
async function assertCartDiscountPermission(client, context, cart) {
  const decision = await authorizePosAction(client, context, { permission: "DISCOUNT_ORDER_MANUAL", outletId: cart.store_id });
  if (decision.decision === "DENY") throw cartDiscountError(403, "POS_CART_DISCOUNT_PERMISSION_DENIED");
  return decision;
}

const discountLabel = (type, value) => (type === "percent" ? `${formatDecimal(decimal(value))}%` : formatDecimal(decimal(value)));

// Apply or replace the bill discount. input: type ("percent" | "amount"), value, reasonCode, note, approvalId, expectedVersion,
// idempotencyKey. No type, or a value of 0, removes it.
export async function setPosCartDiscount(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, input, "cart_discount");
  if (replay) return replay;
  if (input.type == null && input.discountType == null && input.discount_type == null) return removeCartDiscountWithin(client, context, cart, policy, claim);
  const proposal = readCartDiscount(input, policy);
  if (proposal.zero) return removeCartDiscountWithin(client, context, cart, policy, claim, "Bill discount set to 0");
  await assertCartDiscountPermission(client, context, cart);
  const { priced, current } = await priceWithCartDiscount(client, context, cart, policy, proposal);
  const summary = priced.cartDiscount;
  if (summary.issues.length) throw cartDiscountError(409, summary.issues[0].code, summary.issues[0].message, { issues: summary.issues, excluded: summary.excluded });
  if ((policy.discount_reason_required || input.approvalId) && !proposal.hasReason) throw cartDiscountError(400, "POS_CART_DISCOUNT_REASON_REQUIRED");
  const amount = decimal(summary.amount);
  const request = await cartDiscountRequest(client, context, cart, priced, { reason: proposal.reasonLabel ?? proposal.note ?? "recorded", approvalId: input.approvalId });
  let decision;
  try { decision = await assertPosAction(client, context, request); } catch (error) { throw mapCartAuthorityError(error, request, proposal, summary); }
  const previous = (await client.query(
    `UPDATE tenant.pos_cart_adjustments SET status='replaced', ended_at=now(), ended_by=$3, updated_by=$3, updated_at=now(), version=version+1
      WHERE organization_id=$1 AND cart_id=$2 AND adjustment_type='manual_cart_discount' AND status='active' RETURNING *`,
    [context.organizationId, cart.id, context.userId])).rows[0] ?? null;
  await client.query(
    `INSERT INTO tenant.pos_cart_adjustments (organization_id, cart_id, discount_type, entered_value, eligible_base_amount, calculated_discount_amount, currency_code, reason_code,
       reason_note, approval_id, allocations, cart_version, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$13)`,
    [context.organizationId, cart.id, proposal.type, asDatabaseDecimal(proposal.value), summary.eligibleBase, summary.amount, cart.currency_code, proposal.reasonCode, proposal.note,
      decision.approvalId ?? null, JSON.stringify(summary.allocations), cart.version, context.userId]);
  await client.query(
    `UPDATE tenant.pos_carts SET cart_discount_type=$3,cart_discount_value=$4,cart_discount_reason=$5,cart_discount_reason_code=$6,cart_discount_note=$7,cart_discount_approval_id=$8,
            cart_discount_approved_amount=$9 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cart.id, proposal.type, asDatabaseDecimal(proposal.value), proposal.reasonLabel ?? proposal.note, proposal.reasonCode, proposal.note,
      decision.approvalId ?? null, decision.approvalId ? asDatabaseDecimal(amount) : null]);
  const result = await reprice(client, context, cart, policy);
  const was = current.cart_discount_type ? { type: current.cart_discount_type, value: current.cart_discount_value, amount: current.cart_discount_total,
    reasonCode: current.cart_discount_reason_code ?? null, approvalId: current.cart_discount_approval_id ?? null } : null;
  await cartEvent(client, context, cart.id, "cart_discount_applied",
    `Bill discount ${was ? `changed from ${discountLabel(was.type, was.value)} to` : ""} ${discountLabel(proposal.type, proposal.value)} (${formatDecimal(amount)} off ${formatDecimal(decimal(summary.eligibleBase))})`
      .replace(/\s+/g, " ") + `${proposal.reasonLabel ? ` — ${proposal.reasonLabel}` : ""}${decision.approvalId ? " — approved" : ""}`,
    { action: was ? "changed" : "applied", previous: was, previousAdjustmentId: previous?.id ?? null, type: proposal.type, value: asDatabaseDecimal(proposal.value),
      amount: summary.amount, eligibleBase: summary.eligibleBase, excluded: summary.excluded.length, reasonCode: proposal.reasonCode, note: proposal.note,
      approvalId: decision.approvalId ?? null, allocations: summary.allocations });
  await recordCartAction(client, context, cart.id, claim);
  return result;
}

async function removeCartDiscountWithin(client, context, cart, policy, claim, why = "Bill discount removed") {
  await assertCartDiscountPermission(client, context, cart);
  const current = (await client.query(
    `SELECT cart_discount_type, cart_discount_value, cart_discount_total, cart_discount_reason_code, cart_discount_approval_id FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cart.id])).rows[0];
  const ended = (await client.query(
    `UPDATE tenant.pos_cart_adjustments SET status='removed', ended_at=now(), ended_by=$3, updated_by=$3, updated_at=now(), version=version+1
      WHERE organization_id=$1 AND cart_id=$2 AND adjustment_type='manual_cart_discount' AND status='active' RETURNING id`,
    [context.organizationId, cart.id, context.userId])).rows[0] ?? null;
  await client.query(
    `UPDATE tenant.pos_carts SET cart_discount_type=NULL,cart_discount_value=NULL,cart_discount_reason=NULL,cart_discount_reason_code=NULL,cart_discount_note=NULL,
            cart_discount_approval_id=NULL,cart_discount_approved_amount=NULL WHERE organization_id=$1 AND id=$2`, [context.organizationId, cart.id]);
  const result = await reprice(client, context, cart, policy);
  await cartEvent(client, context, cart.id, "cart_discount_removed", why,
    { action: "removed", adjustmentId: ended?.id ?? null, previous: current.cart_discount_type ? { type: current.cart_discount_type, value: current.cart_discount_value,
      amount: current.cart_discount_total, reasonCode: current.cart_discount_reason_code ?? null, approvalId: current.cart_discount_approval_id ?? null } : null });
  await recordCartAction(client, context, cart.id, claim);
  return result;
}

// Remove the bill discount: lines and tax are worked out again; the history keeps what was there.
export async function removePosCartDiscount(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, input, "remove_cart_discount");
  if (replay) return replay;
  return removeCartDiscountWithin(client, context, cart, policy, claim);
}

const linePreview = (line) => ({
  lineId: line.lineId, description: line.description, grossAmount: line.grossAmount, itemDiscountAmount: line.manualDiscountAmount, promotionAmount: line.promotionDiscountAmount,
  eligibleBase: line.cartDiscountBase, cartDiscountAmount: line.cartDiscountAmount, excludedReason: line.cartDiscountExcludedReason,
  taxableAmount: line.taxableAmount, taxAmount: line.taxAmount, lineTotal: line.lineTotal, taxRate: line.taxRatePercent,
});
const billTotals = (priced) => ({
  subtotal: priced.totals.subtotal, itemDiscounts: priced.totals.manualDiscountTotal, promotions: priced.totals.promotionDiscountTotal, coupons: priced.totals.couponDiscountTotal,
  cartDiscount: priced.totals.cartDiscountTotal, taxable: priced.totals.taxableTotal, tax: priced.totals.taxTotal, rounding: priced.totals.roundingAdjustment, total: priced.totals.grandTotal,
});

// What a proposed bill discount would do, before it is applied: the eligible value and what is left out (and why), the discount and how it
// is shared across the lines, each line's tax, the bill's tax and total before and after — and whether the cashier may give it (ALLOWED),
// needs a supervisor (REQUIRES_APPROVAL), may not (DENIED), or it is not a valid discount for this bill (INVALID). Changes nothing, uses
// no approval. input: type, value.
export async function previewPosCartDiscount(client, context, cartId, input = {}) {
  requirePermission(context, "pos.view");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId, { requireOpen: false });
  let proposal;
  try { proposal = readCartDiscount({ type: input.type ?? input.discountType, value: input.value }, policy); }
  catch (error) { return { status: "INVALID", issues: [{ code: error.code, message: error.message }], cartVersion: Number(cart.version) }; }
  const before = await priceWithCartDiscount(client, context, cart, policy, undefined);
  const after = await priceWithCartDiscount(client, context, cart, policy, proposal.zero ? null : proposal);
  const summary = after.priced.cartDiscount;
  const issues = [...summary.issues];
  const total = decimal(after.priced.totals.grandTotal);
  if (!issues.length && total === 0n && !proposal.zero && !policy.allow_zero_total_sale)
    issues.push({ code: "POS_CART_DISCOUNT_ZERO_TOTAL_NOT_ALLOWED", message: POS_CART_DISCOUNT_MESSAGES.POS_CART_DISCOUNT_ZERO_TOTAL_NOT_ALLOWED });
  let status = issues.length ? "INVALID" : "ALLOWED";
  let authority = null;
  if (!issues.length && !proposal.zero) {
    const permission = await authorizePosAction(client, context, { permission: "DISCOUNT_ORDER_MANUAL", outletId: cart.store_id });
    const request = await cartDiscountRequest(client, context, cart, after.priced, { reason: "preview" });
    const decision = permission.decision === "DENY" ? permission : await authorizePosAction(client, context, request);
    status = decision.decision === "ALLOW" ? "ALLOWED" : decision.decision === "REQUIRES_APPROVAL" ? "REQUIRES_APPROVAL" : "DENIED";
    authority = {
      percentage: request.percentage, amount: request.amount, aggregateAmount: request.aggregateAmount, limit: decision.details?.limit ?? null,
      message: decision.decision === "ALLOW" ? "Discount is within your limits." : decision.decision === "DENY" ? POS_CART_DISCOUNT_MESSAGES.POS_CART_DISCOUNT_PERMISSION_DENIED : decision.message ?? null,
      approval: decision.decision === "REQUIRES_APPROVAL" ? { permission: "DISCOUNT_ORDER_MANUAL", amount: request.amount, percentage: request.percentage,
        resource: { type: "pos_cart", id: cart.id }, action: cartApprovalAction(request, proposal, summary) } : null,
    };
  }
  return {
    status, issues, authority, cartVersion: Number(cart.version), reasonRequired: Boolean(policy.discount_reason_required), currency: cart.currency_code,
    discount: { type: summary.type, value: summary.value, eligibleBase: summary.eligibleBase, excludedBase: summary.excludedBase, amount: summary.amount, fingerprint: summary.fingerprint,
      excluded: summary.excluded },
    lines: after.priced.lines.map(linePreview),
    before: billTotals(before.priced), after: billTotals(after.priced),
  };
}

// The bill discount now (if any), what the bill could take one on (eligible value, lines left out and why), the reasons, the cashier's
// limits with what is left of the sale total, and the discount's history on this bill.
export async function getPosCartDiscountEligibility(client, context, cartId) {
  requirePermission(context, "pos.view");
  const policy = await loadPolicy(client, context);
  const cart = await lockCart(client, context, cartId, { requireOpen: false });
  const lines = await loadLines(client, context, cart.id);
  const decision = await authorizePosAction(client, context, { permission: "DISCOUNT_ORDER_MANUAL", outletId: cart.store_id });
  const grant = decision.grant ?? null;
  const aggregateLimit = grant?.limitMode === "limited" ? grant.maxAggregateAmount ?? grant.maxAmount ?? null : null;
  const history = (await client.query(
    `SELECT adjustment.id, adjustment.status, adjustment.discount_type AS type, adjustment.entered_value::text AS value, adjustment.calculated_discount_amount::text AS amount,
            adjustment.eligible_base_amount::text AS eligible_base, adjustment.reason_code, adjustment.reason_note AS note, adjustment.approval_id, adjustment.created_at, adjustment.ended_at,
            creator.full_name AS created_by_name
       FROM tenant.pos_cart_adjustments adjustment LEFT JOIN public.users creator ON creator.id = adjustment.created_by
      WHERE adjustment.organization_id=$1 AND adjustment.cart_id=$2 ORDER BY adjustment.created_at DESC LIMIT 20`, [context.organizationId, cart.id])).rows;
  const fresh = (await client.query(`SELECT * FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`, [context.organizationId, cart.id])).rows[0];
  const base = {
    cartVersion: Number(fresh.version), currency: fresh.currency_code, reasons: cartDiscountReasons(policy), reasonRequired: Boolean(policy.discount_reason_required),
    allowFullDiscount: Boolean(policy.allow_full_line_discount), allowZeroTotal: Boolean(policy.allow_zero_total_sale), stacking: policy.manual_discount_stacking ?? "non_stackable",
    maxCartPercent: policy.max_cart_discount_percent === null || policy.max_cart_discount_percent === undefined ? null : Number(policy.max_cart_discount_percent),
    current: fresh.cart_discount_type ? { type: fresh.cart_discount_type, value: formatDecimal(decimal(fresh.cart_discount_value)), amount: formatDecimal(decimal(fresh.cart_discount_total)),
      eligibleBase: fresh.cart_discount_eligible_base === null ? null : formatDecimal(decimal(fresh.cart_discount_eligible_base)), reasonCode: fresh.cart_discount_reason_code ?? null,
      note: fresh.cart_discount_note ?? null, approved: Boolean(fresh.cart_discount_approval_id),
      issue: fresh.cart_discount_issue_code ? { code: fresh.cart_discount_issue_code, message: fresh.cart_discount_issue_message } : null } : null,
    history,
  };
  let eligibility = { eligibleBase: "0", excludedBase: "0", excluded: [], lineCount: lines.length };
  let used = decimal(0);
  if (lines.length) {
    const { priced } = await priceWithCartDiscount(client, context, cart, policy, null);
    eligibility = { eligibleBase: priced.cartDiscount.eligibleBase, excludedBase: priced.cartDiscount.excludedBase, excluded: priced.cartDiscount.excluded, lineCount: lines.length };
    used = decimal(priced.totals.manualDiscountTotal);
  }
  return {
    ...base, ...eligibility, discountable: decision.decision !== "DENY" && decimal(eligibility.eligibleBase) > 0n,
    authority: {
      canDiscount: decision.decision !== "DENY", denied: decision.decision === "DENY" ? POS_CART_DISCOUNT_MESSAGES.POS_CART_DISCOUNT_PERMISSION_DENIED : null,
      mode: grant?.limitMode ?? null, maxPercentage: grant?.maxPercentage ?? null, maxAmount: grant?.maxAmount ?? null, maxAggregateAmount: aggregateLimit,
      usedOnSale: formatDecimal(used), remainingOnSale: aggregateLimit === null ? null : formatDecimal(max(sub(decimal(aggregateLimit), used), decimal(0))),
    },
  };
}

// A customer a new sale may name: a Customer Master customer of this company that is active and not blocked from new sales.
export async function assertPosCustomerEligible(client, context, customerId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(customerId ?? ""))) throw customerError(404, "POS_CUSTOMER_NOT_FOUND");
  const customer = (await client.query(
    `SELECT id, display_name, status, party_type, customer_number, sales_block FROM tenant.business_parties WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, customerId])).rows[0];
  if (!customer || !(customer.customer_number || ["customer", "both"].includes(customer.party_type))) throw customerError(404, "POS_CUSTOMER_NOT_FOUND");
  if (customer.status !== "active") throw customerError(409, "POS_CUSTOMER_INACTIVE");
  if (customer.sales_block && customer.sales_block !== "none") throw customerError(409, "POS_CUSTOMER_NOT_ELIGIBLE");
  return customer;
}

// The billing address a named customer's bill is invoiced to: the one asked for (it must be that customer's own active billing address),
// else their default billing address; null when they have none.
export async function resolveCartBillingAddress(client, context, customerId, billingAddressId = null) {
  if (billingAddressId) {
    const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(billingAddressId));
    const row = valid ? (await client.query(
      `SELECT id FROM tenant.addresses WHERE organization_id=$1 AND id=$2 AND party_id=$3 AND address_type='billing' AND status='active'`,
      [context.organizationId, billingAddressId, customerId])).rows[0] : null;
    if (!row) throw customerError(400, "POS_CUSTOMER_BILLING_ADDRESS_INVALID");
    return row.id;
  }
  return (await client.query(
    `SELECT id FROM tenant.addresses WHERE organization_id=$1 AND party_id=$2 AND address_type='billing' AND status='active'
      ORDER BY is_default_billing DESC, is_primary DESC, created_at LIMIT 1`, [context.organizationId, customerId])).rows[0]?.id ?? null;
}

export async function setPosCartCustomer(client, context, cartId, input) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, input, "customer");
  if (replay) return replay;
  let name = null;
  let billingAddressId = null;
  // Choosing, changing or removing a named customer needs CUSTOMER_SELECT; a bill that starts and stays walk-in never does.
  if (input.customerId || cart.customer_mode === "registered") {
    try { await assertPosAction(client, context, { permission: "CUSTOMER_SELECT", outletId: cart.store_id }); }
    catch (error) { if (error.code === "POS_PERMISSION_DENIED") throw customerError(403, "POS_CUSTOMER_SELECTION_DENIED"); throw error; }
  }
  if (input.customerId) {
    const customer = await assertPosCustomerEligible(client, context, input.customerId);
    name = customer.display_name;
    billingAddressId = await resolveCartBillingAddress(client, context, input.customerId, input.billingAddressId ?? null);
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
    `UPDATE tenant.pos_carts SET customer_id=$3,customer_mode=$4,billing_address_id=$5,buyer_name=NULL,buyer_address='{}'::jsonb,loyalty_redeem_points=NULL,cart_discount_approval_id=NULL,cart_discount_approved_amount=NULL,
            customer_context_version=customer_context_version+1 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cartId, input.customerId || null, input.customerId ? "registered" : "walk_in", billingAddressId]);
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
    { customerId: input.customerId || null, previousCustomerId: cart.customer_id ?? null, mode: input.customerId ? "registered" : "walk_in", billingAddressId,
      totalBefore: before, totalAfter: result.grand_total, approvalsCleared });
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
  if (input.unitPrice !== null && input.unitPrice !== undefined) {
    const discounted = (await client.query(`SELECT manual_discount_type, manual_discount_amount FROM tenant.pos_cart_lines WHERE organization_id=$1 AND id=$2`, [context.organizationId, lineId])).rows[0];
    if (discounted?.manual_discount_type || Number(discounted?.manual_discount_amount ?? 0) > 0)
      throw itemDiscountError(409, "POS_ITEM_DISCOUNT_OVERRIDE_CONFLICT", "This line has a manual discount. Remove it before overriding the price.");
  }
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
    if (error.taxError) await client.query(`UPDATE tenant.pos_carts SET tax_error_code=$3,tax_error_message=$4 WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, cartId, error.code, error.message]);
    repriced = await getPosCart(client, context, cartId);
    changes.push({ code: error.code ?? "POS_CART_PRICE_CHANGED", message: error.message });
  }
  for (const line of repriced.lines) {
    const old = before.find((entry) => entry.id === line.id);
    if (old && decimal(old.unit_price) !== decimal(line.unit_price))
      changes.push({ code: "POS_CART_PRICE_CHANGED", lineId: line.id, message: `${line.description}: price ${formatDecimal(decimal(old.unit_price))} → ${formatDecimal(decimal(line.unit_price))}` });
  }
  for (const issue of await collectPosCartProductIssues(client, context, cartId)) changes.push(issue);
  // A named customer may have become inactive, blocked or lost the billing address while the bill was held: checkout stays blocked until fixed.
  if (cart.customer_id) for (const issue of await namedCustomerCheckoutIssues(client, context, repriced)) changes.push(issue);
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
// A named customer's bill, before payment: the customer still active and allowed new sales; the chosen billing address still theirs and
// active; and a GST-registered business invoice with a billing address that names the state (place of supply).
export async function namedCustomerCheckoutIssues(client, context, cart) {
  const issues = [];
  const customer = (await client.query(
    `SELECT status, sales_block, gstin, tax_treatment FROM tenant.business_parties WHERE organization_id=$1 AND id=$2`, [context.organizationId, cart.customer_id])).rows[0];
  if (!customer || customer.status !== "active") {
    issues.push({ code: "POS_CUSTOMER_INACTIVE", message: "The selected customer is no longer active. Choose another customer or a walk-in sale." });
    return issues;
  }
  if (customer.sales_block && customer.sales_block !== "none") issues.push({ code: "POS_CUSTOMER_NOT_ELIGIBLE", message: "This customer is blocked from new sales. Choose another customer." });
  if (cart.billing_address_id) {
    const address = (await client.query(
      `SELECT id FROM tenant.addresses WHERE organization_id=$1 AND id=$2 AND party_id=$3 AND address_type='billing' AND status='active'`,
      [context.organizationId, cart.billing_address_id, cart.customer_id])).rows[0];
    if (!address) issues.push({ code: "POS_CUSTOMER_BILLING_ADDRESS_INVALID", message: "The chosen billing address is no longer available. Select another." });
  }
  const registered = Boolean(customer.gstin) && ["registered_regular", "registered_composition", "sez"].includes(customer.tax_treatment ?? "");
  if (registered) {
    const billing = (await client.query(
      `SELECT state_code FROM tenant.addresses WHERE organization_id=$1 AND party_id=$2 AND address_type='billing' AND status='active'
        ORDER BY (id = $3::uuid) DESC, is_default_billing DESC, is_primary DESC, created_at LIMIT 1`, [context.organizationId, cart.customer_id, cart.billing_address_id ?? null])).rows[0];
    if (!billing?.state_code) issues.push({ code: "POS_CUSTOMER_CHECKOUT_DETAILS_REQUIRED", message: "A GST invoice needs the customer's billing address with its state. Add it to the customer record." });
  }
  return issues;
}

async function checkoutIssues(client, context, cart, policy) {
  const issues = [];
  const push = (code, message = POS_CART_MESSAGES[code] ?? code, extra = {}) => issues.push({ code, message, ...extra });
  const lines = await loadLines(client, context, cart.id);
  if (!lines.length) push("POS_CART_EMPTY");
  const shift = (await client.query(`SELECT status, lifecycle_status FROM tenant.pos_shifts WHERE organization_id=$1 AND id=$2`, [context.organizationId, cart.shift_id])).rows[0];
  if (shift?.status !== "open" || shift.lifecycle_status !== "OPEN") push("POS_SESSION_REQUIRED");
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
        billingAddressId: cart.billing_address_id, supplyMode: cart.supply_mode ?? "in_store", deliveryStateCode: cart.delivery_state_code ?? null, lines: toPricingInputLines(lines), cartDiscount: cartDiscountOf(cart),
        couponCode: cart.coupon_code, loyaltyRedeemPoints: cart.loyalty_redeem_points,
      });
    } catch (error) {
      const priceProblem = ["POS_PRICE_NOT_FOUND", "POS_PRICE_LIST_REQUIRED", "POS_SALE_ITEM_NOT_FOUND"].includes(error.code);
      // A tax problem keeps its own code and message (missing classification, registration, place of supply …): never a guessed 0% tax.
      if (error.taxError) push(error.code, error.message);
      else push(priceProblem ? "POS_PRODUCT_PRICE_MISSING" : "POS_TAX_CALCULATION_FAILED", error.message);
    }
  }
  if (priced) for (const line of priced.lines) for (const discountIssue of line.discountIssues ?? []) push(discountIssue.code, discountIssue.message);
  if (priced) for (const discountIssue of priced.cartDiscount?.issues ?? []) push(discountIssue.code, discountIssue.message);
  if (priced) {
    if (decimal(priced.totals.grandTotal) !== decimal(cart.grand_total))
      push("POS_CART_PRICE_CHANGED", `${POS_CART_MESSAGES.POS_CART_PRICE_CHANGED} Total ${formatDecimal(decimal(cart.grand_total))} → ${formatDecimal(decimal(priced.totals.grandTotal))}.`,
        { previousTotal: cart.grand_total, currentTotal: priced.totals.grandTotal });
    const totalNow = decimal(priced.totals.grandTotal);
    // A zero total only from discounts, and only when the company allows it; it is still a sale with its tax and stock.
    if (totalNow < 0n || (totalNow === 0n && decimal(priced.totals.discountTotal) <= 0n)) push("POS_CART_TOTAL_INVALID");
    else if (totalNow === 0n && !policy.allow_zero_total_sale) push("POS_CART_DISCOUNT_ZERO_TOTAL_NOT_ALLOWED", POS_CART_DISCOUNT_MESSAGES.POS_CART_DISCOUNT_ZERO_TOTAL_NOT_ALLOWED);
  }
  try { await assertPosCartDiscountsAuthorized(client, context, cart); }
  catch (error) { push(error.code === "POS_APPROVAL_REQUIRED" ? "POS_CART_DISCOUNT_LIMIT_EXCEEDED" : error.code ?? "POS_CART_DISCOUNT_LIMIT_EXCEEDED", error.message); }
  if (cart.customer_id) for (const issue of await namedCustomerCheckoutIssues(client, context, cart)) push(issue.code, issue.message);
  // Walk-in: allowed at this outlet, and from the company's amount the invoice needs the buyer's name and address.
  const customerPolicy = await outletCustomerPolicy(client, context, cart.store_id);
  if (cart.customer_mode !== "registered" && !customerPolicy.allowWalkIn) push("POS_WALK_IN_NOT_ALLOWED", `${POS_CUSTOMER_MESSAGES.POS_WALK_IN_NOT_ALLOWED} Select or add a customer.`);
  const totalNow = priced ? priced.totals.grandTotal : cart.grand_total;
  if (buyerDetailsRequired({ ...cart, grand_total: totalNow }, customerPolicy) && !buyerDetailsComplete(cart))
    push("POS_BUYER_DETAILS_REQUIRED", `A bill of ${formatDecimal(decimal(customerPolicy.buyerDetailsRequiredAbove))} or more needs the buyer's name, address and state on the invoice.`);
  // GST Invoice (0098): a document that could not be issued stops the bill before payment.
  for (const issue of await invoiceCheckoutIssues(client, context, cart, priced)) push(issue.code, issue.message);
  return { issues, lines, priced };
}

// GST Invoice (0098): the invoice this bill will become, before payment — type, seller, buyer, place of supply, lines, taxes; no number.
export async function previewPosCartInvoice(client, context, cartId) {
  requirePermission(context, "pos.view");
  const cart = await lockCart(client, context, cartId, { requireOpen: false });
  const { issues, priced } = await checkoutIssues(client, context, cart, await loadPolicy(client, context));
  return formatPosInvoicePreview(client, context, cart, priced, issues);
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
    inventory: "The bill's stock is reserved at the outlet's warehouse for this checkout and consumed once when the sale completes.",
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
  const { issues, priced } = await checkoutIssues(client, context, cart, policy);
  if (issues.length) {
    const refreshed = issues.some((issue) => issue.code === "POS_CART_PRICE_CHANGED") ? await reprice(client, context, cart, policy).catch(() => getPosCart(client, context, cartId))
      : await getPosCart(client, context, cartId);
    return { ready: false, code: "POS_CART_CHECKOUT_NOT_READY", message: POS_CART_MESSAGES.POS_CART_CHECKOUT_NOT_READY, issues, cart: refreshed };
  }
  // Stock Reduction (0101): the bill's stock is reserved with its checkout, all or nothing — a line that cannot be reserved leaves the bill as it was.
  await client.query("SAVEPOINT pos_checkout_stock");
  try {
    await client.query(
      `UPDATE tenant.pos_carts SET checkout_started_at=now(),checkout_reference=gen_random_uuid(),checkout_expires_at=now()+make_interval(mins=>$3),checkout_started_by=$4,
              checkout_tax_hash=$5,stock_recovery_status=NULL,stock_recovery_code=NULL,stock_recovery_message=NULL,stock_recovery_at=NULL,stock_recovery_resolved_at=NULL,
              version=version+1,updated_at=now(),updated_by=$4 WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, cartId, policy.checkout_lock_minutes, context.userId, priced?.tax?.hash ?? null]);
    await reservePosCheckoutStock(client, context, cartId);
    await client.query("RELEASE SAVEPOINT pos_checkout_stock");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT pos_checkout_stock");
    await client.query("RELEASE SAVEPOINT pos_checkout_stock");
    if (!isPosStockFailure(error.code)) throw error;
    return { ready: false, code: "POS_CART_CHECKOUT_NOT_READY", message: POS_CART_MESSAGES.POS_CART_CHECKOUT_NOT_READY,
      issues: [{ code: error.code, message: error.message, ...(error.details ?? {}) }], cart: await getPosCart(client, context, cartId) };
  }
  await cartEvent(client, context, cartId, "checkout_started", "Checkout started");
  await recordCartAction(client, context, cartId, claim);
  const locked = await getPosCart(client, context, cartId);
  return { ready: true, issues: [], cart: locked, snapshot: checkoutSnapshot(locked) };
}

// Before a card / UPI / wallet payment: the bill must be in checkout (started here when it is not, with the same checks).
export async function ensurePosCheckoutStarted(client, context, cartId) {
  const cart = await lockCart(client, context, cartId, { requireOpen: false });
  if (cart.checkout_started_at) {
    // A payment is starting on a bill already in checkout: its stock lease is renewed (within the outlet's maximum hold).
    await renewPosCheckoutStock(client, context, cartId);
    return cart;
  }
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
  await client.query(`UPDATE tenant.pos_carts SET checkout_started_at=NULL,checkout_expires_at=NULL,checkout_started_by=NULL,checkout_tax_hash=NULL,version=version+1,updated_at=now(),updated_by=$3
                       WHERE organization_id=$1 AND id=$2`, [context.organizationId, cartId, context.userId]);
  // Its stock goes back; a paid bill in stock recovery whose payments were given back is no longer waiting on stock.
  await releasePosCheckoutStock(client, context, cart.checkout_reference, { reasonCode: "released", reason: "Back to the bill", cartId });
  await resolvePosStockRecovery(client, context, cartId, "checkout_released");
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
  POS_CUSTOMER_COMPANY_MISMATCH: "Customer is not available for this company.",
  POS_CUSTOMER_NOT_ELIGIBLE: "This customer cannot be used for this sale.",
  POS_CUSTOMER_BILLING_ADDRESS_INVALID: "Select a valid billing address.",
  POS_CUSTOMER_CHECKOUT_DETAILS_REQUIRED: "Enter the required billing information.",
  POS_CUSTOMER_POSSIBLE_DUPLICATE: "Similar customer found. Review before continuing.",
  POS_CUSTOMER_DETAILS_INVALID: "Check the customer details.",
  POS_CUSTOMER_GSTIN_INVALID: "Check the GSTIN.",
  POS_CUSTOMER_CONTEXT_CONFLICT: "Customer details changed. Refresh the bill.",
  POS_CUSTOMER_SELECTION_DENIED: "You cannot select or change customers.",
  POS_CUSTOMER_CREATION_DENIED: "You cannot create customers.",
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
    customer: cart.customer_mode === "registered" ? await namedCustomerContext(client, context, cart, full) : null,
    buyerDetails: cart.customer_mode === "walk_in" ? { name: cart.buyer_name ?? null, address: cart.buyer_address ?? {} } : null,
    receiptContact: {
      phone: full ? cart.receipt_contact_phone ?? null : maskPhone(cart.receipt_contact_phone), email: full ? cart.receipt_contact_email ?? null : maskEmail(cart.receipt_contact_email),
      consent: Boolean(cart.receipt_delivery_consent), masked: !full,
    },
    policy, buyerDetailsRequired: buyerDetailsRequired(cart, policy), buyerDetailsComplete: buyerDetailsComplete(cart),
  };
}

// The named customer on a bill: identity, type, GST registration (GSTIN in full only for those who may read the Customer Master), status,
// the billing address the bill is invoiced to with the other choices, and the price list its prices come from.
async function namedCustomerContext(client, context, cart, full) {
  const party = (await client.query(
    `SELECT COALESCE(party.customer_number, party.code) AS code, party.display_name, party.legal_name, party.customer_kind, party.status, party.sales_block, party.gstin,
            party.tax_treatment, party.phone FROM tenant.business_parties party WHERE party.organization_id=$1 AND party.id=$2`,
    [context.organizationId, cart.customer_id])).rows[0] ?? {};
  const addresses = (await client.query(
    `SELECT id, label, line1, city, state, state_code, postal_code, is_default_billing FROM tenant.addresses
      WHERE organization_id=$1 AND party_id=$2 AND address_type='billing' AND status='active' ORDER BY is_default_billing DESC, is_primary DESC, created_at`,
    [context.organizationId, cart.customer_id])).rows;
  const priceList = cart.effective_price_list_id ? (await client.query(`SELECT id, name FROM tenant.price_lists WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cart.effective_price_list_id])).rows[0] : null;
  const gstRegistered = Boolean(party.gstin) && ["registered_regular", "registered_composition", "sez"].includes(party.tax_treatment ?? "");
  const status = party.status !== "active" ? "inactive" : party.sales_block && party.sales_block !== "none" ? "blocked" : "active";
  return {
    id: cart.customer_id, code: party.code ?? null, name: party.display_name ?? cart.customer_name, legalName: party.legal_name && party.legal_name !== party.display_name ? party.legal_name : null,
    type: party.customer_kind === "individual" ? "individual" : "business", status, gstRegistered,
    gstin: party.gstin ? (full ? party.gstin : `${party.gstin.slice(0, 2)}•••••••••${party.gstin.slice(-4)}`) : null,
    phone: full ? party.phone ?? null : maskPhone(party.phone),
    billingAddressId: cart.billing_address_id ?? null,
    billingAddresses: addresses.map((row) => ({ id: row.id, label: row.label ?? null, line1: row.line1, city: row.city ?? null, state: row.state ?? null, stateCode: row.state_code ?? null,
      postalCode: row.postal_code ?? null, isDefault: Boolean(row.is_default_billing) })),
    priceList: priceList ? { id: priceList.id, name: priceList.name, isCustomerList: priceList.id !== cart.price_list_id } : null,
  };
}

// Choose which of the named customer's billing addresses the bill is invoiced to (CUSTOMER_SELECT). The place of supply can change with it,
// so tax is worked out again. input: billingAddressId, expectedVersion, idempotencyKey.
export async function setPosCartBillingAddress(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, input, "billing_address");
  if (replay) return replay;
  if (cart.customer_mode !== "registered" || !cart.customer_id) throw customerError(409, "POS_CUSTOMER_BILLING_ADDRESS_INVALID", "Select a customer first: a walk-in bill has no billing address.");
  try { await assertPosAction(client, context, { permission: "CUSTOMER_SELECT", outletId: cart.store_id }); }
  catch (error) { if (error.code === "POS_PERMISSION_DENIED") throw customerError(403, "POS_CUSTOMER_SELECTION_DENIED"); throw error; }
  if (!input.billingAddressId) throw customerError(400, "POS_CUSTOMER_BILLING_ADDRESS_INVALID");
  const billingAddressId = await resolveCartBillingAddress(client, context, cart.customer_id, input.billingAddressId);
  const address = (await client.query(`SELECT label, city, state FROM tenant.addresses WHERE organization_id=$1 AND id=$2`, [context.organizationId, billingAddressId])).rows[0] ?? {};
  await client.query(`UPDATE tenant.pos_carts SET billing_address_id=$3,customer_context_version=customer_context_version+1 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cartId, billingAddressId]);
  const before = cart.grand_total;
  const result = await reprice(client, context, cart, policy);
  const customerChanges = decimal(before ?? 0) !== decimal(result.grand_total ?? 0)
    ? [{ code: "POS_CUSTOMER_PRICING_CHANGED", message: `Tax changed with the billing address. Total ${formatDecimal(decimal(before ?? 0))} → ${formatDecimal(decimal(result.grand_total ?? 0))}` }] : [];
  await cartEvent(client, context, cartId, "customer_changed", `Billing address: ${[address.label, address.city, address.state].filter(Boolean).join(", ") || "changed"}`,
    { billingAddressId, previousBillingAddressId: cart.billing_address_id ?? null, totalBefore: before, totalAfter: result.grand_total });
  await recordCartAction(client, context, cartId, claim);
  return { ...result, customerChanges };
}

// ------------------------------------------------------------------ POS Taxes (migration 0089)

// How the goods leave the store, which decides their place of supply: handed over at the counter (the store's state) or delivered (the
// delivery state). The tax is worked out again. input: supplyMode ("in_store" | "delivery"), deliveryStateCode, expectedVersion, idempotencyKey.
export async function setPosCartSupply(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const policy = await loadPolicy(client, context);
  const { cart, claim, replay } = await beginCartAction(client, context, cartId, input, "supply");
  if (replay) return replay;
  const mode = input.supplyMode === "delivery" ? "delivery" : "in_store";
  const state = mode === "delivery" ? String(input.deliveryStateCode ?? "").trim() : null;
  if (mode === "delivery" && !/^[0-9]{2}$/.test(state ?? "")) throw cartError(400, "POS_TAX_SUPPLY_CONTEXT_REQUIRED", "Choose the state the goods are delivered to.");
  await client.query(`UPDATE tenant.pos_carts SET supply_mode=$3,delivery_state_code=$4,customer_context_version=customer_context_version+1 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cartId, mode, state]);
  const before = cart.grand_total;
  const result = await reprice(client, context, cart, policy);
  await cartEvent(client, context, cartId, "customer_changed", mode === "delivery" ? `Delivered to state ${state}` : "Handed over at the counter",
    { supplyMode: mode, deliveryStateCode: state, totalBefore: before, totalAfter: result.grand_total });
  await recordCartAction(client, context, cartId, claim);
  return result;
}

// The bill's tax as it stands, worked out now without changing the bill: VALID with the breakdown, or INVALID with the reason (never a
// guessed figure). For the cashier's tax panel.
export async function getPosCartTaxes(client, context, cartId) {
  const cart = await getPosCart(client, context, cartId);
  const policy = await loadPolicy(client, context);
  if (!cart.lines.length) return { status: "EMPTY", cartVersion: Number(cart.version), lines: [], breakdown: [], taxTotal: "0", taxableTotal: "0", grandTotal: "0" };
  const store = (await client.query(`SELECT warehouse_id, currency_code, price_list_id FROM tenant.pos_stores WHERE organization_id=$1 AND id=$2`, [context.organizationId, cart.store_id])).rows[0];
  try {
    const priced = await priceCartLines(client, context, {
      store: { id: cart.store_id, warehouse_id: store.warehouse_id, currency_code: store.currency_code, price_list_id: store.price_list_id }, policy, customerId: cart.customer_id,
      billingAddressId: cart.billing_address_id, supplyMode: cart.supply_mode ?? "in_store", deliveryStateCode: cart.delivery_state_code ?? null, lines: toPricingInputLines(cart.lines),
      cartDiscount: cartDiscountOf(cart),
      couponCode: cart.coupon_code, loyaltyRedeemPoints: cart.loyalty_redeem_points,
    });
    const tax = priced.tax;
    return {
      status: "VALID", cartVersion: Number(cart.version), currency: String(cart.currency_code ?? "").trim(), stale: Boolean(cart.tax_calculation_hash) && cart.tax_calculation_hash !== tax.hash,
      seller: tax.seller ? { name: tax.seller.name, gstin: tax.seller.gstin, stateCode: tax.seller.stateCode, stateName: tax.seller.stateName } : null,
      taxEnabled: tax.taxEnabled, taxDate: tax.taxDate, supplyMode: tax.supplyMode, deliveryStateCode: tax.deliveryStateCode, placeOfSupply: tax.placeOfSupply,
      placeOfSupplyName: tax.placeOfSupplyName, documentType: tax.documentType, pricesIncludeTax: tax.pricesIncludeTax,
      taxableTotal: tax.taxableTotal, taxTotal: priced.totals.taxTotal, roundingAdjustment: priced.totals.roundingAdjustment, grandTotal: priced.totals.grandTotal, breakdown: tax.breakdown,
      lines: priced.lines.map((line, index) => ({
        lineId: cart.lines[index]?.id ?? null, description: line.description, hsnSac: line.hsnSac ?? null, classification: line.taxClassification, rate: line.taxRatePercent,
        priceIncludesTax: Boolean(line.taxInclusive), taxableAmount: line.taxableAmount, taxAmount: line.taxAmount, components: line.taxComponents,
      })),
    };
  } catch (error) {
    if (!error.taxError && !String(error.code ?? "").startsWith("POS_")) throw error;
    return { status: "INVALID", cartVersion: Number(cart.version), code: error.code, message: error.message };
  }
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
  const party = (await client.query(
    `SELECT display_name, legal_name, gstin, tax_treatment AS gst_registration_type, gst_state_code, COALESCE(customer_number, code) AS customer_code, customer_kind
       FROM tenant.business_parties WHERE organization_id=$1 AND id=$2`, [context.organizationId, cart.customer_id])).rows[0] ?? {};
  // The billing address chosen at the counter, else the customer's default billing address.
  const billing = (await client.query(
    `SELECT id, line1, line2, city, state, state_code, postal_code, country_code, gstin FROM tenant.addresses WHERE organization_id=$1 AND party_id=$2 AND address_type='billing' AND status='active'
      ORDER BY (id = $3::uuid) DESC, is_default_billing DESC, is_primary DESC, created_at LIMIT 1`, [context.organizationId, cart.customer_id, cart.billing_address_id ?? null])).rows[0];
  const gstin = billing?.gstin || party.gstin || null;
  const business = Boolean(gstin) && ["registered_regular", "registered_composition", "sez"].includes(party.gst_registration_type ?? "");
  return {
    mode: "registered", name: party.legal_name || party.display_name || null,
    taxDetails: { gstin, registrationType: party.gst_registration_type ?? null, stateCode: billing?.state_code ?? party.gst_state_code ?? null },
    billingAddress: billing ? { line1: billing.line1, line2: billing.line2, city: billing.city, state: billing.state, stateCode: billing.state_code, postalCode: billing.postal_code,
      countryCode: billing.country_code } : null,
    taxTreatment: business ? "b2b" : "b2c",
    customerCode: party.customer_code ?? null,
    customerType: party.customer_kind === "individual" ? "individual" : "business",
    billingAddressId: billing?.id ?? null,
  };
}

export {
  loadPolicy as loadPosSettingsPolicy,
  lockCart as lockPosCart,
  reprice as repricePosCartInternal,
  loadLines as loadPosCartLines,
  toPricingInputLines as toPosCartPricingInputLines,
};
