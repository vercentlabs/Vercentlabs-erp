// Partial Production — the commands: production batches; production entries as documents (draft → reported) with the order's counters moved
// only when an entry posts; quality decisions on what awaits inspection; finished-goods receipts in parts, each naming the entries it
// received; overproduction allowances requested and approved by someone else; linked corrections of reported output; and printing. Stock
// moves only through Inventory (receipts), money only through Finance; nothing here consumes material or delivers to a customer.
import { randomUUID } from "node:crypto";

import {
  atomically, event, idempotent, loadMaterials, money, moError, needMo, nextNumber, quantity, requireStatus,
} from "../orders/mo-core.js";
import { getManufacturingOrder } from "../orders/mo-read.js";
import { QI } from "../quality/qi-core.js";
import { decideThroughInspection } from "../quality/qi-service.js";
import {
  D, DISPOSITIONS, MO, PRODUCTION, STATUS_LABEL, ZERO, add, authorizedTarget, decisionsOf, entryFigures, has, loadEntry, loadProductionOrder, materialReadiness, needProduction, outputQuantity,
  productionError, productionSettings, q, requireProducing, splitOf, sub, text, uuid,
} from "./production-core.js";

const withOrder = async (client, c, result) => ({ ...result, order: await getManufacturingOrder(client, c, result.orderId) });
async function entryEvent(client, c, entryId, action, summary = null, details = {}) {
  await client.query(`INSERT INTO tenant.manufacturing_production_entry_events (organization_id, production_entry_id, action, summary, details, actor_user_id) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [c.organizationId, entryId, action, summary ? String(summary).slice(0, 1000) : null, JSON.stringify(details), c.userId ?? null]);
}
const versionCheck = (entry, expected) => {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(entry.row_version)) throw productionError(409, "MFG_PARTIAL_SOURCE_CHANGED", "The entry changed. Review it and retry.");
};

// ------------------------------------------------------------------ production batches
// input: { batchReference, productionLocationId?, plannedQuantity?, notes? }
export async function createProductionBatch(client, c, orderId, input = {}) {
  needMo(c, MO.view);
  needProduction(c, PRODUCTION.editDraft);
  const order = await loadProductionOrder(client, c, orderId, { lock: true });
  requireProducing(order, { drafts: true });
  return openBatch(client, c, order, input);
}
async function openBatch(client, c, order, input) {
  const reference = text(input.batchReference, 120);
  if (!reference) throw productionError(400, "MFG_PARTIAL_BATCH_INVALID", "Give the production batch a reference.");
  const existing = (await client.query(`SELECT id FROM tenant.manufacturing_production_batches WHERE organization_id = $1 AND manufacturing_order_id = $2 AND lower(batch_reference) = lower($3)`,
    [c.organizationId, order.id, reference])).rows[0];
  if (existing) throw productionError(409, "MFG_PARTIAL_BATCH_INVALID", `${order.mo_number} already has a batch ${reference}.`);
  const locationId = await productionLocation(client, c, order, input.productionLocationId);
  let planned = null;
  if (input.plannedQuantity !== undefined && input.plannedQuantity !== null && String(input.plannedQuantity).trim() !== "") planned = (await outputQuantity(client, c, order, input.plannedQuantity, null)).base;
  const row = (await client.query(`INSERT INTO tenant.manufacturing_production_batches (organization_id, manufacturing_order_id, batch_reference, production_location_id, planned_quantity, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [c.organizationId, order.id, reference, locationId, planned === null ? null : q(planned), text(input.notes, 1000) || null, c.userId ?? null])).rows[0];
  await event(client, c, order.id, "PRODUCTION_BATCH_OPENED", { summary: `${reference}${planned ? ` · ${q(planned)} planned` : ""}` });
  return row;
}
export async function closeProductionBatch(client, c, orderId, batchId) {
  needProduction(c, PRODUCTION.editDraft);
  const order = await loadProductionOrder(client, c, orderId, { lock: true });
  const batch = (await client.query(`UPDATE tenant.manufacturing_production_batches SET status = 'CLOSED', ended_at = clock_timestamp(), closed_by = $4
      WHERE organization_id = $1 AND manufacturing_order_id = $2 AND id = $3 AND status = 'OPEN' RETURNING *`, [c.organizationId, order.id, uuid(batchId, "Batch"), c.userId ?? null])).rows[0];
  if (!batch) throw productionError(409, "MFG_PARTIAL_BATCH_INVALID", "That batch is not open on this order.");
  await event(client, c, order.id, "PRODUCTION_BATCH_CLOSED", { summary: batch.batch_reference });
  return batch;
}
async function productionLocation(client, c, order, locationId) {
  if (!locationId) return null;
  const row = (await client.query(`SELECT id FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2 AND warehouse_id = $3`, [c.organizationId, uuid(locationId, "Location"), order.manufacturing_warehouse_id])).rows[0];
  if (!row) throw productionError(400, "MFG_PARTIAL_BATCH_INVALID", "That location is not in the order's manufacturing warehouse.");
  return row.id;
}
async function resolveBatch(client, c, order, input, { create = false } = {}) {
  if (input.productionBatchId) {
    const batch = (await client.query(`SELECT * FROM tenant.manufacturing_production_batches WHERE organization_id = $1 AND manufacturing_order_id = $2 AND id = $3`,
      [c.organizationId, order.id, uuid(input.productionBatchId, "Batch")])).rows[0];
    if (!batch) throw productionError(400, "MFG_PARTIAL_BATCH_INVALID", "That batch is not on this order.");
    return batch;
  }
  const reference = text(input.batchReference, 120);
  if (reference) {
    const batch = (await client.query(`SELECT * FROM tenant.manufacturing_production_batches WHERE organization_id = $1 AND manufacturing_order_id = $2 AND lower(batch_reference) = lower($3)`,
      [c.organizationId, order.id, reference])).rows[0];
    if (batch) return batch;
    if (create) return openBatch(client, c, order, { batchReference: reference, productionLocationId: input.productionLocationId });
    throw productionError(400, "MFG_PARTIAL_BATCH_INVALID", `${order.mo_number} has no batch ${reference}: open it first.`);
  }
  if (!create) throw productionError(400, "MFG_PARTIAL_BATCH_INVALID");
  const count = Number((await client.query(`SELECT count(*) AS n FROM tenant.manufacturing_production_batches WHERE organization_id = $1 AND manufacturing_order_id = $2`, [c.organizationId, order.id])).rows[0].n);
  return openBatch(client, c, order, { batchReference: `${order.mo_number}-B${String(count + 1).padStart(2, "0")}`, productionLocationId: input.productionLocationId });
}

