// Purchase returns: goods sent back to the supplier after they were received — damaged, defective, failed inspection, wrong, expired,
// surplus. A return is its own document; the goods receipt it draws on is never changed and what was received stays received.
//
//   draft      editable; no stock or financial effect, and it reserves nothing (another return may be prepared for the same goods)
//   posted     the goods physically left (dispatch confirmed): Inventory's outbound movement from where the goods are (usable stock, inspection
//              hold, a rejection's quarantine), exactly once; GRNI cleared at the accrued value when receipts accrue; the returned quantity
//              allocated to what was billed or not, so Finance knows what to correct
//   cancelled  a draft not sent
//   reversed   a posted return whose goods came back: an inbound correction, never a status change pretending they never left
//
// Every quantity is checked against the receipt line: what it took into custody, less what posted returns already sent back — and what is
// physically there to send (usable stock, held goods, rejected goods). A return never reopens what may be received on the order, never
// credits the supplier by itself (a vendor credit does) and never orders a replacement by itself (an explicit replacement order does).
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { add, decimal, div, formatDecimal, mul, roundMoney, sub } from "../../../core/decimal.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { StockError, postStockMovement } from "../../stock/index.js";
import { convertBetweenUnits, factorOf, resolveItemUnit } from "../../products/uom.js";
import { loadPurchaseOrder, poCan } from "../purchase-orders/access.js";
import { postReturnAccrual, reverseReturnAccrual } from "../purchase-orders/accrual.js";
import { databaseToday } from "../purchase-orders/document.js";
import { recordPoEvent } from "../purchase-orders/persist.js";
import { assertWarehouseAccess, recordReceiptEvent, stockContextFor } from "../purchase-orders/receipts.js";
import { applyResolution, blockedQuantityOf, recordRejectionEvent } from "../purchase-orders/rejection-core.js";
import {
  COMMERCIAL_REASONS, EXPECTED_RESOLUTIONS, PurchaseReturnError, REASON_LABELS, RETURN_PERMISSIONS, dayOf, fail, has, optionalUuid, readDate, requireUuid, text,
} from "./constants.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const QTY = /^\d+(?:\.\d{1,6})?$/;
const POSTED_RETURN = `EXISTS (SELECT 1 FROM tenant.purchase_returns posted_return WHERE posted_return.organization_id = return_line.organization_id
  AND posted_return.id = return_line.purchase_return_id AND posted_return.document_status = 'posted')`;

export const can = (context, permission) => poCan(context, permission);
export function requirePermission(context, permission, message) {
  if (!can(context, permission)) throw new PurchaseReturnError(403, message, "PERMISSION_DENIED");
}
export function requireReturnAccess(context) {
  if (![RETURN_PERMISSIONS.view, RETURN_PERMISSIONS.manage, RETURN_PERMISSIONS.poView, RETURN_PERMISSIONS.poViewAll].some((key) => can(context, key)))
    throw new PurchaseReturnError(403, "You do not have permission to view purchase returns.", "PERMISSION_DENIED");
}
// Reads of the order on the return's behalf (a payables user sees the returns of every order).
export const orderReader = (context) => ({ ...context, permissions: [...new Set([...(context.permissions ?? []), RETURN_PERMISSIONS.poView, RETURN_PERMISSIONS.poViewAll])] });

export async function recordReturnEvent(client, context, returnId, type, summary, details = {}) {
  await client.query(`INSERT INTO tenant.purchase_return_events (organization_id, purchase_return_id, event_type, summary, details, actor_user_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [context.organizationId, returnId, type, summary, JSON.stringify(details), context.userId ?? null]);
}

export async function loadReturn(client, context, returnId, { lock = false } = {}) {
  requireReturnAccess(context);
  const row = (await client.query(`SELECT * FROM tenant.purchase_returns WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [context.organizationId, requireUuid(returnId, "Purchase return")])).rows[0];
  if (!row) throw new PurchaseReturnError(404, "Purchase return not found.", "PURCHASE_RETURN_NOT_FOUND");
  return row;
}

// ---------------------------------------------------------------- what may be returned

// The receipt lines with what they took into custody and what posted returns already sent back (from usable stock and in all), the goods
// released from hold, and rejected goods still held in usable stock (returned through their rejection case, not as ordinary stock).
export async function receiptLinesFor(client, organizationId, where, values, { lock = false } = {}) {
  return (await client.query(
    `SELECT line.*, receipt.receipt_number, receipt.status AS receipt_status, receipt.reversed_at, receipt.purchase_order_id, receipt.supplier_id, receipt.receipt_date,
            item.tracking_type, item.code AS item_code, order_line.line_number AS order_line_number, order_line.unit_price AS order_unit_price, order_line.taxable_amount AS order_taxable,
            order_line.ordered_quantity AS order_ordered, warehouse.name AS warehouse_name, location.code AS location_code,
            (SELECT COALESCE(sum(return_line.quantity), 0) FROM tenant.purchase_return_lines return_line
              WHERE return_line.organization_id = line.organization_id AND return_line.goods_receipt_line_id = line.id AND ${POSTED_RETURN}) AS posted_returned,
            (SELECT COALESCE(sum(return_line.quantity) FILTER (WHERE return_line.disposition_id IS NULL AND NOT return_line.from_hold), 0) FROM tenant.purchase_return_lines return_line
              WHERE return_line.organization_id = line.organization_id AND return_line.goods_receipt_line_id = line.id AND ${POSTED_RETURN}) AS posted_from_stock,
            (SELECT COALESCE(sum(d.released_quantity), 0) FROM tenant.goods_receipt_dispositions d WHERE d.organization_id = line.organization_id AND d.goods_receipt_line_id = line.id) AS released,
            (SELECT COALESCE(sum(j.rejected_quantity - j.released_quantity - j.returned_quantity), 0) FROM tenant.receiving_rejections j
              WHERE j.organization_id = line.organization_id AND j.goods_receipt_line_id = line.id AND j.stock_source = 'usable_stock' AND j.status <> 'cancelled') AS rejected_from_stock
       FROM tenant.goods_receipt_lines line
       JOIN tenant.goods_receipts receipt ON receipt.organization_id = line.organization_id AND receipt.id = line.goods_receipt_id
       JOIN tenant.purchase_order_lines order_line ON order_line.organization_id = line.organization_id AND order_line.id = line.purchase_order_line_id
       LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.product_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = line.organization_id AND warehouse.id = line.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = line.organization_id AND location.id = line.warehouse_location_id
      WHERE line.organization_id = $1 AND ${where} ORDER BY receipt.receipt_date, receipt.receipt_number, line.line_number${lock ? " FOR UPDATE OF line" : ""}`,
    [organizationId, ...values])).rows;
}

// calculateRemainingReturnableQuantity: the receipt line's entitlement (taken into custody − posted returns) and what usable stock from it may
// still go back (accepted + released from hold − returned from stock − rejected goods held in stock).
export function returnableOf(line) {
  const received = add(line.accepted_quantity, line.held_quantity);
  const entitlement = sub(received, line.posted_returned);
  const usable = sub(sub(add(line.accepted_quantity, line.released), line.posted_from_stock), line.rejected_from_stock);
  return { received, entitlement: entitlement > 0n ? entitlement : 0n, usable: usable > 0n ? usable : 0n, returned: decimal(line.posted_returned) };
}

