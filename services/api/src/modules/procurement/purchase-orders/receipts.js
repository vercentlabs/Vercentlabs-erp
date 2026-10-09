// Goods receipts (GRN): the record of goods physically received against a
// confirmed purchase order, in as many batches as they arrive. A receipt is
// drafted — proposed with every line's remaining quantity, editable, with no
// stock effect and reserving nothing — and then posted. One receipt is one
// order, one supplier (the order's) and one receiving warehouse.
//
// Posting re-checks everything under a lock on the order (status, supplier,
// products, units, the warehouse and who may receive into it, lot, serial and
// expiry details, and what is still owed) and then, exactly once:
//
//   accepted           Inventory receipt into the warehouse (usable)
//   inspection hold    Inventory receipt into the quality location (not available),
//                      linked to a Quality inspection when an incoming plan applies
//   damaged            into the quality location too, recorded as damaged
//   refused            never taken in: no stock; a rejection case (refused at
//                      the dock) records it, and the order still owes it
//
// Damaged goods open a rejection case too (rejected after receipt), so they
// are returned, disposed of or accepted through it. And, where the company
// keeps perpetual inventory, the GRNI accrual. Held
// goods are released or returned later; the receipt is never posted again. A
// posted receipt is corrected only by an authorised reversal while nothing has
// used it. Posting never creates a supplier bill or a payable.
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { add, decimal, div, formatDecimal, mul, roundMoney, sub } from "../../../core/decimal.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { StockError, moveStockWithinWarehouse, postStockMovement, reverseStockMovements, receiveSerializedStock } from "../../stock/index.js";
import { defaultLocationOf, validateWarehouseOperation } from "../../stock/warehouses.js";
import { QualityError } from "../../quality/common.js";
import { cancelInspection, createInspection } from "../../quality/inspections.js";
import { loadPurchaseOrder, requirePoAccess, requirePoPermission } from "./access.js";
import { postReceiptAccrual, reverseReceiptAccrual } from "./accrual.js";
import { PO_PERMISSIONS, PurchaseOrderError, STATUS, dayOf, fail, has, optionalUuid, readDate, requireUuid, text } from "./constants.js";
import { databaseToday } from "./document.js";
import { recordPoEvent } from "./persist.js";
import { REJECTION_REASONS, openRejectionCase } from "./rejection-core.js";
import { loadLineProgress } from "./progress.js";
import { convertBetweenUnits, factorOf, resolveItemUnit } from "../../products/uom.js";
import { carryNegativeStock } from "../../stock/negative-stock-control.js";
import { getExchangeRate } from "../../accounting/index.js";
import { registerHeldStock } from "../../stock/quality-holds.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const QTY = /^\d+(?:\.\d{1,6})?$/;
const ONE = decimal(1);
// Discrepancies are what the supplier is told about a delivery that is not itself rejected goods: a shortage (never arrived), a wrong item
// described, an excess. Refused and damaged goods are rejection cases; the two older kinds are kept only to label earlier records.
export const DISCREPANCY_TYPES = Object.freeze([
  { code: "short_delivery", label: "Short delivery (never arrived)" }, { code: "wrong_item", label: "Wrong item delivered" }, { code: "excess", label: "Excess delivered" },
  { code: "other", label: "Other" },
]);
export const DISCREPANCY_LABELS = Object.freeze({ ...Object.fromEntries(DISCREPANCY_TYPES.map((entry) => [entry.code, entry.label])), damaged: "Damaged", refused: "Refused at delivery" });

// Inventory (and Quality) do their own postings, on behalf of whoever may receive goods.
export const stockContextFor = (context) => ({
  organizationId: context.organizationId, userId: context.userId ?? null, roleSlugs: [],
  permissions: ["stock.view", "stock.receive", "stock.issue", "stock.manage", "stock.transfer"],
});
const qualityContextFor = (context) => ({ organizationId: context.organizationId, userId: context.userId ?? null, roleSlugs: [], permissions: ["quality.view", "quality.inspect"] });

async function stocked(work, label = "") {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StockError) throw carryNegativeStock(error, new PurchaseOrderError(error.status, `${label}${error.message}`, error.code));
    throw error;
  }
}