// ------------------------------------------------------------------ production entries
// input: { productionBatchId? | batchReference?, quantity, uomId?, productionLocationId?, producedAt?, notes?, acceptedQuantity?, rejectedQuantity?,
// pendingQuantity?, rejectionReason?, idempotencyKey? }
export async function createProductionEntryDraft(client, c, orderId, input = {}, { createBatch = false } = {}) {
  needMo(c, MO.view);
  needProduction(c, PRODUCTION.editDraft);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const existing = (await client.query(`SELECT id FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (existing) return { id: existing.id, replayed: true };
  }
  const order = await loadProductionOrder(client, c, orderId, { lock: true });
  requireProducing(order, { drafts: true });
  const batch = await resolveBatch(client, c, order, input, { create: createBatch });
  if (batch.status === "CLOSED") throw productionError(409, "MFG_PARTIAL_BATCH_INVALID", `Batch ${batch.batch_reference} is closed: open a new batch.`);
  const amount = await outputQuantity(client, c, order, input.quantity ?? input.reportedQuantity, input.uomId);
  const settings = await productionSettings(client, c);
  const split = splitOf(amount.base, input, settings);
  const fields = await entryFields(client, c, order, batch, input);
  const id = randomUUID();
  const number = await nextNumber(client, c, "manufacturing_production_entry");
  await client.query(
    `INSERT INTO tenant.manufacturing_production_entries (id, organization_id, manufacturing_order_id, entry_number, batch_reference, reported_quantity, accepted_quantity, rejected_quantity, pending_quantity,
       pending_remaining, rejection_reason, notes, idempotency_key, recorded_by, status, production_batch_id, production_location_id, entered_quantity, output_uom_id, conversion_factor, produced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,'DRAFT',$14,$15,$16,$17,$18,$19)`,
    [id, c.organizationId, order.id, number, batch.batch_reference, q(amount.base), q(split.accepted), q(split.rejected), q(split.pending), split.reason, fields.notes, key ?? `draft:${id}`, c.userId ?? null,
      batch.id, fields.locationId, amount.entered, amount.uomId, q(amount.factor, 9), fields.producedAt]);
  await entryEvent(client, c, id, "CREATED", `${number} · ${batch.batch_reference}: ${amount.entered} reported`);
  return { id, number };
}
async function entryFields(client, c, order, batch, input, existing = null) {
  const locationId = await productionLocation(client, c, order, input.productionLocationId === undefined ? existing?.production_location_id ?? batch.production_location_id : input.productionLocationId);
  let producedAt = input.producedAt === undefined ? existing?.produced_at ?? null : input.producedAt || null;
  if (producedAt) {
    const at = new Date(String(producedAt));
    if (Number.isNaN(at.getTime())) throw productionError(400, "MFG_PARTIAL_QTY_INVALID", "When it was produced is not a valid date and time.");
    if (at.getTime() > Date.now() + 5 * 60_000) throw productionError(400, "MFG_PARTIAL_QTY_INVALID", "Output cannot be reported for the future.");
    if (order.released_at && at < new Date(order.released_at)) throw productionError(400, "MFG_PARTIAL_QTY_INVALID", `Output cannot be earlier than ${order.mo_number}'s release.`);
    producedAt = at.toISOString();
  }
  return { locationId, producedAt, notes: input.notes === undefined ? existing?.notes ?? null : text(input.notes, 1000) || null };
}

export async function updateProductionEntryDraft(client, c, entryId, input = {}) {
  needProduction(c, PRODUCTION.editDraft);
  const entry = await loadEntry(client, c, entryId, { lock: true });
  if (entry.status !== "DRAFT") throw productionError(409, entry.status === "REPORTED" ? "MFG_PARTIAL_ENTRY_ALREADY_POSTED" : "MFG_PARTIAL_STATE_INVALID");
  versionCheck(entry, input.expectedVersion);
  const order = await loadProductionOrder(client, c, entry.manufacturing_order_id, { lock: true });
  requireProducing(order, { drafts: true });
  const batch = input.productionBatchId || input.batchReference ? await resolveBatch(client, c, order, input)
    : (await client.query(`SELECT * FROM tenant.manufacturing_production_batches WHERE id = $1`, [entry.production_batch_id])).rows[0];
  if (batch.status === "CLOSED") throw productionError(409, "MFG_PARTIAL_BATCH_INVALID", `Batch ${batch.batch_reference} is closed.`);
  const amount = await outputQuantity(client, c, order, input.quantity ?? entry.entered_quantity ?? q(D(entry.reported_quantity)), input.uomId ?? entry.output_uom_id);
  const settings = await productionSettings(client, c);
  const splitInput = ["acceptedQuantity", "rejectedQuantity", "pendingQuantity"].some((field) => input[field] !== undefined) ? input
    : input.quantity !== undefined ? input : { acceptedQuantity: q(D(entry.accepted_quantity)), rejectedQuantity: q(D(entry.rejected_quantity)), pendingQuantity: q(D(entry.pending_quantity)), rejectionReason: entry.rejection_reason };
  const split = splitOf(amount.base, splitInput, settings);
  const fields = await entryFields(client, c, order, batch, input, entry);
  await client.query(
    `UPDATE tenant.manufacturing_production_entries SET production_batch_id = $3, batch_reference = $4, reported_quantity = $5, accepted_quantity = $6, rejected_quantity = $7, pending_quantity = $8,
       pending_remaining = $8, rejection_reason = $9, notes = $10, production_location_id = $11, entered_quantity = $12, output_uom_id = $13, conversion_factor = $14, produced_at = $15,
       row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, entry.id, batch.id, batch.batch_reference, q(amount.base), q(split.accepted), q(split.rejected), q(split.pending), split.reason, fields.notes, fields.locationId, amount.entered,
      amount.uomId, q(amount.factor, 9), fields.producedAt]);
  await entryEvent(client, c, entry.id, "EDITED", `${amount.entered} reported`);
  return { id: entry.id };
}

export async function cancelProductionEntry(client, c, entryId, input = {}) {
  needProduction(c, PRODUCTION.editDraft);
  const entry = await loadEntry(client, c, entryId, { lock: true });
  if (entry.status === "CANCELLED") return { id: entry.id };
  if (entry.status !== "DRAFT") throw productionError(409, "MFG_PARTIAL_ENTRY_ALREADY_POSTED", "A reported entry is not cancelled; correct it if the output did not exist.");
  versionCheck(entry, input.expectedVersion);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw productionError(400, "MFG_PARTIAL_REASON_REQUIRED", "Say why the entry is cancelled.");
  await client.query(`UPDATE tenant.manufacturing_production_entries SET status = 'CANCELLED', cancelled_by = $3, cancelled_at = clock_timestamp(), cancel_reason = $4, row_version = row_version + 1
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id, c.userId ?? null, reason]);
  await entryEvent(client, c, entry.id, "CANCELLED", reason);
  return { id: entry.id };
}

