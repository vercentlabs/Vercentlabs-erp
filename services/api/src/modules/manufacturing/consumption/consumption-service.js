// Material Consumption — the commands: create and edit a draft (nothing leaves custody), preview it against the BOM's expectation and the
// custody it would use, ask for and decide an approval of usage variance, post it, cancel a draft, correct posted consumption that never
// happened, and count a print. Posting is one transaction: every line posts or none does, under the identity `mc:<id>:v<version>` — a retry
// finds the posted note and returns it. The value moved to work in progress when the material was issued, so posting consumption allocates
// that value within work in progress and posts no second journal.
import { randomUUID } from "node:crypto";

import { atomically, event as orderEvent, money, nextNumber } from "../orders/mo-core.js";
import {
  BAND_LABEL, CONSUMPTION, D, approvalOf, STATUS_LABEL, UNPOSTED, ZERO, add, consumptionError, consumptionHash, consumptionSettings, div, expectationFor, has, loadConsumption,
  loadConsumptionLines, loadConsumptionOrder, loadMaterials, mul, needConsumption, needsApproval, outputBasis, planConsumption, q, requireInProduction, resolveConsumptionLines,
  storedConsumptionLines, sub, text, uuid, variancesOf, versionsOf,
} from "./consumption-core.js";
import { getMaterialConsumption } from "./consumption-read.js";

async function noteEvent(client, c, id, action, { from = null, to = null, summary = null, details = {} } = {}) {
  await client.query(`INSERT INTO tenant.manufacturing_material_consumption_events (organization_id, consumption_id, action, from_status, to_status, summary, details, actor_user_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`, [c.organizationId, id, action, from, to, summary ? String(summary).slice(0, 1000) : null, JSON.stringify(details), c.userId ?? null]);
}
const versionCheck = (note, expected) => {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(note.row_version)) throw consumptionError(409, "MFG_CONSUMPTION_DOCUMENT_CHANGED");
};

