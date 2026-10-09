// Receiving rejections (Rejected Receipts): goods that cannot be accepted,
// recorded as a case against the purchase order line — and, once the goods
// were taken into custody, against the posted goods receipt line. A case
// never moves stock or posts accounting by itself; it delegates:
//
//   refused at the dock     no stock, never received; the order still owes it.
//                           Resolved by a replacement arriving on a normal
//                           receipt, by cancelling the outstanding quantity,
//                           or by closing the refusal.
//   rejected after receipt  the posted receipt stays as it is. Held goods are
//                           already in the quality location (Quality's
//                           decision blocks them); usable goods are moved
//                           there by an Inventory transfer. Resolved by a
//                           purchase return, an authorised disposal (an
//                           Inventory issue) or an exceptional acceptance
//                           back into usable stock.
//
// Supplier bills are never changed: the mismatch is shown, and Finance
// corrects it with a debit note.
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { add, decimal, div, formatDecimal, mul, roundMoney, sub } from "../../../core/decimal.js";
import { StockError, moveStockWithinWarehouse, postStockMovement } from "../../stock/index.js";
import { dispositionAt, internalMoveTypes } from "../../stock/ledger-posting.js";
import { loadPurchaseOrder, poCan, requirePoPermission } from "./access.js";
import { PO_PERMISSIONS, PurchaseOrderError, STATUS, fail, has, optionalUuid, requireUuid, text } from "./constants.js";
import { cancelRemainingPurchaseOrderQty } from "./lifecycle.js";
import { recordPoEvent } from "./persist.js";
import { assertWarehouseOperation, orderLinesById, qualityLocation, receiptLineCaseFields, recordReceiptEvent, stockContextFor } from "./receipts.js";
import { createPurchaseReturnFromRejection } from "../purchase-returns/returns.js";
import {
  RESOLUTION_TYPES, applyResolution, blockedQuantityOf, loadRejection, openQuantityOf, openRejectionCase, readExpectedResolution, readRejectionReason, reasonLabel,
  recordRejectionEvent, requireRejectionAccess,
} from "./rejection-core.js";
import { carryNegativeStock } from "../../stock/negative-stock-control.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const QTY = /^\d+(?:\.\d{1,6})?$/;
const ONE = decimal(1);

function readQuantity(value, label, { required = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) fail(`Enter the ${label.toLowerCase()}.`, "quantity", "REJECTION_QUANTITY_INVALID");
    return null;
  }
  const raw = String(value).trim();
  if (!QTY.test(raw) || decimal(raw) <= 0n) fail(`${label} must be more than zero.`, "quantity", "REJECTION_QUANTITY_INVALID");
  return decimal(raw);
}
function checkPlaces(quantity, places, label) {
  if (roundMoney(quantity, places) !== quantity) fail(`${label}: the unit allows ${places} decimal place${places === 1 ? "" : "s"}.`, "quantity", "REJECTION_QUANTITY_INVALID");
}
function readObservedAt(value) {
  if (!value) return new Date().toISOString();
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) fail("Enter when the problem was found.", "observedAt");
  if (when.getTime() > Date.now() + 5 * 60_000) fail("The rejection cannot be dated in the future.", "observedAt");
  return when.toISOString();
}
async function readReporter(client, context, value) {
  const userId = optionalUuid(value, "Reported by");
  if (!userId) return context.userId ?? null;
  const member = (await client.query(`SELECT 1 FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`, [context.organizationId, userId])).rows[0];
  if (!member) fail("Whoever reported the rejection must be an active member of the workspace.", "reportedByUserId", "REJECTION_REPORTER_INVALID", 409);
  return userId;
}
async function stocked(work, label = "") {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StockError) throw carryNegativeStock(error, new PurchaseOrderError(error.status === 400 ? 409 : error.status, `${label}${error.message}`, error.code));
    throw error;
  }
}
const serialsOf = (value) => (Array.isArray(value) ? value : String(value ?? "").split(/[\s,;]+/)).map((entry) => text(entry, 120)).filter(Boolean);

// Files already attached to the receipt may be cited as evidence when a case is opened.
async function readEvidence(client, context, input, receiptId) {
  const ids = [...new Set((Array.isArray(input.evidenceFileIds) ? input.evidenceFileIds : []).map((id) => requireUuid(id, "File")))];
  if (!ids.length) return [];
  const found = (await client.query(
    `SELECT id FROM public.attachments WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL
        AND ((entity_type = 'procurement.goods_receipt' AND entity_id = $3::text) OR entity_type = 'procurement.receiving_rejection')`,
    [context.organizationId, ids, receiptId ?? "00000000-0000-0000-0000-000000000000"])).rows;
  if (found.length !== ids.length) fail("Evidence must be files attached to the goods receipt or to the rejection.", "evidenceFileIds", "REJECTION_FILE_NOT_FOUND", 409);
  return ids;
}

// ---------------------------------------------------------------- refused at the dock

