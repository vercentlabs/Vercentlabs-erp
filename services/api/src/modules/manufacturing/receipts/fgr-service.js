// Finished-Goods Receipt — the commands: create and edit a draft, check it (nothing moves), ask for and decide the approval of a receipt into
// another warehouse, post it, cancel a draft, request and decide a correction of a posted receipt (an approved one reverses it), count a
// print and re-check a posting. Posting is one database transaction across Manufacturing, Inventory and Finance: the order is locked, its
// entries' accepted, unreceived output is claimed, the stock is received, the value moves from work in progress to finished goods, and the
// order's receipt record is written — or none of it happens. Its identity is the note and its version (`fgr:<id>:v<version>`), so a retry
// finds the posted note and returns it; it never receives twice.
import { randomUUID } from "node:crypto";

import { createStockBatch, postStockMovement, receiveSerializedStock, reverseStockMovements } from "../../stock/index.js";
import { valuationOfMovements } from "../../stock/valuation-engine.js";
import { attributeReceiptToDemand } from "../demand/demand-service.js";
import { SOURCE, atomically, div, event as orderEvent, moError, nextNumber, postJournal } from "../orders/mo-core.js";
import {
  D, FGR, MoError, UNPOSTED, isoDay, ZERO, add, approvalState, contentHash, costOf, fgrError, has, loadFinishedItem, loadReceipt, loadReceiptLines, loadReceiptOrder, money, needFgr, q,
  receiptSettings, receivableSources, requireReceivable, resolveDestination, resolveLines, sub, text,
} from "./fgr-core.js";
import { getFinishedGoodsReceipt } from "./fgr-read.js";

const stockCtx = (c) => ({ ...c, permissions: [...new Set([...(c.permissions ?? []), "stock.view", "stock.receive", "stock.issue", "stock.manage"])] });
async function receiptEvent(client, c, receiptId, action, { from = null, to = null, summary = null, details = {} } = {}) {
  await client.query(`INSERT INTO tenant.manufacturing_finished_goods_receipt_events (organization_id, receipt_id, action, from_status, to_status, summary, details, actor_user_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`, [c.organizationId, receiptId, action, from, to, summary ? String(summary).slice(0, 1000) : null, JSON.stringify(details), c.userId ?? null]);
}
const versionCheck = (receipt, expected) => {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(receipt.row_version)) throw fgrError(409, "MFG_FGR_DOCUMENT_CHANGED");
};
// An Inventory refusal in the receipt's own words.
function stockFailure(error, fallback = "MFG_FGR_INVENTORY_UNAVAILABLE") {
  if (error instanceof MoError) return error;
  const map = { STOCK_SERIAL_DUPLICATE: "MFG_FGR_SERIAL_INVALID", STOCK_BATCH_DUPLICATE: "MFG_FGR_BATCH_REQUIRED", STOCK_BATCH_DATES_INVALID: "MFG_FGR_BATCH_REQUIRED",
    STOCK_INSUFFICIENT: "MFG_FGR_CORRECTION_BLOCKED", NEGATIVE_STOCK_BLOCKED: "MFG_FGR_CORRECTION_BLOCKED", NEGATIVE_BATCH_STOCK_BLOCKED: "MFG_FGR_CORRECTION_BLOCKED",
    NEGATIVE_SERIAL_STOCK_BLOCKED: "MFG_FGR_CORRECTION_BLOCKED", STOCK_SERIAL_NOT_AVAILABLE: "MFG_FGR_CORRECTION_BLOCKED", STOCK_SERIAL_RESERVED: "MFG_FGR_CORRECTION_BLOCKED",
    STOCK_MOVEMENT_ALREADY_REVERSED: "MFG_FGR_CORRECTION_BLOCKED", STOCK_LOCATION_INVALID: "MFG_FGR_WAREHOUSE_INVALID" };
  if (error?.status && error.status < 500 && error.code) return fgrError(error.status === 403 ? 403 : 409, error.status === 403 ? "MFG_FGR_PERMISSION_DENIED" : map[error.code] ?? fallback, `Inventory: ${error.message}`);
  return error;
}

// ------------------------------------------------------------------ drafts
async function writeLines(client, c, receiptId, lines) {
  await client.query(`DELETE FROM tenant.manufacturing_finished_goods_receipt_lines WHERE organization_id = $1 AND receipt_id = $2`, [c.organizationId, receiptId]);
  for (const [index, line] of lines.entries()) {
    await client.query(
      `INSERT INTO tenant.manufacturing_finished_goods_receipt_lines (organization_id, receipt_id, line_number, production_entry_id, production_batch_id, quality_decision_id, quantity, uom_id,
         conversion_factor, base_quantity, lot_number, manufactured_on, expires_on, serial_numbers) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::text[])`,
      [c.organizationId, receiptId, index + 1, line.entryId, line.batchId, line.qualityDecisionId, line.quantity, line.uomId, q(line.factor, 9), q(line.baseQuantity), line.lotNumber,
        line.manufacturedOn, line.expiresOn, line.serialNumbers]);
  }
}
// Lines as stored, in the shape resolveLines takes (to re-check a stored draft against today's output).
const asInput = (rows) => rows.map((row) => ({ productionEntryId: row.production_entry_id, quantity: q(D(row.quantity)), uomId: row.uom_id, lotNumber: row.lot_number,
  manufacturedOn: isoDay(row.manufactured_on), expiresOn: isoDay(row.expires_on), serialNumbers: row.serial_numbers ?? null }));

