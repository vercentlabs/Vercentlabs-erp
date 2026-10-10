// Barcode Scanning (POS, migration 0085): scan → identify → validate → add to the sale → ready for the next scan.
//
// Scanning is an input to Product Search and the cart, never a catalogue, price list, tax rule or stock system of its own. A completed scan
// arrives with its own action id; the barcode is resolved exactly in the Item Master's registry (lookupPosProductByBarcode), the product is
// checked for this outlet, price and stock (the same rules as search), serials are checked and batches allocated through Inventory, and the
// line is added through the one cart operation (addPosCartLine) — so a scan can never do what the cart would refuse.
//
// Every scan ends in an identifiable outcome: "added", "selection_required" (an ambiguous barcode or a variant group), "serial_required",
// "batch_required" or "rejected" with a stable code and a cashier message. The same action id retried returns its original outcome without
// adding again; the id reused for a different scan is refused; a new scan of the same barcode adds one more. Failed and slow scans are
// recorded as diagnostics; successful ones are already in the cart's records.
import { createHash } from "node:crypto";

import { decimal } from "../../../core/decimal.js";
import { posError } from "../shared/errors.js";
import { assertPosStoreAccess, requirePermission } from "../shared/access-control.js";
import { cleanScannedValue, lookupPosProductByBarcode, posProductError, resolvePosProductContext } from "../product-search/index.js";
import { addPosCartLine, getPosCart, lockPosCart } from "../assortment-pricing-customer-and-cart/cart.js";
import { itemPositions, DISPOSITION_SQL } from "../../stock/positions.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOW_SCAN_MS = 500;
const privileged = (context) => Boolean(context.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (context, permission) => privileged(context) || Boolean(context.permissions?.includes(permission));

export const POS_SCAN_MESSAGES = Object.freeze({
  POS_BARCODE_NOT_FOUND: "Barcode not found. Try searching by product name.",
  POS_BARCODE_AMBIGUOUS: "This barcode matches more than one product. Contact a manager.",
  POS_BARCODE_INACTIVE: "This barcode is no longer active.",
  POS_BARCODE_INVALID: "Barcode could not be read. Please scan again.",
  POS_PRODUCT_INACTIVE: "This product is inactive.",
  POS_PRODUCT_NOT_SELLABLE: "This product cannot be sold.",
  POS_PRODUCT_OUTLET_RESTRICTED: "Product is not available at this store.",
  POS_PRODUCT_PRICE_MISSING: "Selling price is not set.",
  POS_PRODUCT_OUT_OF_STOCK: "Product is out of stock.",
  POS_PRODUCT_INSUFFICIENT_STOCK: "Not enough stock for this quantity.",
  POS_PRODUCT_UOM_INVALID: "This pack size is not configured correctly.",
  POS_PRODUCT_SELECTION_REQUIRED: "Choose the exact product to add.",
  POS_SERIAL_REQUIRED: "Scan or select the product's serial number.",
  POS_SERIAL_UNAVAILABLE: "This serial number is not available for sale.",
  POS_BATCH_REQUIRED: "Choose the batch to sell from.",
  POS_SESSION_REQUIRED: "Open a POS session before adding products.",
  POS_PERMISSION_DENIED: "You cannot add products to this sale.",
  POS_CART_NOT_EDITABLE: "This sale can no longer be changed.",
  POS_SCAN_PROCESSING_FAILED: "Could not add the product. Please retry.",
});
const SCAN_CODE_OF_LOOKUP = { not_found: "POS_BARCODE_NOT_FOUND", invalid: "POS_BARCODE_INVALID", inactive: "POS_BARCODE_INACTIVE" };
const RESULT_OF_LOOKUP = { not_found: "not_found", invalid: "invalid", inactive: "inactive_barcode" };
const KNOWN_CODES = new Set(Object.keys(POS_SCAN_MESSAGES));

const fingerprintOf = (input) => createHash("sha256")
  .update(JSON.stringify([input.barcode, input.serialNumber ?? null, input.batchId ?? null, input.itemId ?? null])).digest("hex");

// ------------------------------------------------------------------ diagnostics

export async function recordScanDiagnostic(client, context, details) {
  try {
    await client.query(
      `INSERT INTO tenant.pos_scan_events (organization_id, store_id, terminal_id, shift_id, cart_id, cashier_id, user_id, scan_action_id, barcode, result, error_code, duration_ms)
       VALUES ($1, $2, $3, $4, $5, (SELECT id FROM tenant.pos_cashiers WHERE organization_id = $1 AND user_id = $6), $6, $7, $8, $9, $10, $11)`,
      [context.organizationId, details.storeId ?? null, details.terminalId ?? null, details.shiftId ?? null, details.cartId ?? null, context.userId ?? null,
        details.scanActionId ?? null, details.barcode ? String(details.barcode).slice(0, 64) : null, details.result, details.errorCode ?? null,
        details.durationMs == null ? null : Math.round(details.durationMs)]);
  } catch { /* diagnostics never block a sale */ }
}

// Failed scans and slow scans for the scan diagnostics screen (POS administrators and report viewers).
export async function listScanDiagnostics(client, context, { result = null, limit = 100 } = {}) {
  if (!can(context, "pos.terminals.view_transactions") && !can(context, "pos.settings.manage")) throw posProductError("POS_PERMISSION_DENIED");
  const { rows } = await client.query(
    `SELECT event.*, outlet.code AS outlet_code, terminal.code AS terminal_code, person.full_name AS user_name
       FROM tenant.pos_scan_events event
       LEFT JOIN tenant.pos_stores outlet ON outlet.organization_id = event.organization_id AND outlet.id = event.store_id
       LEFT JOIN tenant.pos_terminals terminal ON terminal.organization_id = event.organization_id AND terminal.id = event.terminal_id
       LEFT JOIN public.users person ON person.id = event.user_id
      WHERE event.organization_id = $1 AND ($2::text IS NULL OR event.result = $2) ORDER BY event.created_at DESC LIMIT $3`,
    [context.organizationId, result, Math.min(Math.max(Number(limit) || 100, 1), 500)]);
  return rows.map((row) => ({ id: row.id, at: row.created_at, outlet: row.outlet_code, terminal: row.terminal_code, user: row.user_name, barcode: row.barcode, result: row.result,
    errorCode: row.error_code, durationMs: row.duration_ms, scanActionId: row.scan_action_id }));
}

// ------------------------------------------------------------------ terminal scanner settings

const toSettings = (row) => ({
  terminalId: row.id, enabled: Boolean(row.barcode_scanning), inputMode: row.scanner_input_mode, prefix: row.scanner_prefix ?? null, suffix: row.scanner_suffix,
  suffixCustom: row.scanner_suffix_custom ?? null, successSound: Boolean(row.scan_success_sound_enabled), errorSound: Boolean(row.scan_error_sound_enabled), version: Number(row.version),
});

async function terminalRow(client, context, terminalId, { lock = false } = {}) {
  if (!UUID.test(String(terminalId ?? ""))) throw posError(404, "POS terminal not found.", "TERMINAL_NOT_FOUND");
  const row = (await client.query(`SELECT * FROM tenant.pos_terminals WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [context.organizationId, terminalId])).rows[0];
  if (!row) throw posError(404, "POS terminal not found.", "TERMINAL_NOT_FOUND");
  return row;
}

// How a terminal's scanner talks: on / off, keyboard-wedge, an optional prefix and the suffix ending each code, and feedback sounds.
export async function getScannerConfiguration(client, context, terminalId) {
  requirePermission(context, "pos.view");
  const row = await terminalRow(client, context, terminalId);
  return { ...toSettings(row), capabilities: { edit: can(context, "pos.terminals.configure_hardware") } };
}

// input: enabled, prefix, suffix ("enter" | "tab" | "custom"), suffixCustom, successSound, errorSound, expectedVersion. Recorded in the
// terminal's history.
export async function updateScannerConfiguration(client, context, terminalId, input = {}) {
  if (!can(context, "pos.terminals.configure_hardware")) throw posError(403, "You do not have permission to configure terminal hardware.", "PERMISSION_DENIED");
  const row = await terminalRow(client, context, terminalId, { lock: true });
  if (input.expectedVersion != null && Number(input.expectedVersion) !== Number(row.version))
    throw posError(409, "This terminal changed since you opened it. Reload and try again.", "TERMINAL_VERSION_CONFLICT");
  const current = toSettings(row);
  const next = {
    enabled: input.enabled ?? current.enabled,
    prefix: input.prefix === undefined ? current.prefix : (String(input.prefix ?? "").length ? String(input.prefix) : null),
    suffix: input.suffix ?? current.suffix,
    suffixCustom: input.suffixCustom === undefined ? current.suffixCustom : (String(input.suffixCustom ?? "").length ? String(input.suffixCustom) : null),
    successSound: input.successSound ?? current.successSound,
    errorSound: input.errorSound ?? current.errorSound,
  };
  const issue = (field, message) => { const error = posError(400, message, "VALIDATION_FAILED"); error.details = { issues: [{ field, message }] }; return error; };
  if (!["enter", "tab", "custom"].includes(next.suffix)) throw issue("suffix", "Choose Enter, Tab or a custom suffix.");
  if (next.prefix && next.prefix.length > 10) throw issue("prefix", "A prefix has at most 10 characters.");
  if (next.suffix === "custom" && (!next.suffixCustom || next.suffixCustom.length > 10)) throw issue("suffixCustom", "Enter the custom suffix (1 to 10 characters).");
  if (next.suffix !== "custom") next.suffixCustom = null;
  await client.query(
    `UPDATE tenant.pos_terminals SET barcode_scanning = $3, scanner_prefix = $4, scanner_suffix = $5, scanner_suffix_custom = $6, scan_success_sound_enabled = $7,
            scan_error_sound_enabled = $8, version = version + 1, updated_at = now(), updated_by = $9 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, Boolean(next.enabled), next.prefix, next.suffix, next.suffixCustom, Boolean(next.successSound), Boolean(next.errorSound), context.userId ?? null]);
  const changes = Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== current[key]).map(([key, value]) => [`scanner.${key}`, { from: current[key], to: value }]));
  if (Object.keys(changes).length) {
    await client.query(`INSERT INTO tenant.pos_terminal_history (organization_id, terminal_id, event_type, summary, changes, actor_user_id) VALUES ($1, $2, 'hardware_changed', $3, $4, $5)`,
      [context.organizationId, row.id, "Scanner settings changed", JSON.stringify(changes), context.userId ?? null]);
  }
  return getScannerConfiguration(client, context, row.id);
}

