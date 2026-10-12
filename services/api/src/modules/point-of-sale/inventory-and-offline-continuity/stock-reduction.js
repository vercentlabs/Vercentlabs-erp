// POS Stock Reduction (0101). POS asks; Inventory owns the stock. A bill reserves what it sells in Inventory's own reservations when checkout
// begins (source pos_checkout = the checkout's reference, one reservation per bill line) and the sale consumes exactly those reservations once —
// the issue movement, its cost from Inventory valuation and the reservation's consumption, together. Nothing here writes a balance.
//
//   draft / held bill        nothing reserved, nothing moved
//   checkout begins          eligible stock reserved at the outlet's warehouse (and the terminal's selling location), for the exact batch or serial
//   payment under way        the lease is renewed (never past the outlet's maximum hold); an unknown payment keeps it, a lapsed checkout frees it
//   back to the bill         released
//   sale completes           reservations consumed: on hand falls once, available does not fall again
//   sale cannot take stock   the bill is marked for stock recovery with its payments kept: retry, or refund through Refunds
//
// An expired reservation is never consumed blindly: it is released and the stock reserved again, which checks eligibility and availability anew.
import { consumeStockReservation, postStockMovement, releaseStockReservation, renewStockReservation, reserveAvailableStock, reserveStock, getStockAvailability }
  from "../../stock/index.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";
import { event } from "../shared/audit.js";

export const POS_STOCK_MESSAGES = Object.freeze({
  POS_STOCK_WAREHOUSE_NOT_CONFIGURED: "This store's stock location is not configured.",
  POS_STOCK_WAREHOUSE_INACTIVE: "This store's stock location is inactive, so stock cannot be sold from it.",
  POS_STOCK_ITEM_NOT_AVAILABLE: "This product is not available for sale.",
  POS_STOCK_INSUFFICIENT: "Not enough stock is available.",
  POS_STOCK_RESERVATION_FAILED: "Stock could not be reserved. Try again.",
  POS_STOCK_RESERVATION_EXPIRED: "Stock reservation expired. Checking availability again.",
  POS_STOCK_ITEM_ON_HOLD: "This stock is on hold and cannot be sold.",
  POS_STOCK_ITEM_EXPIRED: "This batch has expired.",
  POS_STOCK_ITEM_QUARANTINED: "This stock is not available for sale.",
  POS_STOCK_UOM_INVALID: "Product quantity/unit is not supported.",
  POS_STOCK_BATCH_REQUIRED: "Select a valid product batch.",
  POS_STOCK_SERIAL_REQUIRED: "Scan or select the product serial number.",
  POS_STOCK_SERIAL_ALREADY_SOLD: "This serial number has already been sold.",
  POS_STOCK_WAREHOUSE_MISMATCH: "The selected stock location does not belong to this store.",
  POS_STOCK_VERSION_CONFLICT: "Stock changed. Review the available quantity.",
  POS_STOCK_CONSUMPTION_PENDING: "Sale stock update is being completed.",
  POS_STOCK_CONSUMPTION_UNKNOWN: "Stock update is being verified. Do not retry the sale.",
  POS_STOCK_CONSUMPTION_FAILED: "The sale needs stock recovery.",
  POS_STOCK_RECONCILIATION_REQUIRED: "Inventory records need reconciliation.",
  POS_STOCK_PERMISSION_DENIED: "You cannot perform this stock operation.",
});

const stockError = (status, code, message = POS_STOCK_MESSAGES[code], details = undefined) => {
  const error = posError(status, message, code);
  if (details) error.details = details;
  return error;
};
// Reserving and issuing for a sale is the sale's own authority (SALE_COMPLETE is checked by checkout): the cashier needs no Inventory permission.
const stockContext = (context) => ({ ...context, permissions: [...new Set([...(context.permissions || []), "stock.view", "stock.reserve", "stock.issue"])] });
const n = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const qty = (value, unit) => `${n(value)}${unit ? ` ${unit}` : ""}`;

// A stock error from Inventory, said the way a cashier understands it (the internal message never reaches the counter).
function cashierError(error, line, available = null) {
  const name = line?.description ?? "This product";
  switch (error?.code) {
    case "STOCK_RESERVATION_INSUFFICIENT": case "INSUFFICIENT_STOCK": case "STOCK_NEGATIVE_NOT_ALLOWED": case "STOCK_INSUFFICIENT":
      return stockError(409, "POS_STOCK_INSUFFICIENT", available === null ? `${name}: not enough stock is available at this store.`
        : `${name}: only ${qty(available, line?.base_uom)} available at this store. Reduce the quantity to continue.`, { lineId: line?.id, itemId: line?.item_id, available });
    case "STOCK_SERIAL_NOT_AVAILABLE": return stockError(409, "POS_STOCK_SERIAL_ALREADY_SOLD", `${name}: this serial number is not in stock here (sold, held or elsewhere).`, { lineId: line?.id });
    case "STOCK_SERIAL_ALREADY_RESERVED": return stockError(409, "POS_STOCK_RESERVATION_FAILED", `${name}: this serial number is being sold on another bill.`, { lineId: line?.id });
    case "STOCK_RESERVATION_INELIGIBLE": return stockError(409, "POS_STOCK_ITEM_ON_HOLD", `${name}: ${POS_STOCK_MESSAGES.POS_STOCK_ITEM_ON_HOLD}`, { lineId: line?.id });
    case "STOCK_UNDER_COUNT": return stockError(409, "POS_STOCK_RESERVATION_FAILED", `${name}: this stock is being counted, so it cannot be sold right now.`, { lineId: line?.id });
    case "STOCK_SERIAL_REQUIRED": case "STOCK_TRACKING_REQUIRED": return stockError(409, line?.tracking_type === "batch" ? "POS_STOCK_BATCH_REQUIRED" : "POS_STOCK_SERIAL_REQUIRED");
    case "STOCK_WAREHOUSE_INACTIVE": case "WAREHOUSE_INACTIVE": return stockError(409, "POS_STOCK_WAREHOUSE_INACTIVE");
    default:
      return error?.code?.startsWith?.("POS_STOCK_") ? error : stockError(409, "POS_STOCK_RESERVATION_FAILED", `${name}: ${POS_STOCK_MESSAGES.POS_STOCK_RESERVATION_FAILED}`, { cause: error?.code });
  }
}