export async function recordReceiptEvent(client, context, receiptId, eventType, summary, details = {}) {
  await client.query(
    `INSERT INTO tenant.goods_receipt_events (organization_id, goods_receipt_id, event_type, summary, details, actor_user_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [context.organizationId, receiptId, eventType, summary, JSON.stringify(details), context.userId ?? null]);
}

export const statusOf = (row) => (row.status === "posted" && row.reversed_at ? "reversed" : row.status);

function readQuantity(value, label) {
  if (value === undefined || value === null || value === "") return 0n;
  const raw = String(value).trim();
  if (!QTY.test(raw)) fail(`${label} must be zero or more.`, "quantity", "GOODS_RECEIPT_QUANTITY_INVALID");
  return decimal(raw);
}

// Warehouses decides: the warehouse allows the operation (receiving, returns) and the user may do it there. capability: false checks only
// the user (goods already in custody are handled where they are). Whether the warehouse is active is checked by the caller.
export async function assertWarehouseOperation(client, context, warehouseId, operation, label, { capability = true } = {}) {
  if (!warehouseId) return;
  await validateWarehouseOperation(client, context, warehouseId, operation, { label, allowInactive: true, skipCapability: !capability });
}

export async function qualityLocation(client, organizationId, warehouseId) {
  return (await client.query(`SELECT id FROM tenant.warehouse_locations WHERE organization_id = $1 AND warehouse_id = $2 AND status = 'active' AND allow_stock
      AND (disposition = 'quality_hold' OR location_type = 'quality') ORDER BY (disposition = 'quality_hold') DESC, code LIMIT 1`,
    [organizationId, warehouseId])).rows[0]?.id ?? null;
}

export async function orderLinesById(client, organizationId, orderId) {
  const { rows } = await client.query(
    `SELECT line.*, item.tracking_type, item.track_inventory, item.item_type, item.status AS item_status, item.requires_expiry_date, item.group_id AS item_group_id,
            uom.decimal_places, uom.code AS uom_code, base.code AS base_uom_code
       FROM tenant.purchase_order_lines line
       LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.product_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.purchase_uom_id
      LEFT JOIN tenant.units_of_measure base ON base.organization_id = line.organization_id AND base.id = line.base_uom_id
      WHERE line.organization_id = $1 AND line.purchase_order_id = $2 ORDER BY line.line_number`, [organizationId, orderId]);
  return new Map(rows.map((row) => [row.id, row]));
}

const serialsOf = (value) => (Array.isArray(value) ? value : String(value ?? "").split(/[\s,;]+/)).map((entry) => text(entry, 120)).filter(Boolean);

// The receipt lines to store, checked against the order and what is still owed (posted receipts only).
async function readReceiptLines(client, context, order, inputLines, warehouseId, receiptDate) {
  const organizationId = context.organizationId;
  const lines = await orderLinesById(client, organizationId, order.id);
  const progress = new Map((await loadLineProgress(client, organizationId, order.id)).map((line) => [line.lineId, line]));
  const requested = Array.isArray(inputLines) && inputLines.length ? inputLines
    : [...progress.values()].filter((line) => line.receiptRequired && line.remainingToReceive > 0n)
      .map((line) => ({ purchaseOrderLineId: line.lineId, acceptedQuantity: formatDecimal(line.remainingToReceive) }));
  if (!requested.length) throw new PurchaseOrderError(409, "Nothing is left to receive on this order.", "GOODS_RECEIPT_NOTHING_TO_RECEIVE");
  const result = [];
  const seen = new Map();
  const taken = new Map();
  for (const entry of splitIntoLots(requested, lines)) {
    const line = lines.get(requireUuid(entry.purchaseOrderLineId, "Order line"));
    if (!line) throw new PurchaseOrderError(404, "That line is not on this order.", "PURCHASE_ORDER_LINE_NOT_FOUND");
    // One entry per order line, except the lots of one line.
    if (seen.has(line.id) && (!entry.lotGroup || seen.get(line.id) !== entry.lotGroup)) fail(`Line ${line.line_number} is entered twice.`, "purchaseOrderLineId");
    seen.set(line.id, entry.lotGroup ?? Symbol("line"));
    const label = entry.lotGroup ? `Line ${line.line_number} (lot ${entry.batchNumber})` : `Line ${line.line_number}`;
    // No substitution: a line receives the product it ordered, or the order is amended first.
    if (entry.productId && entry.productId !== line.product_id)
      fail(`${label}: only ${line.description} can be received against this line. Amend the order to receive another product.`, "productId", "GOODS_RECEIPT_PRODUCT_MISMATCH", 409);
    if (line.product_type === "service") fail(`${label} is a service; services are not received. Bill it when the service is done.`, "purchaseOrderLineId", "GOODS_RECEIPT_SERVICE_LINE", 409);
    if (entry.warehouseId && entry.warehouseId !== warehouseId)
      fail(`${label}: a goods receipt has one receiving warehouse. Receive goods for another warehouse on a separate receipt.`, "warehouseId", "GOODS_RECEIPT_ONE_WAREHOUSE");
    let inspection = readQuantity(entry.heldQuantity ?? entry.inspectionQuantity, `${label} inspection hold`);
    let damaged = readQuantity(entry.damagedQuantity, `${label} damaged quantity`);
    let refused = readQuantity(entry.refusedQuantity ?? entry.rejectedQuantity, `${label} refused quantity`);
    let accepted = entry.acceptedQuantity !== undefined && entry.acceptedQuantity !== null && entry.acceptedQuantity !== ""
      ? readQuantity(entry.acceptedQuantity, `${label} accepted quantity`)
      : sub(readQuantity(entry.receivedQuantity, `${label} received quantity`), add(inspection, damaged));
    if (accepted < 0n) fail(`${label}: the inspection and damaged quantities are more than was received.`, "receivedQuantity", "GOODS_RECEIPT_QUANTITY_INVALID");
    if (add(accepted, inspection, damaged, refused) <= 0n) continue;
    // Received in another unit than the order's (30 PCS against an order in BOX of 20): what was entered is kept, and each quantity is turned
    // into the order's unit exactly through the shared conversion service — never rounded, so the order's entitlement stays exact.
    const enteredUomId = optionalUuid(entry.uomId ?? entry.receiptUomId, "Unit of measure") ?? line.purchase_uom_id;
    let entered = null;
    let presentedEntered = entry.presentedQuantity;
    if (line.product_id && enteredUomId !== line.purchase_uom_id) {
      const unit = await resolveItemUnit(client, organizationId, line.product_id, enteredUomId, { purpose: "purchase" });
      if (!unit.ok) fail(`${label}: ${unit.message}`, "uomId", "GOODS_RECEIPT_UOM_INVALID", 409);
      const toOrderUnit = async (value, what) => {
        if (value === 0n) return 0n;
        const converted = await convertBetweenUnits(client, organizationId, line.product_id, formatDecimal(value), enteredUomId, line.purchase_uom_id, { purpose: "purchase" });
        if (!converted.ok) fail(`${label} (${what}): ${converted.message}`, "quantity", converted.reason === "inexact" ? "GOODS_RECEIPT_UOM_INEXACT" : "GOODS_RECEIPT_QUANTITY_INVALID", 409);
        return converted.quantity;
      };
      entered = { uomId: enteredUomId, quantity: add(accepted, inspection, damaged, refused), factor: factorOf(unit.unit), code: unit.unit.code };
      accepted = await toOrderUnit(accepted, "accepted");
      inspection = await toOrderUnit(inspection, "inspection hold");
      damaged = await toOrderUnit(damaged, "damaged");
      refused = await toOrderUnit(refused, "refused");
      if (presentedEntered !== undefined && presentedEntered !== null && presentedEntered !== "")
        presentedEntered = formatDecimal(await toOrderUnit(readQuantity(presentedEntered, `${label} presented quantity`), "presented"));
    } else {
      const places = Number(line.decimal_places ?? 6);
      for (const [value, what] of [[accepted, "accepted"], [inspection, "inspection hold"], [damaged, "damaged"], [refused, "refused"]])
        if (roundMoney(value, places) !== value) fail(`${label}: ${line.uom_code ?? "the unit"} allows ${places} decimal place${places === 1 ? "" : "s"} (${what}).`, "quantity", "GOODS_RECEIPT_QUANTITY_INVALID");
    }
    const received = add(accepted, inspection, damaged);
    if (inspection + damaged > 0n && line.product_type !== "stock") fail(`${label}: only stock items can be held.`, "heldQuantity");
    // Taking goods into custody on hold or damaged (restricted stock) is its own permission.
    if (inspection + damaged > 0n) requirePoPermission(context, PO_PERMISSIONS.acceptRestricted, `${label}: you do not have permission to take goods in on hold or damaged.`);
    if (inspection + damaged > 0n && line.tracking_type === "serial") fail(`${label}: serial-numbered items are accepted or refused at receipt; hold them through Quality.`, "heldQuantity");
    const refusalText = text(entry.refusalReason ?? entry.rejectionReason, 500);
    let refusalCode = text(entry.refusalReasonCode, 40) ?? (refusalText ? "other" : null);
    if (refused > 0n) {
      if (!refusalCode) fail(`${label}: choose the reason for refusing.`, "refusalReasonCode", "REJECTION_REASON_REQUIRED");
      if (!REJECTION_REASONS.some((reason) => reason.code === refusalCode)) fail(`${label}: choose the reason for refusing from the list.`, "refusalReasonCode", "REJECTION_REASON_REQUIRED");
      if (refusalCode === "other" && (!refusalText || refusalText.length < 3)) fail(`${label}: explain why the goods were refused.`, "refusalReason", "REJECTION_EXPLANATION_REQUIRED");
    } else refusalCode = null;
    // What was presented at the dock is either taken into custody or refused: nothing is counted twice.
    const presented = presentedEntered === undefined || presentedEntered === null || presentedEntered === "" ? null : readQuantity(presentedEntered, `${label} presented quantity`);
    if (presented !== null && presented !== add(received, refused))
      fail(`${label}: of the ${formatDecimal(presented)} presented, ${formatDecimal(received)} taken in and ${formatDecimal(refused)} refused do not add up. Record a shortage as a discrepancy.`,
        "presentedQuantity", "GOODS_RECEIPT_PRESENTED_MISMATCH");
    if (received > 0n && !warehouseId) fail("Choose the receiving warehouse.", "warehouseId", "GOODS_RECEIPT_WAREHOUSE_REQUIRED");
    // No location chosen: the warehouse's default receiving location, else MAIN. MAIN is the ledger's "no location".
    let locationId = optionalUuid(entry.warehouseLocationId, "Location") ?? (warehouseId ? await defaultLocationOf(client, organizationId, warehouseId, "receiving") : null);
    if (locationId) {
      const location = (await client.query(`SELECT location_type, disposition, allow_stock, is_default_storage FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2 AND warehouse_id = $3 AND status = 'active'`,
        [organizationId, locationId, warehouseId])).rows[0];
      if (!location) fail(`${label}: the location is not in the receiving warehouse.`, "warehouseLocationId", "GOODS_RECEIPT_LOCATION_INVALID", 409);
      if (location.location_type === "quality" || location.disposition !== "available") fail(`${label}: accepted goods cannot go into a location for held stock; enter them as on hold instead.`, "warehouseLocationId");
      if (!location.allow_stock) fail(`${label}: the location does not hold stock; choose a bin inside it.`, "warehouseLocationId", "GOODS_RECEIPT_LOCATION_INVALID", 409);
      if (location.is_default_storage) locationId = null;
    }
    const tracked = line.product_type === "stock";
    const serials = serialsOf(entry.serialNumbers);
    if (tracked && line.tracking_type === "serial" && accepted > 0n) {
      // One serial number per base unit: 2 BOX of 5 laptops needs 10 serial numbers, not 2.
      const units = roundMoney(mul(accepted, line.conversion_factor ?? ONE), 6);
      if (units % ONE !== 0n || BigInt(serials.length) * ONE !== units)
        fail(`${label}: enter one serial number for each unit accepted (${formatDecimal(units).replace(/\.?0+$/, "")} ${line.base_uom_code ?? "units"}).`, "serialNumbers", "GOODS_RECEIPT_SERIALS_REQUIRED");
      if (new Set(serials.map((value) => value.toLowerCase())).size !== serials.length) fail(`${label}: a serial number is entered twice.`, "serialNumbers", "GOODS_RECEIPT_SERIAL_DUPLICATE");
    }
    const batchNumber = text(entry.batchNumber, 120);
    const lot = tracked && line.tracking_type === "batch";
    if (lot && received > 0n && !batchNumber) fail(`${label}: enter the batch (lot) number.`, "batchNumber", "GOODS_RECEIPT_BATCH_REQUIRED");
    const expiryDate = lot ? readDate(entry.expiryDate, `${label} expiry date`) : null;
    const manufacturedDate = lot ? readDate(entry.manufacturedDate, `${label} manufacture date`) : null;
    if (lot && line.requires_expiry_date && received > 0n && !expiryDate) fail(`${label}: enter the lot's expiry date.`, "expiryDate", "GOODS_RECEIPT_EXPIRY_REQUIRED");
    if (expiryDate && manufacturedDate && manufacturedDate > expiryDate) fail(`${label}: the manufacture date is after the expiry date.`, "manufacturedDate");
    if (expiryDate && receiptDate && expiryDate < receiptDate && accepted > 0n)
      fail(`${label}: the lot expired on ${expiryDate}. Receive it as damaged, or refuse it.`, "expiryDate", "GOODS_RECEIPT_LOT_EXPIRED");
    // The entitlement is compared in base units (what is still owed × the order's own factor), whatever unit the receipt is entered in.
    // What the order line still owes, less what earlier lots of this receipt already take.
    const owed = sub(progress.get(line.id).remainingToReceive, taken.get(line.id) ?? 0n);
    taken.set(line.id, add(taken.get(line.id) ?? 0n, received));
    const factor = line.conversion_factor ?? ONE;
    if (mul(received, factor) > mul(owed, factor)) {
      const owedBase = formatDecimal(mul(owed, factor)).replace(/\.?0+$/, "");
      throw new PurchaseOrderError(409, owed === 0n ? `${label} is fully received.`
        : `${label}: only ${formatDecimal(owed).replace(/\.?0+$/, "")} ${line.uom_code ?? ""} (${owedBase} ${line.base_uom_code ?? "base units"}) is still to be received.`.replace(/\s+/g, " "),
        "GOODS_RECEIPT_OVER_RECEIPT", { lineId: line.id, remaining: formatDecimal(owed), remainingBase: owedBase });
    }
    result.push({
      line, entered, accepted, inspection, damaged, held: add(inspection, damaged), refused, refusalReason: refusalText, refusalCode, presented, locationId, serials, batchNumber,
      expiryDate, manufacturedDate, discrepancyNotes: text(entry.discrepancyNotes, 2000),
      trackingSnapshot: { trackingType: line.tracking_type ?? "none", requiresExpiryDate: Boolean(line.requires_expiry_date), stocked: tracked },
    });
  }
  if (!result.length) fail("Enter what was received.", "lines", "GOODS_RECEIPT_EMPTY");
  return result;
}