async function draftQuantities(client, organizationId, receiptLineIds, excludeReturnId) {
  const { rows } = await client.query(
    `SELECT return_line.goods_receipt_line_id, sum(return_line.quantity) AS quantity, array_agg(DISTINCT purchase_return.return_number) AS numbers
       FROM tenant.purchase_return_lines return_line JOIN tenant.purchase_returns purchase_return ON purchase_return.organization_id = return_line.organization_id
        AND purchase_return.id = return_line.purchase_return_id
      WHERE return_line.organization_id = $1 AND return_line.goods_receipt_line_id = ANY($2::uuid[]) AND purchase_return.document_status = 'draft'
        AND purchase_return.id IS DISTINCT FROM $3::uuid GROUP BY return_line.goods_receipt_line_id`, [organizationId, receiptLineIds, excludeReturnId]);
  return new Map(rows.map((row) => [row.goods_receipt_line_id, { quantity: decimal(row.quantity), numbers: row.numbers }]));
}

function readQuantity(value, label) {
  const raw = String(value ?? "").trim();
  if (!QTY.test(raw) || decimal(raw) <= 0n) fail(`${label}: enter the quantity returned (more than zero).`, "quantity", "PURCHASE_RETURN_QUANTITY_INVALID");
  return decimal(raw);
}

// The lines of a return, validated against the receipts as they are now. Throws on anything that cannot be returned; warns about other drafts.
async function buildLines(client, context, requested, { orderId = null, excludeReturnId = null, lock = false, posting = false, defaultReason = null, warehouseId: returnWarehouse = null } = {}) {
  const organizationId = context.organizationId;
  if (!Array.isArray(requested) || !requested.length) fail("Choose what is being returned.", "lines", "PURCHASE_RETURN_NO_LINES");
  const ids = [...new Set(requested.map((entry) => requireUuid(entry.goodsReceiptLineId, "Receipt line")))];
  const lines = new Map((await receiptLinesFor(client, organizationId, "line.id = ANY($2::uuid[])", [ids], { lock })).map((row) => [row.id, row]));
  const drafts = await draftQuantities(client, organizationId, ids, excludeReturnId);
  const entries = [];
  const warnings = [];
  const claimed = new Map();
  for (const [index, entry] of requested.entries()) {
    const line = lines.get(entry.goodsReceiptLineId);
    if (!line) throw new PurchaseReturnError(404, "That goods receipt line was not found.", "PURCHASE_RETURN_LINE_INVALID");
    const label = `Line ${index + 1} (${line.receipt_number} line ${line.line_number})`;
    if (line.receipt_status !== "posted" || line.reversed_at) throw new PurchaseReturnError(409, `${label}: only goods on a posted receipt can be returned.`, "PURCHASE_RETURN_RECEIPT_NOT_POSTED");
    if (line.product_type === "service") throw new PurchaseReturnError(409, `${label}: a service is not returned; correct its bill instead.`, "PURCHASE_RETURN_SERVICE");
    if (orderId && line.purchase_order_id !== orderId) fail(`${label}: a return covers the receipts of one purchase order.`, "lines", "PURCHASE_RETURN_ORDER_MISMATCH", 409);
    orderId = orderId ?? line.purchase_order_id;
    let quantity = readQuantity(entry.quantity, label);
    // Returned in another unit than the receipt's (10 PCS of a receipt in BOX of 20): kept as entered, and turned exactly into the receipt's
    // unit, so the entitlement is consumed in base units whatever unit is used.
    const enteredUomId = optionalUuid(entry.uomId, "Unit of measure");
    let entered = null;
    if (enteredUomId && line.product_id && enteredUomId !== line.receipt_uom_id) {
      const unit = await resolveItemUnit(client, organizationId, line.product_id, enteredUomId, { purpose: "purchase" });
      if (!unit.ok) fail(`${label}: ${unit.message}`, "uomId", "PURCHASE_RETURN_UOM_INVALID", 409);
      const converted = await convertBetweenUnits(client, organizationId, line.product_id, formatDecimal(quantity), enteredUomId, line.receipt_uom_id, { purpose: "purchase" });
      if (!converted.ok) fail(`${label}: ${converted.message}`, "quantity", converted.reason === "inexact" ? "PURCHASE_RETURN_UOM_INEXACT" : "PURCHASE_RETURN_QUANTITY_INVALID", 409);
      entered = { uomId: enteredUomId, quantity, factor: factorOf(unit.unit) };
      quantity = converted.quantity;
    }
    const reason = String(entry.reason ?? entry.returnReason ?? defaultReason ?? "").trim();
    if (!REASON_LABELS[reason]) fail(`${label}: choose the return reason.`, "reason", "PURCHASE_RETURN_REASON_REQUIRED");
    const notes = text(entry.reasonNotes ?? entry.notes, 1000);
    if (reason === "other" && !notes) fail(`${label}: explain the reason.`, "reasonNotes", "PURCHASE_RETURN_REASON_REQUIRED");
    const rejectionId = optionalUuid(entry.rejectionId, "Rejection");
    let dispositionId = optionalUuid(entry.dispositionId, "Held goods");
    let rejection = null; let disposition = null; let available;
    if (rejectionId) {
      rejection = (await client.query(`SELECT * FROM tenant.receiving_rejections WHERE organization_id = $1 AND id = $2 AND goods_receipt_line_id = $3${lock ? " FOR UPDATE" : ""}`,
        [organizationId, rejectionId, line.id])).rows[0];
      if (!rejection) fail(`${label}: that rejection is not on this line.`, "rejectionId", "PURCHASE_RETURN_LINE_INVALID", 404);
      if (rejection.rejection_stage !== "after_custody")
        throw new PurchaseReturnError(409, `${rejection.rejection_number} was refused at the dock: those goods were never received, so there is nothing to return.`, "PURCHASE_RETURN_REJECTION_INVALID");
      if (rejection.status !== "open") throw new PurchaseReturnError(409, `${rejection.rejection_number} is ${rejection.status}.`, "PURCHASE_RETURN_REJECTION_INVALID");
      if (dispositionId && dispositionId !== rejection.disposition_id) fail(`${label}: those held goods are not the rejected goods.`, "dispositionId");
      dispositionId = rejection.disposition_id;
      available = blockedQuantityOf(rejection);
    }
    if (dispositionId) {
      disposition = (await client.query(`SELECT * FROM tenant.goods_receipt_dispositions WHERE organization_id = $1 AND id = $2 AND goods_receipt_line_id = $3${lock ? " FOR UPDATE" : ""}`,
        [organizationId, dispositionId, line.id])).rows[0];
      if (!disposition) fail(`${label}: those held goods are not on this line.`, "dispositionId", "PURCHASE_RETURN_LINE_INVALID", 404);
      if (!rejection) available = sub(sub(sub(sub(disposition.quantity, disposition.released_quantity), disposition.returned_quantity), disposition.disposed_quantity), disposition.blocked_quantity);
    }
    const returnable = returnableOf(line);
    if (!rejection && !disposition) available = returnable.usable;
    // Two lines of one return on the same receipt line share its quantities.
    const key = `${line.id}:${rejection?.id ?? disposition?.id ?? "stock"}`;
    const already = claimed.get(key) ?? 0n;
    const sourceLimit = available < returnable.entitlement ? available : returnable.entitlement;
    if (add(already, quantity) > sourceLimit)
      throw new PurchaseReturnError(409, `${label}: only ${dec(sub(sourceLimit, already) > 0n ? sub(sourceLimit, already) : 0n)} ${rejection ? `rejected on ${rejection.rejection_number}` : disposition ? "on hold (and not rejected)" : "in usable stock from this receipt"} can still be returned (received ${dec(returnable.received)}, returned ${dec(returnable.returned)}).`,
        "PURCHASE_RETURN_EXCEEDS_RECEIVED", { lineId: line.id, returnable: dec(sourceLimit) });
    claimed.set(key, add(already, quantity));
    // A commercial return of good stock (excess, surplus) is the supplier's agreement, approved when it posts — never a made-up quality failure.
    if (posting && COMMERCIAL_REASONS.includes(reason) && !rejection && !disposition && !can(context, RETURN_PERMISSIONS.commercial))
      throw new PurchaseReturnError(403, `${label}: returning good stock for a commercial reason (${REASON_LABELS[reason].toLowerCase()}) is posted by someone allowed to approve commercial returns.`, "PERMISSION_DENIED");
    const serials = (Array.isArray(entry.serialNumbers) ? entry.serialNumbers : String(entry.serialNumbers ?? "").split(/[\s,;]+/)).map((value) => text(value, 120)).filter(Boolean);
    // One serial number per base unit returned (a BOX of 5 serial-numbered pieces is 5 serial numbers).
    if (line.tracking_type === "serial" && line.product_type === "stock" && BigInt(serials.length) * decimal(1) !== roundMoney(mul(quantity, line.conversion_factor ?? "1"), 6))
      fail(`${label}: choose the serial number of each unit returned.`, "serialNumbers", "PURCHASE_RETURN_SERIALS_REQUIRED");
    if (new Set(serials.map((value) => value.toLowerCase())).size !== serials.length) fail(`${label}: a serial number is entered twice.`, "serialNumbers", "PURCHASE_RETURN_SERIAL_INVALID");
    if (rejection && rejection.serial_numbers?.length) {
      const allowed = new Set(rejection.serial_numbers.map((value) => value.toLowerCase()));
      if (serials.some((value) => !allowed.has(value.toLowerCase()))) fail(`${label}: return only the serial numbers rejected on ${rejection.rejection_number}.`, "serialNumbers", "PURCHASE_RETURN_SERIAL_INVALID", 409);
    }
    // Where the goods are now: the rejection's or hold's location, the receipt's location — or where they were moved to since.
    const warehouseId = optionalUuid(entry.warehouseId, "Warehouse") ?? returnWarehouse ?? line.warehouse_id ?? null;
    // Moved to another warehouse since: from the location given there (or its general stock), never the receipt's old location.
    const moved = warehouseId !== line.warehouse_id;
    const locationId = optionalUuid(entry.warehouseLocationId, "Location") ?? (moved ? null : rejection?.location_id ?? disposition?.location_id ?? line.warehouse_location_id ?? null);
    const billingAllocation = ["unbilled", "billed"].includes(entry.billingAllocation) ? entry.billingAllocation : "auto";
    const other = drafts.get(line.id);
    if (other && !posting) warnings.push(`${label}: ${dec(other.quantity)} is also on draft return${other.numbers.length === 1 ? "" : "s"} ${other.numbers.join(", ")} — whichever posts first is returned.`);
    entries.push({
      line, entered, quantity, reason, notes, rejection, disposition, serials, warehouseId, locationId, billingAllocation,
      baseQuantity: roundMoney(mul(quantity, line.conversion_factor ?? "1"), 6),
      expectedCredit: roundMoney(div(mul(line.order_taxable ?? 0, quantity), line.order_ordered ?? "1"), 2),
    });
  }
  return { entries, warnings, orderId };
}