async function writeLines(client, c, id, lines, variances) {
  await client.query(`DELETE FROM tenant.manufacturing_material_consumption_lines WHERE organization_id = $1 AND consumption_id = $2`, [c.organizationId, id]);
  for (const [index, line] of lines.entries()) {
    const variance = variances[index];
    await client.query(
      `INSERT INTO tenant.manufacturing_material_consumption_lines (organization_id, consumption_id, line_number, material_id, item_id, quantity, uom_id, conversion_factor, base_quantity, batch_id,
         serial_ids, source_movement_id, expected_quantity, variance_quantity, variance_pct, variance_band, variance_reason, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid[],$12,$13,$14,$15,$16,$17,$18)`,
      [c.organizationId, id, index + 1, line.material.id, line.material.component_item_id, line.quantity, line.uomId, q(line.factor, 9), q(line.baseQuantity), line.batchId, line.serialIds,
        line.sourceMovementId, variance.expected === null ? null : q(variance.expected), variance.variance === null ? null : q(variance.variance), variance.pct === null ? null : q(variance.pct, 4),
        variance.band, line.varianceReason, line.notes]);
  }
}
async function header(client, c, order, input, existing = null) {
  let locationId = input.productionLocationId === undefined ? existing?.production_location_id ?? null : input.productionLocationId || null;
  if (locationId) {
    const row = (await client.query(`SELECT id FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2 AND warehouse_id = $3`, [c.organizationId, uuid(locationId, "Location"), order.manufacturing_warehouse_id])).rows[0];
    if (!row) throw consumptionError(400, "MFG_CONSUMPTION_LOCATION_MISMATCH", "That location is not in the order's manufacturing warehouse.");
    locationId = row.id;
  }
  let entryId = input.productionEntryId === undefined ? existing?.production_entry_id ?? null : input.productionEntryId || null;
  let batchReference = input.productionBatchReference === undefined ? existing?.production_batch_reference ?? null : text(input.productionBatchReference, 120) || null;
  let batchId = input.productionBatchId === undefined ? existing?.production_batch_id ?? null : input.productionBatchId || null;
  if (entryId) {
    const entry = (await client.query(`SELECT id, batch_reference, entry_number, production_batch_id FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND id = $2 AND manufacturing_order_id = $3`,
      [c.organizationId, uuid(entryId, "Production entry"), order.id])).rows[0];
    if (!entry) throw consumptionError(400, "MFG_CONSUMPTION_COMPONENT_INVALID", "That production entry is not on this order.");
    entryId = entry.id;
    batchReference ??= entry.batch_reference ?? entry.entry_number;
    batchId ??= entry.production_batch_id;
  }
  if (batchId) {
    const batch = (await client.query(`SELECT id, batch_reference FROM tenant.manufacturing_production_batches WHERE organization_id = $1 AND id = $2 AND manufacturing_order_id = $3`,
      [c.organizationId, uuid(batchId, "Production batch"), order.id])).rows[0];
    if (!batch) throw consumptionError(400, "MFG_CONSUMPTION_COMPONENT_INVALID", "That production batch is not on this order.");
    batchId = batch.id;
    batchReference ??= batch.batch_reference;
  } else if (batchReference) {
    batchId = (await client.query(`SELECT id FROM tenant.manufacturing_production_batches WHERE organization_id = $1 AND manufacturing_order_id = $2 AND lower(batch_reference) = lower($3)`,
      [c.organizationId, order.id, batchReference])).rows[0]?.id ?? null;
  }
  const rawBasis = input.outputBasisQuantity === undefined ? existing?.output_basis_quantity ?? null : input.outputBasisQuantity;
  let basis = null;
  if (rawBasis !== null && rawBasis !== undefined && String(rawBasis).trim() !== "") {
    if (!/^\d+(\.\d+)?$/.test(String(rawBasis).trim()) || !(Number(rawBasis) > 0)) throw consumptionError(400, "MFG_CONSUMPTION_QTY_INVALID", "The output quantity the usage is for must be more than zero.");
    basis = String(rawBasis).trim();
  }
  let consumedAt = input.consumedAt === undefined ? existing?.consumed_at ?? null : input.consumedAt || null;
  if (consumedAt) {
    const at = new Date(String(consumedAt));
    if (Number.isNaN(at.getTime())) throw consumptionError(400, "MFG_CONSUMPTION_QTY_INVALID", "When the material was used is not a valid date and time.");
    if (at.getTime() > Date.now() + 5 * 60_000) throw consumptionError(400, "MFG_CONSUMPTION_QTY_INVALID", "Usage cannot be recorded in the future.");
    consumedAt = at.toISOString();
  }
  let supervisor = input.supervisorUserId === undefined ? existing?.supervisor_user_id ?? null : input.supervisorUserId || null;
  if (supervisor) supervisor = uuid(supervisor, "Supervisor");
  return { locationId, entryId, batchId, batchReference, basis, consumedAt, supervisor, notes: input.notes === undefined ? existing?.notes ?? null : text(input.notes, 1000) || null };
}
async function computeVariances(client, c, order, noteLike, lines) {
  const settings = await consumptionSettings(client, c);
  return { settings, variances: variancesOf(lines, await expectationFor(client, c, order, await outputBasis(client, c, noteLike)), settings) };
}