// A lot-tracked line received in several lots (input batches: [{ batchNumber, quantity, heldQuantity?, damagedQuantity?, expiryDate?, manufacturedDate?,
// warehouseLocationId? }]) becomes one receipt line per lot. The lots must account for exactly what the line says was received (and held, and
// damaged); the refused and presented quantities belong to the line and go with its first lot.
function splitIntoLots(requested, lines) {
  const out = [];
  const given = (value) => value !== undefined && value !== null && value !== "";
  const plain = (value) => formatDecimal(value).replace(/\.?0+$/, "") || "0";
  for (const [index, entry] of requested.entries()) {
    const lots = Array.isArray(entry.batches) ? entry.batches.filter((lot) => lot && (lot.batchNumber || lot.quantity)) : [];
    if (lots.length === 0) { out.push(entry); continue; }
    const line = lines.get(requireUuid(entry.purchaseOrderLineId, "Order line"));
    if (!line) throw new PurchaseOrderError(404, "That line is not on this order.", "PURCHASE_ORDER_LINE_NOT_FOUND");
    const label = `Line ${line.line_number}`;
    if (lots.length === 1) {
      const [lot] = lots;
      out.push({ ...entry, batches: undefined, batchNumber: lot.batchNumber ?? entry.batchNumber, expiryDate: lot.expiryDate ?? entry.expiryDate,
        manufacturedDate: lot.manufacturedDate ?? entry.manufacturedDate, warehouseLocationId: lot.warehouseLocationId ?? entry.warehouseLocationId });
      continue;
    }
    if (line.tracking_type !== "batch") fail(`${label}: only a lot-tracked product is received in several lots.`, "batches", "GOODS_RECEIPT_LOTS_INVALID");
    const names = lots.map((lot) => text(lot.batchNumber, 120));
    if (names.some((name) => !name)) fail(`${label}: enter the lot number of every lot.`, "batches", "GOODS_RECEIPT_BATCH_REQUIRED");
    if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) fail(`${label}: a lot is entered twice.`, "batches", "GOODS_RECEIPT_LOT_DUPLICATE");
    const amounts = lots.map((lot, position) => ({
      received: readQuantity(lot.quantity ?? lot.receivedQuantity, `${label} lot ${names[position]}`),
      held: readQuantity(lot.heldQuantity, `${label} lot ${names[position]} on hold`),
      damaged: readQuantity(lot.damagedQuantity, `${label} lot ${names[position]} damaged`),
    }));
    const total = (key) => amounts.reduce((sum, amount) => add(sum, amount[key]), 0n);
    const held = readQuantity(entry.heldQuantity ?? entry.inspectionQuantity, `${label} inspection hold`);
    const damaged = readQuantity(entry.damagedQuantity, `${label} damaged quantity`);
    const received = given(entry.receivedQuantity) ? readQuantity(entry.receivedQuantity, `${label} received quantity`)
      : given(entry.acceptedQuantity) ? add(readQuantity(entry.acceptedQuantity, `${label} accepted quantity`), held, damaged) : total("received");
    const mismatch = (what, lotTotal, lineTotal) =>
      fail(`${label}: the lots add up to ${plain(lotTotal)} ${what}, but the line has ${plain(lineTotal)}. Allocate every unit to a lot.`, "batches", "GOODS_RECEIPT_LOT_TOTAL_MISMATCH");
    if (total("received") !== received) mismatch("received", total("received"), received);
    if (given(entry.heldQuantity ?? entry.inspectionQuantity) && total("held") !== held) mismatch("on hold", total("held"), held);
    if (given(entry.damagedQuantity) && total("damaged") !== damaged) mismatch("damaged", total("damaged"), damaged);
    const refused = entry.refusedQuantity ?? entry.rejectedQuantity;
    let presented = null;
    if (given(entry.presentedQuantity)) {
      presented = readQuantity(entry.presentedQuantity, `${label} presented quantity`);
      if (presented !== add(received, readQuantity(refused, `${label} refused quantity`)))
        fail(`${label}: of the ${plain(presented)} presented, the lots and the refused quantity do not add up. Record a shortage as a discrepancy.`, "presentedQuantity", "GOODS_RECEIPT_PRESENTED_MISMATCH");
    }
    lots.forEach((lot, position) => out.push({
      purchaseOrderLineId: entry.purchaseOrderLineId, productId: entry.productId, uomId: entry.uomId ?? entry.receiptUomId, lotGroup: `lots-${index}`,
      receivedQuantity: formatDecimal(amounts[position].received), heldQuantity: formatDecimal(amounts[position].held), damagedQuantity: formatDecimal(amounts[position].damaged),
      refusedQuantity: position === 0 ? refused : undefined, refusalReasonCode: position === 0 ? entry.refusalReasonCode : undefined,
      refusalReason: position === 0 ? entry.refusalReason ?? entry.rejectionReason : undefined,
      presentedQuantity: presented === null ? undefined : formatDecimal(position === 0 ? sub(presented, sub(received, amounts[0].received)) : amounts[position].received),
      batchNumber: names[position], expiryDate: lot.expiryDate ?? entry.expiryDate, manufacturedDate: lot.manufacturedDate ?? entry.manufacturedDate,
      warehouseLocationId: lot.warehouseLocationId ?? entry.warehouseLocationId, discrepancyNotes: position === 0 ? entry.discrepancyNotes : undefined,
    }));
  }
  return out;
}

async function writeReceiptLines(client, context, receiptId, orderId, warehouseId, lines) {
  await client.query(`DELETE FROM tenant.goods_receipt_lines WHERE organization_id = $1 AND goods_receipt_id = $2`, [context.organizationId, receiptId]);
  for (const [index, entry] of lines.entries()) {
    const baseQuantity = roundMoney(mul(add(entry.accepted, entry.held), entry.line.conversion_factor), 6);
    await client.query(
      `INSERT INTO tenant.goods_receipt_lines (organization_id, goods_receipt_id, purchase_order_id, purchase_order_line_id, line_number, product_id, product_type, description,
         warehouse_id, warehouse_location_id, accepted_quantity, held_quantity, damaged_quantity, rejected_quantity, rejection_reason, conversion_factor, uom_snapshot, batch_number,
         serial_numbers, product_snapshot, receipt_uom_id, base_quantity, discrepancy_notes, tracking_snapshot, expiry_date, manufactured_date, presented_quantity, refusal_reason_code,
         entered_uom_id, entered_quantity, entered_conversion_factor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20::jsonb, $21, $22, $23, $24::jsonb, $25, $26, $27, $28, $29, $30, $31)`,
      [context.organizationId, receiptId, orderId, entry.line.id, index + 1, entry.line.product_id, entry.line.product_type, entry.line.description,
        entry.line.product_type === "service" ? null : warehouseId, entry.locationId, formatDecimal(entry.accepted), formatDecimal(entry.held), formatDecimal(entry.damaged),
        formatDecimal(entry.refused), entry.refusalReason, entry.line.conversion_factor, JSON.stringify(entry.line.uom_snapshot ?? {}), entry.batchNumber, entry.serials,
        JSON.stringify(entry.line.product_snapshot ?? {}), entry.line.purchase_uom_id, formatDecimal(baseQuantity), entry.discrepancyNotes, JSON.stringify(entry.trackingSnapshot),
        entry.expiryDate, entry.manufacturedDate, entry.presented === null ? null : formatDecimal(entry.presented), entry.refusalCode,
        entry.entered?.uomId ?? null, entry.entered ? formatDecimal(entry.entered.quantity) : null, entry.entered ? formatDecimal(entry.entered.factor) : null]);
  }
}

function receivableOrder(order) {
  if (order.status !== STATUS.confirmed)
    throw new PurchaseOrderError(409, `Goods can be received only against a confirmed order; this one is ${order.status}.`, "GOODS_RECEIPT_ORDER_NOT_CONFIRMED");
}