// input: { manufacturingOrderId, lines: [{ productionEntryId, quantity, uomId?, lotNumber?, manufacturedOn?, expiresOn?, serialNumbers? }], destinationWarehouseId?,
// destinationLocationId?, sourceLocationId?, receiptDate?, notes?, idempotencyKey? }
export async function createFinishedGoodsReceiptDraft(client, c, input = {}) {
  needFgr(c, FGR.create);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const existing = (await client.query(`SELECT id FROM tenant.manufacturing_finished_goods_receipts WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (existing) return { ...(await getFinishedGoodsReceipt(client, c, existing.id)), replayed: true };
  }
  const order = await loadReceiptOrder(client, c, input.manufacturingOrderId, { lock: true });
  requireReceivable(order, await receiptSettings(client, c));
  const item = await loadFinishedItem(client, c, order);
  const destination = await resolveDestination(client, c, order, input);
  const lines = await resolveLines(client, c, order, item, await receivableSources(client, c, order), input.lines);
  const id = randomUUID();
  const number = await nextNumber(client, c, "manufacturing_goods_receipt");
  const receiptDate = input.receiptDate && /^\d{4}-\d{2}-\d{2}$/.test(String(input.receiptDate)) ? String(input.receiptDate) : null;
  const hash = contentHash({ manufacturing_order_id: order.id, destination_warehouse_id: destination.warehouseId, destination_location_id: destination.locationId }, lines);
  await client.query(
    `INSERT INTO tenant.manufacturing_finished_goods_receipts (id, organization_id, receipt_number, manufacturing_order_id, finished_item_id, source_warehouse_id, source_location_id,
       destination_warehouse_id, destination_location_id, receipt_date, notes, content_hash, created_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::date, current_date),$11,$12,$13,$14)`,
    [id, c.organizationId, number, order.id, order.finished_item_id, order.manufacturing_warehouse_id, destination.sourceLocationId, destination.warehouseId, destination.locationId, receiptDate,
      text(input.notes, 1000) || null, hash, c.userId ?? null, key]);
  await writeLines(client, c, id, lines);
  await receiptEvent(client, c, id, "CREATED", { to: "DRAFT", summary: `${number} for ${order.mo_number}: ${lines.map((line) => `${line.source.row.entry_number} ${q(line.baseQuantity)}`).join(", ")}` });
  return getFinishedGoodsReceipt(client, c, id);
}

// input: { expectedVersion, lines?, destinationWarehouseId?, destinationLocationId?, sourceLocationId?, receiptDate?, notes? }. Any edit returns the
// note to a draft and withdraws an approval: an approval binds to the exact content it saw.
export async function updateFinishedGoodsReceiptDraft(client, c, id, input = {}) {
  needFgr(c, FGR.editDraft);
  const receipt = await loadReceipt(client, c, id, { lock: true });
  if (!UNPOSTED.has(receipt.status)) throw fgrError(409, receipt.status === "POSTED" ? "MFG_FGR_ALREADY_POSTED" : "MFG_FGR_STATE_INVALID");
  versionCheck(receipt, input.expectedVersion);
  const order = await loadReceiptOrder(client, c, receipt.manufacturing_order_id, { lock: true });
  requireReceivable(order, await receiptSettings(client, c));
  const item = await loadFinishedItem(client, c, order);
  const destination = await resolveDestination(client, c, order, {
    destinationWarehouseId: input.destinationWarehouseId === undefined ? receipt.destination_warehouse_id : input.destinationWarehouseId,
    destinationLocationId: input.destinationLocationId === undefined ? receipt.destination_location_id : input.destinationLocationId,
    sourceLocationId: input.sourceLocationId === undefined ? receipt.source_location_id : input.sourceLocationId,
  });
  const lines = await resolveLines(client, c, order, item, await receivableSources(client, c, order), input.lines ?? asInput(await loadReceiptLines(client, c, receipt.id)));
  const hash = contentHash({ ...receipt, destination_warehouse_id: destination.warehouseId, destination_location_id: destination.locationId }, lines);
  await writeLines(client, c, receipt.id, lines);
  const receiptDate = input.receiptDate === undefined ? null : input.receiptDate && /^\d{4}-\d{2}-\d{2}$/.test(String(input.receiptDate)) ? String(input.receiptDate) : null;
  await client.query(
    `UPDATE tenant.manufacturing_finished_goods_receipts SET destination_warehouse_id = $3, destination_location_id = $4, source_location_id = $5, receipt_date = COALESCE($6::date, receipt_date),
       notes = $7, content_hash = $8, status = 'DRAFT', approval_status = 'NOT_REQUIRED', approval_hash = NULL, approved_by = NULL, approved_at = NULL, approval_note = NULL,
       row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, receipt.id, destination.warehouseId, destination.locationId, destination.sourceLocationId, receiptDate, input.notes === undefined ? receipt.notes : text(input.notes, 1000) || null, hash]);
  await receiptEvent(client, c, receipt.id, "EDITED", { from: receipt.status, to: "DRAFT",
    summary: ["REQUESTED", "APPROVED"].includes(receipt.approval_status) ? "Edited: the approval was withdrawn" : "Edited" });
  return getFinishedGoodsReceipt(client, c, receipt.id);
}

// What posting would do now, without doing it: each line against its entry's accepted, unreceived output, the destination, the tracking,
// the cost and every problem. A moment's truth — posting checks it all again under the order's lock.
export async function previewFinishedGoodsReceipt(client, c, id) {
  needFgr(c, FGR.view);
  const receipt = await loadReceipt(client, c, id);
  const order = await loadReceiptOrder(client, c, receipt.manufacturing_order_id);
  const item = await loadFinishedItem(client, c, order);
  const rows = await loadReceiptLines(client, c, receipt.id);
  const sources = await receivableSources(client, c, order);
  const problems = [];
  if (!UNPOSTED.has(receipt.status)) problems.push({ code: receipt.status === "POSTED" ? "MFG_FGR_ALREADY_POSTED" : "MFG_FGR_STATE_INVALID", message: `${receipt.receipt_number} is ${receipt.status.toLowerCase().replace(/_/g, " ")}.` });
  try { requireReceivable(order, await receiptSettings(client, c)); } catch (error) { problems.push({ code: error.code, message: error.message }); }
  try { await resolveLines(client, c, order, item, sources, asInput(rows)); } catch (error) { if (error instanceof MoError) problems.push({ code: error.code, message: error.message }); else throw error; }
  try { await resolveDestination(client, c, order, { destinationWarehouseId: receipt.destination_warehouse_id, destinationLocationId: receipt.destination_location_id }); } catch (error) {
    if (error instanceof MoError) problems.push({ code: error.code, message: error.message }); else throw error;
  }
  const approval = approvalState(receipt, order);
  if (approval.required && !approval.valid) problems.push({ code: "MFG_FGR_APPROVAL_REQUIRED", message: approval.message });
  const total = rows.reduce((sum, row) => add(sum, D(row.base_quantity)), ZERO);
  const open = sub(D(order.accepted_quantity), D(order.received_quantity));
  if (total > open) problems.push({ code: "MFG_FGR_QTY_EXCEEDS", message: `${order.mo_number} has ${q(open)} accepted output waiting to be received; this receipt takes ${q(total)}.` });
  const cost = total > ZERO ? await costOf(client, c, order, total) : null;
  if (cost && cost.status !== "READY") problems.push({ code: cost.code, message: cost.message });
  const costView = has(c, FGR.costView) || has(c, "manufacturing.mo.cost_view");
  return {
    receiptId: receipt.id, receiptNumber: receipt.receipt_number, previewOnly: true, checkedAt: new Date().toISOString(), ok: problems.length === 0,
    readiness: problems.length === 0 ? "READY_TO_POST" : approval.required && !approval.valid && problems.length === 1 ? "PENDING_APPROVAL" : "BLOCKED",
    approval, problems, quantity: q(total), uom: item.uom_code, trackingType: item.tracking_type,
    cost: cost ? { status: cost.status, unitCost: costView && cost.unitCost !== null ? q(cost.unitCost) : null, total: costView && cost.total !== null ? money(cost.total) : null,
      wipBefore: costView ? money(cost.wipBefore) : null, wipAfter: costView && cost.wipAfter !== undefined ? money(cost.wipAfter) : null, basis: costView ? cost.basis : [] } : null,
    lines: rows.map((row) => {
      const source = sources.find((entry) => entry.row.id === row.production_entry_id);
      return { lineId: row.id, entryNumber: row.entry_number, quantity: q(D(row.base_quantity)), accepted: q(source?.figures.accepted ?? ZERO), received: q(source?.figures.received ?? ZERO),
        receivable: q(source?.receivable ?? ZERO), ok: Boolean(source) && D(row.base_quantity) <= (source?.receivable ?? ZERO) };
    }),
  };
}