// ------------------------------------------------------------------ serials and batches (Inventory's)

// Is this serial number this product's, in stock at this outlet's selling warehouse (and the counter's location), usable, not reserved and
// not already on another open sale? Returns { serialId, batchId } or throws POS_SERIAL_UNAVAILABLE with the reason. A serial number is never
// read as a product barcode.
export async function validateScannedSerial(client, context, ctx, { itemId, serialNumber, cartId = null, lineId = null }) {
  const value = cleanScannedValue(serialNumber);
  if (!value) throw posProductError("POS_SERIAL_REQUIRED", { itemId }, POS_SCAN_MESSAGES.POS_SERIAL_REQUIRED);
  const unavailable = (reason, message = POS_SCAN_MESSAGES.POS_SERIAL_UNAVAILABLE) => posProductError("POS_SERIAL_UNAVAILABLE", { itemId, reason, serialNumber: value }, message);
  const row = (await client.query(
    `SELECT serial.*, ${DISPOSITION_SQL()} AS disposition
       FROM tenant.stock_serials serial
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = serial.organization_id AND location.id = serial.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = serial.organization_id AND batch.id = serial.batch_id
      WHERE serial.organization_id = $1 AND serial.serial_number = $2`, [ctx.organizationId, value])).rows[0];
  if (!row) throw unavailable("not_found", "This serial number is not in stock. Check the number or scan it again.");
  if (row.item_id !== itemId) throw unavailable("other_item", "This serial number belongs to another product.");
  if (row.status !== "available") throw unavailable("sold", "This serial number has already been sold.");
  if (row.warehouse_id !== ctx.outlet.warehouse_id || (ctx.outlet.location_id && row.warehouse_location_id !== ctx.outlet.location_id))
    throw unavailable("elsewhere", "This serial number is not in this store's selling stock.");
  if (row.disposition !== "available") throw unavailable("restricted", "This serial number is on hold and cannot be sold.");
  const reserved = (await client.query(`SELECT 1 FROM tenant.stock_reservations WHERE organization_id = $1 AND serial_id = $2 AND status = 'active' LIMIT 1`, [ctx.organizationId, row.id])).rows[0];
  if (reserved) throw unavailable("reserved", "This serial number is reserved for another order.");
  const elsewhere = (await client.query(
    `SELECT line.cart_id FROM tenant.pos_cart_lines line JOIN tenant.pos_carts cart ON cart.organization_id = line.organization_id AND cart.id = line.cart_id
      WHERE line.organization_id = $1 AND line.serial_id = $2 AND cart.status IN ('draft', 'priced', 'held') AND ($3::uuid IS NULL OR line.id <> $3) LIMIT 1`,
    [ctx.organizationId, row.id, lineId])).rows[0];
  if (elsewhere) throw unavailable(elsewhere.cart_id === cartId ? "on_this_sale" : "on_another_sale",
    elsewhere.cart_id === cartId ? "This serial number is already on this sale." : "This serial number is on another open sale.");
  return { serialId: row.id, batchId: row.batch_id ?? null, serialNumber: row.serial_number };
}

