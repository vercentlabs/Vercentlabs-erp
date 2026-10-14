// Finished-Goods Receipt — the shared core: permissions, errors, the receipt note and its lines, which orders may receive, the accepted,
// unreceived output of each production entry (net of reversed receipts), the lines as entered (entry, quantity, unit, lot or serial units)
// checked against it, the destination, the cost the receipt carries, and the content hash an approval binds to.
import { createHash } from "node:crypto";

import { loadItem } from "../boms/bom-engine.js";
import { MoError, STATUS_LABEL, loadMaterials, money, mul, settingsOf, unitMaterialCost, wipBalance } from "../orders/mo-core.js";
import { D, ZERO, add, decisionsOf, entryFigures, has, loadProductionOrder, max, outputQuantity, q, sub, text, uuid } from "../production/production-core.js";

export const FGR = Object.freeze({
  view: "manufacturing.fgr.view", create: "manufacturing.fgr.create", editDraft: "manufacturing.fgr.edit_draft", post: "manufacturing.fgr.post",
  cancelDraft: "manufacturing.fgr.cancel_draft", requestCorrection: "manufacturing.fgr.request_correction", approveCorrection: "manufacturing.fgr.approve_correction",
  export: "manufacturing.fgr.export", costView: "manufacturing.fgr.cost_view",
});
export const FGR_STATUS_LABEL = Object.freeze({ DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", POSTING: "Posting", POSTED: "Posted", CANCELLED: "Cancelled",
  RECOVERY_REQUIRED: "Recovery required" });
export const UNPOSTED = new Set(["DRAFT", "PENDING_APPROVAL"]);

const MESSAGES = Object.freeze({
  MFG_FGR_MO_NOT_FOUND: "Manufacturing Order could not be found.",
  MFG_FGR_NOT_FOUND: "The finished-goods receipt was not found.",
  MFG_FGR_MO_STATUS_INVALID: "Finished goods cannot be received in this order's current status.",
  MFG_FGR_NO_ACCEPTED_OUTPUT: "There are no accepted goods available to receive.",
  MFG_FGR_QUALITY_PENDING: "These goods still require Quality approval.",
  MFG_FGR_REJECTED_OUTPUT: "Rejected goods cannot be received as accepted stock.",
  MFG_FGR_QTY_INVALID: "Enter a valid receipt quantity.",
  MFG_FGR_QTY_EXCEEDS: "The quantity exceeds accepted, unreceived output.",
  MFG_FGR_SOURCE_INVALID: "The selected production batch is not valid for this order.",
  MFG_FGR_WAREHOUSE_INVALID: "Select an authorized finished-goods warehouse.",
  MFG_FGR_UOM_INVALID: "The selected unit is not valid.",
  MFG_FGR_BATCH_REQUIRED: "Enter the required finished-goods batch information.",
  MFG_FGR_SERIAL_INVALID: "One or more serial numbers are invalid or already used.",
  MFG_FGR_COST_UNAVAILABLE: "Manufacturing cost cannot be validated.",
  MFG_FGR_COST_POLICY_BLOCKED: "The selected cost cannot be used for this receipt.",
  MFG_FGR_ALREADY_POSTED: "This receipt has already been posted.",
  MFG_FGR_CONCURRENT_RECEIPT: "Another receipt has claimed some of this output. Refresh the quantity.",
  MFG_FGR_INVENTORY_UNAVAILABLE: "Inventory cannot confirm this receipt right now.",
  MFG_FGR_OUTCOME_UNKNOWN: "Checking the previous receipt. Do not submit it again.",
  MFG_FGR_FINANCE_PENDING: "Goods were received, but accounting reconciliation is pending.",
  MFG_FGR_CORRECTION_BLOCKED: "These goods have already moved or been used. A controlled correction is required.",
  MFG_FGR_PERMISSION_DENIED: "You do not have permission for this action.",
  MFG_FGR_APPROVAL_REQUIRED: "A receipt into another warehouse needs an approval first.",
  MFG_FGR_APPROVAL_SELF: "Someone other than the requester approves this.",
  MFG_FGR_DOCUMENT_CHANGED: "The receipt changed since it was checked. Review it and retry.",
  MFG_FGR_REASON_REQUIRED: "Give a reason.",
  MFG_FGR_STATE_INVALID: "This action is not available in the receipt's current status.",
  MFG_FGR_EMPTY: "Add at least one production entry to receive from.",
});
// A DATE column as YYYY-MM-DD: pg gives a JS Date at local midnight, so its local parts are the date (toISOString would shift it a day east of UTC).
export const isoDay = (value) => {
  if (!value) return null;
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};
export const fgrError = (status, code, message, details) => new MoError(status, code, message ?? MESSAGES[code], details);
export const needFgr = (c, permission) => { if (!has(c, permission)) throw fgrError(403, "MFG_FGR_PERMISSION_DENIED"); };
export const canSeeCost = (c) => has(c, FGR.costView) || has(c, "manufacturing.mo.cost_view");