// ------------------------------------------------------------------ approval of a receipt into another warehouse
// input: { reason, expectedVersion? }
export async function requestFinishedGoodsReceiptApproval(client, c, id, input = {}) {
  needFgr(c, FGR.editDraft);
  const receipt = await loadReceipt(client, c, id, { lock: true });
  if (!UNPOSTED.has(receipt.status)) throw fgrError(409, receipt.status === "POSTED" ? "MFG_FGR_ALREADY_POSTED" : "MFG_FGR_STATE_INVALID");
  versionCheck(receipt, input.expectedVersion);
  const order = await loadReceiptOrder(client, c, receipt.manufacturing_order_id);
  if (!approvalState(receipt, order).required) throw fgrError(409, "MFG_FGR_STATE_INVALID", "This receipt goes to the order's finished-goods warehouse; no approval is needed.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw fgrError(400, "MFG_FGR_REASON_REQUIRED", "Say why the goods go to another warehouse.");
  await client.query(`UPDATE tenant.manufacturing_finished_goods_receipts SET status = 'PENDING_APPROVAL', approval_status = 'REQUESTED', approval_hash = content_hash, approval_reason = $3,
      approval_requested_by = $4, approval_requested_at = clock_timestamp(), approved_by = NULL, approved_at = NULL, approval_note = NULL, row_version = row_version + 1
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, receipt.id, reason, c.userId ?? null]);
  await receiptEvent(client, c, receipt.id, "APPROVAL_REQUESTED", { from: receipt.status, to: "PENDING_APPROVAL", summary: reason });
  return getFinishedGoodsReceipt(client, c, receipt.id);
}
// input: { decision: APPROVE | REJECT, note?, expectedVersion? }. By someone other than the requester unless the company allows it.
export async function decideFinishedGoodsReceiptApproval(client, c, id, input = {}) {
  needFgr(c, FGR.approveCorrection);
  const receipt = await loadReceipt(client, c, id, { lock: true });
  if (receipt.status !== "PENDING_APPROVAL" || receipt.approval_status !== "REQUESTED") throw fgrError(409, "MFG_FGR_STATE_INVALID", "This receipt is not waiting for an approval.");
  versionCheck(receipt, input.expectedVersion);
  const settings = await receiptSettings(client, c);
  if (receipt.approval_requested_by === c.userId && !settings.varianceSelfApproval) throw fgrError(409, "MFG_FGR_APPROVAL_SELF");
  const decision = String(input.decision ?? "").toUpperCase();
  if (!["APPROVE", "REJECT"].includes(decision)) throw fgrError(400, "MFG_FGR_STATE_INVALID", "Approve or reject the request.");
  const note = text(input.note, 1000) || null;
  if (decision === "REJECT" && (!note || note.length < 3)) throw fgrError(400, "MFG_FGR_REASON_REQUIRED", "Say why it is rejected.");
  if (receipt.approval_hash !== receipt.content_hash) throw fgrError(409, "MFG_FGR_DOCUMENT_CHANGED");
  await client.query(`UPDATE tenant.manufacturing_finished_goods_receipts SET status = 'DRAFT', approval_status = $3, approved_by = $4, approved_at = clock_timestamp(), approval_note = $5,
      row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, receipt.id, decision === "APPROVE" ? "APPROVED" : "REJECTED", c.userId ?? null, note]);
  await receiptEvent(client, c, receipt.id, decision === "APPROVE" ? "APPROVED" : "REJECTED", { from: receipt.status, to: "DRAFT", summary: note });
  return getFinishedGoodsReceipt(client, c, receipt.id);
}