// recordDockRejection: goods refused before they entered custody, for one or several lines of a confirmed order, with or without a goods receipt
// (a whole shipment may be refused). input: { observedAt?, reportedByUserId?, warehouseId?, expectedResolution?, evidenceFileIds?, idempotencyKey?,
// lines: [{ purchaseOrderLineId, productId?, refusedQuantity, presentedQuantity?, reason, reasonTags?, description?, deliveredProductDescription?, batchNumber? }] }
export async function recordDockRejection(client, context, orderId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.rejectionsRecord, "You do not have permission to record receiving rejections.");
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "procurement.rejection.dock", key: text(input.idempotencyKey, 200), payload: { orderId, ...input, idempotencyKey: undefined },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const order = await loadPurchaseOrder(client, context, orderId, { lock: true });
  if (order.status !== STATUS.confirmed)
    throw new PurchaseOrderError(409, `Deliveries are received (or refused) only against a confirmed order; this one is ${order.status}.`, "REJECTION_ORDER_NOT_CONFIRMED");
  const warehouseId = optionalUuid(input.warehouseId, "Warehouse") ?? order.default_warehouse_id ?? null;
  if (warehouseId) await assertWarehouseOperation(client, context, warehouseId, "receive", "Receiving warehouse");
  if (!Array.isArray(input.lines) || !input.lines.length) fail("Choose the lines whose goods were refused.", "lines");
  const lines = await orderLinesById(client, context.organizationId, order.id);
  const observedAt = readObservedAt(input.observedAt);
  const reportedByUserId = await readReporter(client, context, input.reportedByUserId);
  const expectedResolution = readExpectedResolution(input.expectedResolution ?? "replacement_expected", "before_custody");
  const evidenceFileIds = await readEvidence(client, context, input, null);
  const seen = new Set();
  const entries = [];
  for (const entry of input.lines) {
    const line = lines.get(requireUuid(entry.purchaseOrderLineId, "Order line"));
    if (!line) throw new PurchaseOrderError(404, "That line is not on this order.", "PURCHASE_ORDER_LINE_NOT_FOUND");
    const label = `Line ${line.line_number}`;
    if (seen.has(line.id)) fail(`${label} is entered twice.`, "purchaseOrderLineId");
    seen.add(line.id);
    if (line.product_type === "service") fail(`${label} is a service; services are not delivered to the dock.`, "purchaseOrderLineId", "REJECTION_SERVICE_LINE", 409);
    const reason = readRejectionReason(entry);
    // No substitution: an unexpected product is described on the ordered line's refusal, never received as the ordered product.
    if (entry.productId && entry.productId !== line.product_id)
      fail(`${label}: the goods delivered are not ${line.description}. Refuse them as a wrong product and describe what arrived.`, "productId", "GOODS_RECEIPT_PRODUCT_MISMATCH", 409);
    if (reason.reason === "wrong_product" && !text(entry.deliveredProductDescription, 500)) fail(`${label}: describe the product that was delivered instead.`, "deliveredProductDescription");
    const quantity = readQuantity(entry.refusedQuantity ?? entry.quantity, `${label} refused quantity`);
    const presented = readQuantity(entry.presentedQuantity, `${label} presented quantity`, { required: false });
    if (presented !== null && quantity > presented) fail(`${label}: more cannot be refused (${dec(quantity)}) than was presented (${dec(presented)}).`, "presentedQuantity", "REJECTION_EXCEEDS_PRESENTED");
    checkPlaces(quantity, Number(line.decimal_places ?? 6), label);
    entries.push({ line, quantity, presented, reason, deliveredProductDescription: text(entry.deliveredProductDescription, 500), batchNumber: text(entry.batchNumber, 120) });
  }
  const cases = [];
  for (const { line, quantity, presented, reason, deliveredProductDescription, batchNumber } of entries) {
    cases.push(await openRejectionCase(client, context, {
      purchaseOrderId: order.id, purchaseOrderLineId: line.id, supplierId: order.supplier_id, warehouseId, productId: line.product_id, productType: line.product_type,
      productSnapshot: line.product_snapshot, descriptionSnapshot: line.description, stage: "before_custody", stockSource: "dock", reason: reason.reason, tags: reason.tags,
      description: reason.description, presentedQuantity: presented, quantity, uomId: line.purchase_uom_id, uomSnapshot: line.uom_snapshot, conversionFactor: line.conversion_factor,
      batchNumber, deliveredProductDescription, expectedResolution, evidenceFileIds, observedAt, reportedByUserId,
    }));
  }
  await recordPoEvent(client, context, order.id, "purchase_order.goods_refused",
    `Refused at the dock: ${entries.map(({ line, quantity, reason }) => `line ${line.line_number} × ${dec(quantity)} (${reasonLabel(reason.reason)})`).join(", ")} — ${cases.map((entry) => entry.rejectionNumber).join(", ")}. Still owed.`,
    { details: { rejectionIds: cases.map((entry) => entry.id) } });
  const response = { cases: cases.map(({ id, rejectionNumber }) => ({ id, rejectionNumber })), replayed: false };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "purchase_order", aggregateId: order.id });
  return response;
}

// ---------------------------------------------------------------- rejected after receipt