// Stock-class failures (the ones that put a paid bill into stock recovery).
export const isPosStockFailure = (code) => typeof code === "string" && (code.startsWith("POS_STOCK_") || code.startsWith("STOCK_") || code === "INSUFFICIENT_STOCK");

async function policyOf(client, context) {
  const row = (await client.query(`SELECT allow_negative_stock, checkout_lock_minutes, stock_reservation_max_hold_minutes FROM tenant.pos_settings WHERE organization_id=$1`,
    [context.organizationId])).rows[0];
  return { allowNegative: Boolean(row?.allow_negative_stock), leaseMinutes: Number(row?.checkout_lock_minutes ?? 15), maxHoldMinutes: Number(row?.stock_reservation_max_hold_minutes ?? 30) };
}

// The bill's lines that move physical stock (services and items not kept in inventory never do), with their item and base unit.
async function stockLines(client, context, cartId) {
  return (await client.query(
    `SELECT line.id, line.line_number, line.item_id, line.description, line.quantity, COALESCE(line.base_quantity, line.quantity) AS base_quantity, line.warehouse_id,
            line.warehouse_location_id, line.batch_id, line.serial_id, item.tracking_type, item.code AS sku, base.code AS base_uom, sale_uom.code AS uom,
            (item.item_type = 'service' OR item.track_inventory = false) AS non_stock
       FROM tenant.pos_cart_lines line
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       LEFT JOIN tenant.units_of_measure base ON base.organization_id = item.organization_id AND base.id = item.uom_id
       LEFT JOIN tenant.units_of_measure sale_uom ON sale_uom.organization_id = line.organization_id AND sale_uom.id = line.uom_id
      WHERE line.organization_id = $1 AND line.cart_id = $2 ORDER BY line.line_number`, [context.organizationId, cartId])).rows;
}

// The fulfillment warehouse: the outlet's own, active, a real warehouse (never a transit or system one) — and the terminal's selling location.
// The cashier never chooses it; a line that names another warehouse is refused.
export async function resolvePosFulfillmentWarehouse(client, context, cart) {
  const row = (await client.query(
    `SELECT warehouse.id, warehouse.code, warehouse.name, warehouse.status, warehouse.system_role, COALESCE(terminal.selling_location_id, store.selling_location_id) AS location_id,
            store.name AS store_name
       FROM tenant.pos_stores store
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = store.organization_id AND warehouse.id = store.warehouse_id
       LEFT JOIN tenant.pos_terminals terminal ON terminal.organization_id = store.organization_id AND terminal.id = $3
      WHERE store.organization_id = $1 AND store.id = $2`, [context.organizationId, cart.store_id, cart.terminal_id ?? null])).rows[0];
  if (!row?.id || row.system_role) throw stockError(409, "POS_STOCK_WAREHOUSE_NOT_CONFIGURED");
  if (row.status !== "active") throw stockError(409, "POS_STOCK_WAREHOUSE_INACTIVE");
  return { warehouseId: row.id, warehouseCode: row.code, warehouseName: row.name, locationId: row.location_id ?? null, storeName: row.store_name };
}

// Active POS-checkout allocations of a checkout (all lines, or one).
async function activeAllocations(client, context, checkoutReference, lineId = null) {
  return (await client.query(
    `SELECT allocation.*, parent.source_line_id FROM tenant.stock_reservations allocation
       JOIN tenant.inventory_reservations parent ON parent.organization_id = allocation.organization_id AND parent.id = allocation.inventory_reservation_id
      WHERE allocation.organization_id = $1 AND allocation.reference_type = 'pos_checkout' AND allocation.reference_id = $2 AND allocation.status = 'active'
        AND ($3::uuid IS NULL OR parent.source_line_id = $3) ORDER BY allocation.created_at, allocation.id FOR UPDATE OF allocation`,
    [context.organizationId, checkoutReference, lineId])).rows;
}

const availableAt = async (client, context, line, source) => {
  const availability = await getStockAvailability(client, stockContext(context),
    { itemId: line.item_id, warehouseId: source.warehouseId, warehouseLocationId: line.warehouse_location_id || undefined, batchId: line.batch_id || undefined });
  return n(availability.availableQuantity);
};

// Reserves one line's missing quantity. Returns { reserved, shortfall }.
async function reserveLine(client, context, cart, line, source, missing, expiresAt) {
  const ctx = stockContext(context);
  const common = { itemId: line.item_id, warehouseId: source.warehouseId, referenceType: "pos_checkout", referenceId: cart.checkout_reference, sourceLineId: line.id, expiresAt };
  try {
    if (line.serial_id) {
      await reserveStock(client, ctx, { ...common, serialId: line.serial_id, quantity: 1 });
      return { reserved: 1, shortfall: 0 };
    }
    const result = await reserveAvailableStock(client, ctx, { ...common, maxQuantity: missing, warehouseLocationId: line.warehouse_location_id || null, batchId: line.batch_id || null });
    return { reserved: n(result.reserved), shortfall: n(missing - result.reserved) };
  } catch (error) {
    throw cashierError(error, line, error.code === "STOCK_RESERVATION_INSUFFICIENT" ? await availableAt(client, context, line, source) : null);
  }
}