// Posting: the order must be in production; accepted (and awaiting-inspection) output stays within the authorized target; a batch within its
// planned size; materials for the cumulative output issued or reserved (a warning, or under the company's BLOCK policy a refusal unless
// someone who may approve variances records why). input: { expectedVersion?, expectedMoVersion?, materialOverrideReason? }
export async function postProductionEntry(client, c, entryId, input = {}) {
  needMo(c, MO.record);
  needProduction(c, PRODUCTION.post);
  const entry = await loadEntry(client, c, entryId, { lock: true });
  if (entry.status === "REPORTED" || entry.status === "RECOVERY_REQUIRED") {
    if (input.expectedVersion === undefined || input.expectedVersion === null || Number(input.expectedVersion) === Number(entry.row_version)) return { orderId: entry.manufacturing_order_id, entryId: entry.id, entryNumber: entry.entry_number, replayed: true };
    throw productionError(409, "MFG_PARTIAL_ENTRY_ALREADY_POSTED");
  }
  if (entry.status !== "DRAFT") throw productionError(409, "MFG_PARTIAL_STATE_INVALID", `${entry.entry_number} is ${entry.status.toLowerCase()}.`);
  versionCheck(entry, input.expectedVersion);
  const order = await loadProductionOrder(client, c, entry.manufacturing_order_id, { lock: true });
  if (input.expectedMoVersion !== undefined && input.expectedMoVersion !== null && Number(input.expectedMoVersion) !== Number(order.version)) throw productionError(409, "MFG_PARTIAL_SOURCE_CHANGED");
  requireProducing(order);
  const settings = await productionSettings(client, c);
  const reported = D(entry.reported_quantity);
  const accepted = D(entry.accepted_quantity);
  const pending = D(entry.pending_quantity);
  if (settings.requireInspection && accepted > ZERO) throw moError(409, "MFG_MO_INSPECTION_REQUIRED");
  const limit = authorizedTarget(order, settings);
  if (add(add(D(order.accepted_quantity), D(order.pending_inspection_quantity)), add(accepted, pending)) > limit) {
    throw productionError(409, "MFG_PARTIAL_APPROVAL_REQUIRED", `Accepted and awaiting-inspection output would pass ${q(limit)} (the authorized target). Rejected output frees room for replacements; for more good output, ask for an overproduction allowance.`,
      { authorizedTarget: q(limit) });
  }
  const batch = (await client.query(`SELECT * FROM tenant.manufacturing_production_batches WHERE id = $1 FOR UPDATE`, [entry.production_batch_id])).rows[0];
  if (!batch || batch.status === "CLOSED") throw productionError(409, "MFG_PARTIAL_BATCH_INVALID", `Batch ${batch?.batch_reference ?? ""} is closed: report into an open batch.`);
  if (batch.planned_quantity !== null) {
    const inBatch = D((await client.query(`SELECT COALESCE(sum(reported_quantity - corrected_pending_quantity - corrected_accepted_quantity), 0) AS n FROM tenant.manufacturing_production_entries
        WHERE organization_id = $1 AND production_batch_id = $2 AND status IN ('REPORTED', 'RECOVERY_REQUIRED')`, [c.organizationId, batch.id])).rows[0].n);
    if (add(inBatch, reported) > D(batch.planned_quantity)) {
      throw productionError(409, "MFG_PARTIAL_OUTPUT_EXCEEDS", `Batch ${batch.batch_reference} was planned for ${q(D(batch.planned_quantity))}; ${q(inBatch)} is reported in it already. Report the rest in a new batch.`);
    }
  }
  const readiness = await materialReadiness(client, c, order, add(D(order.reported_quantity), reported));
  let override = null;
  if (!readiness.ready) {
    const short = readiness.lines.filter((row) => row.status === "SHORT").map((row) => `${row.code} ${row.short} short`);
    if (settings.materialCheck === "BLOCK") {
      override = text(input.materialOverrideReason, 1000);
      if (!override || override.length < 3 || !has(c, MO.approveVariance)) {
        throw productionError(409, "MFG_PARTIAL_MATERIAL_NOT_READY", `Materials for ${readiness.cumulative} units of output are not issued or reserved: ${short.join(", ")}. Issue them, or a manager records why production went ahead.`, { lines: readiness.lines });
      }
    }
  }
  const postingKey = `pe:${entry.id}:v${entry.row_version}`;
  await client.query(`UPDATE tenant.manufacturing_production_entries SET status = 'REPORTED', posting_key = $3, posted_by = $4, posted_at = clock_timestamp(), produced_at = COALESCE(produced_at, clock_timestamp()),
      material_override_reason = $5 WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id, postingKey, c.userId ?? null, override]);
  await client.query(`UPDATE tenant.manufacturing_orders SET reported_quantity = reported_quantity + $3, accepted_quantity = accepted_quantity + $4, rejected_quantity = rejected_quantity + $5,
      pending_inspection_quantity = pending_inspection_quantity + $6, version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, order.id, q(reported), q(accepted), q(D(entry.rejected_quantity)), q(pending)]);
  const warning = readiness.ready ? null : `Materials not yet issued or reserved for ${readiness.cumulative} units: ${readiness.lines.filter((row) => row.status === "SHORT").map((row) => `${row.code} ${row.short}`).join(", ")}`;
  await entryEvent(client, c, entry.id, "POSTED", warning ?? `${q(reported)} reported`, { postingKey, materialWarning: warning, override });
  await event(client, c, order.id, "PRODUCTION_RECORDED", { summary: `${entry.entry_number} · ${batch.batch_reference}: ${q(reported)} reported · ${q(accepted)} accepted · ${q(D(entry.rejected_quantity))} rejected · ${q(pending)} awaiting inspection`,
    details: { entryId: entry.id, materialWarning: warning } });
  return { orderId: order.id, entryId: entry.id, entryNumber: entry.entry_number, materialWarning: warning };
}