async function lockReceiptLine(client, context, receiptLineId) {
  const line = (await client.query(
    `SELECT line.*, item.tracking_type, item.track_inventory FROM tenant.goods_receipt_lines line
       LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.product_id
      WHERE line.organization_id = $1 AND line.id = $2 FOR UPDATE OF line`, [context.organizationId, requireUuid(receiptLineId, "Receipt line")])).rows[0];
  if (!line) throw new PurchaseOrderError(404, "Receipt line not found.", "GOODS_RECEIPT_LINE_INVALID");
  const receipt = (await client.query(`SELECT * FROM tenant.goods_receipts WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, line.goods_receipt_id])).rows[0];
  const order = await loadPurchaseOrder(client, context, receipt.purchase_order_id);
  if (receipt.status !== "posted" || receipt.reversed_at)
    throw new PurchaseOrderError(409, "Goods are rejected after receipt only from a posted (and not reversed) goods receipt.", "REJECTION_RECEIPT_NOT_POSTED");
  return { line, receipt, order };
}

// getEligibleRejectableQuantity: what of a posted receipt line may still be rejected — usable stock from it (not returned or already rejected),
// and each held lot still undecided.
export async function getEligibleRejectableQuantity(client, context, receiptLineId) {
  requireRejectionAccess(context);
  const line = (await client.query(`SELECT * FROM tenant.goods_receipt_lines WHERE organization_id = $1 AND id = $2`, [context.organizationId, requireUuid(receiptLineId, "Receipt line")])).rows[0];
  if (!line) throw new PurchaseOrderError(404, "Receipt line not found.", "GOODS_RECEIPT_LINE_INVALID");
  return eligibleFor(client, context.organizationId, line);
}

async function eligibleFor(client, organizationId, line) {
  const row = (await client.query(
    `SELECT (SELECT COALESCE(sum(released_quantity), 0) FROM tenant.goods_receipt_dispositions WHERE organization_id = $1 AND goods_receipt_line_id = $2) AS released,
            (SELECT COALESCE(sum(quantity) FILTER (WHERE disposition_id IS NULL AND NOT from_hold), 0) FROM tenant.purchase_return_lines return_line WHERE organization_id = $1 AND goods_receipt_line_id = $2
               AND EXISTS (SELECT 1 FROM tenant.purchase_returns posted_return WHERE posted_return.organization_id = return_line.organization_id AND posted_return.id = return_line.purchase_return_id AND posted_return.document_status = 'posted')) AS returned_from_stock,
            (SELECT COALESCE(sum(rejected_quantity - released_quantity - returned_quantity), 0) FROM tenant.receiving_rejections
              WHERE organization_id = $1 AND goods_receipt_line_id = $2 AND stock_source = 'usable_stock' AND status <> 'cancelled') AS rejected_from_stock`,
    [organizationId, line.id])).rows[0];
  const holds = (await client.query(
    `SELECT id, disposition, quantity - released_quantity - returned_quantity - disposed_quantity - blocked_quantity AS undecided, quality_inspection_id
       FROM tenant.goods_receipt_dispositions WHERE organization_id = $1 AND goods_receipt_line_id = $2 ORDER BY created_at`, [organizationId, line.id])).rows;
  const usable = sub(sub(add(line.accepted_quantity, row.released), row.returned_from_stock), row.rejected_from_stock);
  return {
    goodsReceiptLineId: line.id, usable: dec(usable > 0n ? usable : 0n),
    holds: holds.filter((hold) => hold.disposition === "inspection_hold").map((hold) => ({ dispositionId: hold.id, undecided: dec(hold.undecided), qualityInspectionId: hold.quality_inspection_id })),
  };
}

// The quantity a Quality inspection still allows to be rejected (in the receipt's unit), when the held goods were inspected.
async function inspectionAllowance(client, context, inspectionId, factor) {
  const inspection = (await client.query(`SELECT * FROM tenant.quality_inspections WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, inspectionId])).rows[0];
  if (!inspection || inspection.status === "cancelled") return null;
  if (!["failed", "conditionally_accepted"].includes(inspection.status))
    throw new PurchaseOrderError(409, `Quality has not decided yet: inspection ${inspection.inspection_number} is ${inspection.status.replace("_", " ")}. Complete it first.`, "REJECTION_QUALITY_DECISION_PENDING");
  const used = (await client.query(`SELECT COALESCE(sum(base_quantity), 0) AS base FROM tenant.receiving_rejections WHERE organization_id = $1 AND quality_inspection_id = $2 AND status <> 'cancelled'`,
    [context.organizationId, inspectionId])).rows[0].base;
  const left = sub(inspection.rejected_quantity, used);
  return { inspection, allowed: roundMoney(div(left > 0n ? left : 0n, factor), 6) };
}