// Frees POS checkout holds whose lease has passed: unless the bill still has a payment under way and is within the outlet's maximum hold. Scoped
// to some items when given (a checkout frees what it competes for). Locks only the allocations it releases.
export async function sweepExpiredPosCheckoutReservations(client, context, { itemIds = null } = {}) {
  const policy = await policyOf(client, context);
  const due = (await client.query(
    `SELECT allocation.id FROM tenant.stock_reservations allocation
       LEFT JOIN tenant.pos_carts cart ON cart.organization_id = allocation.organization_id AND cart.checkout_reference = allocation.reference_id
      WHERE allocation.organization_id = $1 AND allocation.reference_type = 'pos_checkout' AND allocation.status = 'active'
        AND ($2::uuid[] IS NULL OR allocation.item_id = ANY($2::uuid[]))
        AND (cart.id IS NULL OR cart.checkout_started_at IS NULL OR cart.status NOT IN ('draft', 'priced')
          OR (allocation.expires_at IS NOT NULL AND allocation.expires_at <= now()
              AND (NOT EXISTS (SELECT 1 FROM tenant.pos_payments payment WHERE payment.organization_id = cart.organization_id AND payment.cart_id = cart.id
                     AND (payment.status IN ('initiated', 'pending', 'authorized') OR (payment.status = 'captured' AND payment.sale_id IS NULL)))
                   OR cart.checkout_started_at + make_interval(mins => $3) <= now())))
      ORDER BY allocation.expires_at NULLS FIRST LIMIT 500`, [context.organizationId, itemIds, policy.maxHoldMinutes])).rows;
  const ctx = stockContext(context);
  for (const row of due) await releaseStockReservation(client, ctx, row.id, { status: "released", reasonCode: "expired", reason: "POS checkout reservation expired" });
  return { released: due.length };
}

// Checkout begins: every stock line reserved in full, or nothing (the caller wraps this in a savepoint). The bill must already carry its new
// checkout reference and lease. A shortfall is refused unless the company lets POS sell beyond stock — then only what exists is reserved.
export async function reservePosCheckoutStock(client, context, cartId) {
  const cart = (await client.query(`SELECT * FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`, [context.organizationId, cartId])).rows[0];
  const lines = (await stockLines(client, context, cartId)).filter((line) => !line.non_stock);
  if (!lines.length) return { reserved: [], warehouse: null };
  const source = await resolvePosFulfillmentWarehouse(client, context, cart);
  const policy = await policyOf(client, context);
  await sweepExpiredPosCheckoutReservations(client, context, { itemIds: [...new Set(lines.map((line) => line.item_id))] });
  const reserved = [];
  for (const line of lines) {
    if (line.warehouse_id && line.warehouse_id !== source.warehouseId) throw stockError(409, "POS_STOCK_WAREHOUSE_MISMATCH", undefined, { lineId: line.id });
    if (!(Number(line.base_quantity) > 0)) throw stockError(400, "POS_STOCK_UOM_INVALID", `${line.description}: ${POS_STOCK_MESSAGES.POS_STOCK_UOM_INVALID}`, { lineId: line.id });
    if (line.tracking_type === "serial" && !line.serial_id) throw stockError(409, "POS_STOCK_SERIAL_REQUIRED", undefined, { lineId: line.id });
    if (line.tracking_type === "batch" && !line.batch_id) throw stockError(409, "POS_STOCK_BATCH_REQUIRED", undefined, { lineId: line.id });
    const held = (await activeAllocations(client, context, cart.checkout_reference, line.id)).reduce((sum, row) => sum + Number(row.active_quantity), 0);
    const missing = n(Number(line.base_quantity) - held);
    if (missing <= 0) { reserved.push({ lineId: line.id, reserved: n(held) }); continue; }
    const result = await reserveLine(client, context, cart, line, source, missing, cart.checkout_expires_at);
    if (result.shortfall > 0 && !policy.allowNegative) {
      const available = n(result.reserved + held);
      throw cashierError({ code: "STOCK_RESERVATION_INSUFFICIENT" }, line, available);
    }
    reserved.push({ lineId: line.id, reserved: n(held + result.reserved), shortfall: result.shortfall });
  }
  await event(client, context, "pos_cart", cartId, "pos.stock.reserved",
    { checkoutReference: cart.checkout_reference, warehouseId: source.warehouseId, lines: reserved, expiresAt: cart.checkout_expires_at });
  return { reserved, warehouse: source };
}

// Gives back what a checkout holds (back to the bill, a lapsed or abandoned checkout). Safe to repeat.
export async function releasePosCheckoutStock(client, context, checkoutReference, { reasonCode = "released", reason = "POS checkout ended", cartId = null } = {}) {
  if (!checkoutReference) return { released: 0 };
  const ctx = stockContext(context);
  const allocations = await activeAllocations(client, context, checkoutReference);
  for (const allocation of allocations) await releaseStockReservation(client, ctx, allocation.id, { status: "released", reasonCode, reason });
  if (allocations.length && cartId) await event(client, context, "pos_cart", cartId, "pos.stock.released", { checkoutReference, reasonCode, allocations: allocations.length });
  return { released: allocations.length };
}