// ------------------------------------------------------------------ posting
// input: { expectedVersion?, expectedMoVersion? }. Under the order's lock: revalidates the output each line claims (so two storekeepers
// receiving the same output at once cannot both succeed), the destination, tracking and cost; receives the stock line by line; values it;
// posts one finished-goods journal; writes the order's receipt record and the entries it received from; and hands received output made for
// customer demand to Sales (a failure there leaves the receipt posted and lists an allocation exception).
export async function postFinishedGoodsReceipt(client, c, id, input = {}) {
  needFgr(c, FGR.post);
  if (!has(c, "stock.receive")) throw fgrError(403, "MFG_FGR_PERMISSION_DENIED", "Inventory: you also need permission to receive stock.");
  const receipt = await loadReceipt(client, c, id, { lock: true });
  const postingKey = `fgr:${receipt.id}:v${receipt.row_version}`;
  if (receipt.status === "POSTED" || receipt.status === "RECOVERY_REQUIRED") {
    if (input.expectedVersion === undefined || input.expectedVersion === null || Number(input.expectedVersion) === Number(receipt.row_version)) {
      return { ...(await postingResult(client, c, receipt.id)), replayed: true };
    }
    throw fgrError(409, "MFG_FGR_ALREADY_POSTED");
  }
  if (!UNPOSTED.has(receipt.status)) throw fgrError(409, "MFG_FGR_STATE_INVALID", `${receipt.receipt_number} is ${receipt.status.toLowerCase()}.`);
  versionCheck(receipt, input.expectedVersion);
  let order = await loadReceiptOrder(client, c, receipt.manufacturing_order_id, { lock: true });
  if (input.expectedMoVersion !== undefined && input.expectedMoVersion !== null && Number(input.expectedMoVersion) !== Number(order.version)) {
    throw fgrError(409, "MFG_FGR_DOCUMENT_CHANGED", `${order.mo_number} changed since this receipt was checked. Review it again.`);
  }
  requireReceivable(order, await receiptSettings(client, c));
  // Labor and overhead due on the output so far are applied first (Production Costing), so the receipt carries them.
  const { applyCostsBeforeReceipt } = await import("../costing/cost-service.js");
  await applyCostsBeforeReceipt(client, c, order);
  order = await loadReceiptOrder(client, c, order.id, { lock: true });
  const item = await loadFinishedItem(client, c, order);
  if (item.id !== receipt.finished_item_id) throw fgrError(409, "MFG_FGR_SOURCE_INVALID", "The receipt's product is not the order's finished item.");
  const rows = await loadReceiptLines(client, c, receipt.id);
  if (!rows.length) throw fgrError(400, "MFG_FGR_EMPTY");
  if (contentHash(receipt, rows) !== receipt.content_hash) throw fgrError(409, "MFG_FGR_DOCUMENT_CHANGED");
  const approval = approvalState(receipt, order);
  if (approval.required && !approval.valid) throw fgrError(409, "MFG_FGR_APPROVAL_REQUIRED", approval.message);
  await resolveDestination(client, c, order, { destinationWarehouseId: receipt.destination_warehouse_id, destinationLocationId: receipt.destination_location_id });
  // The claim: the entries locked with the order, each line within what its entry may still give right now.
  const sources = await receivableSources(client, c, order, { lock: true });
  let lines;
  try { lines = await resolveLines(client, c, order, item, sources, asInput(rows)); } catch (error) {
    if (error.code === "MFG_FGR_QTY_EXCEEDS") throw fgrError(409, "MFG_FGR_CONCURRENT_RECEIPT", `${error.message} Another receipt took some of it: refresh the quantity.`, error.details);
    throw error;
  }
  const total = lines.reduce((sum, line) => add(sum, line.baseQuantity), ZERO);
  if (total > sub(D(order.accepted_quantity), D(order.received_quantity))) throw fgrError(409, "MFG_FGR_CONCURRENT_RECEIPT");
  const cost = await costOf(client, c, order, total);
  if (cost.status !== "READY") throw fgrError(409, cost.code, cost.message);
  const unitCost = div(cost.total, total);
  const reference = `${receipt.receipt_number} · ${order.mo_number}`;
  const ctx = stockCtx(c);

  // 1. Inventory: every line (a refusal stops the whole receipt; nothing posts).
  const received = [];
  for (const [index, line] of lines.entries()) {
    const row = rows[index];
    const keyOf = `${postingKey}:${row.line_number}`;
    let lotId = null;
    let movementIds;
    let serials = [];
    try {
      if (item.tracking_type === "batch") {
        const existing = (await client.query(`SELECT id FROM tenant.stock_batches WHERE organization_id = $1 AND item_id = $2 AND lower(batch_number) = lower($3)`, [c.organizationId, item.id, line.lotNumber])).rows[0];
        lotId = existing?.id ?? (await createStockBatch(client, ctx, { itemId: item.id, batchNumber: line.lotNumber, manufacturedOn: line.manufacturedOn, expiresOn: line.expiresOn,
          notes: `Made on ${order.mo_number} (${row.entry_number})` })).id;
      }
      if (item.tracking_type === "serial") {
        const result = await receiveSerializedStock(client, ctx, { itemId: item.id, warehouseId: receipt.destination_warehouse_id, warehouseLocationId: receipt.destination_location_id,
          serialNumbers: line.serialNumbers, unitCost: q(unitCost), referenceType: SOURCE, referenceId: order.id, sourceLineId: row.id, reason: `Finished goods ${reference}`, idempotencyKey: keyOf });
        movementIds = (result.movements ?? [result.movement]).map((movement) => movement.id);
        serials = (result.serials ?? []).map((serial, at) => ({ number: serial.serial_number, id: serial.id, movementId: movementIds[at] ?? null }));
      } else {
        const movement = await postStockMovement(client, ctx, { movementType: "receipt", itemId: item.id, warehouseId: receipt.destination_warehouse_id,
          warehouseLocationId: receipt.destination_location_id ?? undefined, batchId: lotId ?? undefined, quantity: q(line.baseQuantity), unitCost: q(unitCost), referenceType: SOURCE,
          referenceId: order.id, sourceLineId: row.id, reason: `Finished goods ${reference}`, idempotencyKey: keyOf });
        movementIds = [movement.id];
      }
    } catch (error) { throw stockFailure(error); }
    const value = await valuationOfMovements(client, c.organizationId, movementIds);
    received.push({ line, row, lotId, movementIds, serials, cost: D(money(D(Math.abs(Number(value.total)).toFixed(6)))) });
  }
  const allMovements = received.flatMap((part) => part.movementIds);
  const totalCost = received.reduce((sum, part) => add(sum, part.cost), ZERO);

  // 2. Finance: finished goods out of work in progress, at Inventory's valuation.
  const journal = await postJournal(client, c, { event: "manufacturing_goods_receipt", sourceType: "manufacturing_goods_receipt", sourceId: receipt.id, sourceNumber: receipt.receipt_number, reference,
    description: `Finished goods received from ${order.mo_number}`,
    lines: [{ mappingKey: "inventory", itemId: item.id, label: "Finished goods", debit: totalCost }, { mappingKey: "wip", label: "Work in progress", credit: totalCost }] });

  // 3. Manufacturing: the order's receipt record (its figures are built from it), the entries it received from, the serial units.
  const goodsReceiptId = randomUUID();
  const lots = [...new Set(received.map((part) => part.lotId).filter(Boolean))];
  const serialNumbers = received.flatMap((part) => part.line.serialNumbers ?? []);
  // The applied labor and overhead this receipt capitalises (the rest of its value is material, at Inventory's valuation).
  const conversion = cost.conversion > totalCost ? totalCost : cost.conversion;
  const basis = { policy: "Planned material per unit at actual average issue cost, plus applied labor and overhead per equivalent accepted unit", lines: cost.basis,
    material: money(sub(totalCost, conversion)), conversion: money(conversion), wipBefore: money(cost.wipBefore), at: new Date().toISOString() };
  await client.query(
    `INSERT INTO tenant.manufacturing_goods_receipts (id, organization_id, manufacturing_order_id, receipt_number, item_id, warehouse_id, quantity, unit_cost, total_cost, cost_basis, batch_id, serial_numbers,
       stock_movement_ids, journal_entry_id, idempotency_key, received_by, finished_goods_receipt_id, location_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::uuid[],$14,$15,$16,$17,$18)`,
    [goodsReceiptId, c.organizationId, order.id, receipt.receipt_number, item.id, receipt.destination_warehouse_id, q(total), q(div(totalCost, total)), money(totalCost), JSON.stringify(basis),
      lots.length === 1 ? lots[0] : null, serialNumbers.length ? serialNumbers : null, allMovements, journal, postingKey, c.userId ?? null, receipt.id, receipt.destination_location_id]);
  for (const part of received) {
    const { line, row } = part;
    await client.query(`INSERT INTO tenant.manufacturing_goods_receipt_allocations (organization_id, goods_receipt_id, production_entry_id, quantity) VALUES ($1,$2,$3,$4)`,
      [c.organizationId, goodsReceiptId, line.entryId, q(line.baseQuantity)]);
    await client.query(`UPDATE tenant.manufacturing_production_entries SET received_quantity = received_quantity + $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, line.entryId, q(line.baseQuantity)]);
    await client.query(`INSERT INTO tenant.manufacturing_production_entry_events (organization_id, production_entry_id, action, summary, details, actor_user_id) VALUES ($1,$2,'RECEIVED',$3,'{}'::jsonb,$4)`,
      [c.organizationId, line.entryId, `${receipt.receipt_number}: ${q(line.baseQuantity)} into stock`, c.userId ?? null]);
    await client.query(`UPDATE tenant.manufacturing_finished_goods_receipt_lines SET lot_id = $3, stock_movement_ids = $4::uuid[], unit_cost = $5, total_cost = $6 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, row.id, part.lotId, part.movementIds, q(div(part.cost, line.baseQuantity)), money(part.cost)]);
    for (const serial of part.serials) {
      await client.query(`INSERT INTO tenant.manufacturing_finished_goods_serials (organization_id, receipt_line_id, production_entry_id, serial_number, serial_id, stock_movement_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [c.organizationId, row.id, line.entryId, serial.number, serial.id, serial.movementId]);
    }
  }
  await client.query(`UPDATE tenant.manufacturing_orders SET received_quantity = received_quantity + $3, wip_capitalised_cost = wip_capitalised_cost + $4,
      wip_conversion_capitalised_cost = wip_conversion_capitalised_cost + $5, version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, order.id, q(total), money(totalCost), money(conversion)]);
  await client.query(`INSERT INTO tenant.manufacturing_finished_goods_receipt_postings (organization_id, receipt_id, command_key, document_version, kind, inventory_status, stock_movement_ids, finance_status,
      journal_entry_id, quantity, amount, created_by) VALUES ($1,$2,$3,$4,'RECEIPT','CONFIRMED',$5::uuid[],$6,$7,$8,$9,$10)`,
    [c.organizationId, receipt.id, postingKey, receipt.row_version, allMovements, journal ? "POSTED" : "NOT_REQUIRED", journal, q(total), money(totalCost), c.userId ?? null]);
  await client.query(
    `UPDATE tenant.manufacturing_finished_goods_receipts SET status = 'POSTED', posting_key = $3, posted_mo_version = $4, posted_by = $5, posted_at = clock_timestamp(), goods_receipt_id = $6,
       unit_cost = $7, total_cost = $8, cost_basis = $9::jsonb, journal_entry_id = $10, finance_status = $11 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, receipt.id, postingKey, order.version, c.userId ?? null, goodsReceiptId, q(div(totalCost, total)), money(totalCost), JSON.stringify(basis), journal, journal ? "POSTED" : "NOT_REQUIRED"]);
  const summary = lines.map((line) => `${line.source.row.entry_number} ${q(line.baseQuantity)}`).join(", ");
  await receiptEvent(client, c, receipt.id, "POSTED", { from: receipt.status, to: "POSTED", summary: `${q(total)} ${item.uom_code} into stock (${summary})`,
    details: { postingKey, movements: allMovements.length } });
  await orderEvent(client, c, order.id, "GOODS_RECEIVED", { summary: `${receipt.receipt_number}: ${q(total)} ${item.uom_code} into stock (${summary})`, details: { receiptId: receipt.id } });

  // 4. Sales: output made for customer demand is attributed to it and reserved for its order. A failure keeps the receipt and lists an exception.
  const demandLinked = order.source_demand_type === "SALES_ORDER"
    || (await client.query(`SELECT 1 FROM tenant.manufacturing_demand_allocations WHERE manufacturing_order_id = $1 AND status <> 'RELEASED' LIMIT 1`, [order.id])).rows[0];
  if (demandLinked) {
    try {
      const demand = await atomically(client, () => attributeReceiptToDemand(client, c, order, goodsReceiptId, q(total)));
      await receiptEvent(client, c, receipt.id, "DEMAND_ALLOCATED", { summary: Number(demand.unassigned) > 0 ? `${demand.unassigned} not assigned to a sales order` : "Assigned to its sales demand" });
    } catch (error) {
      await receiptEvent(client, c, receipt.id, "DEMAND_ALLOCATION_FAILED", { summary: error.message ?? "The sales allocation failed." });
    }
  }
  return postingResult(client, c, receipt.id);
}

async function postingResult(client, c, id) {
  const receipt = await getFinishedGoodsReceipt(client, c, id);
  return { receiptId: receipt.id, receiptNumber: receipt.number, status: receipt.status, postedQuantity: receipt.totals.quantity, inventoryTransactionIds: receipt.posting?.stockMovementIds ?? [],
    financeReconciliationStatus: receipt.posting?.financeStatus ?? null, postedAt: receipt.postedAt, receipt };
}

// input: { reason, expectedVersion? }. Only a note that never posted; it stays, cancelled, in the history.
export async function cancelFinishedGoodsReceipt(client, c, id, input = {}) {
  needFgr(c, FGR.cancelDraft);
  const receipt = await loadReceipt(client, c, id, { lock: true });
  if (receipt.status === "CANCELLED") return getFinishedGoodsReceipt(client, c, receipt.id);
  if (!UNPOSTED.has(receipt.status)) throw fgrError(409, receipt.status === "POSTED" ? "MFG_FGR_ALREADY_POSTED" : "MFG_FGR_STATE_INVALID",
    receipt.status === "POSTED" ? "A posted receipt is not cancelled: request a correction instead." : undefined);
  versionCheck(receipt, input.expectedVersion);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw fgrError(400, "MFG_FGR_REASON_REQUIRED", "Say why the receipt is cancelled.");
  await client.query(`UPDATE tenant.manufacturing_finished_goods_receipts SET status = 'CANCELLED', cancelled_by = $3, cancelled_at = clock_timestamp(), cancel_reason = $4, row_version = row_version + 1
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, receipt.id, c.userId ?? null, reason]);
  await receiptEvent(client, c, receipt.id, "CANCELLED", { from: receipt.status, to: "CANCELLED", summary: reason });
  return getFinishedGoodsReceipt(client, c, receipt.id);
}