// recordPostReceiptRejection: goods already received and then found unacceptable. input: { source: "inspection_hold" | "usable_stock", dispositionId? (held goods),
// quantity, reason, reasonTags?, description?, serialNumbers? (usable serial-numbered goods), warehouseLocationId? (where the usable goods are), observedAt?,
// reportedByUserId?, expectedResolution?, evidenceFileIds?, idempotencyKey? }. Held goods stay where they are and become blocked; usable goods move to the
// warehouse's quality location through Inventory. The posted receipt is not changed.
export async function recordPostReceiptRejection(client, context, receiptLineId, input = {}) {
  const fromHold = input.source === "inspection_hold" || Boolean(input.dispositionId);
  requirePoPermission(context, fromHold ? PO_PERMISSIONS.rejectionsQuality : PO_PERMISSIONS.rejectionsRecord,
    fromHold ? "You do not have permission to reject held goods: that is Quality's decision." : "You do not have permission to record receiving rejections.");
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "procurement.rejection.after_receipt", key: text(input.idempotencyKey, 200), payload: { receiptLineId, ...input, idempotencyKey: undefined },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const { line, receipt, order } = await lockReceiptLine(client, context, receiptLineId);
  const label = `Line ${line.line_number}`;
  if (line.product_type === "service") fail(`${label} is a service; there are no goods to reject.`, "goodsReceiptLineId", "REJECTION_SERVICE_LINE", 409);
  if (line.warehouse_id) await assertWarehouseOperation(client, context, line.warehouse_id, "receive", "Warehouse", { capability: false });
  const reason = readRejectionReason(input, { defaultReason: fromHold ? "failed_inspection" : null });
  const quantity = readQuantity(input.quantity, `${label} quantity rejected`);
  const orderLine = (await orderLinesById(client, context.organizationId, order.id)).get(line.purchase_order_line_id);
  checkPlaces(quantity, Number(orderLine?.decimal_places ?? 6), label);
  const factor = decimal(line.conversion_factor);
  const base = { ...receiptLineCaseFields(receipt, line, orderLine), stage: "after_custody", reason: reason.reason, tags: reason.tags, description: reason.description, quantity,
    observedAt: readObservedAt(input.observedAt), reportedByUserId: await readReporter(client, context, input.reportedByUserId),
    expectedResolution: readExpectedResolution(input.expectedResolution ?? "purchase_return", "after_custody"), evidenceFileIds: await readEvidence(client, context, input, receipt.id) };
  let created;
  if (fromHold) {
    const disposition = (await client.query(`SELECT * FROM tenant.goods_receipt_dispositions WHERE organization_id = $1 AND goods_receipt_line_id = $2 AND id = $3 FOR UPDATE`,
      [context.organizationId, line.id, requireUuid(input.dispositionId, "Held goods")])).rows[0];
    if (!disposition || disposition.disposition !== "inspection_hold") fail(`${label}: choose goods on inspection hold.`, "dispositionId", "REJECTION_DISPOSITION_INVALID", 404);
    const undecided = sub(sub(sub(sub(disposition.quantity, disposition.released_quantity), disposition.returned_quantity), disposition.disposed_quantity), disposition.blocked_quantity);
    if (quantity > undecided)
      throw new PurchaseOrderError(409, `${label}: only ${dec(undecided)} on hold is still undecided.`, "REJECTION_EXCEEDS_ELIGIBLE", { eligible: dec(undecided) });
    let inspectionId = null;
    if (disposition.quality_inspection_id) {
      const allowance = await inspectionAllowance(client, context, disposition.quality_inspection_id, factor);
      if (allowance) {
        if (quantity > allowance.allowed)
          throw new PurchaseOrderError(409, `${label}: inspection ${allowance.inspection.inspection_number} rejected ${dec(allowance.allowed)} more at most.`, "REJECTION_EXCEEDS_INSPECTION");
        inspectionId = allowance.inspection.id;
      }
    }
    await client.query(`UPDATE tenant.goods_receipt_dispositions SET blocked_quantity = blocked_quantity + $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, disposition.id, formatDecimal(quantity)]);
    created = await openRejectionCase(client, context, { ...base, stockSource: "inspection_hold", dispositionId: disposition.id, locationId: disposition.location_id,
      qualityInspectionId: inspectionId, sourceKey: input.sourceKey ?? null });
  } else {
    const eligible = decimal((await eligibleFor(client, context.organizationId, line)).usable);
    if (quantity > eligible)
      throw new PurchaseOrderError(409, `${label}: only ${dec(eligible)} from this receipt is still in usable stock (not returned or already rejected).`, "REJECTION_EXCEEDS_ELIGIBLE", { eligible: dec(eligible) });
    const serials = serialsOf(input.serialNumbers);
    let movements = [];
    let locationId = null;
    const sourceLocationId = optionalUuid(input.warehouseLocationId, "Location") ?? line.warehouse_location_id ?? null;
    if (line.product_type === "stock") {
      // Inventory moves the goods out of use: into the warehouse's quality location, exactly the units rejected.
      locationId = await qualityLocation(client, context.organizationId, line.warehouse_id);
      if (!locationId) fail(`${label}: the warehouse has no quality location to keep rejected goods in. Add one in Inventory first.`, "warehouseId", "REJECTION_NO_QUALITY_LOCATION", 409);
      const stock = stockContextFor(context);
      const reasonText = `Rejected (${reasonLabel(reason.reason)}) from ${receipt.receipt_number}`;
      if (line.tracking_type === "serial") {
        if (quantity % ONE !== 0n || BigInt(serials.length) * ONE !== quantity) fail(`${label}: choose the serial number of each unit rejected.`, "serialNumbers", "REJECTION_SERIALS_REQUIRED");
        const received = new Set(line.serial_numbers.map((value) => value.toLowerCase()));
        for (const serialNumber of serials) {
          if (!received.has(serialNumber.toLowerCase())) fail(`${label}: serial number ${serialNumber} was not received on ${receipt.receipt_number}.`, "serialNumbers", "REJECTION_SERIAL_INVALID", 409);
          const serial = (await client.query(`SELECT id, warehouse_location_id FROM tenant.stock_serials WHERE organization_id = $1 AND item_id = $2 AND lower(serial_number) = lower($3) AND status = 'available'`,
            [context.organizationId, line.product_id, serialNumber])).rows[0];
          if (!serial) throw new PurchaseOrderError(409, `${label}: serial number ${serialNumber} is no longer in stock (sold, returned or moved).`, "REJECTION_STOCK_UNAVAILABLE");
          if (serial.warehouse_location_id === locationId) fail(`${label}: serial number ${serialNumber} is already in the quality location.`, "serialNumbers", "REJECTION_SERIAL_INVALID", 409);
          const ref = { itemId: line.product_id, warehouseId: line.warehouse_id, serialId: serial.id, quantity: "1", referenceType: "receiving_rejection", referenceId: line.id, reason: reasonText };
          const moves = internalMoveTypes(await dispositionAt(client, context.organizationId, serial.warehouse_location_id), await dispositionAt(client, context.organizationId, locationId));
          movements.push((await stocked(() => postStockMovement(client, stock, { ...ref, movementType: "issue", ledgerType: moves.out, warehouseLocationId: serial.warehouse_location_id,
            idempotencyKey: `rjr-out:${line.id}:${serial.id}:${base.observedAt}` }), `${label}: `)).id);
          movements.push((await stocked(() => postStockMovement(client, stock, { ...ref, movementType: "receipt", ledgerType: moves.in, warehouseLocationId: locationId,
            idempotencyKey: `rjr-in:${line.id}:${serial.id}:${base.observedAt}` }), `${label}: `)).id);
        }
      } else {
        // Into the quality location: a disposition change inside the warehouse, posted against the receipt line.
        const moved = await stocked(() => moveStockWithinWarehouse(client, stock, {
          itemId: line.product_id, warehouseId: line.warehouse_id, fromLocationId: sourceLocationId, toLocationId: locationId, batchId: line.batch_id,
          quantity: formatDecimal(roundMoney(mul(quantity, factor), 6)), referenceType: "receiving_rejection", referenceId: line.id, reason: reasonText,
          idempotencyKey: `rjr:${line.id}:${dec(quantity)}:${base.observedAt}`,
        }), `${label}: `);
        movements = moved.movements.map((movement) => movement.id);
      }
    } else if (serials.length) fail(`${label}: the product is not serial-numbered.`, "serialNumbers");
    created = await openRejectionCase(client, context, { ...base, stockSource: "usable_stock", locationId, sourceLocationId, serialNumbers: serials, stockMovementIds: movements,
      sourceKey: input.sourceKey ?? null });
  }
  await recordReceiptEvent(client, context, receipt.id, "goods_receipt.rejected",
    `${created.rejectionNumber}: ${dec(quantity)} rejected after receipt on line ${line.line_number} (${reasonLabel(reason.reason)})${fromHold ? "" : " — moved out of usable stock"}`, { rejectionId: created.id });
  await recordPoEvent(client, context, order.id, "purchase_order.goods_rejected", `${created.rejectionNumber}: ${dec(quantity)} rejected after receipt ${receipt.receipt_number} (${reasonLabel(reason.reason)})`,
    { details: { rejectionId: created.id, receiptId: receipt.id } });
  const response = { id: created.id, rejectionNumber: created.rejectionNumber, replayed: false };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "receiving_rejection", aggregateId: created.id });
  return response;
}

// quarantineRejectedStock: the same as recording a rejection of usable stock — Inventory moves the goods into the quality location.
export const quarantineRejectedStock = (client, context, receiptLineId, input = {}) => recordPostReceiptRejection(client, context, receiptLineId, { ...input, source: "usable_stock" });

// createRejectionFromQualityInspection: Quality failed (part of) a lot held at receipt; the case is opened once per inspection — a retry returns it.
export async function createRejectionFromQualityInspection(client, context, inspectionId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.rejectionsQuality, "You do not have permission to record quality rejections.");
  const id = requireUuid(inspectionId, "Inspection");
  const existing = (await client.query(`SELECT id, rejection_number FROM tenant.receiving_rejections WHERE organization_id = $1 AND source_key = $2`, [context.organizationId, `qi:${id}`])).rows[0];
  if (existing) return { id: existing.id, rejectionNumber: existing.rejection_number, replayed: true };
  const disposition = (await client.query(
    `SELECT disposition.*, line.conversion_factor FROM tenant.goods_receipt_dispositions disposition
       JOIN tenant.goods_receipt_lines line ON line.organization_id = disposition.organization_id AND line.id = disposition.goods_receipt_line_id
      WHERE disposition.organization_id = $1 AND disposition.quality_inspection_id = $2`, [context.organizationId, id])).rows[0];
  if (!disposition) throw new PurchaseOrderError(404, "That inspection is not for goods held on a goods receipt.", "REJECTION_INSPECTION_NOT_LINKED");
  const allowance = await inspectionAllowance(client, context, id, decimal(disposition.conversion_factor));
  if (!allowance || allowance.allowed <= 0n) throw new PurchaseOrderError(409, "The inspection rejected nothing that is still to be recorded.", "REJECTION_NOTHING_TO_REJECT");
  const undecided = sub(sub(sub(sub(disposition.quantity, disposition.released_quantity), disposition.returned_quantity), disposition.disposed_quantity), disposition.blocked_quantity);
  const quantity = allowance.allowed < undecided ? allowance.allowed : undecided;
  if (quantity <= 0n) throw new PurchaseOrderError(409, "Nothing on hold is still undecided for this inspection.", "REJECTION_NOTHING_TO_REJECT");
  return recordPostReceiptRejection(client, context, disposition.goods_receipt_line_id, {
    ...input, source: "inspection_hold", dispositionId: disposition.id, quantity: formatDecimal(quantity), reason: input.reason ?? "failed_inspection",
    description: input.description ?? `Inspection ${allowance.inspection.inspection_number} failed`, sourceKey: `qi:${id}`,
  });
}

// ---------------------------------------------------------------- editing and cancelling a case

// updateOpenRejection: the reason, notes, expected resolution and evidence of an open case. Quantities and links are never edited.
export async function updateOpenRejection(client, context, rejectionId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.rejectionsEdit, "You do not have permission to edit rejections.");
  const rejection = await loadRejection(client, context, rejectionId, { lock: true });
  if (rejection.status !== "open") throw new PurchaseOrderError(409, `A ${rejection.status} rejection is kept as it is.`, "REJECTION_LOCKED");
  if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== new Date(rejection.updated_at).getTime())
    throw new PurchaseOrderError(409, "Someone else changed this rejection. Reload it and enter your change again.", "REJECTION_STALE");
  for (const key of ["quantity", "rejectedQuantity", "purchaseOrderLineId", "goodsReceiptLineId", "status"])
    if (has(input, key)) fail("Quantities, links and status are changed only by recording, resolving or cancelling the rejection.", key, "REJECTION_FIELD_LOCKED");
  const reason = readRejectionReason({ reason: input.reason ?? rejection.rejection_reason, reasonTags: input.reasonTags ?? rejection.reason_tags,
    description: has(input, "description") ? input.description : rejection.description });
  const expected = has(input, "expectedResolution") ? readExpectedResolution(input.expectedResolution, rejection.rejection_stage) : rejection.expected_resolution;
  const delivered = has(input, "deliveredProductDescription") ? text(input.deliveredProductDescription, 500) : rejection.delivered_product_description;
  if (reason.reason === "wrong_product" && rejection.rejection_stage === "before_custody" && !delivered) fail("Describe the product that was delivered instead.", "deliveredProductDescription");
  const evidence = has(input, "evidenceFileIds") ? await readEvidence(client, context, input, rejection.goods_receipt_id) : rejection.evidence_file_ids;
  const changes = [];
  if (reason.reason !== rejection.rejection_reason) changes.push(`reason ${reasonLabel(rejection.rejection_reason)} → ${reasonLabel(reason.reason)}`);
  if ((reason.description ?? null) !== (rejection.description ?? null)) changes.push("description");
  if (expected !== rejection.expected_resolution) changes.push(`expected resolution → ${expected ?? "none"}`);
  if (evidence.length !== rejection.evidence_file_ids.length) changes.push("evidence");
  await client.query(
    `UPDATE tenant.receiving_rejections SET rejection_reason = $3, reason_tags = $4, description = $5, expected_resolution = $6, delivered_product_description = $7, evidence_file_ids = $8,
            updated_by = $9, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, rejection.id, reason.reason, reason.tags, reason.description, expected, delivered, evidence, context.userId ?? null]);
  if (changes.length) await recordRejectionEvent(client, context, rejection.id, "rejection.updated", `Changed: ${changes.join(", ")}`);
  return { id: rejection.id };
}