// Renews a checkout's lease while payment is under way: never past checkout start + the outlet's maximum hold. A reservation that already
// expired is released and reserved again (availability and eligibility checked anew). The bill's own checkout lease moves with it.
export async function renewPosCheckoutStock(client, context, cartId) {
  const cart = (await client.query(`SELECT * FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, cartId])).rows[0];
  if (!cart?.checkout_started_at || !cart.checkout_reference) return { renewed: 0, expiresAt: null };
  const policy = await policyOf(client, context);
  const cap = new Date(new Date(cart.checkout_started_at).getTime() + policy.maxHoldMinutes * 60000);
  const wanted = new Date(Math.min(Date.now() + policy.leaseMinutes * 60000, cap.getTime()));
  if (wanted.getTime() <= Date.now()) return { renewed: 0, expiresAt: cart.checkout_expires_at, capped: true };
  const ctx = stockContext(context);
  let renewed = 0;
  for (const allocation of await activeAllocations(client, context, cart.checkout_reference)) {
    if (allocation.expires_at && new Date(allocation.expires_at).getTime() <= Date.now()) {
      await releaseStockReservation(client, ctx, allocation.id, { status: "released", reasonCode: "expired", reason: "POS checkout reservation expired before renewal" });
      continue;
    }
    await renewStockReservation(client, ctx, allocation.id, wanted.toISOString());
    renewed += 1;
  }
  await client.query(`UPDATE tenant.pos_carts SET checkout_expires_at=greatest(checkout_expires_at, $3::timestamptz) WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cartId, wanted.toISOString()]);
  // Whatever lapsed is reserved again now (or the shortfall reported).
  const refreshed = { ...cart, checkout_expires_at: wanted.toISOString() };
  const result = await ensurePosCheckoutStockAllocation(client, context, refreshed, { reserveOnly: true });
  await event(client, context, "pos_cart", cartId, "pos.stock.renewed", { checkoutReference: cart.checkout_reference, renewed, expiresAt: wanted.toISOString(), capped: wanted.getTime() === cap.getTime() });
  return { renewed, expiresAt: wanted.toISOString(), capped: wanted.getTime() === cap.getTime(), shortfalls: result.shortfalls };
}

// Completion: every stock line covered by live reservations of this checkout. Expired ones are released and reserved again (never consumed
// blindly); a line that cannot be covered stops the sale (POS_STOCK_RESERVATION_EXPIRED when its reservation had lapsed, else POS_STOCK_INSUFFICIENT),
// unless POS may sell beyond stock (then the shortfall is issued directly and Inventory's own negative-stock policy decides).
// Returns Map(cartLineId → { allocations, shortfall }).
export async function ensurePosCheckoutStockAllocation(client, context, cart, { reserveOnly = false } = {}) {
  const lines = (await stockLines(client, context, cart.id)).filter((line) => !line.non_stock);
  const coverage = new Map();
  const shortfalls = [];
  if (!lines.length) return { coverage, shortfalls };
  const source = await resolvePosFulfillmentWarehouse(client, context, cart);
  if (!cart.checkout_reference) {
    cart.checkout_reference = (await client.query(`UPDATE tenant.pos_carts SET checkout_reference=COALESCE(checkout_reference, gen_random_uuid()) WHERE organization_id=$1 AND id=$2
      RETURNING checkout_reference`, [context.organizationId, cart.id])).rows[0].checkout_reference;
  }
  const policy = await policyOf(client, context);
  const ctx = stockContext(context);
  await sweepExpiredPosCheckoutReservations(client, context, { itemIds: [...new Set(lines.map((line) => line.item_id))] });
  for (const line of lines) {
    if (line.warehouse_id && line.warehouse_id !== source.warehouseId) throw stockError(409, "POS_STOCK_WAREHOUSE_MISMATCH", undefined, { lineId: line.id });
    let lapsed = false;
    let allocations = [];
    for (const allocation of await activeAllocations(client, context, cart.checkout_reference, line.id)) {
      if (allocation.expires_at && new Date(allocation.expires_at).getTime() <= Date.now()) {
        lapsed = true;
        await releaseStockReservation(client, ctx, allocation.id, { status: "released", reasonCode: "expired", reason: "POS checkout reservation expired before the sale completed" });
      } else allocations.push(allocation);
    }
    // A reservation released earlier (a lapse swept by another checkout) also counts as lapsed.
    if (!lapsed && !allocations.length) lapsed = Boolean((await client.query(
      `SELECT 1 FROM tenant.stock_reservations WHERE organization_id=$1 AND reference_type='pos_checkout' AND reference_id=$2 AND release_reason_code='expired' AND item_id=$3 LIMIT 1`,
      [context.organizationId, cart.checkout_reference, line.item_id])).rows[0]);
    const held = n(allocations.reduce((sum, row) => sum + Number(row.active_quantity), 0));
    let missing = n(Number(line.base_quantity) - held);
    if (missing > 0) {
      const expiresAt = cart.checkout_expires_at && new Date(cart.checkout_expires_at).getTime() > Date.now() ? cart.checkout_expires_at
        : new Date(Date.now() + policy.leaseMinutes * 60000).toISOString();
      let result;
      try { result = await reserveLine(client, context, cart, line, source, missing, expiresAt); }
      catch (error) {
        if (lapsed && error.code === "POS_STOCK_INSUFFICIENT") throw stockError(409, "POS_STOCK_RESERVATION_EXPIRED", `${line.description}: the stock reserved for this bill expired and is no longer available (${error.message})`, error.details);
        throw error;
      }
      missing = result.shortfall;
      allocations = await activeAllocations(client, context, cart.checkout_reference, line.id);
      if (missing > 0 && !policy.allowNegative && !reserveOnly) {
        const available = n(Number(line.base_quantity) - missing);
        if (lapsed) throw stockError(409, "POS_STOCK_RESERVATION_EXPIRED", `${line.description}: the stock reserved for this bill expired; only ${qty(available, line.base_uom)} is available now.`,
          { lineId: line.id, available });
        throw cashierError({ code: "STOCK_RESERVATION_INSUFFICIENT" }, line, available);
      }
      if (missing > 0) shortfalls.push({ lineId: line.id, shortfall: missing });
    }
    coverage.set(line.id, { line, allocations, shortfall: missing > 0 ? missing : 0 });
  }
  return { coverage, shortfalls };
}