// input: { manufacturingOrderId, lines, productionLocationId?, productionEntryId?, productionBatchReference?, outputBasisQuantity?, consumedAt?,
// supervisorUserId?, notes?, idempotencyKey? }
export async function createMaterialConsumptionDraft(client, c, input = {}, { kind = "NORMAL" } = {}) {
  needConsumption(c, CONSUMPTION.create);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const existing = (await client.query(`SELECT id FROM tenant.manufacturing_material_consumptions WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (existing) return { ...(await getMaterialConsumption(client, c, existing.id)), replayed: true };
  }
  const order = await loadConsumptionOrder(client, c, input.manufacturingOrderId, { lock: true });
  requireInProduction(order, { closing: kind === "CLOSING" });
  const materials = await loadMaterials(client, c, order.id);
  const lines = await resolveConsumptionLines(client, c, order, materials, input.lines);
  const fields = await header(client, c, order, input);
  const id = randomUUID();
  const number = await nextNumber(client, c, "manufacturing_material_consumption");
  const noteLike = { manufacturing_order_id: order.id, production_location_id: fields.locationId, production_entry_id: fields.entryId, output_basis_quantity: fields.basis };
  const { variances } = await computeVariances(client, c, order, noteLike, lines);
  await client.query(
    `INSERT INTO tenant.manufacturing_material_consumptions (id, organization_id, consumption_number, manufacturing_order_id, production_warehouse_id, production_location_id, production_entry_id,
       production_batch_reference, output_basis_quantity, kind, consumed_at, notes, supervisor_user_id, content_hash, created_by, idempotency_key, production_batch_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [id, c.organizationId, number, order.id, order.manufacturing_warehouse_id, fields.locationId, fields.entryId, fields.batchReference, fields.basis, kind, fields.consumedAt, fields.notes,
      fields.supervisor, consumptionHash(noteLike, lines), c.userId ?? null, key, fields.batchId]);
  await writeLines(client, c, id, lines, variances);
  await noteEvent(client, c, id, "CREATED", { to: "DRAFT", summary: `${number} for ${order.mo_number}: ${lines.map((line) => `${line.material.item_code} ${line.quantity}`).join(", ")}` });
  return getMaterialConsumption(client, c, id);
}

// input: as creation, plus expectedVersion. Any edit returns the note to a draft and withdraws an approval.
export async function updateMaterialConsumptionDraft(client, c, id, input = {}) {
  needConsumption(c, CONSUMPTION.create);
  const note = await loadConsumption(client, c, id, { lock: true });
  if (!UNPOSTED.has(note.status)) throw consumptionError(409, note.status === "POSTED" ? "MFG_CONSUMPTION_ALREADY_POSTED" : "MFG_CONSUMPTION_STATE_INVALID");
  versionCheck(note, input.expectedVersion);
  const order = await loadConsumptionOrder(client, c, note.manufacturing_order_id, { lock: true });
  requireInProduction(order);
  const materials = await loadMaterials(client, c, order.id);
  const lines = input.lines ? await resolveConsumptionLines(client, c, order, materials, input.lines) : storedConsumptionLines(await loadConsumptionLines(client, c, note.id), materials);
  const fields = await header(client, c, order, input, note);
  const noteLike = { manufacturing_order_id: order.id, production_location_id: fields.locationId, production_entry_id: fields.entryId, output_basis_quantity: fields.basis };
  const { variances } = await computeVariances(client, c, order, noteLike, lines);
  await writeLines(client, c, note.id, lines, variances);
  await client.query(
    `UPDATE tenant.manufacturing_material_consumptions SET production_location_id = $3, production_entry_id = $4, production_batch_reference = $5, output_basis_quantity = $6, consumed_at = $7,
       notes = $8, supervisor_user_id = $9, content_hash = $10, production_batch_id = $11, status = 'DRAFT', approval_status = 'NOT_REQUIRED', approval_hash = NULL, approval_versions = NULL, approved_by = NULL,
       approved_at = NULL, approval_note = NULL, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, note.id, fields.locationId, fields.entryId, fields.batchReference, fields.basis, fields.consumedAt, fields.notes, fields.supervisor, consumptionHash(noteLike, lines), fields.batchId]);
  await noteEvent(client, c, note.id, "EDITED", { from: note.status, to: "DRAFT", summary: ["REQUESTED", "APPROVED"].includes(note.approval_status) ? "Edited: the approval was withdrawn" : "Edited" });
  return getMaterialConsumption(client, c, note.id);
}

// What posting would do now, without doing it.
export async function previewMaterialConsumption(client, c, id) {
  needConsumption(c, CONSUMPTION.create);
  const note = await loadConsumption(client, c, id);
  const order = await loadConsumptionOrder(client, c, note.manufacturing_order_id);
  const materials = await loadMaterials(client, c, order.id);
  const lines = storedConsumptionLines(await loadConsumptionLines(client, c, note.id), materials);
  const problems = [];
  if (!UNPOSTED.has(note.status)) problems.push({ code: note.status === "POSTED" ? "MFG_CONSUMPTION_ALREADY_POSTED" : "MFG_CONSUMPTION_STATE_INVALID", message: `${note.consumption_number} is ${note.status.toLowerCase().replace(/_/g, " ")}.` });
  try { requireInProduction(order); } catch (error) { problems.push({ code: error.code, message: error.message }); }
  const { variances, settings } = await computeVariances(client, c, order, note, lines);
  const approval = approvalOf(note, lines, variances);
  if (approval.required && !approval.valid) problems.push({ code: approval.stale ? "MFG_CONSUMPTION_APPROVAL_STALE" : "MFG_CONSUMPTION_VARIANCE_APPROVAL", message: approval.message });
  const plan = await planConsumption(client, c, order, note, lines, { strict: false });
  problems.push(...plan.problems);
  return {
    consumptionId: note.id, consumptionNumber: note.consumption_number, previewOnly: true, checkedAt: new Date().toISOString(), ok: problems.length === 0, problems, approval,
    policy: { warningPct: q(settings.warningPct), approvalPct: q(settings.approvalPct) },
    lines: lines.map((line, index) => {
      const held = plan.custody.get(line.material.id);
      const variance = variances[index];
      return { lineId: line.id, materialId: line.material.id, code: line.material.item_code, uom: line.material.uom_code, quantity: line.quantity, baseQuantity: q(line.baseQuantity),
        custodyBefore: q(held.custody), custodyAfter: q(sub(held.custody, line.baseQuantity)), expected: variance.expected === null ? null : q(variance.expected),
        variance: variance.variance === null ? null : q(variance.variance), variancePct: variance.pct === null ? null : q(variance.pct, 2), band: variance.band, bandLabel: BAND_LABEL[variance.band],
        plan: plan.lines[index].plan.map((part) => ({ issueNumber: part.issueNumber ?? part.movementNumber, batchId: part.batchId, serialId: part.serialId, quantity: q(part.quantity) })) };
    }),
  };
}

// ------------------------------------------------------------------ approval of usage variance
// input: { reason, expectedVersion? }
export async function requestConsumptionVarianceApproval(client, c, id, input = {}) {
  needConsumption(c, CONSUMPTION.create);
  const note = await loadConsumption(client, c, id, { lock: true });
  if (!UNPOSTED.has(note.status)) throw consumptionError(409, note.status === "POSTED" ? "MFG_CONSUMPTION_ALREADY_POSTED" : "MFG_CONSUMPTION_STATE_INVALID");
  versionCheck(note, input.expectedVersion);
  const order = await loadConsumptionOrder(client, c, note.manufacturing_order_id);
  requireInProduction(order);
  const materials = await loadMaterials(client, c, order.id);
  const lines = storedConsumptionLines(await loadConsumptionLines(client, c, note.id), materials);
  const { variances, settings } = await computeVariances(client, c, order, note, lines);
  if (!needsApproval(variances)) throw consumptionError(409, "MFG_CONSUMPTION_STATE_INVALID", "Usage on this note is within the company's tolerance; no approval is needed.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw consumptionError(400, "MFG_CONSUMPTION_REASON_REQUIRED", "Say why more was used than the BOM expects.");
  await client.query(
    `UPDATE tenant.manufacturing_material_consumptions SET status = 'PENDING_APPROVAL', approval_status = 'REQUESTED', approval_hash = content_hash, approval_versions = $3::jsonb, approval_reason = $4,
       approval_policy = $5::jsonb, approval_requested_by = $6, approval_requested_at = clock_timestamp(), approved_by = NULL, approved_at = NULL, approval_note = NULL, row_version = row_version + 1
      WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, note.id, JSON.stringify(versionsOf(lines)), reason, JSON.stringify({ warningPct: q(settings.warningPct), approvalPct: q(settings.approvalPct), selfApproval: settings.selfApproval }), c.userId ?? null]);
  await noteEvent(client, c, note.id, "APPROVAL_REQUESTED", { from: note.status, to: "PENDING_APPROVAL", summary: reason,
    details: { lines: lines.map((line, index) => ({ code: line.material.item_code, band: variances[index].band, variance: variances[index].variance === null ? null : q(variances[index].variance) })) } });
  return getMaterialConsumption(client, c, note.id);
}

// input: { decision: APPROVE | REJECT, note?, expectedVersion? }
export async function decideConsumptionVarianceApproval(client, c, id, input = {}) {
  needConsumption(c, CONSUMPTION.approve);
  const note = await loadConsumption(client, c, id, { lock: true });
  if (note.status !== "PENDING_APPROVAL" || note.approval_status !== "REQUESTED") throw consumptionError(409, "MFG_CONSUMPTION_STATE_INVALID", "This note is not waiting for an approval.");
  versionCheck(note, input.expectedVersion);
  const settings = await consumptionSettings(client, c);
  if (note.approval_requested_by === c.userId && !settings.selfApproval) throw consumptionError(409, "MFG_CONSUMPTION_APPROVAL_SELF");
  if (note.created_by === c.userId && !settings.selfApproval) throw consumptionError(409, "MFG_CONSUMPTION_APPROVAL_SELF", "Someone other than the person who recorded this usage must approve it.");
  const decision = String(input.decision ?? "").toUpperCase();
  if (!["APPROVE", "REJECT"].includes(decision)) throw consumptionError(400, "MFG_CONSUMPTION_QTY_INVALID", "Approve or reject the request.");
  const remark = text(input.note, 1000) || null;
  if (decision === "REJECT" && (!remark || remark.length < 3)) throw consumptionError(400, "MFG_CONSUMPTION_REASON_REQUIRED", "Say why the usage is rejected.");
  if (note.approval_hash !== note.content_hash) throw consumptionError(409, "MFG_CONSUMPTION_APPROVAL_STALE");
  await client.query(`UPDATE tenant.manufacturing_material_consumptions SET status = 'DRAFT', approval_status = $3, approved_by = $4, approved_at = clock_timestamp(), approval_note = $5,
      row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, note.id, decision === "APPROVE" ? "APPROVED" : "REJECTED", c.userId ?? null, remark]);
  await noteEvent(client, c, note.id, decision === "APPROVE" ? "APPROVED" : "REJECTED", { from: note.status, to: "DRAFT", summary: remark });
  return getMaterialConsumption(client, c, note.id);
}

// ------------------------------------------------------------------ posting
// input: { expectedVersion?, expectedMoVersion? }
export async function postMaterialConsumption(client, c, id, input = {}) {
  needConsumption(c, CONSUMPTION.post);
  const note = await loadConsumption(client, c, id, { lock: true });
  const postingKey = `mc:${note.id}:v${note.row_version}`;
  if (note.status === "POSTED" || note.status === "RECOVERY_REQUIRED") {
    if (input.expectedVersion === undefined || input.expectedVersion === null || Number(input.expectedVersion) === Number(note.row_version)) return { ...(await postingResult(client, c, note.id)), replayed: true };
    throw consumptionError(409, "MFG_CONSUMPTION_ALREADY_POSTED");
  }
  if (!UNPOSTED.has(note.status)) throw consumptionError(409, "MFG_CONSUMPTION_STATE_INVALID", `${note.consumption_number} is ${note.status.toLowerCase()}.`);
  if (note.status === "PENDING_APPROVAL") throw consumptionError(409, "MFG_CONSUMPTION_VARIANCE_APPROVAL", "The usage variance is waiting for a decision.");
  versionCheck(note, input.expectedVersion);
  const order = await loadConsumptionOrder(client, c, note.manufacturing_order_id, { lock: true });
  if (input.expectedMoVersion !== undefined && input.expectedMoVersion !== null && Number(input.expectedMoVersion) !== Number(order.version)) {
    throw consumptionError(409, "MFG_CONSUMPTION_STOCK_CHANGED", `${order.mo_number} changed since this note was checked. Review the quantities.`);
  }
  requireInProduction(order, { closing: note.kind === "CLOSING" });
  const materials = await loadMaterials(client, c, order.id, { lock: true });
  const rows = await loadConsumptionLines(client, c, note.id);
  const lines = storedConsumptionLines(rows, materials);
  if (!lines.length) throw consumptionError(400, "MFG_CONSUMPTION_EMPTY");
  if (consumptionHash(note, rows) !== note.content_hash) throw consumptionError(409, "MFG_CONSUMPTION_DOCUMENT_CHANGED");
  if (note.kind !== "CLOSING") {
    const { variances } = await computeVariances(client, c, order, note, lines);
    const approval = approvalOf(note, lines, variances);
    if (approval.required && !approval.valid) throw consumptionError(409, approval.stale ? "MFG_CONSUMPTION_APPROVAL_STALE" : "MFG_CONSUMPTION_VARIANCE_APPROVAL", approval.message);
  }
  const plan = await planConsumption(client, c, order, note, lines, { strict: true });
  let total = ZERO;
  let quantity = ZERO;
  let missing = false;
  const used = [];
  for (const [index, line] of lines.entries()) {
    let lineCost = ZERO;
    for (const part of plan.lines[index].plan) {
      if (part.unitCost === null || part.costMissing) missing = true;
      const cost = part.unitCost === null ? ZERO : mul(part.quantity, part.unitCost);
      lineCost = add(lineCost, cost);
      await client.query(`INSERT INTO tenant.manufacturing_material_consumption_allocations (organization_id, consumption_line_id, source_movement_id, material_issue_id, batch_id, serial_id, quantity, unit_cost)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [c.organizationId, line.id, part.movementId, part.issueId, part.batchId, part.serialId, q(part.quantity), part.unitCost === null ? null : q(part.unitCost)]);
    }
    await client.query(`UPDATE tenant.manufacturing_material_consumption_lines SET unit_cost = $3, total_cost = $4 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, line.id, q(div(lineCost, line.baseQuantity)), money(lineCost)]);
    await client.query(`INSERT INTO tenant.manufacturing_order_consumption (organization_id, manufacturing_order_id, material_id, quantity, note, automatic, recorded_by, consumption_line_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [c.organizationId, order.id, line.material.id, q(line.baseQuantity), `${note.consumption_number}${line.notes ? `: ${line.notes}` : ""}`, note.kind === "CLOSING", c.userId ?? null, line.id]);
    await client.query(`UPDATE tenant.manufacturing_order_materials SET consumed_quantity = consumed_quantity + $3, version = version + 1 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, line.material.id, q(line.baseQuantity)]);
    total = add(total, D(money(lineCost)));
    quantity = add(quantity, line.baseQuantity);
    used.push(`${line.material.item_code} ${q(line.baseQuantity)}`);
  }
  await client.query(`INSERT INTO tenant.manufacturing_material_consumption_postings (organization_id, consumption_id, command_key, document_version, kind, custody_status, finance_status, quantity, amount, created_by)
    VALUES ($1,$2,$3,$4,'CONSUMPTION','CONFIRMED',$5,$6,$7,$8)`, [c.organizationId, note.id, postingKey, note.row_version, missing ? "COST_MISSING" : "IN_WIP_AT_ISSUE", q(quantity), money(total), c.userId ?? null]);
  await client.query(`UPDATE tenant.manufacturing_orders SET version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, order.id]);
  await client.query(`UPDATE tenant.manufacturing_material_consumptions SET status = 'POSTED', posting_key = $3, posted_by = $4, posted_at = clock_timestamp(), consumption_date = current_date,
      consumed_at = COALESCE(consumed_at, clock_timestamp()), total_cost = $5, cost_status = $6 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, note.id, postingKey, c.userId ?? null, money(total), missing ? "MISSING" : "VALUED"]);
  await noteEvent(client, c, note.id, "POSTED", { from: note.status, to: "POSTED", summary: used.join(", "), details: { postingKey } });
  await orderEvent(client, c, order.id, note.kind === "CLOSING" ? "REMAINING_CONSUMED" : "CONSUMPTION_RECORDED", { summary: `${note.consumption_number}: ${used.join(", ")}`, details: { consumptionId: note.id } });
  return postingResult(client, c, note.id);
}
async function postingResult(client, c, id) {
  const note = await getMaterialConsumption(client, c, id);
  return { consumptionId: note.id, consumptionNumber: note.number, status: note.status, consumedQuantity: note.totals.quantity, financeReconciliationStatus: note.posting?.financeStatus ?? null,
    postedAt: note.postedAt, consumption: note };
}

// input: { reason, expectedVersion? }
export async function cancelMaterialConsumption(client, c, id, input = {}) {
  needConsumption(c, CONSUMPTION.create);
  const note = await loadConsumption(client, c, id, { lock: true });
  if (note.status === "CANCELLED") return getMaterialConsumption(client, c, note.id);
  if (!UNPOSTED.has(note.status)) throw consumptionError(409, note.status === "POSTED" ? "MFG_CONSUMPTION_ALREADY_POSTED" : "MFG_CONSUMPTION_STATE_INVALID",
    note.status === "POSTED" ? "Posted consumption is not cancelled: correct it if it never happened." : undefined);
  versionCheck(note, input.expectedVersion);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw consumptionError(400, "MFG_CONSUMPTION_REASON_REQUIRED", "Say why the note is cancelled.");
  await client.query(`UPDATE tenant.manufacturing_material_consumptions SET status = 'CANCELLED', cancelled_by = $3, cancelled_at = clock_timestamp(), cancel_reason = $4, row_version = row_version + 1
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, note.id, c.userId ?? null, reason]);
  await noteEvent(client, c, note.id, "CANCELLED", { from: note.status, to: "CANCELLED", summary: reason });
  return getMaterialConsumption(client, c, note.id);
}