// The receipt header fields shared by create and update. current: the stored draft.
async function readHeader(client, context, input, current = null) {
  const keep = (key, column, max) => (has(input, key) ? text(input[key], max) : current?.[column] ?? null);
  let physicalReceivedAt = current?.physical_received_at ?? null;
  if (has(input, "physicalReceivedAt")) {
    if (!input.physicalReceivedAt) physicalReceivedAt = null;
    else {
      const when = new Date(input.physicalReceivedAt);
      if (Number.isNaN(when.getTime())) fail("Enter when the goods arrived.", "physicalReceivedAt");
      if (when.getTime() > Date.now() + 5 * 60_000) fail("The arrival time cannot be in the future.", "physicalReceivedAt");
      physicalReceivedAt = when.toISOString();
    }
  }
  const receivedByUserId = has(input, "receivedByUserId") ? optionalUuid(input.receivedByUserId, "Received by") : current?.received_by_user_id ?? null;
  if (receivedByUserId) {
    const member = (await client.query(`SELECT 1 FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`, [context.organizationId, receivedByUserId])).rows[0];
    if (!member) fail("Whoever received the goods must be an active member of the workspace.", "receivedByUserId", "GOODS_RECEIPT_RECEIVER_INVALID", 409);
  }
  return {
    supplierChallanNumber: has(input, "supplierChallanNumber") || has(input, "supplierDeliveryNote") ? text(input.supplierChallanNumber ?? input.supplierDeliveryNote, 200) : current?.supplier_delivery_note ?? null,
    supplierChallanDate: has(input, "supplierChallanDate") ? readDate(input.supplierChallanDate, "Challan date") : dayOf(current?.supplier_challan_date) ?? null,
    physicalReceivedAt, receivedByUserId, vehicleNumber: keep("vehicleNumber", "vehicle_number", 40), carrierName: keep("carrierName", "carrier_name", 120),
    trackingReference: keep("trackingReference", "tracking_reference", 120), notes: keep("notes", "notes", 2000),
  };
}

async function receivingWarehouse(client, context, warehouseId) {
  if (!warehouseId) return null;
  const warehouse = (await client.query(`SELECT id FROM tenant.warehouses WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [context.organizationId, warehouseId])).rows[0];
  if (!warehouse) fail("Choose an active receiving warehouse.", "warehouseId", "GOODS_RECEIPT_WAREHOUSE_INVALID", 409);
  await assertWarehouseOperation(client, context, warehouseId, "receive", "Receiving warehouse");
  return warehouse.id;
}

// createGoodsReceiptFromPurchaseOrder. input: { warehouseId?, receiptDate?, physicalReceivedAt?, receivedByUserId?, supplierChallanNumber?, supplierChallanDate?, vehicleNumber?,
// carrierName?, trackingReference?, notes?, lines?: [{ purchaseOrderLineId, productId?, receivedQuantity | acceptedQuantity, heldQuantity?, damagedQuantity?, refusedQuantity?,
// refusalReason?, warehouseLocationId?, batchNumber?, expiryDate?, manufacturedDate?, serialNumbers?, discrepancyNotes? }], post?, idempotencyKey? }
// Without lines, every line still to be received is proposed in full.
export async function createGoodsReceiptFromPurchaseOrder(client, context, orderId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.receive, "You do not have permission to receive goods.");
  if (input.post) requirePoPermission(context, PO_PERMISSIONS.post, "You do not have permission to post goods receipts.");
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "procurement.goods_receipt.create", key: text(input.idempotencyKey, 200), payload: { orderId, ...input, idempotencyKey: undefined },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const order = await loadPurchaseOrder(client, context, orderId, { lock: true });
  receivableOrder(order);
  const today = await databaseToday(client);
  const receiptDate = readDate(input.receiptDate, "Receipt date") ?? today;
  if (receiptDate < dayOf(order.order_date)) fail("The receipt date cannot be before the order date.", "receiptDate");
  if (receiptDate > today) fail("The receipt date cannot be in the future.", "receiptDate");
  const warehouseId = await receivingWarehouse(client, context, optionalUuid(input.warehouseId, "Warehouse") ?? order.default_warehouse_id ?? null);
  const lines = await readReceiptLines(client, context, order, input.lines, warehouseId, receiptDate);
  const header = await readHeader(client, context, input);
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "goods_receipt", at: new Date(`${receiptDate}T12:00:00Z`) });
  const receipt = (await client.query(
    `INSERT INTO tenant.goods_receipts (organization_id, receipt_number, purchase_order_id, supplier_id, receipt_date, supplier_delivery_note, supplier_challan_date, warehouse_id,
       ship_from_snapshot, buying_registration_snapshot, notes, physical_received_at, received_by_user_id, vehicle_number, carrier_name, tracking_reference, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16, $17, $17) RETURNING *`,
    [context.organizationId, number, order.id, order.supplier_id, receiptDate, header.supplierChallanNumber, header.supplierChallanDate, warehouseId,
      JSON.stringify(order.ship_from_snapshot ?? null), JSON.stringify(order.buyer_registration_snapshot ?? null), header.notes, header.physicalReceivedAt, header.receivedByUserId,
      header.vehicleNumber, header.carrierName, header.trackingReference, context.userId ?? null])).rows[0];
  await writeReceiptLines(client, context, receipt.id, order.id, warehouseId, lines);
  await recordReceiptEvent(client, context, receipt.id, "goods_receipt.created", `Drafted against ${order.purchase_order_number}`, { lines: lines.length });
  let response = { id: receipt.id, receiptNumber: receipt.receipt_number, status: "draft", replayed: false };
  if (input.post) response = { ...response, ...(await postGoodsReceipt(client, context, receipt.id)) };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "goods_receipt", aggregateId: receipt.id });
  return response;
}

// createDraftGoodsReceipt: the same, never posting.
export const createDraftGoodsReceipt = (client, context, orderId, input = {}) => createGoodsReceiptFromPurchaseOrder(client, context, orderId, { ...input, post: false });

export async function loadReceipt(client, context, receiptId, { lock = false } = {}) {
  requirePoAccess(context);
  const receipt = (await client.query(`SELECT * FROM tenant.goods_receipts WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [context.organizationId, requireUuid(receiptId, "Goods receipt")])).rows[0];
  if (!receipt) throw new PurchaseOrderError(404, "Goods receipt not found.", "GOODS_RECEIPT_NOT_FOUND");
  await loadPurchaseOrder(client, context, receipt.purchase_order_id);
  return receipt;
}