export async function loadReceiptOrder(client, c, orderId, options) {
  try { return await loadProductionOrder(client, c, uuid(orderId, "Manufacturing order"), options); } catch (error) {
    if (error.code === "MFG_PARTIAL_MO_NOT_FOUND" || error.code === "MFG_MO_NOT_FOUND") throw fgrError(404, "MFG_FGR_MO_NOT_FOUND");
    throw error;
  }
}
export async function loadReceipt(client, c, id, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_finished_goods_receipts WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, uuid(id, "Finished-goods receipt")])).rows[0];
  if (!row) throw fgrError(404, "MFG_FGR_NOT_FOUND");
  return row;
}
export async function loadReceiptLines(client, c, receiptId) {
  return (await client.query(
    `SELECT line.*, entry.entry_number, entry.produced_at, batch.batch_reference, uom.code AS uom_code
       FROM tenant.manufacturing_finished_goods_receipt_lines line JOIN tenant.manufacturing_production_entries entry ON entry.id = line.production_entry_id
       LEFT JOIN tenant.manufacturing_production_batches batch ON batch.id = line.production_batch_id JOIN tenant.units_of_measure uom ON uom.id = line.uom_id
      WHERE line.organization_id = $1 AND line.receipt_id = $2 ORDER BY line.line_number`, [c.organizationId, receiptId])).rows;
}

// Receipt policy: whether output of an order on hold may be received (previously accepted output only).
export async function receiptSettings(client, c) {
  const settings = await settingsOf(client, c);
  const row = (await client.query(`SELECT fgr_receive_on_hold FROM tenant.manufacturing_settings WHERE organization_id = $1`, [c.organizationId])).rows[0];
  return { ...settings, receiveOnHold: Boolean(row?.fgr_receive_on_hold) };
}
// In progress, or waiting for its completion to be approved (reconciling output accepted before); on hold only where the company allows it.
export function requireReceivable(order, settings) {
  const allowed = ["IN_PROGRESS", "COMPLETION_PENDING", ...(settings.receiveOnHold ? ["ON_HOLD"] : [])];
  if (allowed.includes(order.status)) return;
  throw fgrError(409, "MFG_FGR_MO_STATUS_INVALID", order.status === "RELEASED"
    ? `${order.mo_number} is released: start production and report output before receiving finished goods.`
    : `${order.mo_number} is ${STATUS_LABEL[order.status].toLowerCase()}: finished goods are received while an order is in progress${settings.receiveOnHold ? ", on hold" : ""} or awaiting completion.`);
}

// Every reported entry of the order with its figures — accepted, net received (receipts less reversals), receivable — the batch it belongs to
// and the quality decision that accepted it. `lock` locks the entries (posting claims their output under the order's lock).
export async function receivableSources(client, c, order, { lock = false } = {}) {
  const rows = (await client.query(
    `SELECT entry.*, batch.batch_reference, batch.production_location_id,
            (SELECT decision.id FROM tenant.manufacturing_quality_decisions decision WHERE decision.organization_id = entry.organization_id AND decision.production_entry_id = entry.id
               AND decision.accepted_quantity > 0 ORDER BY decision.decided_at DESC LIMIT 1) AS quality_decision_id
       FROM tenant.manufacturing_production_entries entry LEFT JOIN tenant.manufacturing_production_batches batch ON batch.id = entry.production_batch_id
      WHERE entry.organization_id = $1 AND entry.manufacturing_order_id = $2 AND entry.status IN ('REPORTED', 'RECOVERY_REQUIRED')
      ORDER BY entry.posted_at, entry.entry_number${lock ? " FOR UPDATE OF entry" : ""}`, [c.organizationId, order.id])).rows;
  const decided = await decisionsOf(client, c, rows.map((row) => row.id));
  return rows.map((row) => {
    const figures = entryFigures(row, decided.get(row.id));
    return { row, figures, receivable: row.status === "REPORTED" ? figures.receivable : ZERO };
  });
}