// The sale takes its stock: each reservation of the line consumed once (one issue movement each — several when the stock was spread over
// locations or batches), linked to the sale and its line; anything reserved beyond the line is released. Keys are the checkout's, so a retry
// returns the original movements. Returns the movement ids.
export async function consumePosLineStock(client, context, { checkoutReference, saleId, saleLineId, coverage }) {
  const ctx = stockContext(context);
  const { line } = coverage;
  let left = n(line.base_quantity);
  const movements = [];
  for (const allocation of coverage.allocations) {
    if (left <= 0) {
      await releaseStockReservation(client, ctx, allocation.id, { status: "released", reasonCode: "not_needed", reason: "More was reserved than the sale took" });
      continue;
    }
    const take = n(Math.min(left, Number(allocation.active_quantity)));
    let consumed;
    try {
      consumed = await consumeStockReservation(client, ctx, allocation.id, take, {
        posSaleId: saleId, posSaleLineId: saleLineId,
        issue: { referenceType: "pos_sale", referenceId: saleId, sourceLineId: saleLineId, idempotencyKey: `pos-checkout:${checkoutReference}:line:${line.id}:reservation:${allocation.id}` },
      });
    } catch (error) { throw cashierError(error, line); }
    if (consumed.stockMovementId) movements.push(consumed.stockMovementId);
    left = n(left - take);
    if (Number(consumed.active_quantity ?? 0) > 0 && left <= 0)
      await releaseStockReservation(client, ctx, allocation.id, { status: "released", reasonCode: "not_needed", reason: "More was reserved than the sale took" });
  }
  // Selling beyond stock (only when POS allows it): the rest is issued directly; Inventory's negative-stock policy decides whether it may.
  if (left > 0) {
    try {
      const movement = await postStockMovement(client, ctx, {
        movementType: "issue", itemId: line.item_id, warehouseId: line.warehouse_id, warehouseLocationId: line.warehouse_location_id, batchId: line.batch_id, serialId: line.serial_id,
        quantity: left, referenceType: "pos_sale", referenceId: saleId, sourceLineId: saleLineId, reason: "POS sale issue (not reserved)",
        idempotencyKey: `pos-checkout:${checkoutReference}:line:${line.id}:unreserved`,
      });
      movements.push(movement.id);
    } catch (error) { throw cashierError(error, line, n(line.base_quantity) - left); }
  }
  return movements;
}

// A paid bill whose sale could not take its stock: marked for recovery (its payments stay as they are). Called after the completion savepoint
// was rolled back, so it is recorded even though the sale is not.
export async function markPosStockRecovery(client, context, cartId, failure) {
  if (!isPosStockFailure(failure?.code)) return false;
  const paid = (await client.query(
    `SELECT 1 FROM tenant.pos_payments WHERE organization_id=$1 AND cart_id=$2 AND sale_id IS NULL AND (status='captured' OR (payment_method='cash' AND custody_status='pending')) LIMIT 1`,
    [context.organizationId, cartId])).rows[0];
  if (!paid) return false;
  await client.query(
    `UPDATE tenant.pos_carts SET stock_recovery_status='required', stock_recovery_code=$3, stock_recovery_message=$4, stock_recovery_at=now(), stock_recovery_resolved_at=NULL
      WHERE organization_id=$1 AND id=$2`, [context.organizationId, cartId, String(failure.code).slice(0, 80), String(failure.message ?? "").slice(0, 500)]);
  await event(client, context, "pos_cart", cartId, "pos.stock.recovery_required", { code: failure.code, message: failure.message });
  return true;
}

// The recovery ends: the sale completed (or its payments were given back and the checkout released).
export async function resolvePosStockRecovery(client, context, cartId, how) {
  const row = (await client.query(
    `UPDATE tenant.pos_carts SET stock_recovery_status='resolved', stock_recovery_resolved_at=now() WHERE organization_id=$1 AND id=$2 AND stock_recovery_status='required' RETURNING id`,
    [context.organizationId, cartId])).rows[0];
  if (row) await event(client, context, "pos_cart", cartId, "pos.stock.recovery_resolved", { how });
}

// ------------------------------------------------------------------ reads

const lineStatus = (allocations, consumed, line) => {
  if (line.non_stock) return "NOT_STOCKED";
  if (consumed >= Number(line.base_quantity) - 1e-9) return "CONSUMED";
  const active = allocations.filter((row) => row.status === "active");
  if (active.length && active.some((row) => row.expires_at && new Date(row.expires_at).getTime() <= Date.now())) return "EXPIRED";
  const held = active.reduce((sum, row) => sum + Number(row.active_quantity), 0);
  if (held >= Number(line.base_quantity) - 1e-9) return "RESERVED";
  if (held > 0) return "PARTLY_RESERVED";
  if (allocations.some((row) => row.release_reason_code === "expired")) return "EXPIRED";
  if (allocations.some((row) => row.status === "released")) return "RELEASED";
  return "NOT_RESERVED";
};