// updateDraftGoodsReceipt. input: any createGoodsReceiptFromPurchaseOrder field, expectedUpdatedAt? (refused if someone saved it since).
export async function updateDraftGoodsReceipt(client, context, receiptId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.receive, "You do not have permission to edit goods receipts.");
  const receipt = await loadReceipt(client, context, receiptId, { lock: true });
  if (receipt.status !== "draft") throw new PurchaseOrderError(409, `A ${statusOf(receipt)} goods receipt cannot be changed.`, "GOODS_RECEIPT_LOCKED");
  if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== new Date(receipt.updated_at).getTime())
    throw new PurchaseOrderError(409, "Someone else changed this draft. Reload it and enter your change again.", "GOODS_RECEIPT_STALE");
  const order = await loadPurchaseOrder(client, context, receipt.purchase_order_id, { lock: true });
  receivableOrder(order);
  const receiptDate = readDate(input.receiptDate, "Receipt date") ?? dayOf(receipt.receipt_date);
  if (receiptDate > await databaseToday(client)) fail("The receipt date cannot be in the future.", "receiptDate");
  const warehouseId = has(input, "warehouseId") ? await receivingWarehouse(client, context, optionalUuid(input.warehouseId, "Warehouse")) : receipt.warehouse_id;
  if (Array.isArray(input.lines)) await writeReceiptLines(client, context, receipt.id, order.id, warehouseId, await readReceiptLines(client, context, order, input.lines, warehouseId, receiptDate));
  else if (warehouseId !== receipt.warehouse_id)
    await client.query(`UPDATE tenant.goods_receipt_lines SET warehouse_id = $3, warehouse_location_id = NULL WHERE organization_id = $1 AND goods_receipt_id = $2 AND product_type <> 'service'`,
      [context.organizationId, receipt.id, warehouseId]);
  const header = await readHeader(client, context, input, receipt);
  await client.query(
    `UPDATE tenant.goods_receipts SET receipt_date = $3, supplier_delivery_note = $4, supplier_challan_date = $5, warehouse_id = $6, notes = $7, physical_received_at = $8,
            received_by_user_id = $9, vehicle_number = $10, carrier_name = $11, tracking_reference = $12, updated_by = $13, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, receipt.id, receiptDate, header.supplierChallanNumber, header.supplierChallanDate, warehouseId, header.notes, header.physicalReceivedAt,
      header.receivedByUserId, header.vehicleNumber, header.carrierName, header.trackingReference, context.userId ?? null]);
  await recordReceiptEvent(client, context, receipt.id, "goods_receipt.updated", "Draft changed");
  return { id: receipt.id };
}

// validateGoodsReceiptForPosting: everything posting checks, without posting. Returns { ready, issues }.
export async function validateGoodsReceiptForPosting(client, context, receiptId, { receipt: loaded = null, order: lockedOrder = null } = {}) {
  const receipt = loaded ?? await loadReceipt(client, context, receiptId);
  const organizationId = context.organizationId;
  const issues = [];
  const order = lockedOrder ?? await loadPurchaseOrder(client, context, receipt.purchase_order_id);
  if (receipt.status !== "draft") issues.push(`The receipt is ${statusOf(receipt)}.`);
  if (order.status !== STATUS.confirmed) issues.push(`The purchase order is ${order.status}; nothing more can be received against it.`);
  if (receipt.supplier_id !== order.supplier_id) issues.push("The receipt's supplier is not the order's supplier.");
  const supplier = (await client.query(`SELECT status, blocked_reason FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2`, [organizationId, order.supplier_id])).rows[0];
  if (supplier?.status === "blocked") issues.push(`The supplier is blocked (${supplier.blocked_reason}); goods cannot be received from it.`);
  const lines = (await client.query(`SELECT * FROM tenant.goods_receipt_lines WHERE organization_id = $1 AND goods_receipt_id = $2 ORDER BY line_number`, [organizationId, receipt.id])).rows;
  if (!lines.length) issues.push("The receipt has no lines.");
  if (lines.some((line) => line.product_type !== "service" && decimal(line.accepted_quantity) + decimal(line.held_quantity) > 0n)) {
    if (!receipt.warehouse_id) issues.push("Choose the receiving warehouse.");
    else {
      const warehouse = (await client.query(`SELECT status FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [organizationId, receipt.warehouse_id])).rows[0];
      if (warehouse?.status !== "active") issues.push("The receiving warehouse is inactive.");
      try { await assertWarehouseOperation(client, context, receipt.warehouse_id, "receive", "Receiving warehouse"); } catch (error) { issues.push(error.message); }
    }
  }
  const orderLines = await orderLinesById(client, organizationId, order.id);
  const progress = new Map((await loadLineProgress(client, organizationId, order.id)).map((line) => [line.lineId, line]));
  const receiptDate = dayOf(receipt.receipt_date);
  // Never into a closed or locked accounting period: the receipt date is when its stock and accrual take effect.
  const period = (await client.query(
    `SELECT name, status FROM tenant.fiscal_periods WHERE organization_id = $1 AND $2::date BETWEEN start_date AND end_date ORDER BY period_type = 'standard' DESC, start_date DESC LIMIT 1`,
    [organizationId, receiptDate])).rows[0];
  if (period && period.status !== "open") issues.push(`The accounting period ${period.name} is ${period.status}; a receipt dated ${receiptDate} cannot be posted into it.`);
  // An order line's entitlement is checked once, against everything this receipt brings for it (all its lots).
  const onReceipt = new Map();
  for (const line of lines) onReceipt.set(line.purchase_order_line_id, add(onReceipt.get(line.purchase_order_line_id) ?? 0n, add(line.accepted_quantity, line.held_quantity)));
  const checkedOrderLines = new Set();
  for (const line of lines) {
    const orderLine = orderLines.get(line.purchase_order_line_id);
    const label = `Line ${orderLine?.line_number ?? line.line_number}`;
    if (!orderLine) { issues.push(`${label}: the order line no longer exists.`); continue; }
    if (line.product_id !== orderLine.product_id) issues.push(`${label}: the product does not match the order line.`);
    const received = add(line.accepted_quantity, line.held_quantity);
    if (received + decimal(line.rejected_quantity) <= 0n) issues.push(`${label}: nothing is entered.`);
    const owed = progress.get(orderLine.id)?.remainingToReceive ?? 0n;
    const total = onReceipt.get(orderLine.id) ?? received;
    if (!checkedOrderLines.has(orderLine.id) && total > owed)
      issues.push(owed === 0n ? `${label} has meanwhile been received in full (or cancelled).` : `${label}: only ${dec(owed)} is still to be received; this receipt has ${dec(total)}.`);
    checkedOrderLines.add(orderLine.id);
    if (decimal(line.conversion_factor) !== decimal(orderLine.conversion_factor) || line.receipt_uom_id !== orderLine.purchase_uom_id)
      issues.push(`${label}: the unit or its conversion changed on the order; re-enter the line.`);
    if (line.warehouse_id && line.warehouse_id !== receipt.warehouse_id) issues.push(`${label}: re-enter the line for the receipt's warehouse.`);
    if (orderLine.product_type !== "stock" || received <= 0n) continue;
    if (orderLine.item_status && orderLine.item_status !== "active") issues.push(`${label}: the product is inactive.`);
    if (!orderLine.track_inventory) issues.push(`${label}: the product is no longer stocked; ask for the order to be corrected.`);
    if (decimal(line.held_quantity) > 0n && receipt.warehouse_id && !(await qualityLocation(client, organizationId, receipt.warehouse_id)))
      issues.push(`${label}: the warehouse has no quality location to hold goods in. Add one in Inventory, or accept or refuse the goods.`);
    // Lot, serial and expiry rules as Inventory keeps them for the product today.
    if (orderLine.tracking_type === "batch") {
      if (!line.batch_number) issues.push(`${label}: enter the batch (lot) number.`);
      if (orderLine.requires_expiry_date && !line.expiry_date) issues.push(`${label}: enter the lot's expiry date.`);
      if (line.expiry_date && dayOf(line.expiry_date) < receiptDate && decimal(line.accepted_quantity) > 0n) issues.push(`${label}: the lot has expired; receive it as damaged, or refuse it.`);
      if (line.batch_number) {
        const batch = (await client.query(`SELECT expires_on FROM tenant.stock_batches WHERE organization_id = $1 AND item_id = $2 AND lower(batch_number) = lower($3)`,
          [organizationId, line.product_id, line.batch_number])).rows[0];
        if (batch && line.expiry_date && batch.expires_on && dayOf(batch.expires_on) !== dayOf(line.expiry_date))
          issues.push(`${label}: lot ${line.batch_number} is on record with expiry ${dayOf(batch.expires_on)}.`);
      }
    }
    if (orderLine.tracking_type === "serial" && decimal(line.accepted_quantity) > 0n) {
      // One serial number per base unit accepted (the receipt line's own conversion snapshot).
      if (BigInt(line.serial_numbers.length) * ONE !== roundMoney(mul(line.accepted_quantity, line.conversion_factor ?? ONE), 6)) issues.push(`${label}: enter one serial number for each unit accepted.`);
      const taken = (await client.query(`SELECT serial_number FROM tenant.stock_serials WHERE organization_id = $1 AND lower(serial_number) = ANY($2::text[])`,
        [organizationId, line.serial_numbers.map((value) => value.toLowerCase())])).rows;
      if (taken.length) issues.push(`${label}: serial number ${taken.map((row) => row.serial_number).join(", ")} is already registered.`);
    } else if (orderLine.tracking_type !== "serial" && line.serial_numbers.length) issues.push(`${label}: the product is not serial-numbered.`);
  }
  return { ready: issues.length === 0, issues };
}

// The capitalisable cost of one base unit for Inventory Valuation: the line's taxable value per base unit (recoverable tax is not inventory cost),
// in the company's base currency. An order in another currency is converted at the Finance exchange rate of the receipt date, and the source
// currency, unit cost and rate are kept with the valuation (never recalculated later). Without a rate the receipt is valued as missing cost
// (a valuation exception), never at an invented one.
async function receiptCostOf(client, context, order, line, receiptDate) {
  const base = (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0]?.base_currency?.trim();
  if (!base || decimal(line.base_quantity) <= 0n) return {};
  const sourceUnit = div(line.taxable_amount, line.base_quantity);
  const currency = order.currency_code?.trim();
  if (base === currency) return { unitCost: formatDecimal(roundMoney(sourceUnit, 6)), costSource: "receipt_cost" };
  const rate = await getExchangeRate(client, { ...context, permissions: [...(context.permissions ?? []), "accounting.view"] }, currency, base, receiptDate).catch(() => null);
  if (rate === null) return {};
  return { unitCost: formatDecimal(roundMoney(mul(sourceUnit, rate), 6)), costSource: "receipt_cost",
    costSnapshot: { sourceCurrency: currency, sourceUnitCost: formatDecimal(sourceUnit), exchangeRate: formatDecimal(rate) } };
}