// validateReturnStockAvailability: for stock lines, the goods are physically where the return takes them from (sales reservations respected).
async function stockIssues(client, context, entries, warehouseId) {
  const issues = [];
  const need = new Map();
  for (const entry of entries) {
    if (entry.line.product_type !== "stock") continue;
    if (entry.warehouseId !== warehouseId) issues.push(`${entry.line.receipt_number} line ${entry.line.line_number}: the goods must leave from the return's warehouse (one warehouse per return).`);
    const key = `${entry.line.product_id}:${entry.locationId ?? ""}:${entry.line.batch_id ?? ""}`;
    const current = need.get(key) ?? { entry, quantity: 0n };
    current.quantity = add(current.quantity, entry.baseQuantity);
    need.set(key, current);
  }
  for (const { entry, quantity } of need.values()) {
    const row = (await client.query(
      `SELECT COALESCE(sum(quantity - reserved_quantity), 0) AS free FROM tenant.stock_balances WHERE organization_id = $1 AND item_id = $2 AND warehouse_id = $3
          AND warehouse_location_id IS NOT DISTINCT FROM $4 AND batch_id IS NOT DISTINCT FROM $5`,
      [context.organizationId, entry.line.product_id, warehouseId, entry.locationId, entry.line.batch_id])).rows[0];
    if (decimal(row.free) < quantity)
      issues.push(`${entry.line.description ?? entry.line.item_code}: only ${dec(decimal(row.free))} is physically available to return at that location (${dec(quantity)} needed) — the rest was used, sold, reserved or moved.`);
  }
  for (const entry of entries.filter((item) => item.serials.length && item.line.product_type === "stock")) {
    for (const serialNumber of entry.serials) {
      const serial = (await client.query(`SELECT status, warehouse_id FROM tenant.stock_serials WHERE organization_id = $1 AND item_id = $2 AND lower(serial_number) = lower($3)`,
        [context.organizationId, entry.line.product_id, serialNumber])).rows[0];
      if (!serial || serial.status !== "available") issues.push(`Serial number ${serialNumber} is not in stock to return.`);
    }
  }
  return issues;
}

async function supplierAddress(client, organizationId, supplierId, addressId) {
  const row = (await client.query(
    `SELECT * FROM tenant.procurement_supplier_addresses WHERE organization_id = $1 AND supplier_id = $2 AND status = 'active' AND ($3::uuid IS NULL OR id = $3)
      ORDER BY (address_type = 'shipping') DESC, is_primary DESC, created_at LIMIT 1`, [organizationId, supplierId, addressId])).rows[0];
  if (addressId && !row) fail("The return-to address is not an active address of the supplier.", "returnToAddressId", "PURCHASE_RETURN_ADDRESS_INVALID", 409);
  return row ? { addressId: row.id, label: row.label, line1: row.line1, line2: row.line2, city: row.city, state: row.state, stateCode: row.state_code, postalCode: row.postal_code,
    countryCode: row.country_code, contactName: row.contact_name ?? null } : null;
}

const HEADER_FIELDS = [["supplierRmaReference", "supplier_rma_reference"], ["carrierReference", "carrier_reference"], ["trackingReference", "tracking_reference"],
  ["dispatchReference", "dispatch_reference"], ["internalNotes", "internal_notes", 2000]];