// The checkout's stock: per line what is to be sold, what was available before it was reserved, what is reserved (where, which batch or
// serial, until when), what the sale consumed and the movements; overall RESERVED / PARTLY_RESERVED / EXPIRED / RELEASED / CONSUMED / NOT_REQUIRED,
// and any stock recovery.
export async function getPosCheckoutStockStatus(client, context, cartId) {
  requirePermission(context, "pos.sale.create");
  const cart = (await client.query(`SELECT * FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`, [context.organizationId, cartId])).rows[0];
  if (!cart) throw posError(404, "POS cart was not found.", "POS_CART_NOT_FOUND");
  await assertPosStoreAccess(client, context, cart.store_id, cart.terminal_id);
  const lines = await stockLines(client, context, cartId);
  let source = null;
  let sourceError = null;
  if (lines.some((line) => !line.non_stock)) {
    try { source = await resolvePosFulfillmentWarehouse(client, context, cart); } catch (error) { sourceError = { code: error.code, message: error.message }; }
  }
  const allocations = cart.checkout_reference ? (await client.query(
    `SELECT allocation.id, allocation.reservation_number, allocation.status, allocation.quantity, allocation.active_quantity, allocation.consumed_quantity, allocation.expires_at,
            allocation.renewal_count, allocation.release_reason_code, allocation.item_id, parent.source_line_id, location.code AS location, batch.batch_number, batch.expires_on,
            serial.serial_number
       FROM tenant.stock_reservations allocation
       JOIN tenant.inventory_reservations parent ON parent.organization_id = allocation.organization_id AND parent.id = allocation.inventory_reservation_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = allocation.organization_id AND location.id = allocation.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = allocation.organization_id AND batch.id = allocation.batch_id
       LEFT JOIN tenant.stock_serials serial ON serial.organization_id = allocation.organization_id AND serial.id = allocation.serial_id
      WHERE allocation.organization_id = $1 AND allocation.reference_type = 'pos_checkout' AND allocation.reference_id = $2 ORDER BY allocation.created_at`,
    [context.organizationId, cart.checkout_reference])).rows : [];
  const movements = cart.completed_sale_id ? await saleMovementRows(client, context, cart.completed_sale_id) : [];
  const out = [];
  for (const line of lines) {
    const mine = allocations.filter((row) => row.source_line_id === line.id);
    const consumed = n(mine.reduce((sum, row) => sum + Number(row.consumed_quantity), 0)) || (cart.completed_sale_id
      ? n(-movements.filter((row) => row.cart_line_number === line.line_number).reduce((sum, row) => sum + Number(row.quantity), 0)) : 0);
    const reserved = n(mine.filter((row) => row.status === "active").reduce((sum, row) => sum + Number(row.active_quantity), 0));
    let availableNow = null;
    if (!line.non_stock && source && cart.status !== "completed") availableNow = await availableAt(client, context, line, source);
    out.push({
      lineId: line.id, lineNumber: line.line_number, itemId: line.item_id, sku: line.sku, description: line.description, quantity: n(line.quantity), uom: line.uom,
      baseQuantity: n(line.base_quantity), baseUom: line.base_uom, stocked: !line.non_stock, status: lineStatus(mine, consumed, line),
      availableNow, availableBeforeReservation: availableNow === null ? null : n(availableNow + reserved), reserved, consumed,
      allocations: mine.map((row) => ({ id: row.id, number: row.reservation_number, status: row.release_reason_code === "expired" ? "expired" : row.status, quantity: n(row.quantity),
        active: n(row.active_quantity), consumed: n(row.consumed_quantity), location: row.location ?? "MAIN", batch: row.batch_number, batchExpiresOn: row.expires_on, serial: row.serial_number,
        expiresAt: row.expires_at, renewals: Number(row.renewal_count ?? 0) })),
    });
  }
  const stocked = out.filter((line) => line.stocked);
  const statuses = new Set(stocked.map((line) => line.status));
  const status = !stocked.length ? "NOT_REQUIRED" : cart.stock_recovery_status === "required" && cart.status !== "completed" ? "RECOVERY_REQUIRED"
    : statuses.size === 1 ? [...statuses][0] : statuses.has("EXPIRED") ? "EXPIRED" : statuses.has("CONSUMED") ? "PARTLY_CONSUMED" : "PARTLY_RESERVED";
  const active = allocations.filter((row) => row.status === "active" && row.expires_at);
  return {
    cartId, checkoutReference: cart.checkout_reference, checkoutStarted: Boolean(cart.checkout_started_at), status,
    warehouse: source ? { id: source.warehouseId, code: source.warehouseCode, name: source.warehouseName, store: source.storeName } : null, warehouseError: sourceError,
    expiresAt: active.length ? active.map((row) => row.expires_at).sort()[0] : null, saleId: cart.completed_sale_id ?? null, movementsPosted: movements.length,
    recovery: cart.stock_recovery_status ? { status: cart.stock_recovery_status, code: cart.stock_recovery_code, message: cart.stock_recovery_message, at: cart.stock_recovery_at,
      resolvedAt: cart.stock_recovery_resolved_at } : null,
    lines: out,
  };
}

async function saleMovementRows(client, context, saleId) {
  return (await client.query(
    `SELECT movement.id, movement.movement_number, movement.quantity, movement.unit_cost, movement.occurred_at, movement.ledger_type, movement.source_line_id, movement.idempotency_key,
            item.code AS sku, item.name AS item_name, base.code AS base_uom, warehouse.code AS warehouse_code, COALESCE(location.code, 'MAIN') AS location_code,
            batch.batch_number, serial.serial_number, sale_line.line_number AS cart_line_number, sale_line.id AS sale_line_id, sale_line.description,
            reservation.reservation_number, valuation.value AS valuation_value, valuation.id AS valuation_id
       FROM tenant.stock_movements movement
       JOIN tenant.items item ON item.organization_id = movement.organization_id AND item.id = movement.item_id
       LEFT JOIN tenant.units_of_measure base ON base.organization_id = item.organization_id AND base.id = item.uom_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = movement.organization_id AND warehouse.id = movement.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = movement.organization_id AND location.id = movement.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = movement.organization_id AND batch.id = movement.batch_id
       LEFT JOIN tenant.stock_serials serial ON serial.organization_id = movement.organization_id AND serial.id = movement.serial_id
       LEFT JOIN tenant.pos_sale_lines sale_line ON sale_line.organization_id = movement.organization_id AND sale_line.sale_id = movement.reference_id
            AND (sale_line.id = movement.source_line_id OR (movement.source_line_id IS NULL AND sale_line.stock_movement_id = movement.id))
       LEFT JOIN tenant.stock_reservation_consumptions consumption ON consumption.organization_id = movement.organization_id AND consumption.stock_movement_id = movement.id
       LEFT JOIN tenant.stock_reservations reservation ON reservation.organization_id = movement.organization_id AND reservation.id = consumption.reservation_id
       LEFT JOIN LATERAL (SELECT min(entry.id::text)::uuid AS id, sum(entry.value_delta) AS value FROM tenant.inventory_valuation_entries entry
                           WHERE entry.organization_id = movement.organization_id AND entry.movement_id = movement.id) valuation ON true
      WHERE movement.organization_id = $1 AND movement.reference_type = 'pos_sale' AND movement.reference_id = $2
      ORDER BY sale_line.line_number NULLS LAST, movement.occurred_at, movement.movement_number`, [context.organizationId, saleId])).rows;
}