// Inventory's eligible batch positions for this outlet (usable, unexpired, unreserved), earliest expiry first, less what this sale already takes
// from each. { options: [{ batchId, batch, expiresOn, available }] } in base units.
async function batchOptions(client, context, ctx, itemId, cartId) {
  const positions = await itemPositions(client, { ...context, permissions: [...new Set([...(context.permissions ?? []), "stock.view"])] },
    { warehouseId: ctx.outlet.warehouse_id, itemId });
  const taken = new Map((await client.query(
    `SELECT batch_id, sum(COALESCE(base_quantity, quantity))::text AS quantity FROM tenant.pos_cart_lines WHERE organization_id = $1 AND cart_id = $2 AND item_id = $3 AND batch_id IS NOT NULL
      GROUP BY batch_id`, [ctx.organizationId, cartId, itemId])).rows.map((row) => [row.batch_id, Number(row.quantity)]));
  const byBatch = new Map();
  for (const position of positions.positions) {
    if (!position.batchId || position.disposition !== "available") continue;
    if (ctx.outlet.location_id && position.locationId !== ctx.outlet.location_id) continue;
    const entry = byBatch.get(position.batchId) ?? { batchId: position.batchId, batch: position.batch, expiresOn: position.expiresOn, available: 0 };
    entry.available += position.available;
    byBatch.set(position.batchId, entry);
  }
  return [...byBatch.values()].map((entry) => ({ ...entry, available: Math.max(entry.available - (taken.get(entry.batchId) ?? 0), 0) }))
    .filter((entry) => entry.available > 0)
    .sort((left, right) => (left.expiresOn ?? "9999-12-31").localeCompare(right.expiresOn ?? "9999-12-31") || String(left.batch).localeCompare(String(right.batch)));
}