// The lines as entered: one per production entry, a positive quantity in a unit of the finished item, within what the entry may still
// give; a lot number for a batch-tracked item; for a serial-numbered item
// exactly one new, unregistered serial number per unit.
export async function resolveLines(client, c, order, item, sources, input = []) {
  const requested = Array.isArray(input) ? input.filter((line) => line && (line.productionEntryId || line.quantity)) : [];
  if (!requested.length) throw fgrError(400, "MFG_FGR_EMPTY");
  const seenEntries = new Set();
  const seenSerials = new Set();
  const lines = [];
  for (const [index, line] of requested.entries()) {
    const label = `Line ${index + 1}`;
    const source = sources.find((entry) => entry.row.id === line.productionEntryId);
    if (!source) throw fgrError(400, "MFG_FGR_SOURCE_INVALID", `${label}: choose a reported production entry of ${order.mo_number}.`);
    if (seenEntries.has(source.row.id)) throw fgrError(400, "MFG_FGR_SOURCE_INVALID", `${source.row.entry_number} appears twice: receive it on one line.`);
    seenEntries.add(source.row.id);
    if (source.row.status !== "REPORTED") throw fgrError(409, "MFG_FGR_SOURCE_INVALID", `${source.row.entry_number} needs recovery before its output is received.`);
    let amount;
    try { amount = await outputQuantity(client, c, order, line.quantity, line.uomId || undefined); } catch (error) {
      throw fgrError(400, error.code === "MFG_PARTIAL_UOM_INVALID" ? "MFG_FGR_UOM_INVALID" : "MFG_FGR_QTY_INVALID", `${source.row.entry_number}: ${error.message}`);
    }
    if (amount.base > source.receivable) {
      const f = source.figures;
      const code = f.accepted === ZERO ? (f.pending > ZERO ? "MFG_FGR_QUALITY_PENDING" : f.rejected > ZERO ? "MFG_FGR_REJECTED_OUTPUT" : "MFG_FGR_NO_ACCEPTED_OUTPUT") : "MFG_FGR_QTY_EXCEEDS";
      throw fgrError(409, code, `${source.row.entry_number}: ${q(source.receivable)} ${item.uom_code} accepted and not yet received${f.pending > ZERO ? ` (${q(f.pending)} still awaits inspection)` : ""}.`,
        { entryId: source.row.id, receivable: q(source.receivable) });
    }
    let lotNumber = null;
    let serialNumbers = null;
    if (item.tracking_type === "batch") {
      // Named explicitly (the screen proposes the production batch reference): the lot a production batch becomes is a recorded choice.
      lotNumber = text(line.lotNumber, 120) || null;
      if (!lotNumber) throw fgrError(400, "MFG_FGR_BATCH_REQUIRED", `${item.code} is batch-tracked: give the lot number for ${source.row.entry_number}.`);
    }
    if (item.tracking_type === "serial") {
      serialNumbers = [...new Set((Array.isArray(line.serialNumbers) ? line.serialNumbers : String(line.serialNumbers ?? "").split(/[\s,;]+/)).map((value) => text(value, 120)).filter(Boolean))];
      if (D(String(serialNumbers.length)) !== amount.base) {
        throw fgrError(400, "MFG_FGR_SERIAL_INVALID", `${source.row.entry_number}: ${item.code} is serial-numbered — give exactly ${q(amount.base)} unique serial number(s); ${serialNumbers.length} given.`);
      }
      for (const serial of serialNumbers) {
        if (seenSerials.has(serial.toLowerCase())) throw fgrError(400, "MFG_FGR_SERIAL_INVALID", `Serial ${serial} appears twice on this receipt.`);
        seenSerials.add(serial.toLowerCase());
      }
      const taken = (await client.query(`SELECT serial_number FROM tenant.stock_serials WHERE organization_id = $1 AND lower(serial_number) = ANY($2::text[]) LIMIT 1`,
        [c.organizationId, serialNumbers.map((value) => value.toLowerCase())])).rows[0];
      if (taken) throw fgrError(409, "MFG_FGR_SERIAL_INVALID", `Serial ${taken.serial_number} is already registered in Inventory.`);
    }
    const day = (value, what) => {
      if (value === undefined || value === null || value === "") return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw fgrError(400, "MFG_FGR_BATCH_REQUIRED", `${source.row.entry_number}: the ${what} date is not a date.`);
      return String(value);
    };
    const manufacturedOn = item.tracking_type === "batch" ? day(line.manufacturedOn, "manufacture") ?? (source.row.produced_at ? isoDay(new Date(source.row.produced_at)) : null) : null;
    const expiresOn = item.tracking_type === "batch" ? day(line.expiresOn, "expiry") : null;
    if (manufacturedOn && expiresOn && expiresOn < manufacturedOn) throw fgrError(400, "MFG_FGR_BATCH_REQUIRED", `${source.row.entry_number}: the expiry date is before the manufacture date.`);
    lines.push({ source, entryId: source.row.id, batchId: source.row.production_batch_id ?? null, qualityDecisionId: source.row.quality_decision_id ?? null,
      quantity: amount.entered, uomId: amount.uomId, factor: amount.factor, baseQuantity: amount.base, lotNumber, manufacturedOn, expiresOn, serialNumbers });
  }
  return lines;
}