async function writeLines(client, context, returnId, entries) {
  await client.query(`DELETE FROM tenant.purchase_return_lines WHERE organization_id = $1 AND purchase_return_id = $2`, [context.organizationId, returnId]);
  for (const [index, entry] of entries.entries()) {
    const { line } = entry;
    await client.query(
      `INSERT INTO tenant.purchase_return_lines (organization_id, purchase_return_id, goods_receipt_line_id, purchase_order_line_id, quantity, from_hold, disposition_id, serial_numbers,
         receiving_rejection_id, line_number, return_reason, reason_notes, product_id, product_snapshot, description, uom_snapshot, conversion_factor, base_quantity, warehouse_location_id,
         batch_id, stock_disposition, expected_credit_amount, billing_allocation, entered_uom_id, entered_quantity, entered_conversion_factor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16::jsonb, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`,
      [context.organizationId, returnId, line.id, line.purchase_order_line_id, dec(entry.quantity), Boolean(entry.disposition), entry.disposition?.id ?? null, entry.serials,
        entry.rejection?.id ?? null, index + 1, entry.reason, entry.notes, line.product_id, JSON.stringify(line.product_snapshot ?? { code: line.item_code, name: line.description }),
        line.description, JSON.stringify(line.uom_snapshot ?? null), dec(decimal(line.conversion_factor ?? "1")), dec(entry.baseQuantity), entry.locationId, line.batch_id,
        entry.rejection ? "rejected" : entry.disposition ? entry.disposition.disposition : "usable_stock", dec(entry.expectedCredit), entry.billingAllocation,
        entry.entered?.uomId ?? null, entry.entered ? dec(entry.entered.quantity) : null, entry.entered ? dec(entry.entered.factor) : null]);
  }
}

// The stored lines of a draft as input to buildLines (re-validated against the receipts as they are now).
async function storedEntries(client, organizationId, returnId) {
  const rows = (await client.query(`SELECT * FROM tenant.purchase_return_lines WHERE organization_id = $1 AND purchase_return_id = $2 ORDER BY line_number`, [organizationId, returnId])).rows;
  return rows.map((row) => ({ goodsReceiptLineId: row.goods_receipt_line_id, quantity: formatDecimal(row.quantity), reason: row.return_reason, reasonNotes: row.reason_notes,
    rejectionId: row.receiving_rejection_id ?? undefined, dispositionId: row.receiving_rejection_id ? undefined : row.disposition_id ?? undefined, serialNumbers: row.serial_numbers,
    warehouseLocationId: row.warehouse_location_id ?? undefined, billingAllocation: row.billing_allocation ?? "auto" }));
}

// ---------------------------------------------------------------- create / edit / cancel

// createPurchaseReturn. input: { purchaseOrderId?, warehouseId?, returnDate?, expectedResolution, reason? (summary), returnToAddressId?, supplierRmaReference?,
//   carrierReference?, trackingReference?, dispatchReference?, internalNotes?, lines: [{ goodsReceiptLineId, quantity, reason, reasonNotes?, dispositionId? (held goods),
//   rejectionId? (rejected goods), serialNumbers?, warehouseId? / warehouseLocationId? (where the goods are now), billingAllocation? ("auto" | "unbilled" | "billed") }],
//   post? + dispatchConfirmed? (create and post at once), idempotencyKey? }. A draft: no stock or financial effect.
export async function createPurchaseReturn(client, context, input = {}) {
  requirePermission(context, RETURN_PERMISSIONS.manage, "You do not have permission to return goods to suppliers.");
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "procurement.purchase_return.create", key: text(input.idempotencyKey, 200), payload: { ...input, idempotencyKey: undefined },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const organizationId = context.organizationId;
  const { entries, warnings, orderId } = await buildLines(client, context, input.lines, { orderId: optionalUuid(input.purchaseOrderId, "Purchase order"), defaultReason: input.reasonCode });
  const order = await loadPurchaseOrder(client, orderReader(context), orderId, { lock: true });
  const header = await resolveHeader(client, context, input, { order, entries });
  const number = await nextDocumentNumber(client, { organizationId }, { documentType: "purchase_return", at: new Date(`${header.returnDate}T12:00:00Z`) });
  const row = (await client.query(
    `INSERT INTO tenant.purchase_returns (organization_id, return_number, purchase_order_id, goods_receipt_id, supplier_id, return_date, reason, replacement_expected, created_by,
       document_status, buying_registration_id, warehouse_id, supplier_snapshot, return_to_address_snapshot, expected_resolution, supplier_rma_reference, carrier_reference,
       tracking_reference, dispatch_reference, internal_notes, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16, $17, $18, $19, $9) RETURNING *`,
    [organizationId, number, order.id, entries[0].line.goods_receipt_id, order.supplier_id, header.returnDate, header.reason, header.expectedResolution === "replacement",
      context.userId ?? null, order.buying_registration_id, header.warehouseId, JSON.stringify(header.supplierSnapshot), JSON.stringify(header.address), header.expectedResolution,
      ...HEADER_FIELDS.map(([key, , max]) => text(input[key], max ?? 200))])).rows[0];
  await writeLines(client, context, row.id, entries);
  await recordReturnEvent(client, context, row.id, "purchase_return.created", `Drafted: ${entries.map(({ line, quantity, reason }) => `${line.receipt_number} line ${line.line_number} × ${dec(quantity)} (${REASON_LABELS[reason]})`).join(", ")}`);
  let posted = null;
  if (input.post) posted = await postPurchaseReturn(client, context, row.id, { dispatchConfirmed: input.dispatchConfirmed, dispatchedAt: input.dispatchedAt });
  const response = { id: row.id, returnNumber: number, status: posted ? "posted" : "draft", warnings, replacementPurchaseOrderId: null, replacementNumber: null, replayed: false };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "purchase_return", aggregateId: row.id });
  return response;
}