// The order's "Record production" (input: { reportedQuantity, acceptedQuantity?, rejectedQuantity?, pendingQuantity?, rejectionReason?, batchReference?,
// notes?, idempotencyKey }): an entry created and posted at once in its batch (opened if new; the next numbered batch when none is named).
export async function produceThroughEntry(client, c, orderId, input = {}) {
  const key = text(input.idempotencyKey, 200);
  if (!key) throw moError(400, "MFG_MO_KEY_REQUIRED");
  const existing = (await client.query(`SELECT id, manufacturing_order_id, entry_number, status FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND idempotency_key = $2`,
    [c.organizationId, key])).rows[0];
  if (existing?.status === "REPORTED") return withOrder(client, c, { orderId: existing.manufacturing_order_id, entryNumber: existing.entry_number, replayed: true });
  const result = await atomically(client, async () => {
    const draft = existing ?? await createProductionEntryDraft(client, { ...c, permissions: [...new Set([...(c.permissions ?? []), PRODUCTION.editDraft])] }, orderId,
      { ...input, quantity: input.reportedQuantity }, { createBatch: true });
    return postProductionEntry(client, { ...c, permissions: [...new Set([...(c.permissions ?? []), PRODUCTION.post])] }, draft.id, {});
  });
  return withOrder(client, c, result);
}