// ------------------------------------------------------------------ the order's direct receipt (the same posting path)
// The order's "Receive goods" (input: { quantity, productionEntryId?, batchNumber?, expiresOn?, serialNumbers?, idempotencyKey }): a receipt note
// created from the accepted output (the named entry, else oldest accepted first) and posted at once, under the request key — one posting
// path whatever the entry point. Into the order's finished-goods warehouse.
export async function receiveThroughNote(client, c, orderId, input = {}) {
  const key = text(input.idempotencyKey, 200);
  if (!key) throw moError(400, "MFG_MO_KEY_REQUIRED");
  const noteKey = `mo-receipt:${key}`;
  const existing = (await client.query(`SELECT id, manufacturing_order_id, status FROM tenant.manufacturing_finished_goods_receipts WHERE organization_id = $1 AND idempotency_key = $2`,
    [c.organizationId, noteKey])).rows[0];
  if (existing) {
    if (existing.manufacturing_order_id !== orderId) throw fgrError(409, "MFG_FGR_DOCUMENT_CHANGED", "That request key was used for another order.");
    const result = existing.status === "POSTED" ? await postingResult(client, c, existing.id) : await postFinishedGoodsReceipt(client, c, existing.id, {});
    return { orderId, receiptId: result.receiptId, receiptNumber: result.receiptNumber, replayed: existing.status === "POSTED" };
  }
  const order = await loadReceiptOrder(client, c, orderId);
  requireReceivable(order, await receiptSettings(client, c));
  const item = await loadFinishedItem(client, c, order);
  const all = await receivableSources(client, c, order);
  const named = input.productionEntryId ? all.find((source) => source.row.id === input.productionEntryId) : null;
  if (input.productionEntryId && (!named || named.figures.accepted === ZERO)) throw fgrError(409, "MFG_FGR_NO_ACCEPTED_OUTPUT", "That production entry has no accepted output to receive.");
  const sources = all.filter((source) => source.receivable > ZERO && (!named || source.row.id === named.row.id));
  const raw = String(input.quantity ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(raw) || !(Number(raw) > 0)) throw fgrError(400, "MFG_FGR_QTY_INVALID");
  let left = D(raw);
  const available = sources.reduce((sum, source) => add(sum, source.receivable), ZERO);
  if (left > available) throw fgrError(409, "MFG_FGR_QTY_EXCEEDS", `${q(available)} accepted output${input.productionEntryId ? " of that entry" : ""} is waiting to be received.`);
  const serials = item.tracking_type === "serial" ? [...new Set((Array.isArray(input.serialNumbers) ? input.serialNumbers : String(input.serialNumbers ?? "").split(/[\s,;]+/)).map((value) => text(value, 120)).filter(Boolean))] : [];
  if (item.tracking_type === "serial" && D(String(serials.length)) !== left) throw fgrError(400, "MFG_FGR_SERIAL_INVALID", `${item.code} is serial-numbered: give exactly ${q(left)} unique serial number(s).`);
  const lines = [];
  for (const source of sources) {
    if (left <= ZERO) break;
    const take = source.receivable < left ? source.receivable : left;
    const count = Number(q(take));
    lines.push({ productionEntryId: source.row.id, quantity: q(take), uomId: item.uom_id, lotNumber: input.batchNumber || undefined, expiresOn: input.expiresOn || undefined,
      serialNumbers: item.tracking_type === "serial" ? serials.splice(0, count) : undefined });
    left = sub(left, take);
  }
  return atomically(client, async () => {
    const draft = await createFinishedGoodsReceiptDraft(client, c, { manufacturingOrderId: orderId, lines, idempotencyKey: noteKey, notes: input.note });
    const result = await postFinishedGoodsReceipt(client, c, draft.id, { expectedVersion: draft.rowVersion });
    return { orderId, receiptId: result.receiptId, receiptNumber: result.receiptNumber };
  });
}