async function resolveHeader(client, context, input, { order, entries, current = null }) {
  const keep = (key, column) => (has(input, key) ? input[key] : current?.[column]);
  const today = await databaseToday(client);
  const returnDate = readDate(has(input, "returnDate") ? input.returnDate : null, "Return date") ?? dayOf(current?.return_date) ?? today;
  if (returnDate > today) fail("The return date cannot be in the future.", "returnDate", "PURCHASE_RETURN_DATE_INVALID");
  const latestReceipt = entries.map((entry) => dayOf(entry.line.receipt_date)).sort()[entries.length - 1];
  if (returnDate < latestReceipt) fail("The return date cannot be before the goods were received.", "returnDate", "PURCHASE_RETURN_DATE_INVALID");
  const expectedResolution = String(keep("expectedResolution", "expected_resolution") ?? "supplier_credit");
  if (!EXPECTED_RESOLUTIONS[expectedResolution]) fail("Choose what the supplier is expected to do: credit, refund or replace.", "expectedResolution");
  const stockWarehouses = [...new Set(entries.filter((entry) => entry.line.product_type === "stock").map((entry) => entry.warehouseId))];
  const warehouseId = optionalUuid(keep("warehouseId", "warehouse_id"), "Warehouse") ?? stockWarehouses[0] ?? null;
  if (warehouseId) {
    const warehouse = (await client.query(`SELECT status FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [context.organizationId, warehouseId])).rows[0];
    if (!warehouse || warehouse.status !== "active") fail("Choose an active warehouse the goods leave from.", "warehouseId", "PURCHASE_RETURN_WAREHOUSE_INVALID", 409);
    // Goods leave only from a warehouse the user may work in.
    await assertWarehouseAccess(client, context, warehouseId, "Returning warehouse");
  }
  if (stockWarehouses.some((id) => id !== warehouseId))
    fail("A return ships from one warehouse: return the goods of each warehouse on its own return.", "warehouseId", "PURCHASE_RETURN_WAREHOUSE_MIXED", 409);
  const supplier = (await client.query(
    `SELECT supplier.id, supplier.supplier_number, party.display_name, party.legal_name, party.gstin FROM tenant.procurement_suppliers supplier
       JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id WHERE supplier.organization_id = $1 AND supplier.id = $2`,
    [context.organizationId, order.supplier_id])).rows[0];
  const addressId = optionalUuid(input.returnToAddressId, "Return-to address");
  const address = addressId || !current ? await supplierAddress(client, context.organizationId, order.supplier_id, addressId) : current.return_to_address_snapshot;
  const reason = text(keep("reason", "reason"), 1000) ?? [...new Set(entries.map((entry) => REASON_LABELS[entry.reason]))].join(", ");
  return { returnDate, expectedResolution, warehouseId, address, reason,
    supplierSnapshot: { supplierId: supplier.id, supplierNumber: supplier.supplier_number, supplierName: supplier.display_name, legalName: supplier.legal_name ?? supplier.display_name, gstin: supplier.gstin } };
}

// createPurchaseReturnFromGoodsReceipt / FromPurchaseOrder: lines given, or — a full return — every receipt line's usable stock (reasonCode for all).
export async function createPurchaseReturnFromGoodsReceipt(client, context, receiptId, input = {}) {
  const receipt = (await client.query(`SELECT id, purchase_order_id FROM tenant.goods_receipts WHERE organization_id = $1 AND id = $2`, [context.organizationId, requireUuid(receiptId, "Goods receipt")])).rows[0];
  if (!receipt) throw new PurchaseReturnError(404, "Goods receipt not found.", "GOODS_RECEIPT_NOT_FOUND");
  let lines = input.lines;
  if (!Array.isArray(lines) || !lines.length) {
    lines = (await receiptLinesFor(client, context.organizationId, "line.goods_receipt_id = $2", [receipt.id])).filter((line) => line.product_type !== "service")
      .map((line) => ({ goodsReceiptLineId: line.id, quantity: dec(returnableOf(line).usable), reason: input.reasonCode, reasonNotes: input.reasonNotes })).filter((line) => decimal(line.quantity) > 0n);
    if (!lines.length) throw new PurchaseReturnError(409, "Nothing from this receipt is left to return.", "PURCHASE_RETURN_NOTHING_TO_RETURN");
  }
  return createPurchaseReturn(client, context, { ...input, purchaseOrderId: receipt.purchase_order_id, lines });
}
export async function createPurchaseReturnFromPurchaseOrder(client, context, orderId, input = {}) {
  const order = await loadPurchaseOrder(client, orderReader(context), requireUuid(orderId, "Purchase order"));
  return createPurchaseReturn(client, context, { ...input, purchaseOrderId: order.id });
}
// createPurchaseReturnFromRejection: the rejected goods of a post-custody rejection case, from where the case holds them. Returned at once by
// default (the case's "Return to supplier" — the goods leave now); the return resolves the case when it posts.
export async function createPurchaseReturnFromRejection(client, context, rejectionId, input = {}) {
  requirePermission(context, RETURN_PERMISSIONS.manage, "You do not have permission to return goods to suppliers.");
  const rejection = (await client.query(`SELECT * FROM tenant.receiving_rejections WHERE organization_id = $1 AND id = $2`, [context.organizationId, requireUuid(rejectionId, "Rejection")])).rows[0];
  if (!rejection) throw new PurchaseReturnError(404, "Rejection not found.", "REJECTION_NOT_FOUND");
  if (rejection.rejection_stage !== "after_custody")
    throw new PurchaseReturnError(409, "These goods were refused at the dock and never received: nothing is returned. Record the replacement, or cancel the quantity.", "REJECTION_RESOLUTION_INVALID");
  if (rejection.status !== "open") throw new PurchaseReturnError(409, `${rejection.rejection_number} is ${rejection.status}.`, "REJECTION_LOCKED");
  const quantity = input.quantity ? readQuantity(input.quantity, "Quantity returned") : blockedQuantityOf(rejection);
  const result = await createPurchaseReturn(client, context, {
    reason: text(input.reason ?? input.notes, 1000) ?? `Rejected on ${rejection.rejection_number}`, returnDate: input.returnDate, idempotencyKey: input.idempotencyKey,
    expectedResolution: input.expectedResolution ?? "supplier_credit", post: input.post ?? true, dispatchConfirmed: input.dispatchConfirmed ?? true,
    lines: [{ goodsReceiptLineId: rejection.goods_receipt_line_id, quantity: dec(quantity), rejectionId: rejection.id, serialNumbers: input.serialNumbers,
      reason: input.returnReason ?? "failed_quality_inspection", reasonNotes: text(input.reason ?? input.notes, 1000) ?? `Rejected on ${rejection.rejection_number}` }],
  });
  return { id: rejection.id, type: "purchase_return_posted", returnId: result.id, returnNumber: result.returnNumber, status: result.status, quantity: dec(quantity), replayed: result.replayed };
}

// updateDraftPurchaseReturn: header fields and (when given) the lines, re-validated. input as createPurchaseReturn + expectedVersion?.
export async function updateDraftPurchaseReturn(client, context, returnId, input = {}) {
  requirePermission(context, RETURN_PERMISSIONS.manage, "You do not have permission to edit purchase returns.");
  const current = await loadReturn(client, context, returnId, { lock: true });
  if (current.document_status !== "draft") throw new PurchaseReturnError(409, "Only a draft return can be changed.", "PURCHASE_RETURN_LOCKED");
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(current.version))
    throw new PurchaseReturnError(409, "Someone else changed this return. Reload it and enter your change again.", "PURCHASE_RETURN_STALE");
  const requested = Array.isArray(input.lines) && input.lines.length ? input.lines : await storedEntries(client, context.organizationId, current.id);
  const { entries, warnings } = await buildLines(client, context, requested, { orderId: current.purchase_order_id, excludeReturnId: current.id,
    warehouseId: has(input, "warehouseId") ? optionalUuid(input.warehouseId, "Warehouse") : current.warehouse_id });
  const order = await loadPurchaseOrder(client, orderReader(context), current.purchase_order_id, { lock: true });
  const header = await resolveHeader(client, context, input, { order, entries, current });
  await client.query(
    `UPDATE tenant.purchase_returns SET return_date = $3, reason = $4, expected_resolution = $5, replacement_expected = $5 = 'replacement', warehouse_id = $6, return_to_address_snapshot = $7::jsonb,
       supplier_rma_reference = $8, carrier_reference = $9, tracking_reference = $10, dispatch_reference = $11, internal_notes = $12, goods_receipt_id = $13, version = version + 1,
       updated_by = $14, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, current.id, header.returnDate, header.reason, header.expectedResolution, header.warehouseId, JSON.stringify(header.address),
      ...HEADER_FIELDS.map(([key, column, max]) => (has(input, key) ? text(input[key], max ?? 200) : current[column])), entries[0].line.goods_receipt_id, context.userId ?? null]);
  await writeLines(client, context, current.id, entries);
  await recordReturnEvent(client, context, current.id, "purchase_return.edited", "Draft edited");
  return { id: current.id, version: Number(current.version) + 1, warnings };
}

export async function cancelDraftPurchaseReturn(client, context, returnId, input = {}) {
  requirePermission(context, RETURN_PERMISSIONS.manage, "You do not have permission to cancel purchase returns.");
  const current = await loadReturn(client, context, returnId, { lock: true });
  if (current.document_status === "cancelled") return { id: current.id, status: "cancelled", replayed: true };
  if (current.document_status !== "draft") throw new PurchaseReturnError(409, "Only a draft return is cancelled; a posted return is reversed when the goods come back.", "PURCHASE_RETURN_LOCKED");
  const reason = text(input.reason, 1000);
  await client.query(`UPDATE tenant.purchase_returns SET document_status = 'cancelled', cancelled_by = $3, cancelled_at = now(), cancel_reason = $4, updated_at = now(), version = version + 1
     WHERE organization_id = $1 AND id = $2`, [context.organizationId, current.id, context.userId ?? null, reason]);
  await recordReturnEvent(client, context, current.id, "purchase_return.cancelled", `Cancelled${reason ? `: ${reason}` : ""}`);
  return { id: current.id, status: "cancelled", replayed: false };
}

// ---------------------------------------------------------------- validate / post

// validatePurchaseReturnForPosting: everything posting checks, without posting. Returns { ready, issues, warnings }.
export async function validatePurchaseReturnForPosting(client, context, returnId) {
  const current = await loadReturn(client, context, returnId);
  const issues = [];
  let warnings = [];
  if (current.document_status !== "draft") issues.push(`The return is ${current.document_status}.`);
  try {
    const built = await buildLines(client, context, await storedEntries(client, context.organizationId, current.id), { orderId: current.purchase_order_id, excludeReturnId: current.id, warehouseId: current.warehouse_id });
    warnings = built.warnings;
    issues.push(...await stockIssues(client, context, built.entries, current.warehouse_id));
  } catch (error) {
    if (!(error instanceof PurchaseReturnError)) throw error;
    issues.push(error.message);
  }
  return { ready: issues.length === 0, issues, warnings };
}

// postPurchaseReturn: the goods physically left. input: { dispatchConfirmed (required), dispatchedAt?, carrierReference?, trackingReference?, dispatchReference? }.
// Under the receipt lines' locks: re-validated against posted returns and actual stock, Inventory's outbound movements (exactly once — a
// retry returns the posted return), the rejection case / held goods updated, the returned quantities allocated to billed or unbilled goods,
// GRNI cleared when receipts accrue. Nothing is posted if any of it fails.
export async function postPurchaseReturn(client, context, returnId, input = {}) {
  requirePermission(context, RETURN_PERMISSIONS.post, "You do not have permission to post purchase returns.");
  const current = await loadReturn(client, context, returnId, { lock: true });
  if (current.document_status === "posted") return { id: current.id, status: "posted", replayed: true };
  if (current.document_status !== "draft") throw new PurchaseReturnError(409, `The return is ${current.document_status}.`, "PURCHASE_RETURN_LOCKED");
  if (input.dispatchConfirmed !== true)
    throw new PurchaseReturnError(409, "Confirm that the goods have physically left (handed to the supplier or the carrier) before posting the return.", "PURCHASE_RETURN_DISPATCH_NOT_CONFIRMED");
  const organizationId = context.organizationId;
  const order = await loadPurchaseOrder(client, orderReader(context), current.purchase_order_id, { lock: true });
  const { entries } = await buildLines(client, context, await storedEntries(client, organizationId, current.id), { orderId: order.id, excludeReturnId: current.id, lock: true, posting: true,
    warehouseId: current.warehouse_id });
  const issues = await stockIssues(client, context, entries, current.warehouse_id);
  if (issues.length) throw new PurchaseReturnError(409, issues[0], "PURCHASE_RETURN_STOCK_UNAVAILABLE", { issues: issues.map((message) => ({ message })) });
  const dispatchedAt = input.dispatchedAt ? new Date(input.dispatchedAt) : new Date();
  if (Number.isNaN(dispatchedAt.getTime()) || dispatchedAt > new Date(Date.now() + 60_000)) fail("Enter when the goods left (not in the future).", "dispatchedAt");
  const stored = (await client.query(`SELECT * FROM tenant.purchase_return_lines WHERE organization_id = $1 AND purchase_return_id = $2 ORDER BY line_number`, [organizationId, current.id])).rows;
  const stock = stockContextFor(context);
  const movementsByLine = [];
  for (const [index, entry] of entries.entries()) {
    const storedLine = stored[index];
    const { line, quantity, disposition, rejection, serials } = entry;
    const movements = [];
    if (line.product_type === "stock") {
      const base = { movementType: "issue", itemId: line.product_id, warehouseId: current.warehouse_id, warehouseLocationId: entry.locationId, batchId: line.batch_id,
        referenceType: "purchase_return", referenceId: current.id, reason: `${current.return_number} · return to supplier (${line.receipt_number}) · ${REASON_LABELS[entry.reason]}` };
      try {
        if (line.tracking_type === "serial") {
          for (const serialNumber of serials) {
            const serial = (await client.query(`SELECT id FROM tenant.stock_serials WHERE organization_id = $1 AND item_id = $2 AND lower(serial_number) = lower($3) AND status = 'available'`,
              [organizationId, line.product_id, serialNumber])).rows[0];
            if (!serial) fail(`Serial number ${serialNumber} is not in stock.`, "serialNumbers", "PURCHASE_RETURN_SERIAL_INVALID", 409);
            movements.push((await postStockMovement(client, stock, { ...base, serialId: serial.id, quantity: "1", idempotencyKey: `prn:${current.id}:${storedLine.id}:${serial.id}` })).id);
          }
        } else {
          movements.push((await postStockMovement(client, stock, { ...base, quantity: dec(entry.baseQuantity), idempotencyKey: `prn:${current.id}:${storedLine.id}` })).id);
        }
      } catch (error) {
        if (error instanceof StockError) throw new PurchaseReturnError(error.status, `${line.receipt_number} line ${line.line_number}: ${error.message}`, error.code);
        throw error;
      }
    }
    await client.query(`UPDATE tenant.purchase_return_lines SET stock_movement_ids = $3, warehouse_location_id = $4 WHERE organization_id = $1 AND id = $2`,
      [organizationId, storedLine.id, movements, entry.locationId]);
    if (rejection) {
      await applyResolution(client, context, rejection, { type: "purchase_return_posted", quantity, notes: `Returned on ${current.return_number}: ${REASON_LABELS[entry.reason]}`,
        documentType: "purchase_return", documentId: current.id, movementIds: movements, counter: "returned_quantity" });
      await recordRejectionEvent(client, context, rejection.id, "rejection.returned", `${dec(quantity)} returned to the supplier on ${current.return_number}`, { returnId: current.id });
    }
    if (disposition) {
      await client.query(`UPDATE tenant.goods_receipt_dispositions SET returned_quantity = returned_quantity + $3, blocked_quantity = blocked_quantity - $4, updated_at = now()
                           WHERE organization_id = $1 AND id = $2`, [organizationId, disposition.id, dec(quantity), dec(rejection ? quantity : 0n)]);
      await client.query(`INSERT INTO tenant.goods_receipt_disposition_events (organization_id, disposition_id, action, quantity, stock_movement_ids, note, actor_user_id) VALUES ($1, $2, 'returned', $3, $4, $5, $6)`,
        [organizationId, disposition.id, dec(quantity), movements, `${current.return_number}: ${REASON_LABELS[entry.reason]}`, context.userId ?? null]);
    }
    movementsByLine.push({ storedLine, entry, movements });
  }
  await allocateToBilling(client, context, current, movementsByLine);
  const orderLines = new Map((await client.query(`SELECT * FROM tenant.purchase_order_lines WHERE organization_id = $1 AND purchase_order_id = $2`, [organizationId, order.id])).rows.map((row) => [row.id, row]));
  const accrual = await postReturnAccrual(client, context, { ...current, dispatch_date: current.return_date }, order,
    entries.map((entry) => ({ receiptLine: entry.line, orderLine: orderLines.get(entry.line.purchase_order_line_id), quantity: entry.quantity })));
  await client.query(
    `UPDATE tenant.purchase_returns SET document_status = 'posted', posted_by = $3, posted_at = now(), dispatched_at = $4, accrual_journal_entry_id = $5,
       carrier_reference = COALESCE($6, carrier_reference), tracking_reference = COALESCE($7, tracking_reference), dispatch_reference = COALESCE($8, dispatch_reference),
       version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [organizationId, current.id, context.userId ?? null, dispatchedAt.toISOString(), accrual?.journalEntryId ?? null, text(input.carrierReference, 200), text(input.trackingReference, 200),
      text(input.dispatchReference, 200)]);
  const summary = `Purchase return ${current.return_number}: ${entries.map(({ line, quantity }) => `line ${line.order_line_number} × ${dec(quantity)}`).join(", ")}`;
  for (const receiptId of new Set(entries.map((entry) => entry.line.goods_receipt_id)))
    await recordReceiptEvent(client, context, receiptId, "goods_receipt.returned", summary, { returnId: current.id });
  await recordPoEvent(client, context, order.id, "purchase_order.goods_returned", summary, { details: { returnId: current.id, returnNumber: current.return_number } });
  await recordReturnEvent(client, context, current.id, "purchase_return.posted", `Posted — goods dispatched ${dispatchedAt.toISOString().slice(0, 16).replace("T", " ")}${accrual ? ` · GRNI cleared ${accrual.amount}` : ""}`,
    { movements: movementsByLine.flatMap((entry) => entry.movements), accrual });
  return { id: current.id, status: "posted", movementIds: movementsByLine.flatMap((entry) => entry.movements), replayed: false };
}

// The returned quantity of each line against billing (getReturnBillingAllocations): what was not billed yet (it will simply not be billed)
// and what posted bills had billed — bill line by bill line — which a vendor credit corrects. "unbilled" / "billed" choose; "auto"
// takes the unbilled goods first.
async function allocateToBilling(client, context, purchaseReturn, posted) {
  const organizationId = context.organizationId;
  for (const { storedLine, entry } of posted) {
    const orderLineId = entry.line.purchase_order_line_id;
    const billLines = (await client.query(
      `SELECT line.id, line.vendor_bill_id, line.quantity, line.net_amount, bill.bill_number,
              COALESCE((SELECT sum(allocation.allocated_quantity) FROM tenant.purchase_return_financial_allocations allocation
                         JOIN tenant.purchase_returns other ON other.organization_id = allocation.organization_id AND other.id = allocation.purchase_return_id
                        WHERE allocation.organization_id = line.organization_id AND allocation.supplier_bill_line_id = line.id AND allocation.allocation_type = 'billed'
                          AND other.document_status = 'posted'), 0) AS returned
         FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = line.organization_id AND bill.id = line.vendor_bill_id
        WHERE line.organization_id = $1 AND line.purchase_order_line_id = $2 AND bill.bill_type = 'bill' AND bill.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')
          AND line.billing_basis = 'quantity' ORDER BY bill.accounting_date, bill.bill_number`, [organizationId, orderLineId])).rows;
    const billed = billLines.reduce((total, row) => add(total, row.quantity), 0n);
    const billedLeft = billLines.reduce((total, row) => add(total, sub(row.quantity, row.returned) > 0n ? sub(row.quantity, row.returned) : 0n), 0n);
    const progress = (await client.query(`SELECT received_quantity FROM tenant.purchase_order_line_status WHERE organization_id = $1 AND purchase_order_line_id = $2`, [organizationId, orderLineId])).rows[0];
    const unbilledBefore = (await client.query(
      `SELECT COALESCE(sum(allocation.allocated_quantity), 0) AS quantity FROM tenant.purchase_return_financial_allocations allocation
         JOIN tenant.purchase_return_lines return_line ON return_line.organization_id = allocation.organization_id AND return_line.id = allocation.purchase_return_line_id
         JOIN tenant.purchase_returns other ON other.organization_id = allocation.organization_id AND other.id = allocation.purchase_return_id
        WHERE allocation.organization_id = $1 AND return_line.purchase_order_line_id = $2 AND allocation.allocation_type = 'unbilled' AND other.document_status = 'posted'`,
      [organizationId, orderLineId])).rows[0].quantity;
    // Received (posted, including what this return takes) less billed less what earlier returns already took from the unbilled goods.
    let unbilledLeft = sub(sub(progress?.received_quantity ?? 0, billed), unbilledBefore);
    if (unbilledLeft < 0n) unbilledLeft = 0n;
    const label = `${entry.line.receipt_number} line ${entry.line.line_number}`;
    let toUnbilled; let toBilled;
    if (entry.billingAllocation === "unbilled") {
      if (entry.quantity > unbilledLeft)
        throw new PurchaseReturnError(409, `${label}: only ${dec(unbilledLeft)} of these goods is not billed yet; the rest was billed — allocate it to the billed goods so Finance corrects the bill.`,
          "PURCHASE_RETURN_ALLOCATION_INVALID");
      toUnbilled = entry.quantity; toBilled = 0n;
    } else if (entry.billingAllocation === "billed") {
      if (entry.quantity > billedLeft) throw new PurchaseReturnError(409, `${label}: only ${dec(billedLeft)} of these goods is billed and not yet returned.`, "PURCHASE_RETURN_ALLOCATION_INVALID");
      toUnbilled = 0n; toBilled = entry.quantity;
    } else {
      toUnbilled = entry.quantity < unbilledLeft ? entry.quantity : unbilledLeft;
      toBilled = sub(entry.quantity, toUnbilled);
      if (toBilled > billedLeft) { toUnbilled = add(toUnbilled, sub(toBilled, billedLeft)); toBilled = billedLeft; }
    }
    const value = (quantity) => roundMoney(div(mul(entry.line.order_taxable ?? 0, quantity), entry.line.order_ordered ?? "1"), 2);
    if (toUnbilled > 0n)
      await client.query(`INSERT INTO tenant.purchase_return_financial_allocations (organization_id, purchase_return_id, purchase_return_line_id, allocation_type, allocated_quantity, allocated_value, created_by)
         VALUES ($1, $2, $3, 'unbilled', $4, $5, $6)`, [organizationId, purchaseReturn.id, storedLine.id, dec(toUnbilled), dec(value(toUnbilled)), context.userId ?? null]);
    let left = toBilled;
    for (const row of billLines) {
      if (left <= 0n) break;
      const open = sub(row.quantity, row.returned);
      if (open <= 0n) continue;
      const take = open < left ? open : left;
      await client.query(
        `INSERT INTO tenant.purchase_return_financial_allocations (organization_id, purchase_return_id, purchase_return_line_id, allocation_type, supplier_bill_id, supplier_bill_line_id,
           allocated_quantity, allocated_value, created_by) VALUES ($1, $2, $3, 'billed', $4, $5, $6, $7, $8)`,
        [organizationId, purchaseReturn.id, storedLine.id, row.vendor_bill_id, row.id, dec(take), dec(roundMoney(div(mul(row.net_amount, take), row.quantity), 2)), context.userId ?? null]);
      left = sub(left, take);
    }
  }
}

// ---------------------------------------------------------------- reverse

// reversePostedPurchaseReturn: the goods came back (the supplier refused them, the carrier brought them back). input: { reason, goodsReceivedBack: true,
// receivedBackAt? }. An inbound correction puts them back where they left from, the GRNI clearing is reversed and the return no longer counts.
// Not when Finance or the supplier already acted on it (a vendor credit, refund or replacement) or it settled a quality case.
export async function reversePostedPurchaseReturn(client, context, returnId, input = {}) {
  requirePermission(context, RETURN_PERMISSIONS.reverse, "You do not have permission to reverse purchase returns.");
  const current = await loadReturn(client, context, returnId, { lock: true });
  if (current.document_status === "reversed") return { id: current.id, status: "reversed", replayed: true };
  if (current.document_status !== "posted") throw new PurchaseReturnError(409, "Only a posted return is reversed.", "PURCHASE_RETURN_LOCKED");
  const reason = text(input.reason, 1000);
  if (!reason || reason.length < 5) fail("Give the reason for the reversal.", "reason");
  if (input.goodsReceivedBack !== true)
    throw new PurchaseReturnError(409, "A posted return is reversed only when the goods physically came back: confirm they were received back. Otherwise record the supplier's resolution.",
      "PURCHASE_RETURN_GOODS_NOT_BACK");
  const organizationId = context.organizationId;
  const blockers = (await client.query(
    `SELECT (SELECT count(*) FROM tenant.purchase_return_financial_allocations allocation JOIN tenant.accounting_vendor_bills credit ON credit.organization_id = allocation.organization_id
                AND credit.id = allocation.debit_note_id WHERE allocation.organization_id = $1 AND allocation.purchase_return_id = $2 AND allocation.allocation_type = 'debit_note'
                AND credit.status NOT IN ('cancelled', 'reversed'))::int AS credits,
            (SELECT count(*) FROM tenant.purchase_return_resolutions WHERE organization_id = $1 AND purchase_return_id = $2)::int AS resolutions,
            (SELECT count(*) FROM tenant.purchase_return_lines WHERE organization_id = $1 AND purchase_return_id = $2 AND receiving_rejection_id IS NOT NULL)::int AS rejections,
            (SELECT count(*) FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND source_purchase_return_id = $2 AND status NOT IN ('cancelled', 'reversed'))::int AS notes`,
    [organizationId, current.id])).rows[0];
  if (blockers.credits || blockers.notes) throw new PurchaseReturnError(409, "A vendor credit corrects this return: Finance reverses (or cancels) it first.", "PURCHASE_RETURN_IN_USE");
  if (blockers.resolutions) throw new PurchaseReturnError(409, "The supplier's resolution is recorded on this return: it cannot be reversed.", "PURCHASE_RETURN_IN_USE");
  if (blockers.rejections) throw new PurchaseReturnError(409, "This return resolved a quality rejection case: the goods coming back are received as a new receipt.", "PURCHASE_RETURN_IN_USE");
  const lines = (await client.query(
    `SELECT return_line.*, receipt_line.product_type, receipt_line.warehouse_id, item.tracking_type FROM tenant.purchase_return_lines return_line
       JOIN tenant.goods_receipt_lines receipt_line ON receipt_line.organization_id = return_line.organization_id AND receipt_line.id = return_line.goods_receipt_line_id
       LEFT JOIN tenant.items item ON item.organization_id = return_line.organization_id AND item.id = return_line.product_id
      WHERE return_line.organization_id = $1 AND return_line.purchase_return_id = $2 ORDER BY return_line.line_number`, [organizationId, current.id])).rows;
  const stock = stockContextFor(context);
  const movements = [];
  for (const line of lines) {
    if (line.product_type !== "stock") continue;
    const base = { movementType: "receipt", itemId: line.product_id, warehouseId: current.warehouse_id, warehouseLocationId: line.warehouse_location_id, batchId: line.batch_id,
      referenceType: "purchase_return_reversal", referenceId: current.id, reason: `${current.return_number} reversed — goods back from the supplier: ${reason}` };
    try {
      if (line.tracking_type === "serial") {
        for (const serialNumber of line.serial_numbers) {
          const serial = (await client.query(`SELECT id FROM tenant.stock_serials WHERE organization_id = $1 AND item_id = $2 AND lower(serial_number) = lower($3)`,
            [organizationId, line.product_id, serialNumber])).rows[0];
          movements.push((await postStockMovement(client, stock, { ...base, serialId: serial?.id, quantity: "1", idempotencyKey: `prn-rev:${current.id}:${line.id}:${serialNumber}` })).id);
        }
      } else {
        movements.push((await postStockMovement(client, stock, { ...base, quantity: formatDecimal(line.base_quantity ?? line.quantity), idempotencyKey: `prn-rev:${current.id}:${line.id}` })).id);
      }
    } catch (error) {
      if (error instanceof StockError) throw new PurchaseReturnError(error.status, `Line ${line.line_number}: ${error.message}`, error.code);
      throw error;
    }
    if (line.disposition_id)
      await client.query(`UPDATE tenant.goods_receipt_dispositions SET returned_quantity = returned_quantity - $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
        [organizationId, line.disposition_id, formatDecimal(line.quantity)]);
  }
  const accrualReversal = await reverseReturnAccrual(client, context, current, reason);
  await client.query(`UPDATE tenant.purchase_returns SET document_status = 'reversed', reversed_by = $3, reversed_at = now(), reversal_reason = $4, version = version + 1, updated_at = now()
     WHERE organization_id = $1 AND id = $2`, [organizationId, current.id, context.userId ?? null, reason]);
  await recordReturnEvent(client, context, current.id, "purchase_return.reversed", `Reversed — goods received back: ${reason}`, { movements, accrualReversal });
  await recordPoEvent(client, context, current.purchase_order_id, "purchase_order.return_reversed", `Purchase return ${current.return_number} reversed: ${reason}`, { details: { returnId: current.id } });
  return { id: current.id, status: "reversed", movementIds: movements, replayed: false };
}