// A sale's stock movements: one or more per stocked line, with the reservation each consumed, its cost (from Inventory valuation — never the
// selling price) and whether the sale's quantities and the movements agree, line by line.
export async function getPosSaleStockMovements(client, context, saleId) {
  requirePermission(context, "pos.view");
  const sale = (await client.query(`SELECT id, store_id, terminal_id, receipt_number, invoice_number, cart_id FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, saleId])).rows[0];
  if (!sale) throw posError(404, "POS sale was not found.", "POS_SALE_NOT_FOUND");
  await assertPosStoreAccess(client, context, sale.store_id);
  const rows = await saleMovementRows(client, context, saleId);
  const lines = (await client.query(
    `SELECT line.id, line.line_number, line.description, line.quantity, COALESCE(line.base_quantity, line.quantity) AS base_quantity, line.uom_factor, uom.code AS uom,
            (item.item_type = 'service' OR item.track_inventory = false) AS non_stock
       FROM tenant.pos_sale_lines line JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
      WHERE line.organization_id = $1 AND line.sale_id = $2 ORDER BY line.line_number`, [context.organizationId, saleId])).rows;
  const reconciliation = lines.map((line) => {
    const moved = n(-rows.filter((row) => row.sale_line_id === line.id).reduce((sum, row) => sum + Number(row.quantity), 0));
    const expected = line.non_stock ? 0 : n(line.base_quantity);
    return { lineId: line.id, lineNumber: line.line_number, description: line.description, quantity: n(line.quantity), uom: line.uom, conversionFactor: n(line.uom_factor ?? 1),
      expectedBaseQuantity: expected, issuedBaseQuantity: moved, stocked: !line.non_stock, status: Math.abs(moved - expected) < 1e-6 ? "MATCHED" : moved < expected ? "MISSING" : "EXCESS" };
  });
  const matched = reconciliation.every((line) => line.status === "MATCHED");
  return {
    saleId, receiptNumber: sale.receipt_number, invoiceNumber: sale.invoice_number, status: matched ? "CONSUMED" : "RECONCILIATION_REQUIRED",
    inventoryReconciliationStatus: matched ? "MATCHED" : "MISMATCH", movementsPosted: rows.length,
    costConsumed: n(rows.reduce((sum, row) => sum + Math.abs(Number(row.valuation_value ?? Number(row.quantity) * Number(row.unit_cost ?? 0))), 0)),
    movements: rows.map((row) => ({ id: row.id, number: row.movement_number, saleLineId: row.sale_line_id, lineNumber: row.cart_line_number, description: row.description ?? row.item_name,
      sku: row.sku, quantity: n(row.quantity), baseUom: row.base_uom, warehouse: row.warehouse_code, location: row.location_code, batch: row.batch_number, serial: row.serial_number,
      reservation: row.reservation_number, unitCost: n(row.unit_cost), value: n(Math.abs(Number(row.valuation_value ?? Number(row.quantity) * Number(row.unit_cost ?? 0)))),
      valuationReferenceId: row.valuation_id, ledgerType: row.ledger_type, postedAt: row.occurred_at })),
    reconciliation,
  };
}

// Stock Reduction report and reconciliation for a period (default this month), the outlets the user may see: quantities sold by item, by
// warehouse, by batch; serials sold; cost consumed; sale lines whose quantities and movements disagree; bills waiting on stock recovery;
// checkout holds active, expired and released; and sold quantity against POS sale quantity.
export async function getPosStockSummary(client, context, { from = null, to = null, storeId = null } = {}) {
  requirePermission(context, "pos.view");
  if (storeId) await assertPosStoreAccess(client, context, storeId);
  const today = new Date();
  const start = from ?? new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const end = to ?? today.toISOString().slice(0, 10);
  const v = [context.organizationId, start, end, storeId];
  const saleScope = `sale.organization_id = $1 AND sale.completed_at >= $2::date AND sale.completed_at < $3::date + 1 AND sale.status = 'completed' AND ($4::uuid IS NULL OR sale.store_id = $4)`;
  const movementsSql = `FROM tenant.stock_movements movement JOIN tenant.pos_sales sale ON sale.organization_id = movement.organization_id AND sale.id = movement.reference_id
    JOIN tenant.items item ON item.organization_id = movement.organization_id AND item.id = movement.item_id
    LEFT JOIN tenant.units_of_measure base ON base.organization_id = item.organization_id AND base.id = item.uom_id
    WHERE movement.reference_type = 'pos_sale' AND ${saleScope}`;
  const [byItem, byWarehouse, byBatch, serials, mismatches, recovery, holds] = await Promise.all([
    client.query(`SELECT item.code AS sku, item.name, base.code AS base_uom, -sum(movement.quantity) AS quantity, -sum(movement.quantity * movement.unit_cost) AS cost
      ${movementsSql} GROUP BY item.code, item.name, base.code ORDER BY -sum(movement.quantity) DESC LIMIT 50`, v),
    client.query(`SELECT store.name AS outlet, warehouse.code AS warehouse, count(DISTINCT sale.id) AS sales, -sum(movement.quantity) AS quantity, -sum(movement.quantity * movement.unit_cost) AS cost
      ${movementsSql.replace("WHERE movement", `JOIN tenant.pos_stores store ON store.organization_id = sale.organization_id AND store.id = sale.store_id
        JOIN tenant.warehouses warehouse ON warehouse.organization_id = movement.organization_id AND warehouse.id = movement.warehouse_id WHERE movement`)}
      GROUP BY store.name, warehouse.code ORDER BY store.name`, v),
    client.query(`SELECT item.code AS sku, batch.batch_number, batch.expires_on, -sum(movement.quantity) AS quantity
      ${movementsSql.replace("WHERE movement", "JOIN tenant.stock_batches batch ON batch.organization_id = movement.organization_id AND batch.id = movement.batch_id WHERE movement")}
      GROUP BY item.code, batch.batch_number, batch.expires_on ORDER BY item.code, batch.batch_number LIMIT 100`, v),
    client.query(`SELECT item.code AS sku, serial.serial_number, sale.receipt_number, sale.completed_at
      ${movementsSql.replace("WHERE movement", "JOIN tenant.stock_serials serial ON serial.organization_id = movement.organization_id AND serial.id = movement.serial_id WHERE movement")}
      ORDER BY sale.completed_at DESC LIMIT 100`, v),
    client.query(`SELECT sale.id AS sale_id, sale.receipt_number, line.line_number, line.description, COALESCE(line.base_quantity, line.quantity) AS expected,
            COALESCE((SELECT -sum(movement.quantity) FROM tenant.stock_movements movement WHERE movement.organization_id = line.organization_id AND movement.reference_type = 'pos_sale'
                       AND movement.reference_id = sale.id AND (movement.source_line_id = line.id OR (movement.source_line_id IS NULL AND movement.id = line.stock_movement_id))), 0) AS issued
       FROM tenant.pos_sale_lines line JOIN tenant.pos_sales sale ON sale.organization_id = line.organization_id AND sale.id = line.sale_id
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
      WHERE ${saleScope} AND item.item_type <> 'service' AND item.track_inventory IS NOT FALSE`, v),
    client.query(`SELECT cart.id, cart.cart_reference, cart.stock_recovery_code, cart.stock_recovery_message, cart.stock_recovery_at, store.name AS outlet
       FROM tenant.pos_carts cart JOIN tenant.pos_stores store ON store.organization_id = cart.organization_id AND store.id = cart.store_id
      WHERE cart.organization_id = $1 AND cart.stock_recovery_status = 'required' AND ($2::uuid IS NULL OR cart.store_id = $2) ORDER BY cart.stock_recovery_at DESC LIMIT 50`,
      [context.organizationId, storeId]),
    client.query(`SELECT count(*) FILTER (WHERE status = 'active') AS active, count(*) FILTER (WHERE status = 'active' AND expires_at <= now()) AS overdue,
            count(*) FILTER (WHERE release_reason_code = 'expired' AND released_at >= $2::date AND released_at < $3::date + 1) AS expired,
            count(*) FILTER (WHERE status = 'consumed' AND updated_at >= $2::date AND updated_at < $3::date + 1) AS consumed,
            count(*) FILTER (WHERE status = 'released' AND COALESCE(release_reason_code, '') <> 'expired' AND released_at >= $2::date AND released_at < $3::date + 1) AS released
       FROM tenant.stock_reservations WHERE organization_id = $1 AND reference_type = 'pos_checkout'`, [context.organizationId, start, end]),
  ]);
  const discrepancies = mismatches.rows.filter((row) => Math.abs(Number(row.expected) - Number(row.issued)) > 1e-6)
    .map((row) => ({ saleId: row.sale_id, receiptNumber: row.receipt_number, lineNumber: row.line_number, description: row.description, expected: n(row.expected), issued: n(row.issued) }));
  const soldQuantity = n(mismatches.rows.reduce((sum, row) => sum + Number(row.expected), 0));
  const issuedQuantity = n(mismatches.rows.reduce((sum, row) => sum + Number(row.issued), 0));
  const h = holds.rows[0];
  return {
    from: start, to: end,
    totals: { soldQuantity, issuedQuantity, costConsumed: n(byItem.rows.reduce((sum, row) => sum + Number(row.cost ?? 0), 0)), discrepancies: discrepancies.length,
      recoveryRequired: recovery.rows.length, activeHolds: Number(h.active), overdueHolds: Number(h.overdue), expiredHolds: Number(h.expired), consumedHolds: Number(h.consumed),
      releasedHolds: Number(h.released) },
    byItem: byItem.rows.map((row) => ({ sku: row.sku, name: row.name, baseUom: row.base_uom, quantity: n(row.quantity), cost: n(row.cost) })),
    byOutlet: byWarehouse.rows.map((row) => ({ outlet: row.outlet, warehouse: row.warehouse, sales: Number(row.sales), quantity: n(row.quantity), cost: n(row.cost) })),
    byBatch: byBatch.rows.map((row) => ({ sku: row.sku, batch: row.batch_number, expiresOn: row.expires_on, quantity: n(row.quantity) })),
    serialsSold: serials.rows.map((row) => ({ sku: row.sku, serial: row.serial_number, receiptNumber: row.receipt_number, soldAt: row.completed_at })),
    discrepancies,
    recovery: recovery.rows.map((row) => ({ cartId: row.id, cartReference: row.cart_reference, code: row.stock_recovery_code, message: row.stock_recovery_message, at: row.stock_recovery_at,
      outlet: row.outlet })),
  };
}

// Housekeeping: release expired checkout holds now (Inventory reconcilers and POS administrators).
export async function sweepPosCheckoutReservations(client, context) {
  if (!["stock.reservations.reconcile", "pos.settings.manage", "pos.reconciliation.manage"].some((permission) => context.permissions?.includes(permission))
    && !context.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)))
    throw stockError(403, "POS_STOCK_PERMISSION_DENIED");
  return sweepExpiredPosCheckoutReservations(client, context);
}