// ------------------------------------------------------------------ quality
// input: { entryId, acceptedQuantity?, rejectedQuantity?, rejectionReason?, reasonCode?, disposition? (QUARANTINE | SCRAP | REWORK), inspectionReference?,
// expectedEntryVersion?, idempotencyKey }. The order's quick decision is a basic inspection created and finalized at once (quality/qi-service.js):
// one decision path, with its checks — each unit decided once, held output left alone, the reporter not deciding their own output.
export async function decideManufacturingQuality(client, c, id, input = {}) {
  needMo(c, MO.quality);
  const ctx = { ...c, permissions: [...new Set([...(c.permissions ?? []), QI.view, QI.create, QI.editDraft, QI.finalize])] };
  return withOrder(client, c, await decideThroughInspection(client, ctx, id, input));
}

// Finished goods are received through the receipt note (receipts/fgr-service.js): one posting path for every entry point.

// ------------------------------------------------------------------ overproduction allowance
// input: { quantity, reason } — asked by production; approved (input: { decision, note? }) by someone else who may approve variances.
export async function requestOverproduction(client, c, orderId, input = {}) {
  needMo(c, MO.record);
  const order = await loadProductionOrder(client, c, orderId, { lock: true });
  requireProducing(order, { drafts: true });
  const amount = (await outputQuantity(client, c, order, input.quantity, null)).base;
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw productionError(400, "MFG_PARTIAL_REASON_REQUIRED", "Say why more good output is needed.");
  const row = (await client.query(`INSERT INTO tenant.manufacturing_overproduction_requests (organization_id, manufacturing_order_id, quantity, reason, requested_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [c.organizationId, order.id, q(amount), reason, c.userId ?? null])).rows[0];
  await event(client, c, order.id, "OVERPRODUCTION_REQUESTED", { summary: `+${q(amount)}: ${reason}` });
  return { orderId: order.id, requestId: row.id };
}
export async function decideOverproduction(client, c, orderId, requestId, input = {}) {
  needMo(c, MO.approveVariance);
  const order = await loadProductionOrder(client, c, orderId, { lock: true });
  const request = (await client.query(`SELECT * FROM tenant.manufacturing_overproduction_requests WHERE organization_id = $1 AND manufacturing_order_id = $2 AND id = $3 FOR UPDATE`,
    [c.organizationId, order.id, uuid(requestId, "Request")])).rows[0];
  if (!request) throw productionError(404, "MFG_PARTIAL_NOT_FOUND", "That overproduction request is not on this order.");
  if (request.status !== "REQUESTED") return { orderId: order.id };
  const settings = await productionSettings(client, c);
  if (request.requested_by === c.userId && !settings.varianceSelfApproval) throw productionError(409, "MFG_PARTIAL_PERMISSION_DENIED", "Someone other than the requester approves additional production.");
  const decision = String(input.decision ?? "").toUpperCase();
  if (!["APPROVE", "REJECT"].includes(decision)) throw productionError(400, "MFG_PARTIAL_QTY_INVALID", "Approve or reject the request.");
  const note = text(input.note, 1000) || null;
  if (decision === "REJECT" && (!note || note.length < 3)) throw productionError(400, "MFG_PARTIAL_REASON_REQUIRED", "Say why it is rejected.");
  await client.query(`UPDATE tenant.manufacturing_overproduction_requests SET status = $3, decided_by = $4, decided_at = clock_timestamp(), decision_note = $5 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, request.id, decision === "APPROVE" ? "APPROVED" : "REJECTED", c.userId ?? null, note]);
  if (decision === "APPROVE") {
    await client.query(`UPDATE tenant.manufacturing_orders SET overproduction_allowance_quantity = overproduction_allowance_quantity + $3, version = version + 1 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, order.id, q(D(request.quantity))]);
  }
  await event(client, c, order.id, decision === "APPROVE" ? "OVERPRODUCTION_APPROVED" : "OVERPRODUCTION_REJECTED", { summary: `+${q(D(request.quantity))}${note ? `: ${note}` : ""}` });
  return { orderId: order.id };
}

// ------------------------------------------------------------------ corrections
// Reported output that did not exist, withdrawn by a linked correction (the entry stays): output still awaiting inspection (PENDING), or accepted
// output not yet received (ACCEPTED — by someone who may approve variances). Output already received needs an Inventory receipt reversal first.
// input: { kind, quantity, reason, evidence?, idempotencyKey }
export async function correctProductionEntry(client, c, entryId, input = {}) {
  needProduction(c, PRODUCTION.correct);
  const key = text(input.idempotencyKey, 200);
  if (!key) throw moError(400, "MFG_MO_KEY_REQUIRED");
  const done = (await client.query(`SELECT production_entry_id FROM tenant.manufacturing_production_corrections WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
  if (done) return { orderId: (await loadEntry(client, c, done.production_entry_id)).manufacturing_order_id, entryId: done.production_entry_id, replayed: true };
  const entry = await loadEntry(client, c, entryId, { lock: true });
  if (entry.status !== "REPORTED") throw productionError(409, "MFG_PARTIAL_STATE_INVALID", "Only reported output is corrected; a draft is edited or cancelled.");
  const order = await loadProductionOrder(client, c, entry.manufacturing_order_id, { lock: true });
  if (!["IN_PROGRESS", "ON_HOLD"].includes(order.status)) throw productionError(409, "MFG_PARTIAL_CORRECTION_RESTRICTED", `${order.mo_number} is ${STATUS_LABEL[order.status].toLowerCase()}: its output is final.`);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw productionError(400, "MFG_PARTIAL_REASON_REQUIRED", "Say what was reported wrongly.");
  const kind = String(input.kind ?? "PENDING").toUpperCase();
  const amount = (await outputQuantity(client, c, order, input.quantity, null)).base;
  const figures = entryFigures(entry, (await decisionsOf(client, c, [entry.id])).get(entry.id));
  if (kind === "PENDING") {
    const free = sub(figures.pending, figures.held);
    if (amount > free) throw productionError(409, "MFG_PARTIAL_CORRECTION_RESTRICTED", `${entry.entry_number}: only ${q(free)} still awaits inspection${figures.held > ZERO ? " and is not on quality hold" : ""}; inspected output is corrected through quality.`);
    await client.query(`UPDATE tenant.manufacturing_production_entries SET pending_remaining = pending_remaining - $3, corrected_pending_quantity = corrected_pending_quantity + $3 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, entry.id, q(amount)]);
    await client.query(`UPDATE tenant.manufacturing_orders SET reported_quantity = reported_quantity - $3, pending_inspection_quantity = pending_inspection_quantity - $3, version = version + 1 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, order.id, q(amount)]);
  } else if (kind === "ACCEPTED") {
    needMo(c, MO.approveVariance);
    if (amount > figures.receivable) {
      throw productionError(409, "MFG_PARTIAL_CORRECTION_RESTRICTED", `${entry.entry_number}: only ${q(figures.receivable)} accepted output is not yet in stock. Received output needs an Inventory receipt reversal first.`);
    }
    await client.query(`UPDATE tenant.manufacturing_production_entries SET corrected_accepted_quantity = corrected_accepted_quantity + $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id, q(amount)]);
    await client.query(`UPDATE tenant.manufacturing_orders SET reported_quantity = reported_quantity - $3, accepted_quantity = accepted_quantity - $3, version = version + 1 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, order.id, q(amount)]);
  } else {
    throw productionError(400, "MFG_PARTIAL_QTY_INVALID", "Correct output awaiting inspection (PENDING) or accepted output not yet received (ACCEPTED).");
  }
  const number = await nextNumber(client, c, "manufacturing_production_correction");
  await client.query(`INSERT INTO tenant.manufacturing_production_corrections (organization_id, correction_number, production_entry_id, manufacturing_order_id, kind, quantity, reason, evidence, idempotency_key, corrected_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [c.organizationId, number, entry.id, order.id, kind, q(amount), reason, text(input.evidence, 1000) || null, key, c.userId ?? null]);
  await entryEvent(client, c, entry.id, "CORRECTED", `${number}: −${q(amount)} ${kind === "PENDING" ? "awaiting inspection" : "accepted"} — ${reason}`);
  await event(client, c, order.id, "PRODUCTION_CORRECTED", { summary: `${entry.entry_number} −${q(amount)} (${kind.toLowerCase()}): ${reason}` });
  return { orderId: order.id, entryId: entry.id, correctionNumber: number };
}

// The entry to print: counted, never changing anything else.
export async function recordProductionEntryPrint(client, c, entryId) {
  needProduction(c, PRODUCTION.export);
  const entry = await loadEntry(client, c, entryId, { lock: true });
  await client.query(`UPDATE tenant.manufacturing_production_entries SET print_count = print_count + 1, last_printed_at = clock_timestamp() WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id]);
  await entryEvent(client, c, entry.id, entry.print_count > 0 ? "REPRINTED" : "PRINTED", entry.status === "REPORTED" ? `Copy ${entry.print_count + 1}` : "Draft preview");
  return { id: entry.id };
}

export { MO };