// cancelInvalidRejectionCase: a report made in error or twice. Nothing it pointed at is undone; a case that already holds stock out of use, or that
// records a Quality decision or the receipt's own damage, is resolved instead.
export async function cancelInvalidRejectionCase(client, context, rejectionId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.rejectionsCancel, "You do not have permission to cancel rejections.");
  const rejection = await loadRejection(client, context, rejectionId, { lock: true });
  if (rejection.status === "cancelled") return { id: rejection.id, status: "cancelled", replayed: true };
  if (rejection.status !== "open") throw new PurchaseOrderError(409, "A resolved rejection is kept as it is.", "REJECTION_LOCKED");
  const reason = text(input.reason, 1000);
  if (!reason || reason.length < 3) fail("Give the reason for cancelling the rejection.", "reason");
  if (decimal(rejection.resolved_quantity) > 0n) throw new PurchaseOrderError(409, "Part of this rejection was already resolved; it can no longer be cancelled.", "REJECTION_IN_USE");
  if (rejection.stock_source === "damaged_at_receipt")
    throw new PurchaseOrderError(409, "The goods receipt recorded these goods as damaged. Resolve the case (return, dispose of or accept the goods) instead.", "REJECTION_IN_USE");
  if (rejection.stock_source === "usable_stock" && rejection.product_type === "stock")
    throw new PurchaseOrderError(409, "Inventory already moved these goods out of use. Resolve the case by accepting them back instead.", "REJECTION_IN_USE");
  if (rejection.quality_inspection_id) throw new PurchaseOrderError(409, "This rejection records a Quality inspection's decision; it stands. Resolve the case instead.", "REJECTION_IN_USE");
  if (rejection.disposition_id)
    await client.query(`UPDATE tenant.goods_receipt_dispositions SET blocked_quantity = blocked_quantity - $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, rejection.disposition_id, formatDecimal(rejection.rejected_quantity)]);
  await client.query(`UPDATE tenant.receiving_rejections SET status = 'cancelled', cancelled_by = $3, cancelled_at = now(), cancel_reason = $4, updated_by = $3, updated_at = now()
                       WHERE organization_id = $1 AND id = $2`, [context.organizationId, rejection.id, context.userId ?? null, reason]);
  await recordRejectionEvent(client, context, rejection.id, "rejection.cancelled", `Cancelled as invalid: ${reason}${rejection.disposition_id ? " — the goods are back on inspection hold, undecided" : ""}`);
  await recordPoEvent(client, context, rejection.purchase_order_id, "purchase_order.rejection_cancelled", `${rejection.rejection_number} cancelled as invalid: ${reason}`, { details: { rejectionId: rejection.id } });
  return { id: rejection.id, status: "cancelled", replayed: false };
}

// ---------------------------------------------------------------- resolving a case

// getRejectionResolutionOptions: what may close this case now, for this caller.
export async function getRejectionResolutionOptions(client, context, rejectionId) {
  const rejection = await loadRejection(client, context, rejectionId);
  return resolutionOptionsFor(client, context, rejection);
}

export async function resolutionOptionsFor(client, context, rejection) {
  const open = rejection.status === "open" ? openQuantityOf(rejection) : 0n;
  const can = (permission) => poCan(context, permission);
  const options = [];
  if (open > 0n && rejection.rejection_stage === "before_custody") {
    const remaining = (await client.query(`SELECT remaining_to_receive FROM tenant.purchase_order_line_status WHERE organization_id = $1 AND purchase_order_line_id = $2`,
      [context.organizationId, rejection.purchase_order_line_id])).rows[0]?.remaining_to_receive ?? 0;
    const replacements = (await client.query(
      `SELECT line.id, receipt.receipt_number, receipt.posted_at, line.accepted_quantity + line.held_quantity AS received,
              COALESCE((SELECT sum(resolution.quantity_resolved) FROM tenant.receiving_rejection_resolutions resolution WHERE resolution.organization_id = line.organization_id
                AND resolution.related_document_type = 'goods_receipt_line' AND resolution.related_document_id = line.id), 0) AS linked
         FROM tenant.goods_receipt_lines line JOIN tenant.goods_receipts receipt ON receipt.organization_id = line.organization_id AND receipt.id = line.goods_receipt_id
        WHERE line.organization_id = $1 AND line.purchase_order_line_id = $2 AND receipt.status = 'posted' AND receipt.reversed_at IS NULL AND receipt.posted_at >= $3
          AND line.accepted_quantity + line.held_quantity > 0 ORDER BY receipt.posted_at`, [context.organizationId, rejection.purchase_order_line_id, rejection.created_at])).rows
      .map((row) => ({ goodsReceiptLineId: row.id, receiptNumber: row.receipt_number, available: dec(sub(row.received, row.linked)) })).filter((row) => decimal(row.available) > 0n);
    if (can(PO_PERMISSIONS.rejectionsResolve)) {
      options.push({ type: "replacement_received", label: "Replacement received", max: dec(open), receipts: replacements, enabled: replacements.length > 0 });
      options.push({ type: "refusal_closed", label: "Close the refusal", max: dec(open), enabled: true });
    }
    if (can(PO_PERMISSIONS.cancel) && can(PO_PERMISSIONS.rejectionsResolve)) {
      const cancelable = decimal(remaining) < open ? decimal(remaining) : open;
      options.push({ type: "outstanding_qty_cancelled", label: "Cancel the outstanding quantity", max: dec(cancelable), enabled: cancelable > 0n });
    }
  }
  if (open > 0n && rejection.rejection_stage === "after_custody") {
    const held = blockedQuantityOf(rejection);
    if (can(PO_PERMISSIONS.returns)) options.push({ type: "purchase_return_posted", label: "Return to the supplier", max: dec(held), enabled: held > 0n });
    if (can(PO_PERMISSIONS.rejectionsDispose)) options.push({ type: "authorized_disposal", label: "Dispose of the goods", max: dec(held), enabled: held > 0n });
    if (can(PO_PERMISSIONS.rejectionsOverride)) options.push({ type: "quality_accepted", label: "Accept back into usable stock", max: dec(held), enabled: held > 0n });
  }
  return { open: dec(open), options };
}

// The stock a case holds goes back into use (an exceptional acceptance): Inventory moves it out of the quality location.
async function acceptBack(client, context, rejection, line, quantity, notes) {
  const stock = stockContextFor(context);
  const movements = [];
  const destination = rejection.source_location_id ?? line.warehouse_location_id ?? null;
  if (rejection.product_type === "stock") {
    if (rejection.serial_numbers.length) fail("Serial-numbered goods are returned or disposed of one by one; accept them back by serial through Inventory.", "type", "REJECTION_RESOLUTION_INVALID", 409);
    // Accepted back: out of the quality location into usable stock, a disposition change posted against the rejection.
    const moved = await stocked(() => moveStockWithinWarehouse(client, stock, {
      itemId: rejection.product_id, warehouseId: rejection.warehouse_id, fromLocationId: rejection.location_id, toLocationId: destination, batchId: rejection.batch_id,
      quantity: formatDecimal(roundMoney(mul(quantity, rejection.conversion_factor), 6)), referenceType: "receiving_rejection_release", referenceId: rejection.id,
      reason: `${rejection.rejection_number} accepted back`, idempotencyKey: `rjr-accept:${rejection.id}:${dec(rejection.released_quantity)}:${dec(quantity)}`,
    }));
    movements.push(...moved.movements.map((movement) => movement.id));
  }
  if (rejection.disposition_id) {
    await client.query(`UPDATE tenant.goods_receipt_dispositions SET released_quantity = released_quantity + $3, blocked_quantity = blocked_quantity - $3, updated_at = now()
                         WHERE organization_id = $1 AND id = $2`, [context.organizationId, rejection.disposition_id, formatDecimal(quantity)]);
    await client.query(`INSERT INTO tenant.goods_receipt_disposition_events (organization_id, disposition_id, action, quantity, stock_movement_ids, note, actor_user_id) VALUES ($1, $2, 'released', $3, $4, $5, $6)`,
      [context.organizationId, rejection.disposition_id, formatDecimal(quantity), movements, `${rejection.rejection_number} accepted back: ${notes}`, context.userId ?? null]);
  }
  return movements;
}

// Disposal: Inventory issues the goods out of the quality location; nothing goes back to the supplier.
async function dispose(client, context, rejection, line, quantity, serials, notes) {
  const stock = stockContextFor(context);
  const movements = [];
  if (rejection.product_type === "stock") {
    const base = { movementType: "issue", itemId: rejection.product_id, warehouseId: rejection.warehouse_id, warehouseLocationId: rejection.location_id, batchId: rejection.batch_id,
      referenceType: "receiving_rejection_disposal", referenceId: rejection.id, reason: `${rejection.rejection_number} disposed of: ${notes}` };
    if (rejection.serial_numbers.length) {
      const allowed = new Set(rejection.serial_numbers.map((value) => value.toLowerCase()));
      if (BigInt(serials.length) * ONE !== quantity || serials.some((value) => !allowed.has(value.toLowerCase())))
        fail("Choose the serial number of each rejected unit disposed of.", "serialNumbers", "REJECTION_SERIALS_REQUIRED");
      for (const serialNumber of serials) {
        const serial = (await client.query(`SELECT id FROM tenant.stock_serials WHERE organization_id = $1 AND item_id = $2 AND lower(serial_number) = lower($3) AND status = 'available'`,
          [context.organizationId, rejection.product_id, serialNumber])).rows[0];
        if (!serial) throw new PurchaseOrderError(409, `Serial number ${serialNumber} is not in stock.`, "REJECTION_STOCK_UNAVAILABLE");
        movements.push((await stocked(() => postStockMovement(client, stock, { ...base, serialId: serial.id, quantity: "1", idempotencyKey: `rjr-dispose:${rejection.id}:${serial.id}` }))).id);
      }
    } else {
      movements.push((await stocked(() => postStockMovement(client, stock, { ...base, quantity: formatDecimal(roundMoney(mul(quantity, rejection.conversion_factor), 6)),
        idempotencyKey: `rjr-dispose:${rejection.id}:${dec(rejection.disposed_quantity)}:${dec(quantity)}` }))).id);
    }
  }
  if (rejection.disposition_id)
    await client.query(`UPDATE tenant.goods_receipt_dispositions SET disposed_quantity = disposed_quantity + $3, blocked_quantity = blocked_quantity - $3, updated_at = now()
                         WHERE organization_id = $1 AND id = $2`, [context.organizationId, rejection.disposition_id, formatDecimal(quantity)]);
  return movements;
}

// recordRejectionResolution. input: { type, quantity, notes, goodsReceiptLineId? (replacement received), reasonCode? (cancellation), serialNumbers?, evidenceFileIds?
// (disposal), idempotencyKey? }. Every outcome is checked again against the documents as they are now, and runs through the owning operation.
export async function recordRejectionResolution(client, context, rejectionId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.rejectionsResolve, "You do not have permission to resolve rejections.");
  const type = text(input.type, 40);
  const definition = RESOLUTION_TYPES.find((entry) => entry.code === type);
  if (!definition) fail("Choose how the rejection was resolved.", "type", "REJECTION_RESOLUTION_INVALID");
  if (type === "purchase_return_posted") return createPurchaseReturnFromRejection(client, context, rejectionId, input);
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "procurement.rejection.resolve", key: text(input.idempotencyKey, 200), payload: { rejectionId, ...input, idempotencyKey: undefined },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const rejection = await loadRejection(client, context, rejectionId, { lock: true });
  if (rejection.status !== "open") throw new PurchaseOrderError(409, `${rejection.rejection_number} is ${rejection.status}.`, "REJECTION_LOCKED");
  if (definition.stage !== rejection.rejection_stage)
    throw new PurchaseOrderError(409, rejection.rejection_stage === "before_custody"
      ? "These goods were refused at the dock and never received: there is no stock to return, dispose of or accept."
      : "These goods were received: they are returned, disposed of or accepted, not replaced or cancelled on the order.", "REJECTION_RESOLUTION_INVALID");
  const quantity = readQuantity(input.quantity ?? formatDecimal(openQuantityOf(rejection)), "Quantity resolved");
  const notes = text(input.notes, 2000);
  const line = rejection.goods_receipt_line_id
    ? (await client.query(`SELECT * FROM tenant.goods_receipt_lines WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, rejection.goods_receipt_line_id])).rows[0] : null;
  if (rejection.warehouse_id && rejection.rejection_stage === "after_custody") await assertWarehouseOperation(client, context, rejection.warehouse_id, "purchase_return", "Warehouse", { capability: false });
  let result;
  if (type === "refusal_closed") {
    result = await applyResolution(client, context, rejection, { type, quantity, notes });
  } else if (type === "replacement_received") {
    // A replacement is received like any delivery, on a normal goods receipt against the quantity the order still owed; the case only links it.
    const replacementLineId = requireUuid(input.goodsReceiptLineId, "Replacement receipt line");
    const replacement = (await client.query(
      `SELECT line.*, receipt.receipt_number, receipt.posted_at, receipt.status, receipt.reversed_at,
              COALESCE((SELECT sum(resolution.quantity_resolved) FROM tenant.receiving_rejection_resolutions resolution WHERE resolution.organization_id = line.organization_id
                AND resolution.related_document_type = 'goods_receipt_line' AND resolution.related_document_id = line.id), 0) AS linked
         FROM tenant.goods_receipt_lines line JOIN tenant.goods_receipts receipt ON receipt.organization_id = line.organization_id AND receipt.id = line.goods_receipt_id
        WHERE line.organization_id = $1 AND line.id = $2 FOR UPDATE OF line`, [context.organizationId, replacementLineId])).rows[0];
    if (!replacement || replacement.purchase_order_line_id !== rejection.purchase_order_line_id)
      fail("The replacement must be received on the same purchase order line.", "goodsReceiptLineId", "REJECTION_REPLACEMENT_INVALID", 409);
    if (replacement.status !== "posted" || replacement.reversed_at) fail("The replacement's goods receipt must be posted.", "goodsReceiptLineId", "REJECTION_REPLACEMENT_INVALID", 409);
    if (new Date(replacement.posted_at) < new Date(rejection.created_at)) fail("That goods receipt was posted before the refusal; it cannot be its replacement.", "goodsReceiptLineId", "REJECTION_REPLACEMENT_INVALID", 409);
    const available = sub(add(replacement.accepted_quantity, replacement.held_quantity), replacement.linked);
    if (quantity > available) throw new PurchaseOrderError(409, `${replacement.receipt_number} has only ${dec(available)} not yet counted as a replacement.`, "REJECTION_REPLACEMENT_EXCEEDS");
    result = await applyResolution(client, context, rejection, { type, quantity, notes: notes ?? `Replacement received on ${replacement.receipt_number}`, documentType: "goods_receipt_line",
      documentId: replacement.id });
  } else if (type === "outstanding_qty_cancelled") {
    const cancelled = await cancelRemainingPurchaseOrderQty(client, context, rejection.purchase_order_id, {
      reasonCode: text(input.reasonCode, 60) ?? "supplier_cannot_supply", reason: notes ?? `Refused on ${rejection.rejection_number}; no replacement`,
      lines: [{ lineId: rejection.purchase_order_line_id, quantity: formatDecimal(quantity), receivingRejectionId: rejection.id }],
    });
    result = await applyResolution(client, context, rejection, { type, quantity, notes: notes ?? "Outstanding quantity cancelled: no replacement", documentType: "purchase_order_line_cancellation",
      documentId: cancelled.cancelled[0].cancellationId });
  } else if (type === "quality_accepted") {
    requirePoPermission(context, PO_PERMISSIONS.rejectionsOverride, "Accepting rejected goods back needs the explicit permission to override a rejection.");
    if (!notes || notes.length < 3) fail("Give the reason for accepting rejected goods.", "notes", "REJECTION_RESOLUTION_NOTES_REQUIRED");
    const held = blockedQuantityOf(rejection);
    if (quantity > held) throw new PurchaseOrderError(409, `Only ${dec(held)} is still held for ${rejection.rejection_number}.`, "REJECTION_RESOLUTION_EXCEEDS_OPEN");
    const movements = await acceptBack(client, context, rejection, line, quantity, notes);
    result = await applyResolution(client, context, rejection, { type, quantity, notes, documentType: "stock_movement", documentId: movements[0] ?? null, movementIds: movements,
      counter: "released_quantity" });
  } else if (type === "authorized_disposal") {
    requirePoPermission(context, PO_PERMISSIONS.rejectionsDispose, "You do not have permission to dispose of rejected goods.");
    if (!notes || notes.length < 3) fail("Explain why the goods are disposed of rather than returned.", "notes", "REJECTION_RESOLUTION_NOTES_REQUIRED");
    const evidence = await readEvidence(client, context, input, rejection.goods_receipt_id);
    const files = Number((await client.query(`SELECT count(*) FROM public.attachments WHERE organization_id = $1 AND entity_type = 'procurement.receiving_rejection' AND entity_id = $2::text AND archived_at IS NULL`,
      [context.organizationId, rejection.id])).rows[0].count);
    if (!evidence.length && !rejection.evidence_file_ids.length && !files) fail("Attach evidence (photos, an inspection record) before disposing of the goods.", "evidenceFileIds", "REJECTION_EVIDENCE_REQUIRED", 409);
    const held = blockedQuantityOf(rejection);
    if (quantity > held) throw new PurchaseOrderError(409, `Only ${dec(held)} is still held for ${rejection.rejection_number}.`, "REJECTION_RESOLUTION_EXCEEDS_OPEN");
    const movements = await dispose(client, context, rejection, line, quantity, serialsOf(input.serialNumbers), notes);
    if (evidence.length)
      await client.query(`UPDATE tenant.receiving_rejections SET evidence_file_ids = (SELECT array_agg(DISTINCT id) FROM unnest(evidence_file_ids || $3::uuid[]) id) WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, rejection.id, evidence]);
    result = await applyResolution(client, context, rejection, { type, quantity, notes, documentType: "stock_movement", documentId: movements[0] ?? null, movementIds: movements,
      counter: "disposed_quantity" });
  }
  await recordPoEvent(client, context, rejection.purchase_order_id, "purchase_order.rejection_resolved",
    `${rejection.rejection_number}: ${definition.label.toLowerCase()} × ${dec(quantity)}${result.resolved ? " — resolved" : ""}`, { details: { rejectionId: rejection.id, type } });
  const response = { id: rejection.id, type, quantity: dec(quantity), resolved: result.resolved, open: result.open, replayed: false };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "receiving_rejection", aggregateId: rejection.id });
  return response;
}

// linkReplacementReceipt / cancelOutstandingQuantityFromRejection / closeRejectionCase: the named resolutions.
export const linkReplacementReceipt = (client, context, rejectionId, input = {}) => recordRejectionResolution(client, context, rejectionId, { ...input, type: "replacement_received" });
export const cancelOutstandingQuantityFromRejection = (client, context, rejectionId, input = {}) =>
  recordRejectionResolution(client, context, rejectionId, { ...input, type: "outstanding_qty_cancelled" });
export const closeRejectionCase = (client, context, rejectionId, input = {}) => recordRejectionResolution(client, context, rejectionId, { ...input, type: "refusal_closed" });