async function findOrCreateBatch(client, context, line) {
  const existing = (await client.query(`SELECT id, expires_on FROM tenant.stock_batches WHERE organization_id = $1 AND item_id = $2 AND lower(batch_number) = lower($3)`,
    [context.organizationId, line.product_id, line.batch_number])).rows[0];
  if (existing) {
    if (!existing.expires_on && line.expiry_date)
      await client.query(`UPDATE tenant.stock_batches SET expires_on = $3, manufactured_on = COALESCE(manufactured_on, $4) WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, existing.id, line.expiry_date, line.manufactured_date]);
    return existing.id;
  }
  return (await client.query(`INSERT INTO tenant.stock_batches (organization_id, item_id, batch_number, manufactured_on, expires_on, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [context.organizationId, line.product_id, line.batch_number, line.manufactured_date, line.expiry_date, context.userId ?? null])).rows[0].id;
}

// An incoming Quality inspection for goods held at receipt, when an active incoming plan applies to the product, supplier and warehouse.
async function openInspection(client, context, receipt, order, line, orderLine, quantity, batchId) {
  const plan = (await client.query(
    `SELECT id FROM tenant.quality_plans WHERE organization_id = $1 AND status = 'active' AND plan_type = 'incoming'
        AND (item_id IS NULL OR item_id = $2) AND (item_group_id IS NULL OR item_group_id = $3) AND (supplier_id IS NULL OR supplier_id = $4) AND (warehouse_id IS NULL OR warehouse_id = $5)
        AND (effective_from IS NULL OR effective_from <= current_date) AND (effective_to IS NULL OR effective_to >= current_date)
      ORDER BY (item_id IS NOT NULL) DESC, (item_group_id IS NOT NULL) DESC, (supplier_id IS NOT NULL) DESC, (warehouse_id IS NOT NULL) DESC LIMIT 1`,
    [context.organizationId, line.product_id, orderLine.item_group_id, order.supplier_id, receipt.warehouse_id])).rows[0];
  if (!plan) return null;
  try {
    const inspection = await createInspection(client, qualityContextFor(context), {
      planId: plan.id, inspectionType: "incoming", sourceType: "procurement_receipt", sourceId: receipt.id, itemId: line.product_id, supplierId: order.supplier_id,
      warehouseId: receipt.warehouse_id, batchId, lotQuantity: formatDecimal(roundMoney(mul(quantity, line.conversion_factor), 6)),
    });
    return inspection.inspection?.id ?? inspection.id ?? null;
  } catch (error) {
    if (error instanceof QualityError) throw new PurchaseOrderError(error.status ?? 409, `Line ${orderLine.line_number}: ${error.message}`, error.code);
    throw error;
  }
}

// postInventoryReceipt: Inventory's movements for one stocked line — accepted into the warehouse, held and damaged into its quality location.
async function postInventoryReceipt(client, context, receipt, order, line, orderLine) {
  const stock = stockContextFor(context);
  const label = `Line ${orderLine.line_number}: `;
  const held = decimal(line.held_quantity);
  const damaged = decimal(line.damaged_quantity);
  const inspection = sub(held, damaged);
  const cost = await receiptCostOf(client, context, order, orderLine, dayOf(receipt.receipt_date));
  const factor = decimal(line.conversion_factor);
  const batchId = line.batch_number ? await findOrCreateBatch(client, context, line) : null;
  const holdLocationId = held > 0n ? await qualityLocation(client, context.organizationId, line.warehouse_id) : null;
  const movements = [];
  // The stock takes effect on the receipt date (the ledger keeps the posting time beside it).
  const reference = (part) => ({ referenceType: "goods_receipt_line", referenceId: line.id, occurredOn: dayOf(receipt.receipt_date),
    reason: `${receipt.receipt_number} · ${order.purchase_order_number} line ${orderLine.line_number}${part}` });
  const post = async (quantity, locationId, part, key) => {
    if (quantity <= 0n) return;
    if (orderLine.tracking_type === "serial") {
      const result = await stocked(() => receiveSerializedStock(client, stock, { itemId: line.product_id, warehouseId: line.warehouse_id, warehouseLocationId: locationId, batchId,
        serialNumbers: line.serial_numbers, ...cost, ...reference(part), idempotencyKey: `grn:${line.id}:${key}` }), label);
      movements.push(...result.movements.map((movement) => movement.id));
    } else {
      const movement = await stocked(() => postStockMovement(client, stock, { movementType: "receipt", itemId: line.product_id, warehouseId: line.warehouse_id,
        warehouseLocationId: locationId, batchId, quantity: formatDecimal(roundMoney(mul(quantity, factor), 6)), ...cost, ...reference(part), idempotencyKey: `grn:${line.id}:${key}`,
        transaction: { uomId: line.receipt_uom_id, quantity: formatDecimal(quantity), factor: formatDecimal(factor) } }), label);
      movements.push(movement.id);
    }
  };
  await post(decimal(line.accepted_quantity), line.warehouse_location_id, "", "accepted");
  await post(inspection, holdLocationId, " (inspection hold)", "inspection");
  await post(damaged, holdLocationId, " (damaged)", "damaged");
  await client.query(`UPDATE tenant.goods_receipt_lines SET batch_id = $3, hold_location_id = $4, stock_movement_ids = $5 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, line.id, batchId, holdLocationId, movements]);
  return { batchId, holdLocationId, inspection, damaged };
}

// recordReceiptDispositions: what was held at posting, as its own records (released or returned later; the line itself never changes).
// Damaged goods are blocked from the start: their rejection case owns them.
async function recordReceiptDispositions(client, context, receipt, order, line, orderLine, posted) {
  const ids = {};
  for (const [quantity, disposition] of [[posted.inspection, "inspection_hold"], [posted.damaged, "damaged"]]) {
    if (quantity <= 0n) continue;
    const inspectionId = disposition === "inspection_hold" ? await openInspection(client, context, receipt, order, line, orderLine, quantity, posted.batchId) : null;
    ids[disposition] = (await client.query(
      `INSERT INTO tenant.goods_receipt_dispositions (organization_id, goods_receipt_id, goods_receipt_line_id, disposition, quantity, location_id, quality_inspection_id, blocked_quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [context.organizationId, receipt.id, line.id, disposition, formatDecimal(quantity), posted.holdLocationId, inspectionId, disposition === "damaged" ? formatDecimal(quantity) : "0"])).rows[0].id;
  }
  return ids;
}

// The fields every rejection case on a receipt line shares.
export function receiptLineCaseFields(receipt, line, orderLine) {
  return {
    purchaseOrderId: receipt.purchase_order_id, purchaseOrderLineId: line.purchase_order_line_id, goodsReceiptId: receipt.id, goodsReceiptLineId: line.id, supplierId: receipt.supplier_id,
    warehouseId: line.warehouse_id ?? receipt.warehouse_id ?? null, productId: line.product_id, productType: line.product_type, productSnapshot: line.product_snapshot ?? orderLine?.product_snapshot,
    descriptionSnapshot: line.description, uomId: line.receipt_uom_id, uomSnapshot: line.uom_snapshot ?? {}, conversionFactor: line.conversion_factor, batchId: line.batch_id ?? null,
    batchNumber: line.batch_number ?? null, expiryDate: line.expiry_date ?? null,
  };
}

// postGoodsReceipt: under the order's lock (two receipts cannot both take the last units), revalidated, then the stock moves once.
export async function postGoodsReceipt(client, context, receiptId) {
  requirePoPermission(context, PO_PERMISSIONS.post, "You do not have permission to post goods receipts.");
  const receipt = await loadReceipt(client, context, receiptId, { lock: true });
  if (receipt.status === "posted" && !receipt.reversed_at) return { id: receipt.id, status: "posted", replayed: true };
  const order = await loadPurchaseOrder(client, context, receipt.purchase_order_id, { lock: true });
  await client.query(`SELECT id FROM tenant.purchase_order_lines WHERE organization_id = $1 AND purchase_order_id = $2 FOR UPDATE`, [context.organizationId, order.id]);
  const check = await validateGoodsReceiptForPosting(client, context, receipt.id, { receipt, order });
  if (!check.ready) {
    const overReceipt = check.issues.some((issue) => /still to be received|received in full/.test(issue));
    throw new PurchaseOrderError(409, check.issues[0], overReceipt ? "GOODS_RECEIPT_OVER_RECEIPT" : "GOODS_RECEIPT_NOT_READY", { issues: check.issues.map((message) => ({ message })) });
  }
  const organizationId = context.organizationId;
  const lines = (await client.query(`SELECT * FROM tenant.goods_receipt_lines WHERE organization_id = $1 AND goods_receipt_id = $2 ORDER BY line_number`, [organizationId, receipt.id])).rows;
  const orderLines = await orderLinesById(client, organizationId, order.id);
  for (const line of lines) {
    const orderLine = orderLines.get(line.purchase_order_line_id);
    let dispositions = {};
    let stockLine = line;
    if (line.product_type === "stock" && add(line.accepted_quantity, line.held_quantity) > 0n) {
      const posted = await postInventoryReceipt(client, context, receipt, order, line, orderLine);
      dispositions = await recordReceiptDispositions(client, context, receipt, order, line, orderLine, posted);
      // What the receipt put on hold (inspection hold, and goods that came in damaged) is explained by an Inventory Quality Hold opened for it.
      const held = add(posted.inspection, posted.damaged);
      if (held > 0n && posted.holdLocationId) {
        const serials = orderLine.tracking_type === "serial" ? (await client.query(
          `SELECT id FROM tenant.stock_serials WHERE organization_id = $1 AND item_id = $2 AND warehouse_location_id = $3 AND status = available AND lower(serial_number) = ANY($4::text[])`,
          [organizationId, line.product_id, posted.holdLocationId, (line.serial_numbers ?? []).map((value) => value.toLowerCase())])).rows : [];
        await registerHeldStock(client, context, { sourceType: "goods_receipt", sourceId: receipt.id, sourceNumber: receipt.receipt_number, sourceLineId: line.id, warehouseId: line.warehouse_id,
          reasonCode: posted.inspection > 0n ? "RECEIVING_INSPECTION" : "DAMAGE_SUSPECTED",
          notes: `Received on hold: ${formatDecimal(posted.inspection)} for inspection${posted.damaged > 0n ? `, ${formatDecimal(posted.damaged)} damaged` : ""} (line ${line.line_number})`,
          positions: serials.length ? serials.map((serial) => ({ itemId: line.product_id, locationId: posted.holdLocationId, batchId: posted.batchId, serialId: serial.id, quantity: 1 }))
            : [{ itemId: line.product_id, locationId: posted.holdLocationId, batchId: posted.batchId, quantity: formatDecimal(roundMoney(mul(held, decimal(line.conversion_factor)), 6)) }] }, { internal: true });
      }
      stockLine = { ...line, batch_id: posted.batchId, hold_location_id: posted.holdLocationId };
    }
    // Rejections, in the same transaction as the receipt: what was refused at the dock (no stock) and what came in damaged (blocked).
    const shared = { ...receiptLineCaseFields(receipt, stockLine, orderLine), observedAt: receipt.physical_received_at ?? new Date().toISOString(),
      reportedByUserId: receipt.received_by_user_id ?? context.userId ?? null };
    if (decimal(line.rejected_quantity) > 0n)
      await openRejectionCase(client, context, { ...shared, stage: "before_custody", stockSource: "dock", goodsReceiptLineId: line.id, reason: line.refusal_reason_code ?? "other",
        description: line.rejection_reason, quantity: decimal(line.rejected_quantity), presentedQuantity: line.presented_quantity, batchId: null, warehouseId: receipt.warehouse_id,
        expectedResolution: "replacement_expected", sourceKey: `grn:${line.id}:refused` });
    if (decimal(line.damaged_quantity) > 0n)
      await openRejectionCase(client, context, { ...shared, stage: "after_custody", stockSource: "damaged_at_receipt", dispositionId: dispositions.damaged ?? null,
        locationId: stockLine.hold_location_id ?? null, reason: "damaged_goods", description: line.discrepancy_notes ?? "Received damaged", quantity: decimal(line.damaged_quantity),
        expectedResolution: "purchase_return", sourceKey: `grn:${line.id}:damaged` });
  }
  const accrual = await postReceiptAccrual(client, context, receipt, order, lines, orderLines);
  await client.query(
    `UPDATE tenant.goods_receipts SET status = 'posted', posted_by = $3, posted_at = now(), received_by_user_id = COALESCE(received_by_user_id, $3), updated_by = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [organizationId, receipt.id, context.userId ?? null]);
  const summary = lines.map((line) => {
    const orderLine = orderLines.get(line.purchase_order_line_id);
    const parts = [`${dec(line.accepted_quantity)} accepted`, decimal(line.held_quantity) - decimal(line.damaged_quantity) > 0n && `${dec(sub(line.held_quantity, line.damaged_quantity))} on hold`,
      decimal(line.damaged_quantity) > 0n && `${dec(line.damaged_quantity)} damaged`, decimal(line.rejected_quantity) > 0n && `${dec(line.rejected_quantity)} refused`].filter(Boolean);
    return `line ${orderLine.line_number}: ${parts.join(", ")}`;
  }).join("; ");
  await recordReceiptEvent(client, context, receipt.id, "goods_receipt.posted", `Posted: ${summary}${accrual ? ` · GRNI accrual ${accrual.amount}` : ""}`, { accrual });
  await recordPoEvent(client, context, order.id, "purchase_order.goods_received", `Goods receipt ${receipt.receipt_number} posted: ${summary}`,
    { details: { receiptId: receipt.id, receiptNumber: receipt.receipt_number } });
  return { id: receipt.id, status: "posted", replayed: false };
}

// cancelDraftGoodsReceipt: a draft that will not be posted. A posted receipt is reversed, never cancelled.
export async function cancelDraftGoodsReceipt(client, context, receiptId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.receive, "You do not have permission to cancel goods receipts.");
  const receipt = await loadReceipt(client, context, receiptId, { lock: true });
  if (receipt.status === "cancelled") return { id: receipt.id, status: "cancelled", replayed: true };
  if (receipt.status !== "draft") throw new PurchaseOrderError(409, "A posted goods receipt is not cancelled; reverse it, or record a purchase return.", "GOODS_RECEIPT_LOCKED");
  const reason = text(input.reason, 1000);
  await client.query(`UPDATE tenant.goods_receipts SET status = 'cancelled', cancelled_by = $3, cancelled_at = now(), cancel_reason = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, receipt.id, context.userId ?? null, reason]);
  await recordReceiptEvent(client, context, receipt.id, "goods_receipt.cancelled", `Draft cancelled${reason ? `: ${reason}` : ""}`);
  return { id: receipt.id, status: "cancelled", replayed: false };
}