// The batch a scan sells from: the one asked for when it is eligible and covers the unit, else the earliest-expiring eligible batch that
// covers it (Inventory's FEFO order). { batchId } or { options } when none covers it alone.
export async function allocateScannedBatch(client, context, ctx, { itemId, baseQuantity, batchId = null, cartId }) {
  const options = await batchOptions(client, context, ctx, itemId, cartId);
  const needed = Number(baseQuantity);
  if (batchId) {
    const chosen = options.find((option) => option.batchId === batchId);
    if (!chosen || chosen.available < needed) throw posProductError("POS_PRODUCT_INSUFFICIENT_STOCK", { itemId, batchId }, "That batch has no eligible stock left for this sale.");
    return { batchId };
  }
  const covering = options.find((option) => option.available >= needed);
  return covering ? { batchId: covering.batchId } : { options };
}

// ------------------------------------------------------------------ processing a scan

const brief = (product) => product && ({
  itemId: product.itemId, sku: product.sku, name: product.name, variantLabel: product.variantLabel, saleUomCode: product.saleUomCode, uomFactor: product.uomFactor,
  displayPrice: product.displayPrice, currency: product.currency, imageUrl: product.imageUrl, requiresTracking: product.requiresTracking,
});

// input: barcode (as the scanner sent it), scanActionId (a new UUID per completed scan), and for a follow-up of the same scan: itemId (the
// product chosen for an ambiguous barcode or a variant group), serialNumber, batchId. expectedCartVersion is accepted but scans are serialised
// on the cart instead: quantity increments do not conflict, so a scan made while the previous one was still resolving is never refused as stale.
export async function processPosScan(client, context, cartId, input = {}) {
  const started = Date.now();
  requirePermission(context, "pos.view");
  const scanActionId = String(input.scanActionId ?? "");
  if (!UUID.test(scanActionId)) throw posError(400, "Each scan needs its own action id.", "POS_SCAN_ACTION_REQUIRED");
  const barcode = cleanScannedValue(input.barcode);
  const fingerprint = fingerprintOf({ barcode, serialNumber: input.serialNumber ? cleanScannedValue(input.serialNumber) : null, batchId: input.batchId ?? null, itemId: input.itemId ?? null });

  // The same scan, retried: its original outcome. The same id for another scan: refused.
  const prior = (await client.query(`SELECT request_fingerprint, outcome FROM tenant.pos_cart_request_keys WHERE organization_id = $1 AND cart_id = $2 AND idempotency_key = $3`,
    [context.organizationId, cartId, scanActionId])).rows[0];
  if (prior) {
    if (prior.request_fingerprint && prior.request_fingerprint !== fingerprint)
      throw posError(409, "This scan id was already used for a different scan.", "POS_SCAN_ACTION_REUSED");
    return { ...(prior.outcome ?? { status: "added", barcode, scanActionId }), cart: await getPosCart(client, context, cartId), replayed: true };
  }

  const cart = await lockPosCart(client, context, cartId, { requireOpen: false });
  const where = { storeId: cart.store_id, terminalId: cart.terminal_id, shiftId: cart.shift_id, cartId, scanActionId, barcode };
  const reject = async (result, code, message = null, extra = {}) => {
    await recordScanDiagnostic(client, context, { ...where, result, errorCode: code, durationMs: Date.now() - started });
    return { status: "rejected", code, message: message ?? POS_SCAN_MESSAGES[code] ?? POS_SCAN_MESSAGES.POS_SCAN_PROCESSING_FAILED, barcode, scanActionId, ...extra };
  };
  if (!["draft", "priced"].includes(cart.status)) return reject("rejected", "POS_CART_NOT_EDITABLE");
  const shift = (await client.query(`SELECT status FROM tenant.pos_shifts WHERE organization_id = $1 AND id = $2`, [context.organizationId, cart.shift_id])).rows[0];
  if (shift?.status !== "open") return reject("rejected", "POS_SESSION_REQUIRED");
  if (!barcode) return reject("invalid", "POS_BARCODE_INVALID");

  const ctx = await resolvePosProductContext(client, context, { cartId });
  const found = await lookupPosProductByBarcode(client, context, { barcode, ctx, quiet: true });
  let product = null;
  if (found.status in SCAN_CODE_OF_LOOKUP) return reject(RESULT_OF_LOOKUP[found.status], SCAN_CODE_OF_LOOKUP[found.status]);
  const choices = found.status === "ambiguous" ? found.candidates : found.status === "selection_required" ? found.variants : null;
  if (choices) {
    if (!input.itemId) {
      if (found.status === "ambiguous") await recordScanDiagnostic(client, context, { ...where, result: "ambiguous", errorCode: "POS_BARCODE_AMBIGUOUS", durationMs: Date.now() - started });
      return { status: "selection_required", reason: found.status === "ambiguous" ? "ambiguous" : "variant", code: found.status === "ambiguous" ? "POS_BARCODE_AMBIGUOUS" : "POS_PRODUCT_SELECTION_REQUIRED",
        message: found.status === "ambiguous" ? POS_SCAN_MESSAGES.POS_BARCODE_AMBIGUOUS : `Choose the ${found.product.name}.`, barcode, scanActionId, candidates: choices };
    }
    product = choices.find((choice) => choice.itemId === input.itemId) ?? null;
    if (!product) return reject("rejected", "POS_PRODUCT_SELECTION_REQUIRED", "Choose one of the products this barcode belongs to.");
  } else {
    product = found.product;
  }
  if (!product.isSellableNow) {
    const code = product.unavailableReason?.code ?? "POS_SCAN_PROCESSING_FAILED";
    return reject("rejected", code, POS_SCAN_MESSAGES[code] ?? product.unavailableReason?.message, { product: brief(product) });
  }

  // Tracking: a serial is captured (scanned or typed) and checked by Inventory; a batch is allocated by Inventory's FEFO order or chosen.
  let serialId = null;
  let batchId = null;
  if (product.requiresTracking === "serial") {
    if (decimal(product.uomFactor) !== decimal(1)) return reject("rejected", "POS_PRODUCT_UOM_INVALID", "A serial-numbered product is scanned one unit at a time.", { product: brief(product) });
    if (!input.serialNumber) return { status: "serial_required", code: "POS_SERIAL_REQUIRED", message: POS_SCAN_MESSAGES.POS_SERIAL_REQUIRED, barcode, scanActionId, product: brief(product) };
    try {
      const serial = await validateScannedSerial(client, context, ctx, { itemId: product.itemId, serialNumber: input.serialNumber, cartId });
      serialId = serial.serialId;
      batchId = serial.batchId;
    } catch (error) {
      if (error.code !== "POS_SERIAL_UNAVAILABLE" && error.code !== "POS_SERIAL_REQUIRED") throw error;
      await recordScanDiagnostic(client, context, { ...where, result: "serial_rejected", errorCode: error.code, durationMs: Date.now() - started });
      return { status: "serial_required", code: error.code, message: error.message, barcode, scanActionId, product: brief(product), reason: error.details?.reason ?? null };
    }
  } else if (product.requiresTracking === "batch") {
    try {
      const allocation = await allocateScannedBatch(client, context, ctx, { itemId: product.itemId, baseQuantity: product.uomFactor, batchId: input.batchId ?? null, cartId });
      if (!allocation.batchId) {
        if (!allocation.options.length) return reject("rejected", "POS_PRODUCT_OUT_OF_STOCK", null, { product: brief(product) });
        return { status: "batch_required", code: "POS_BATCH_REQUIRED", message: "No single batch covers this pack. Choose the batch to sell from.", barcode, scanActionId,
          product: brief(product), options: allocation.options };
      }
      batchId = allocation.batchId;
    } catch (error) {
      if (!String(error.code ?? "").startsWith("POS_PRODUCT_")) throw error;
      return reject("rejected", error.code, error.message, { product: brief(product) });
    }
  }

  // The one cart operation, inside a savepoint: a refusal leaves the cart exactly as it was.
  let updated;
  await client.query("SAVEPOINT pos_scan");
  try {
    updated = await addPosCartLine(client, context, cartId, { itemId: product.itemId, uomId: product.saleUomId, quantity: 1, barcode, batchId, serialId, idempotencyKey: scanActionId });
    await client.query("RELEASE SAVEPOINT pos_scan");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT pos_scan");
    const denied = error.code === "FORBIDDEN" || error.code === "POS_PERMISSION_DENIED" || error.status === 403;
    const code = denied ? "POS_PERMISSION_DENIED" : KNOWN_CODES.has(error.code) ? error.code : null;
    if (!code && !error.status) throw error;
    return reject(denied ? "permission_denied" : code ? "rejected" : "failed", code ?? "POS_SCAN_PROCESSING_FAILED", code === "POS_PRODUCT_INSUFFICIENT_STOCK" ? POS_SCAN_MESSAGES[code] : null,
      { product: brief(product), detail: code ? undefined : error.message });
  }
  const line = [...updated.lines].reverse().find((candidate) => candidate.item_id === product.itemId && candidate.uom_id === product.saleUomId
    && (candidate.serial_id ?? null) === serialId && (candidate.batch_id ?? null) === batchId) ?? null;
  const quantity = line ? Number(line.quantity) : 1;
  const outcome = {
    status: "added", code: null, barcode, scanActionId, product: brief(product),
    message: `${product.name}${product.uomFactor !== "1" && product.saleUomCode ? ` (${product.saleUomCode})` : ""} added — Quantity: ${quantity}`,
    line: line && { id: line.id, quantity: String(line.quantity), uomCode: line.uom_code ?? product.saleUomCode, unitPrice: String(line.unit_price), lineTotal: String(line.line_total),
      serialId: line.serial_id ?? null, batchId: line.batch_id ?? null },
  };
  await client.query(`UPDATE tenant.pos_cart_request_keys SET request_fingerprint = $4, outcome = $5::jsonb, operation = 'scan' WHERE organization_id = $1 AND cart_id = $2 AND idempotency_key = $3`,
    [context.organizationId, cartId, scanActionId, fingerprint, JSON.stringify(outcome)]);
  const durationMs = Date.now() - started;
  if (durationMs > SLOW_SCAN_MS) await recordScanDiagnostic(client, context, { ...where, result: "slow", durationMs });
  return { ...outcome, cart: updated, replayed: false };
}