// ------------------------------------------------------------------ correction
// A posted receipt is never edited. A correction is requested with a reason; someone else approves it, which reverses the whole receipt —
// the exact Inventory movements (same lots, serial units and bin, at their original value) and the value back from finished goods to work
// in progress — and makes its output receivable again. The correct quantity is then received on a new receipt. Goods that moved on (sold,
// transferred, consumed or reserved for a customer) cannot be reversed this way: Inventory refuses, and the request says so.
// input: { reason, evidence?, idempotencyKey }
export async function requestFinishedGoodsReceiptCorrection(client, c, id, input = {}) {
  needFgr(c, FGR.requestCorrection);
  const key = text(input.idempotencyKey, 200);
  if (!key) throw moError(400, "MFG_MO_KEY_REQUIRED");
  const done = (await client.query(`SELECT receipt_id FROM tenant.manufacturing_finished_goods_receipt_corrections WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
  if (done) return { ...(await getFinishedGoodsReceipt(client, c, done.receipt_id)), replayed: true };
  const receipt = await loadReceipt(client, c, id, { lock: true });
  if (receipt.status !== "POSTED") throw fgrError(409, "MFG_FGR_STATE_INVALID", "Only a posted receipt is corrected; a draft is edited or cancelled.");
  if (receipt.correction_status === "REVERSED") throw fgrError(409, "MFG_FGR_CORRECTION_BLOCKED", `${receipt.receipt_number} is reversed already.`);
  if (receipt.correction_status === "REQUESTED") throw fgrError(409, "MFG_FGR_STATE_INVALID", `A correction of ${receipt.receipt_number} already waits for a decision.`);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw fgrError(400, "MFG_FGR_REASON_REQUIRED", "Say what went wrong with this receipt.");
  await blockersOfReversal(client, c, receipt, { throwFirst: true });
  const quantity = (await client.query(`SELECT quantity FROM tenant.manufacturing_goods_receipts WHERE id = $1`, [receipt.goods_receipt_id])).rows[0].quantity;
  const number = await nextNumber(client, c, "manufacturing_goods_receipt_correction");
  await client.query(`INSERT INTO tenant.manufacturing_finished_goods_receipt_corrections (organization_id, correction_number, receipt_id, quantity, reason, evidence, requested_by, idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [c.organizationId, number, receipt.id, quantity, reason, text(input.evidence, 1000) || null, c.userId ?? null, key]);
  await client.query(`UPDATE tenant.manufacturing_finished_goods_receipts SET correction_status = 'REQUESTED' WHERE organization_id = $1 AND id = $2`, [c.organizationId, receipt.id]);
  await receiptEvent(client, c, receipt.id, "CORRECTION_REQUESTED", { summary: `${number}: ${reason}` });
  return getFinishedGoodsReceipt(client, c, receipt.id);
}

// Why a posted receipt cannot simply be reversed now: the order is closed, its output was handed to a customer's demand, or the stock moved on.
export async function blockersOfReversal(client, c, receipt, { throwFirst = false } = {}) {
  const blockers = [];
  const order = await loadReceiptOrder(client, c, receipt.manufacturing_order_id);
  if (["COMPLETED", "CANCELLED"].includes(order.status)) blockers.push(`${order.mo_number} is ${order.status.toLowerCase()}: its receipts are history.`);
  // Output handed to a customer's demand (attributed, and reserved for the sales order where it could be) stays with that order.
  const demand = (await client.query(`SELECT count(*)::int AS n FROM tenant.manufacturing_demand_events WHERE organization_id = $1 AND source_type = 'manufacturing_goods_receipt' AND source_id = $2
      AND action = 'OUTPUT_RECEIVED'`, [c.organizationId, receipt.goods_receipt_id])).rows[0];
  if (demand?.n) blockers.push("These goods were assigned to a customer's sales demand: correct them through Sales and Inventory instead.");
  const movements = (await client.query(`SELECT stock_movement_ids FROM tenant.manufacturing_goods_receipts WHERE id = $1`, [receipt.goods_receipt_id])).rows[0]?.stock_movement_ids ?? [];
  if (movements.length) {
    const reversedAlready = (await client.query(`SELECT count(*)::int AS n FROM tenant.stock_movements WHERE organization_id = $1 AND reversed_movement_id = ANY($2::uuid[])`, [c.organizationId, movements])).rows[0].n;
    if (reversedAlready) blockers.push("Inventory has already reversed part of this receipt.");
  }
  if (throwFirst && blockers.length) throw fgrError(409, "MFG_FGR_CORRECTION_BLOCKED", blockers[0], { blockers });
  return blockers;
}

// input: { decision: APPROVE | REJECT, note?, idempotencyKey? }. By someone who may approve corrections, other than the requester unless the company allows it.
export async function decideFinishedGoodsReceiptCorrection(client, c, id, input = {}) {
  needFgr(c, FGR.approveCorrection);
  const receipt = await loadReceipt(client, c, id, { lock: true });
  const correction = (await client.query(`SELECT * FROM tenant.manufacturing_finished_goods_receipt_corrections WHERE organization_id = $1 AND receipt_id = $2 AND status = 'REQUESTED' FOR UPDATE`,
    [c.organizationId, receipt.id])).rows[0];
  if (!correction) {
    if (receipt.correction_status === "REVERSED" || receipt.correction_status === "REJECTED") return { ...(await getFinishedGoodsReceipt(client, c, receipt.id)), replayed: true };
    throw fgrError(409, "MFG_FGR_STATE_INVALID", "No correction of this receipt waits for a decision.");
  }
  const settings = await receiptSettings(client, c);
  if (correction.requested_by === c.userId && !settings.varianceSelfApproval) throw fgrError(409, "MFG_FGR_APPROVAL_SELF");
  const decision = String(input.decision ?? "").toUpperCase();
  if (!["APPROVE", "REJECT"].includes(decision)) throw fgrError(400, "MFG_FGR_STATE_INVALID", "Approve or reject the correction.");
  const note = text(input.note, 1000) || null;
  if (decision === "REJECT") {
    if (!note || note.length < 3) throw fgrError(400, "MFG_FGR_REASON_REQUIRED", "Say why the correction is rejected.");
    await client.query(`UPDATE tenant.manufacturing_finished_goods_receipt_corrections SET status = 'REJECTED', decided_by = $3, decided_at = clock_timestamp(), decision_note = $4 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, correction.id, c.userId ?? null, note]);
    await client.query(`UPDATE tenant.manufacturing_finished_goods_receipts SET correction_status = 'REJECTED' WHERE organization_id = $1 AND id = $2`, [c.organizationId, receipt.id]);
    await receiptEvent(client, c, receipt.id, "CORRECTION_REJECTED", { summary: `${correction.correction_number}: ${note}` });
    return getFinishedGoodsReceipt(client, c, receipt.id);
  }
  if (!has(c, "stock.issue")) throw fgrError(403, "MFG_FGR_PERMISSION_DENIED", "Inventory: you also need permission to issue stock to reverse a receipt.");
  const order = await loadReceiptOrder(client, c, receipt.manufacturing_order_id, { lock: true });
  await blockersOfReversal(client, c, receipt, { throwFirst: true });
  const record = (await client.query(`SELECT * FROM tenant.manufacturing_goods_receipts WHERE organization_id = $1 AND id = $2`, [c.organizationId, receipt.goods_receipt_id])).rows[0];
  const allocations = (await client.query(`SELECT * FROM tenant.manufacturing_goods_receipt_allocations WHERE organization_id = $1 AND goods_receipt_id = $2`, [c.organizationId, record.id])).rows;
  // 1. Inventory: the exact movements back out (Inventory refuses what was sold, moved or used since).
  let back;
  try {
    back = await reverseStockMovements(client, stockCtx(c), record.stock_movement_ids, { reason: `Reversal of ${receipt.receipt_number}: ${correction.reason}`, referenceType: SOURCE, referenceId: order.id,
      keyPrefix: `fgc:${correction.id}` });
  } catch (error) { throw stockFailure(error, "MFG_FGR_CORRECTION_BLOCKED"); }
  const cost = D(record.total_cost);
  // 2. Finance: the value back from finished goods to work in progress.
  const journal = await postJournal(client, c, { event: "manufacturing_goods_receipt_reversal", sourceType: "manufacturing_goods_receipt_correction", sourceId: correction.id,
    sourceNumber: correction.correction_number, reference: `${correction.correction_number} · ${receipt.receipt_number} · ${order.mo_number}`, description: `Reversal of ${receipt.receipt_number}`,
    lines: [{ mappingKey: "wip", label: "Work in progress", debit: cost }, { mappingKey: "inventory", itemId: record.item_id, label: "Finished goods", credit: cost }] });
  // 3. Manufacturing: the entries' output receivable again, the order's received figure and capitalised value back.
  for (const allocation of allocations) {
    await client.query(`UPDATE tenant.manufacturing_production_entries SET receipt_reversed_quantity = receipt_reversed_quantity + $3 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, allocation.production_entry_id, q(D(allocation.quantity))]);
    await client.query(`INSERT INTO tenant.manufacturing_production_entry_events (organization_id, production_entry_id, action, summary, details, actor_user_id) VALUES ($1,$2,'RECEIPT_REVERSED',$3,'{}'::jsonb,$4)`,
      [c.organizationId, allocation.production_entry_id, `${correction.correction_number}: ${q(D(allocation.quantity))} back to receivable`, c.userId ?? null]);
  }
  // The applied labor and overhead it had capitalised go back to work in progress with it.
  const conversionBack = record.cost_basis?.conversion ? D(record.cost_basis.conversion) : ZERO;
  await client.query(`UPDATE tenant.manufacturing_orders SET received_quantity = received_quantity - $3, wip_capitalised_cost = wip_capitalised_cost - $4,
      wip_conversion_capitalised_cost = GREATEST(wip_conversion_capitalised_cost - $5, 0), version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, order.id, q(D(record.quantity)), money(cost), money(conversionBack)]);
  const movementIds = back.movements.map((movement) => movement.id);
  await client.query(`UPDATE tenant.manufacturing_finished_goods_receipt_corrections SET status = 'APPROVED', decided_by = $3, decided_at = clock_timestamp(), decision_note = $4, stock_movement_ids = $5::uuid[],
      total_cost = $6, journal_entry_id = $7 WHERE organization_id = $1 AND id = $2`, [c.organizationId, correction.id, c.userId ?? null, note, movementIds, money(cost), journal]);
  await client.query(`INSERT INTO tenant.manufacturing_finished_goods_receipt_postings (organization_id, receipt_id, command_key, document_version, kind, inventory_status, stock_movement_ids, finance_status,
      journal_entry_id, quantity, amount, created_by) VALUES ($1,$2,$3,$4,'REVERSAL','CONFIRMED',$5::uuid[],$6,$7,$8,$9,$10)`,
    [c.organizationId, receipt.id, `fgc:${correction.id}`, receipt.row_version, movementIds, journal ? "POSTED" : "NOT_REQUIRED", journal, q(D(record.quantity)), money(cost), c.userId ?? null]);
  await client.query(`UPDATE tenant.manufacturing_finished_goods_receipts SET correction_status = 'REVERSED' WHERE organization_id = $1 AND id = $2`, [c.organizationId, receipt.id]);
  await receiptEvent(client, c, receipt.id, "REVERSED", { summary: `${correction.correction_number}: ${q(D(record.quantity))} reversed — ${correction.reason}${note ? ` (${note})` : ""}` });
  await orderEvent(client, c, order.id, "GOODS_RECEIPT_REVERSED", { summary: `${receipt.receipt_number} reversed by ${correction.correction_number}: ${correction.reason}` });
  return getFinishedGoodsReceipt(client, c, receipt.id);
}

// ------------------------------------------------------------------ printing and recovery
// The note to print (a draft prints as DRAFT): counted, never posting anything.
export async function recordFinishedGoodsReceiptPrint(client, c, id) {
  needFgr(c, FGR.export);
  const receipt = await loadReceipt(client, c, id, { lock: true });
  await client.query(`UPDATE tenant.manufacturing_finished_goods_receipts SET print_count = print_count + 1, last_printed_at = clock_timestamp() WHERE organization_id = $1 AND id = $2`, [c.organizationId, receipt.id]);
  await receiptEvent(client, c, receipt.id, receipt.print_count > 0 ? "REPRINTED" : "PRINTED", { summary: receipt.status === "POSTED" ? `Copy ${receipt.print_count + 1}` : "Draft preview" });
  return getFinishedGoodsReceipt(client, c, receipt.id);
}

// Re-check a posted receipt against Inventory and Finance: one that disagrees is marked for recovery, one that agrees again returns to posted.
export async function recoverFinishedGoodsReceipt(client, c, id) {
  needFgr(c, FGR.approveCorrection);
  const { checkFinishedGoodsReceiptPosting } = await import("./fgr-read.js");
  const receipt = await loadReceipt(client, c, id, { lock: true });
  if (!["POSTED", "RECOVERY_REQUIRED"].includes(receipt.status)) throw fgrError(409, "MFG_FGR_STATE_INVALID", "Only a posted receipt is checked against Inventory and Finance.");
  const check = await checkFinishedGoodsReceiptPosting(client, c, receipt.id);
  const to = check.consistent ? "POSTED" : "RECOVERY_REQUIRED";
  if (to !== receipt.status) {
    await client.query(`UPDATE tenant.manufacturing_finished_goods_receipts SET status = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, receipt.id, to]);
    await receiptEvent(client, c, receipt.id, to === "POSTED" ? "RECOVERED" : "RECOVERY_REQUIRED", { from: receipt.status, to, summary: check.problems.join(" ") || "Inventory and Finance agree" });
  }
  return { check, receipt: await getFinishedGoodsReceipt(client, c, receipt.id) };
}