// reversePostedGoodsReceipt: undoes a posted receipt nothing has used yet — no return from it, no bill allocated to it, no held goods released or inspected,
// and its stock still where it was put (Inventory refuses otherwise). Compensating stock movements (and the accrual's reversal) are posted; nothing is deleted.
export async function reversePostedGoodsReceipt(client, context, receiptId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.reverse, "You do not have permission to reverse goods receipts.");
  const receipt = await loadReceipt(client, context, receiptId, { lock: true });
  if (receipt.reversed_at) return { id: receipt.id, status: "reversed", replayed: true };
  if (receipt.status !== "posted") throw new PurchaseOrderError(409, "Only a posted goods receipt can be reversed.", "GOODS_RECEIPT_NOT_POSTED");
  const reason = text(input.reason, 1000);
  if (!reason || reason.length < 3) fail("Give the reason for the reversal.", "reason");
  const order = await loadPurchaseOrder(client, context, receipt.purchase_order_id, { lock: true });
  const organizationId = context.organizationId;
  const used = (await client.query(
    `SELECT (SELECT count(*) FROM tenant.purchase_return_lines return_line JOIN tenant.goods_receipt_lines receipt_line ON receipt_line.organization_id = return_line.organization_id
                AND receipt_line.id = return_line.goods_receipt_line_id WHERE return_line.organization_id = $1 AND receipt_line.goods_receipt_id = $2 AND EXISTS (SELECT 1 FROM tenant.purchase_returns posted_return WHERE posted_return.organization_id = return_line.organization_id AND posted_return.id = return_line.purchase_return_id AND posted_return.document_status = 'posted'))::int AS returns,
            (SELECT count(*) FROM tenant.supplier_bill_receipt_allocations allocation JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = allocation.organization_id AND bill.id = allocation.vendor_bill_id
               JOIN tenant.goods_receipt_lines line ON line.organization_id = allocation.organization_id AND line.id = allocation.goods_receipt_line_id
              WHERE allocation.organization_id = $1 AND line.goods_receipt_id = $2 AND bill.status NOT IN ('cancelled', 'reversed', 'draft'))::int AS bills,
            (SELECT COALESCE(sum(released_quantity + disposed_quantity), 0) FROM tenant.goods_receipt_dispositions WHERE organization_id = $1 AND goods_receipt_id = $2) AS released,
            (SELECT count(*) FROM tenant.goods_receipt_dispositions disposition JOIN tenant.quality_inspections inspection ON inspection.organization_id = disposition.organization_id
                AND inspection.id = disposition.quality_inspection_id
              WHERE disposition.organization_id = $1 AND disposition.goods_receipt_id = $2 AND inspection.status NOT IN ('draft', 'cancelled'))::int AS inspected`,
    [organizationId, receipt.id])).rows[0];
  if (used.returns) throw new PurchaseOrderError(409, "Goods from this receipt were returned to the supplier. It can no longer be reversed.", "GOODS_RECEIPT_IN_USE");
  if (used.bills) throw new PurchaseOrderError(409, "A supplier bill draws on this receipt. Finance must cancel or correct the bill first.", "GOODS_RECEIPT_IN_USE");
  if (decimal(used.released) > 0n) throw new PurchaseOrderError(409, "Held goods from this receipt were released into stock. It can no longer be reversed.", "GOODS_RECEIPT_IN_USE");
  if (used.inspected) throw new PurchaseOrderError(409, "Quality has started inspecting goods from this receipt. Finish or cancel the inspection first.", "GOODS_RECEIPT_IN_USE");
  const cases = (await client.query(`SELECT id, rejection_number, stock_source, status, resolved_quantity FROM tenant.receiving_rejections WHERE organization_id = $1 AND goods_receipt_id = $2 AND status <> 'cancelled'`,
    [organizationId, receipt.id])).rows;
  const settled = cases.find((entry) => entry.status !== "open" || decimal(entry.resolved_quantity) > 0n || entry.stock_source === "usable_stock");
  if (settled) throw new PurchaseOrderError(409, `Rejection ${settled.rejection_number} was acted on for goods from this receipt. Resolve it through its own documents; the receipt can no longer be reversed.`, "GOODS_RECEIPT_IN_USE");
  const lines = (await client.query(`SELECT line.*, item.tracking_type FROM tenant.goods_receipt_lines line LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.product_id
     WHERE line.organization_id = $1 AND line.goods_receipt_id = $2 ORDER BY line.line_number`, [organizationId, receipt.id])).rows;
  const progress = new Map((await loadLineProgress(client, organizationId, order.id)).map((line) => [line.lineId, line]));
  for (const line of lines) {
    const state = progress.get(line.purchase_order_line_id);
    if (state && state.billingBasis === "receipt" && state.receiptRequired && state.billed > sub(state.billable, decimal(line.accepted_quantity)))
      throw new PurchaseOrderError(409, `Line ${line.line_number}: what is billed would exceed what remains received. Finance must correct the bill first.`, "GOODS_RECEIPT_IN_USE");
  }
  // Each movement the receipt posted is reversed by a compensating one (the receipt's own stays in the ledger): the same location, batch and
  // serial number, so goods taken back are exactly the goods received.
  const stock = stockContextFor(context);
  for (const line of lines) {
    if (line.product_type !== "stock") continue;
    const label = `Line ${line.line_number}: `;
    if (line.tracking_type === "serial") {
      for (const serialNumber of line.serial_numbers) {
        const serial = (await client.query(`SELECT id FROM tenant.stock_serials WHERE organization_id = $1 AND item_id = $2 AND lower(serial_number) = lower($3) AND status = 'available'`,
          [organizationId, line.product_id, serialNumber])).rows[0];
        if (!serial) throw new PurchaseOrderError(409, `${label}serial number ${serialNumber} is no longer in stock.`, "GOODS_RECEIPT_STOCK_USED");
      }
    }
    await stocked(() => reverseStockMovements(client, stock, line.stock_movement_ids, { referenceType: "goods_receipt_reversal", referenceId: line.id,
      reason: `${receipt.receipt_number} reversed: ${reason}`, keyPrefix: "grn-reversal" }), label);
  }
  // Inspections opened for this receipt's held goods are no longer needed.
  const drafts = (await client.query(
    `SELECT inspection.id FROM tenant.goods_receipt_dispositions disposition JOIN tenant.quality_inspections inspection ON inspection.organization_id = disposition.organization_id
        AND inspection.id = disposition.quality_inspection_id WHERE disposition.organization_id = $1 AND disposition.goods_receipt_id = $2 AND inspection.status = 'draft'`,
    [organizationId, receipt.id])).rows;
  for (const draft of drafts) await cancelInspection(client, qualityContextFor(context), draft.id, `Goods receipt ${receipt.receipt_number} reversed`);
  // Its rejection cases go with it: what the receipt recorded did not happen as recorded.
  for (const entry of cases)
    await client.query(`UPDATE tenant.receiving_rejections SET status = 'cancelled', cancelled_by = $3, cancelled_at = now(), cancel_reason = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [organizationId, entry.id, context.userId ?? null, `Goods receipt ${receipt.receipt_number} reversed: ${reason}`]);
  const accrualReversal = await reverseReceiptAccrual(client, context, receipt, reason);
  await client.query(`UPDATE tenant.goods_receipts SET reversed_by = $3, reversed_at = now(), reversal_reason = $4, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [organizationId, receipt.id, context.userId ?? null, reason]);
  await recordReceiptEvent(client, context, receipt.id, "goods_receipt.reversed", `Reversed: ${reason}`, { accrualReversalJournalEntryId: accrualReversal });
  await recordPoEvent(client, context, order.id, "purchase_order.receipt_reversed", `Goods receipt ${receipt.receipt_number} reversed: ${reason}`, { details: { receiptId: receipt.id } });
  return { id: receipt.id, status: "reversed", replayed: false };
}