// ------------------------------------------------------------------ returns

// A returned product scanned against its receipt: the line of that sale it matches (same product, and the same pack when the barcode names one),
// with quantity left to return — never proof of purchase on its own, never a refund. Serial-numbered lines need the same serial number back.
export async function findPosSaleLineByBarcode(client, context, saleId, input = {}) {
  requirePermission(context, "pos.view");
  const barcode = cleanScannedValue(input.barcode);
  if (!barcode) throw posProductError("POS_PRODUCT_NOT_FOUND", {}, POS_SCAN_MESSAGES.POS_BARCODE_INVALID);
  const sale = (await client.query(`SELECT id, store_id, terminal_id FROM tenant.pos_sales WHERE organization_id = $1 AND id = $2`, [context.organizationId, saleId])).rows[0];
  if (!sale) throw posError(404, "POS sale was not found.", "POS_SALE_NOT_FOUND");
  await assertPosStoreAccess(client, context, sale.store_id, sale.terminal_id);
  const gtinKey = /^\d{12,14}$/.test(barcode) ? barcode.padStart(14, "0") : null;
  // What the barcode names — active or since removed (a product sold under a barcode can come back after the barcode was retired) — and the
  // barcode each line was scanned with.
  const identities = (await client.query(
    `SELECT item_id, uom_id FROM tenant.item_identifiers WHERE organization_id = $1 AND (upper(value) = upper($2) OR ($3::text IS NOT NULL AND gtin_key = $3))
     UNION SELECT id, NULL::uuid FROM tenant.items WHERE organization_id = $1 AND normalized_sku = upper($2)`, [context.organizationId, barcode, gtinKey])).rows;
  const lines = (await client.query(
    `SELECT line.id, line.item_id, line.uom_id, line.description, line.quantity::text, COALESCE(line.returned_quantity, 0)::text AS returned, line.serial_id, line.scanned_barcode,
            serial.serial_number, uom.code AS uom_code
       FROM tenant.pos_sale_lines line
       LEFT JOIN tenant.stock_serials serial ON serial.organization_id = line.organization_id AND serial.id = line.serial_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
      WHERE line.organization_id = $1 AND line.sale_id = $2 ORDER BY line.line_number`, [context.organizationId, sale.id])).rows;
  const matches = lines.filter((line) => (line.scanned_barcode && line.scanned_barcode.toUpperCase() === barcode.toUpperCase())
    || identities.some((identity) => identity.item_id === line.item_id && (!identity.uom_id || !line.uom_id || identity.uom_id === line.uom_id)));
  if (!matches.length) throw posError(409, "This product is not on this receipt.", "POS_RETURN_ITEM_NOT_ON_SALE");
  const open = matches.filter((line) => Number(line.quantity) - Number(line.returned) > 0);
  if (!open.length) throw posError(409, "Everything of this product on the receipt has already been returned.", "POS_RETURN_NOTHING_LEFT");
  let line = open[0];
  if (open.some((candidate) => candidate.serial_id)) {
    const serial = cleanScannedValue(input.serialNumber);
    if (!serial) throw posError(409, "Scan the serial number of the returned product.", "POS_SERIAL_REQUIRED");
    line = open.find((candidate) => candidate.serial_number === serial);
    if (!line) throw posError(409, "This serial number was not sold on this receipt.", "POS_RETURN_SERIAL_MISMATCH");
  }
  return { saleLineId: line.id, itemId: line.item_id, description: line.description, uomCode: line.uom_code ?? null, serialNumber: line.serial_number ?? null,
    soldQuantity: line.quantity, remainingQuantity: String(Number(line.quantity) - Number(line.returned)) };
}