// ------------------------------------------------------------------ one path for every entry point
// Record and post at once (the order's "Record use", and completion's closing disposition): a note under the request key, posted.
export async function consumeThroughNote(client, c, orderId, input = {}, { kind = "NORMAL", key = null } = {}) {
  const noteKey = key ?? (text(input.idempotencyKey, 200) ? `mo-consume:${text(input.idempotencyKey, 200)}` : null);
  if (noteKey) {
    const existing = (await client.query(`SELECT id, status FROM tenant.manufacturing_material_consumptions WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, noteKey])).rows[0];
    if (existing?.status === "POSTED") return { ...(await postingResult(client, c, existing.id)), replayed: true };
  }
  return atomically(client, async () => {
    const draft = await createMaterialConsumptionDraft(client, c, { manufacturingOrderId: orderId, lines: input.lines, notes: input.note, outputBasisQuantity: input.outputBasisQuantity,
      productionEntryId: input.productionEntryId, idempotencyKey: noteKey ?? undefined }, { kind });
    return postMaterialConsumption(client, c, draft.id, { expectedVersion: draft.rowVersion });
  });
}

// ------------------------------------------------------------------ correction
// Posted consumption that never physically happened goes back to custody — from the very issued stock it was allocated to (last first) —
// with the original kept and the correction beside it. Never on a completed order (its output is costed), never more than the line still
// holds as consumption. input: { lineId, quantity?, reason, evidence?, idempotencyKey }
export async function reverseMaterialConsumption(client, c, id, input = {}) {
  needConsumption(c, CONSUMPTION.reverse);
  const key = text(input.idempotencyKey, 200);
  if (!key) throw consumptionError(400, "MFG_CONSUMPTION_QTY_INVALID", "This action needs a request key so a retry never corrects twice.");
  const note = await loadConsumption(client, c, id, { lock: true });
  if (note.status !== "POSTED") throw consumptionError(409, "MFG_CONSUMPTION_STATE_INVALID", "Only posted consumption is corrected; a draft is edited or cancelled.");
  const done = (await client.query(`SELECT 1 FROM tenant.manufacturing_material_consumption_corrections WHERE organization_id = $1 AND idempotency_key = $2 LIMIT 1`, [c.organizationId, key])).rows[0];
  if (done) return { ...(await getMaterialConsumption(client, c, note.id)), replayed: true };
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw consumptionError(400, "MFG_CONSUMPTION_REASON_REQUIRED", "Say what was recorded wrongly (a correction is evidence the material was not used).");
  const order = await loadConsumptionOrder(client, c, note.manufacturing_order_id, { lock: true });
  if (!["IN_PROGRESS", "ON_HOLD"].includes(order.status)) {
    throw consumptionError(409, "MFG_CONSUMPTION_CORRECTION_BLOCKED", `${order.mo_number} is ${STATUS_LABEL[order.status].toLowerCase()}: its consumption is part of costed output and is corrected through Finance, not here.`);
  }
  if (note.kind === "CLOSING") throw consumptionError(409, "MFG_CONSUMPTION_CORRECTION_BLOCKED", "Material declared used at completion is not corrected here.");
  const row = (await loadConsumptionLines(client, c, note.id)).find((line) => line.id === uuid(input.lineId, "Line"));
  if (!row) throw consumptionError(404, "MFG_CONSUMPTION_NOT_FOUND", "That line is not on this note.");
  const open = sub(D(row.base_quantity), D(row.corrected_quantity));
  const amount = input.quantity === undefined || input.quantity === null || input.quantity === "" ? open : D(String(input.quantity));
  if (!(amount > ZERO)) throw consumptionError(400, "MFG_CONSUMPTION_QTY_INVALID");
  if (amount > open) throw consumptionError(409, "MFG_CONSUMPTION_CORRECTION_BLOCKED", `${row.item_code}: only ${q(open)} of this line is still recorded as used.`);
  if (row.tracking_type === "serial" && amount % 1_000_000n !== ZERO) throw consumptionError(400, "MFG_CONSUMPTION_QTY_INVALID", `${row.item_code}: serial units are corrected whole.`);
  const allocations = (await client.query(`SELECT * FROM tenant.manufacturing_material_consumption_allocations WHERE organization_id = $1 AND consumption_line_id = $2 ORDER BY created_at DESC, id DESC`,
    [c.organizationId, row.id])).rows;
  const already = (await client.query(`SELECT allocations FROM tenant.manufacturing_material_consumption_corrections WHERE organization_id = $1 AND consumption_line_id = $2`, [c.organizationId, row.id])).rows
    .flatMap((correction) => correction.allocations);
  let left = amount;
  let cost = ZERO;
  const back = [];
  for (const allocation of allocations) {
    if (left <= ZERO) break;
    const restored = already.filter((part) => part.allocationId === allocation.id).reduce((sum, part) => add(sum, D(String(part.quantity))), ZERO);
    const room = sub(D(allocation.quantity), restored);
    const take = room < left ? room : left;
    if (take <= ZERO) continue;
    back.push({ allocationId: allocation.id, sourceMovementId: allocation.source_movement_id, batchId: allocation.batch_id ?? "", serialId: allocation.serial_id ?? "", quantity: q(take) });
    cost = add(cost, allocation.unit_cost === null ? ZERO : mul(take, D(allocation.unit_cost)));
    left = sub(left, take);
  }
  const number = await nextNumber(client, c, "manufacturing_material_consumption_correction");
  await client.query(`INSERT INTO tenant.manufacturing_material_consumption_corrections (organization_id, correction_number, consumption_id, consumption_line_id, quantity, reason, evidence, allocations,
      total_cost, idempotency_key, corrected_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
    [c.organizationId, number, note.id, row.id, q(amount), reason, text(input.evidence, 1000) || null, JSON.stringify(back), money(cost), key, c.userId ?? null]);
  await client.query(`UPDATE tenant.manufacturing_material_consumption_lines SET corrected_quantity = corrected_quantity + $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, q(amount)]);
  await client.query(`UPDATE tenant.manufacturing_order_materials SET consumed_quantity = consumed_quantity - $3, consumption_corrected_quantity = consumption_corrected_quantity + $3, version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.material_id, q(amount)]);
  await client.query(`INSERT INTO tenant.manufacturing_material_consumption_postings (organization_id, consumption_id, command_key, document_version, kind, custody_status, finance_status, quantity, amount, created_by)
    VALUES ($1,$2,$3,$4,'CORRECTION','CONFIRMED','IN_WIP_AT_ISSUE',$5,$6,$7)`, [c.organizationId, note.id, `mcc:${key}:${row.id}`, note.row_version, q(amount), money(cost), c.userId ?? null]);
  await client.query(`UPDATE tenant.manufacturing_orders SET version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, order.id]);
  await noteEvent(client, c, note.id, "CORRECTED", { summary: `${number}: ${row.item_code} ${q(amount)} back to custody — ${reason}` });
  await orderEvent(client, c, order.id, "CONSUMPTION_CORRECTED", { summary: `${note.consumption_number} ${row.item_code} −${q(amount)}: ${reason}` });
  return getMaterialConsumption(client, c, note.id);
}

// The note to print: counted, never posting anything.
export async function recordMaterialConsumptionPrint(client, c, id) {
  needConsumption(c, CONSUMPTION.export);
  const note = await loadConsumption(client, c, id, { lock: true });
  await client.query(`UPDATE tenant.manufacturing_material_consumptions SET print_count = print_count + 1, last_printed_at = clock_timestamp() WHERE organization_id = $1 AND id = $2`, [c.organizationId, note.id]);
  await noteEvent(client, c, note.id, note.print_count > 0 ? "REPRINTED" : "PRINTED", { summary: note.status === "POSTED" ? `Copy ${note.print_count + 1}` : "Draft preview" });
  return getMaterialConsumption(client, c, note.id);
}

// Recovery: re-check a posted note against custody; a note that disagrees is marked for recovery, one that agrees again returns to posted.
export async function recoverMaterialConsumption(client, c, id) {
  needConsumption(c, CONSUMPTION.reverse);
  const { checkMaterialConsumptionPosting } = await import("./consumption-read.js");
  const note = await loadConsumption(client, c, id, { lock: true });
  if (!["POSTED", "RECOVERY_REQUIRED"].includes(note.status)) throw consumptionError(409, "MFG_CONSUMPTION_STATE_INVALID", "Only a posted note is checked.");
  const check = await checkMaterialConsumptionPosting(client, c, note.id);
  const to = check.consistent ? "POSTED" : "RECOVERY_REQUIRED";
  if (to !== note.status) {
    await client.query(`UPDATE tenant.manufacturing_material_consumptions SET status = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, note.id, to]);
    await noteEvent(client, c, note.id, to === "POSTED" ? "RECOVERED" : "RECOVERY_REQUIRED", { from: note.status, to, summary: check.problems.join(" ") || "Custody agrees" });
  }
  return { check, consumption: await getMaterialConsumption(client, c, note.id) };
}