// The destination: an active stocking warehouse (never a transit one) and, if named, one of its stock locations.
export async function resolveDestination(client, c, order, input = {}) {
  const warehouseId = input.destinationWarehouseId ? uuid(input.destinationWarehouseId, "Destination warehouse") : order.finished_goods_warehouse_id;
  const warehouse = (await client.query(`SELECT id, code, name, status, COALESCE(warehouse_type, 'stores') AS type FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, warehouseId])).rows[0];
  if (!warehouse || warehouse.status !== "active" || warehouse.type === "transit") throw fgrError(400, "MFG_FGR_WAREHOUSE_INVALID");
  let locationId = null;
  if (input.destinationLocationId) {
    const location = (await client.query(`SELECT id, allow_stock, status FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2 AND warehouse_id = $3`,
      [c.organizationId, uuid(input.destinationLocationId, "Destination bin"), warehouse.id])).rows[0];
    if (!location || location.status !== "active" || !location.allow_stock) throw fgrError(400, "MFG_FGR_WAREHOUSE_INVALID", `That bin is not an active stock location of ${warehouse.code}.`);
    locationId = location.id;
  }
  let sourceLocationId = null;
  if (input.sourceLocationId) {
    const location = (await client.query(`SELECT id FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2 AND warehouse_id = $3`,
      [c.organizationId, uuid(input.sourceLocationId, "Source location"), order.manufacturing_warehouse_id])).rows[0];
    if (!location) throw fgrError(400, "MFG_FGR_WAREHOUSE_INVALID", "The source location is not a location of the order's manufacturing warehouse.");
    sourceLocationId = location.id;
  }
  return { warehouseId: warehouse.id, locationId, sourceLocationId, exception: warehouse.id !== order.finished_goods_warehouse_id };
}

export async function loadFinishedItem(client, c, order) {
  return loadItem(client, c.organizationId, order.finished_item_id);
}

// The cost this receipt carries (the company's policy: the recipe's material per unit at its actual average issue cost), checked against
// what work in progress still holds — a receipt never capitalises more than was issued.
export async function costOf(client, c, order, base) {
  const unit = unitMaterialCost(order, await loadMaterials(client, c, order.id));
  const wip = wipBalance(order);
  if (unit.unitCost === null) {
    return { status: "UNAVAILABLE", code: "MFG_FGR_COST_UNAVAILABLE", message: `No cost is known for ${unit.missing.join(", ")}: issue it (or give it a cost) before receiving.`, unitCost: null, total: null,
      wipBefore: wip, basis: unit.basis };
  }
  const total = D(money(mul(unit.unitCost, base)));
  if (total > add(wip, D("0.01"))) {
    return { status: "BLOCKED", code: "MFG_FGR_COST_POLICY_BLOCKED", message: `These ${q(base)} units carry ₹${money(total)} of material; work in progress holds ₹${money(wip)}. Issue the materials for them first.`,
      unitCost: unit.unitCost, total, wipBefore: wip, basis: unit.basis };
  }
  return { status: "READY", code: null, message: null, unitCost: unit.unitCost, total, wipBefore: wip, wipAfter: max(sub(wip, total), ZERO), basis: unit.basis };
}

export function contentHash(receipt, lines) {
  const base = (line) => (line.baseQuantity !== undefined ? q(line.baseQuantity) : q(D(line.base_quantity)));
  return createHash("sha256").update(JSON.stringify({
    order: receipt.manufacturing_order_id, destination: receipt.destination_warehouse_id, bin: receipt.destination_location_id ?? null,
    lines: lines.map((line) => [line.production_entry_id ?? line.entryId, base(line), line.uom_id ?? line.uomId, line.lot_number ?? line.lotNumber ?? null,
      [...(line.serial_numbers ?? line.serialNumbers ?? [])].map((value) => value.toLowerCase()).sort()]),
  })).digest("hex");
}

// The receipt into another warehouse than the order's finished-goods warehouse needs an approval bound to this exact content.
export function approvalState(receipt, order, hash = receipt.content_hash) {
  const required = receipt.destination_warehouse_id !== order.finished_goods_warehouse_id;
  const valid = !required || (receipt.approval_status === "APPROVED" && receipt.approval_hash === hash);
  return { required, valid, status: receipt.approval_status,
    message: required && !valid ? (receipt.approval_status === "REQUESTED" ? "Waiting for the approval of a receipt into another warehouse." : "A receipt into another warehouse than the order's finished-goods warehouse needs an approval.") : null };
}

export { D, MoError, STATUS_LABEL, ZERO, add, has, loadMaterials, max, money, q, sub, text, uuid };