async function insertDiscrepancy(client, context, receiptId, lineId, type, quantity, notes, fileIds = []) {
  await client.query(
    `INSERT INTO tenant.goods_receipt_discrepancies (organization_id, goods_receipt_id, goods_receipt_line_id, discrepancy_type, quantity, notes, recorded_by, evidence_file_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [context.organizationId, receiptId, lineId, type, quantity === null ? null : formatDecimal(quantity), notes, context.userId ?? null, fileIds]);
}

// recordGoodsReceiptDiscrepancy: a shortage, damage, wrong item, excess or anything else the supplier is to hear about, with the receipt's files as evidence.
// input: { goodsReceiptLineId?, type, quantity?, notes, evidenceFileIds? }
export async function recordReceiptDiscrepancy(client, context, receiptId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.receive, "You do not have permission to record receipt discrepancies.");
  const receipt = await loadReceipt(client, context, receiptId, { lock: true });
  if (receipt.status === "cancelled") fail("The receipt is cancelled.", "status", "GOODS_RECEIPT_LOCKED", 409);
  const type = text(input.type, 40);
  if (!DISCREPANCY_TYPES.some((entry) => entry.code === type)) fail("Choose the kind of discrepancy.", "type");
  const notes = text(input.notes, 2000);
  if (!notes) fail("Describe the discrepancy.", "notes");
  const lineId = optionalUuid(input.goodsReceiptLineId, "Receipt line");
  if (lineId && !(await client.query(`SELECT 1 FROM tenant.goods_receipt_lines WHERE organization_id = $1 AND goods_receipt_id = $2 AND id = $3`, [context.organizationId, receipt.id, lineId])).rows[0])
    fail("That line is not on this receipt.", "goodsReceiptLineId", "GOODS_RECEIPT_LINE_INVALID", 404);
  const quantity = input.quantity === undefined || input.quantity === null || input.quantity === "" ? null : readQuantity(input.quantity, "Quantity");
  if (quantity === 0n) fail("The quantity must be greater than zero.", "quantity");
  const fileIds = [...new Set((Array.isArray(input.evidenceFileIds) ? input.evidenceFileIds : []).map((id) => requireUuid(id, "File")))];
  if (fileIds.length) {
    const found = (await client.query(`SELECT id FROM public.attachments WHERE organization_id = $1 AND entity_type = 'procurement.goods_receipt' AND entity_id = $2::text AND id = ANY($3::uuid[]) AND archived_at IS NULL`,
      [context.organizationId, receipt.id, fileIds])).rows;
    if (found.length !== fileIds.length) fail("Evidence must be files attached to this receipt.", "evidenceFileIds", "GOODS_RECEIPT_FILE_NOT_FOUND", 409);
  }
  await insertDiscrepancy(client, context, receipt.id, lineId, type, quantity, notes, fileIds);
  await recordReceiptEvent(client, context, receipt.id, "goods_receipt.discrepancy",
    `Discrepancy recorded: ${DISCREPANCY_LABELS[type]}${quantity ? ` × ${dec(quantity)}` : ""} — ${notes}${fileIds.length ? ` (${fileIds.length} file${fileIds.length === 1 ? "" : "s"})` : ""}`);
  return { id: receipt.id };
}
export const recordGoodsReceiptDiscrepancy = recordReceiptDiscrepancy;

// releaseHeldGoods: goods on inspection hold (or kept damaged) become usable: Inventory moves them out of the quality location. The receipt is unchanged.
// input: { quantity, note?, warehouseLocationId? }
export async function releaseHeldGoods(client, context, dispositionId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.release, "You do not have permission to release held goods.");
  const disposition = (await client.query(`SELECT * FROM tenant.goods_receipt_dispositions WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [context.organizationId, requireUuid(dispositionId, "Held goods")])).rows[0];
  if (!disposition) throw new PurchaseOrderError(404, "Held goods not found.", "GOODS_RECEIPT_DISPOSITION_NOT_FOUND");
  const receipt = await loadReceipt(client, context, disposition.goods_receipt_id, { lock: true });
  if (receipt.reversed_at) fail("The receipt was reversed.", "status", "GOODS_RECEIPT_LOCKED", 409);
  const line = (await client.query(`SELECT * FROM tenant.goods_receipt_lines WHERE organization_id = $1 AND id = $2`, [context.organizationId, disposition.goods_receipt_line_id])).rows[0];
  // Only what Quality has not rejected: rejected goods are accepted back through their rejection case.
  const open = sub(sub(sub(sub(disposition.quantity, disposition.released_quantity), disposition.returned_quantity), disposition.disposed_quantity), disposition.blocked_quantity);
  const quantity = readQuantity(input.quantity, "Quantity");
  if (quantity <= 0n) fail("Enter the quantity to release.", "quantity");
  if (quantity > open)
    throw new PurchaseOrderError(409, decimal(disposition.blocked_quantity) > 0n ? `Only ${dec(open)} is still held and undecided; ${dec(disposition.blocked_quantity)} is rejected and is handled through its rejection case.` : `Only ${dec(open)} is still held.`,
      "GOODS_RECEIPT_RELEASE_EXCEEDS_HELD");
  if (line.expiry_date && dayOf(line.expiry_date) < await databaseToday(client)) fail(`The lot expired on ${dayOf(line.expiry_date)}; it cannot be released to usable stock.`, "quantity", "GOODS_RECEIPT_LOT_EXPIRED", 409);
  const destination = optionalUuid(input.warehouseLocationId, "Location") ?? line.warehouse_location_id ?? null;
  const stock = stockContextFor(context);
  // Released from hold: a disposition change inside the warehouse, posted as the receipt line's own movement.
  const moved = await stocked(() => moveStockWithinWarehouse(client, stock, {
    itemId: line.product_id, warehouseId: line.warehouse_id, fromLocationId: disposition.location_id, toLocationId: destination, batchId: line.batch_id,
    quantity: formatDecimal(roundMoney(mul(quantity, line.conversion_factor), 6)), referenceType: "goods_receipt_line", referenceId: line.id,
    reason: `${receipt.receipt_number} line ${line.line_number}: released from hold`, idempotencyKey: `grn-release:${disposition.id}:${dec(disposition.released_quantity)}:${dec(quantity)}`,
  }));
  await client.query(`UPDATE tenant.goods_receipt_dispositions SET released_quantity = released_quantity + $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, disposition.id, formatDecimal(quantity)]);
  const note = text(input.note, 1000);
  await client.query(`INSERT INTO tenant.goods_receipt_disposition_events (organization_id, disposition_id, action, quantity, note, actor_user_id) VALUES ($1, $2, 'released', $3, $4, $5)`,
    [context.organizationId, disposition.id, formatDecimal(quantity), note, context.userId ?? null]);
  await recordReceiptEvent(client, context, receipt.id, "goods_receipt.held_released",
    `${dec(quantity)} ${disposition.disposition === "damaged" ? "damaged" : "held"} released into stock (line ${line.line_number})${note ? `: ${note}` : ""}`, { dispositionId: disposition.id, movementIds: moved.movements.map((movement) => movement.id) });
  return { dispositionId: disposition.id, released: dec(quantity) };
}
