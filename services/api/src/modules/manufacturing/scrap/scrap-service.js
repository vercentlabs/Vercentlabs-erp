// Manufacturing Scrap — the commands: create and edit a draft, check it (nothing moves), submit it for the approval the company's policy asks
// for, approve or reject it, post it, cancel a draft, request and decide a correction of a posted note, count a print and re-check a posting.
// Posting is one database transaction: under the order's lock the custody (or rejected output) is claimed again, the disposition recorded once
// — irrecoverable scrap moves no stock (it left the warehouse when it was issued, or was never received), recoverable scrap is received into
// the damaged-stock bin at its source value — and Finance moves value out of work in progress only where it leaves it (recoverable scrap to
// inventory, an abnormal loss to manufacturing variance); a normal loss stays in the order's cost. Identity: `ms:<id>:v<version>`.
import { randomUUID } from "node:crypto";

import { postStockMovement, reverseStockMovements } from "../../stock/index.js";
import { valuationOfMovements } from "../../stock/valuation-engine.js";
import { SOURCE, atomically, event as orderEvent, moError, nextNumber, postJournal } from "../orders/mo-core.js";
import {
  D, MoError, REASONS, SCRAP, UNPOSTED, ZERO, add, approvalReasons, contentHash, costOf, div, has, loadScrap, loadScrapLines, loadScrapOrder, money, needScrap, q, requireScrappable,
  resolveDestination, resolveLines, scrapError, scrapSettings, sub, text,
} from "./scrap-core.js";
import { getManufacturingScrap } from "./scrap-read.js";

const stockCtx = (c) => ({ ...c, permissions: [...new Set([...(c.permissions ?? []), "stock.view", "stock.receive", "stock.issue"])] });
async function scrapEvent(client, c, scrapId, action, { from = null, to = null, summary = null, details = {} } = {}) {
  await client.query(`INSERT INTO tenant.manufacturing_scrap_events (organization_id, scrap_id, action, from_status, to_status, summary, details, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [c.organizationId, scrapId, action, from, to, summary ? String(summary).slice(0, 1000) : null, JSON.stringify(details), c.userId ?? null]);
}
const versionCheck = (scrap, expected) => {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(scrap.row_version)) throw scrapError(409, "MFG_SCRAP_DOCUMENT_CHANGED");
};
function stockFailure(error, fallback) {
  if (error instanceof MoError) return error;
  if (error?.status && error.status < 500 && error.code) return scrapError(error.status === 403 ? 403 : 409, error.status === 403 ? "MFG_SCRAP_PERMISSION_DENIED" : fallback, `Inventory: ${error.message}`);
  return error;
}

// ------------------------------------------------------------------ the header as entered
function readHeader(input, current = {}) {
  const pick = (key, column, fallback = null) => (input[key] !== undefined ? input[key] : current[column] ?? fallback);
  const type = String(pick("scrapType", "scrap_type", "ISSUED_MATERIAL")).toUpperCase();
  if (!["ISSUED_MATERIAL", "REJECTED_OUTPUT"].includes(type)) throw scrapError(400, "MFG_SCRAP_SOURCE_REQUIRED", "Choose what is scrapped: issued material or rejected output.");
  const reason = String(pick("reasonCode", "reason_code", "") ?? "").toUpperCase();
  if (!REASONS[reason]) throw scrapError(400, "MFG_SCRAP_REASON_REQUIRED", "Choose why it is scrapped.");
  const disposition = String(pick("disposition", "disposition", "IRRECOVERABLE")).toUpperCase();
  if (!["IRRECOVERABLE", "RECOVERABLE"].includes(disposition)) throw scrapError(400, "MFG_SCRAP_STATE_INVALID", "Choose recoverable or irrecoverable.");
  const loss = String(pick("lossClass", "loss_class", "NORMAL")).toUpperCase();
  if (!["NORMAL", "ABNORMAL"].includes(loss)) throw scrapError(400, "MFG_SCRAP_STATE_INVALID", "Choose a normal or an abnormal loss.");
  const description = text(pick("description", "description", ""), 1000) || null;
  if ((reason === "OTHER" || loss === "ABNORMAL") && (!description || description.length < 3)) {
    throw scrapError(400, "MFG_SCRAP_REASON_REQUIRED", reason === "OTHER" ? "Describe what happened (the reason is Other)." : "Describe what happened: an abnormal loss is explained.");
  }
  const recovery = pick("recoveryValue", "recovery_value", null);
  if (recovery !== null && recovery !== "" && !(Number(recovery) >= 0)) throw scrapError(400, "MFG_SCRAP_QTY_INVALID", "The recovery value is an amount of zero or more.");
  return { scrap_type: type, reason_code: reason, disposition, loss_class: loss, description, recovery_value: recovery === null || recovery === "" ? null : String(recovery),
    destinationLocationId: disposition === "RECOVERABLE" ? pick("destinationLocationId", "destination_location_id", null) : null,
    scrap_date: pick("scrapDate", "scrap_date", null) };
}
// Recoverable scrap is received back into stock (a damaged-stock bin): a serial-numbered item is recovered through Inventory instead.
function checkRecoverable(header, lines, order) {
  if (header.disposition !== "RECOVERABLE") return;
  for (const line of lines) {
    const tracking = line.trackingType ?? order.finished_tracking_type;
    if (tracking === "serial") throw scrapError(400, "MFG_SCRAP_SERIAL_INVALID", "Serial-numbered items are scrapped as irrecoverable here; recover a serial unit through Inventory.");
    if (header.scrap_type === "REJECTED_OUTPUT" && tracking === "batch") throw scrapError(400, "MFG_SCRAP_BATCH_INVALID", "Batch-tracked output is scrapped as irrecoverable here; recover it through Inventory.");
  }
}
async function withFinishedTracking(client, order) {
  const row = (await client.query(`SELECT tracking_type FROM tenant.items WHERE id = $1`, [order.finished_item_id])).rows[0];
  return { ...order, finished_tracking_type: row?.tracking_type ?? "none" };
}

async function writeLines(client, c, scrapId, lines) {
  await client.query(`DELETE FROM tenant.manufacturing_scrap_lines WHERE organization_id = $1 AND scrap_id = $2`, [c.organizationId, scrapId]);
  for (const [index, line] of lines.entries()) {
    await client.query(
      `INSERT INTO tenant.manufacturing_scrap_lines (organization_id, scrap_id, line_number, item_id, material_id, production_entry_id, quality_decision_id, quantity, uom_id, conversion_factor,
         base_quantity, batch_id, serial_ids, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::uuid[],$14)`,
      [c.organizationId, scrapId, index + 1, line.itemId, line.material?.id ?? null, line.entryId ?? null, line.qualityDecisionId ?? null, line.quantity, line.uomId, q(line.factor, 9),
        q(line.baseQuantity), line.batchId, line.serialIds, line.notes]);
  }
}
const asInput = (rows) => rows.map((row) => ({ materialId: row.material_id, productionEntryId: row.production_entry_id, quantity: q(D(row.quantity)), uomId: row.uom_id,
  batchId: row.batch_id, serialIds: row.serial_ids ?? undefined, notes: row.notes }));

// input: { manufacturingOrderId, scrapType, reasonCode, description?, disposition, lossClass, destinationLocationId?, recoveryValue?, scrapDate?, lines, idempotencyKey? }
// lines: [{ materialId, quantity, uomId?, batchId?, serialIds? }] for issued material; [{ productionEntryId, quantity, uomId? }] for rejected output.
export async function createScrapDraft(client, c, input = {}) {
  needScrap(c, SCRAP.create);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const existing = (await client.query(`SELECT id FROM tenant.manufacturing_scraps WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (existing) return { ...(await getManufacturingScrap(client, c, existing.id)), replayed: true };
  }
  const order = await withFinishedTracking(client, await loadScrapOrder(client, c, input.manufacturingOrderId, { lock: true }));
  const header = readHeader(input);
  requireScrappable(order, header.scrap_type);
  const { lines } = await resolveLines(client, c, order, header.scrap_type, input.lines);
  checkRecoverable(header, lines, order);
  const destination = await resolveDestination(client, c, order, header);
  const id = randomUUID();
  const number = await nextNumber(client, c, "manufacturing_scrap");
  const full = { ...header, manufacturing_order_id: order.id, destination_location_id: destination.locationId };
  await client.query(
    `INSERT INTO tenant.manufacturing_scraps (id, organization_id, scrap_number, manufacturing_order_id, scrap_type, reason_code, description, disposition, loss_class, source_warehouse_id,
       destination_warehouse_id, destination_location_id, recovery_value, scrap_date, content_hash, created_by, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::date, current_date),$15,$16,$17)`,
    [id, c.organizationId, number, order.id, header.scrap_type, header.reason_code, header.description, header.disposition, header.loss_class, order.manufacturing_warehouse_id,
      destination.warehouseId, destination.locationId, header.recovery_value, header.scrap_date, contentHash(full, lines), c.userId ?? null, key]);
  await writeLines(client, c, id, lines);
  await scrapEvent(client, c, id, "CREATED", { to: "DRAFT", summary: `${number} for ${order.mo_number}: ${lines.length} line(s), ${header.disposition.toLowerCase()}` });
  return getManufacturingScrap(client, c, id);
}

// input: { expectedVersion, ...header fields?, lines? }. Any edit returns the note to a draft and withdraws an approval.
export async function updateScrapDraft(client, c, id, input = {}) {
  needScrap(c, SCRAP.editDraft);
  const scrap = await loadScrap(client, c, id, { lock: true });
  if (!UNPOSTED.has(scrap.status)) throw scrapError(409, scrap.status === "POSTED" ? "MFG_SCRAP_ALREADY_POSTED" : "MFG_SCRAP_STATE_INVALID");
  versionCheck(scrap, input.expectedVersion);
  const order = await withFinishedTracking(client, await loadScrapOrder(client, c, scrap.manufacturing_order_id, { lock: true }));
  const header = readHeader({ ...input, scrapType: scrap.scrap_type }, scrap);
  requireScrappable(order, header.scrap_type);
  const { lines } = await resolveLines(client, c, order, header.scrap_type, input.lines ?? asInput(await loadScrapLines(client, c, scrap.id)));
  checkRecoverable(header, lines, order);
  const destination = await resolveDestination(client, c, order, header);
  const full = { ...header, manufacturing_order_id: order.id, destination_location_id: destination.locationId };
  await writeLines(client, c, scrap.id, lines);
  await client.query(
    `UPDATE tenant.manufacturing_scraps SET reason_code = $3, description = $4, disposition = $5, loss_class = $6, destination_warehouse_id = $7, destination_location_id = $8, recovery_value = $9,
       scrap_date = COALESCE($10::date, scrap_date), content_hash = $11, status = 'DRAFT', approval_required = false, approval_status = 'NOT_REQUIRED', approval_hash = NULL, approval_reasons = NULL,
       approved_by = NULL, approved_at = NULL, approval_note = NULL, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, scrap.id, header.reason_code, header.description, header.disposition, header.loss_class, destination.warehouseId, destination.locationId, header.recovery_value,
      header.scrap_date, contentHash(full, lines)]);
  await scrapEvent(client, c, scrap.id, "EDITED", { from: scrap.status, to: "DRAFT",
    summary: ["REQUESTED", "APPROVED"].includes(scrap.approval_status) ? "Edited: the approval was withdrawn" : "Edited" });
  return getManufacturingScrap(client, c, scrap.id);
}

// What posting would do now, without doing it: each line against its source, the value, the approval the policy asks for and every problem.
export async function previewScrap(client, c, id) {
  needScrap(c, SCRAP.view);
  const scrap = await loadScrap(client, c, id);
  const order = await withFinishedTracking(client, await loadScrapOrder(client, c, scrap.manufacturing_order_id));
  const rows = await loadScrapLines(client, c, scrap.id);
  const problems = [];
  if (!UNPOSTED.has(scrap.status)) problems.push({ code: scrap.status === "POSTED" ? "MFG_SCRAP_ALREADY_POSTED" : "MFG_SCRAP_STATE_INVALID", message: `${scrap.scrap_number} is ${scrap.status.toLowerCase().replace(/_/g, " ")}.` });
  try { requireScrappable(order, scrap.scrap_type); } catch (error) { problems.push({ code: error.code, message: error.message }); }
  let lines = [];
  try { lines = (await resolveLines(client, c, order, scrap.scrap_type, asInput(rows))).lines; } catch (error) { if (error instanceof MoError) problems.push({ code: error.code, message: error.message }); else throw error; }
  const cost = lines.length ? costOf(order, lines, scrap) : null;
  if (cost && cost.status === "MISSING") problems.push({ code: "MFG_SCRAP_VALUATION_MISSING", message: cost.message });
  if (cost && cost.status === "BLOCKED") problems.push({ code: "MFG_SCRAP_VALUATION_MISSING", message: cost.message });
  const reasons = approvalReasons(await scrapSettings(client, c), scrap, cost?.total ?? null);
  const approved = scrap.approval_status === "APPROVED" && scrap.approval_hash === scrap.content_hash;
  if (reasons.length && !approved) problems.push({ code: scrap.approval_status === "APPROVED" ? "MFG_SCRAP_APPROVAL_STALE" : "MFG_SCRAP_APPROVAL_REQUIRED", message: `Needs approval: ${reasons.join(", ")}.` });
  const costView = has(c, SCRAP.costView) || has(c, "manufacturing.mo.cost_view");
  return {
    scrapId: scrap.id, scrapNumber: scrap.scrap_number, previewOnly: true, checkedAt: new Date().toISOString(), ok: problems.length === 0,
    readiness: problems.length === 0 ? "READY_TO_POST" : reasons.length && !approved && problems.length === 1 ? "PENDING_APPROVAL" : "BLOCKED",
    approval: { required: reasons.length > 0, reasons, valid: !reasons.length || approved },
    cost: cost ? { status: cost.status, total: costView && cost.total !== null ? money(cost.total) : null,
      treatment: scrap.disposition === "RECOVERABLE" ? "To the scrap bin at source value (work in progress down, inventory up)" : scrap.loss_class === "ABNORMAL" ? "Written off: work in progress down, manufacturing variance up" : "Normal loss: stays in the order's cost" } : null,
    problems,
    lines: lines.map((line, index) => ({ lineNumber: index + 1, quantity: q(line.baseQuantity), value: costView && cost?.perLine?.[index] ? money(cost.perLine[index]) : null })),
  };
}

// ------------------------------------------------------------------ approval
// input: { expectedVersion? }. Records why the policy asks for it; nothing moves.
export async function submitScrap(client, c, id, input = {}) {
  needScrap(c, SCRAP.submit);
  const scrap = await loadScrap(client, c, id, { lock: true });
  if (scrap.status !== "DRAFT") throw scrapError(409, scrap.status === "POSTED" ? "MFG_SCRAP_ALREADY_POSTED" : "MFG_SCRAP_STATE_INVALID");
  versionCheck(scrap, input.expectedVersion);
  const preview = await previewScrap(client, c, scrap.id);
  const other = preview.problems.filter((row) => !["MFG_SCRAP_APPROVAL_REQUIRED", "MFG_SCRAP_APPROVAL_STALE"].includes(row.code));
  if (other.length) throw scrapError(409, other[0].code, other[0].message);
  if (!preview.approval.required) throw scrapError(409, "MFG_SCRAP_STATE_INVALID", "This scrap needs no approval under the company's policy: post it.");
  await client.query(`UPDATE tenant.manufacturing_scraps SET status = 'PENDING_APPROVAL', approval_required = true, approval_status = 'REQUESTED', approval_hash = content_hash, approval_reasons = $3::jsonb,
      approval_requested_by = $4, approval_requested_at = clock_timestamp(), approved_by = NULL, approved_at = NULL, approval_note = NULL, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, scrap.id, JSON.stringify(preview.approval.reasons), c.userId ?? null]);
  await scrapEvent(client, c, scrap.id, "SUBMITTED", { from: "DRAFT", to: "PENDING_APPROVAL", summary: preview.approval.reasons.join(", ") });
  return getManufacturingScrap(client, c, scrap.id);
}
// input: { decision: APPROVE | REJECT, note?, expectedVersion? }. By someone other than the requester unless the company allows it.
export async function decideScrap(client, c, id, input = {}) {
  needScrap(c, SCRAP.approve);
  const scrap = await loadScrap(client, c, id, { lock: true });
  if (scrap.status !== "PENDING_APPROVAL" || scrap.approval_status !== "REQUESTED") throw scrapError(409, "MFG_SCRAP_STATE_INVALID", "This scrap note is not waiting for an approval.");
  versionCheck(scrap, input.expectedVersion);
  const settings = await scrapSettings(client, c);
  if ((scrap.approval_requested_by === c.userId || scrap.created_by === c.userId) && !settings.varianceSelfApproval) throw scrapError(409, "MFG_SCRAP_APPROVAL_SELF");
  const decision = String(input.decision ?? "").toUpperCase();
  if (!["APPROVE", "REJECT"].includes(decision)) throw scrapError(400, "MFG_SCRAP_STATE_INVALID", "Approve or reject the scrap.");
  const note = text(input.note, 1000) || null;
  if (decision === "REJECT" && (!note || note.length < 3)) throw scrapError(400, "MFG_SCRAP_REASON_REQUIRED", "Say why it is rejected.");
  if (scrap.approval_hash !== scrap.content_hash) throw scrapError(409, "MFG_SCRAP_APPROVAL_STALE");
  const to = decision === "APPROVE" ? "APPROVED" : "DRAFT";
  await client.query(`UPDATE tenant.manufacturing_scraps SET status = $3, approval_status = $4, approved_by = $5, approved_at = clock_timestamp(), approval_note = $6, row_version = row_version + 1
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, scrap.id, to, decision === "APPROVE" ? "APPROVED" : "REJECTED", c.userId ?? null, note]);
  await scrapEvent(client, c, scrap.id, decision === "APPROVE" ? "APPROVED" : "REJECTED", { from: scrap.status, to, summary: note });
  return getManufacturingScrap(client, c, scrap.id);
}

// ------------------------------------------------------------------ posting
// input: { expectedVersion?, expectedMoVersion? }
export async function postScrap(client, c, id, input = {}) {
  needScrap(c, SCRAP.post);
  const scrap = await loadScrap(client, c, id, { lock: true });
  const postingKey = `ms:${scrap.id}:v${scrap.row_version}`;
  if (scrap.status === "POSTED" || scrap.status === "RECOVERY_REQUIRED") {
    if (input.expectedVersion === undefined || input.expectedVersion === null || Number(input.expectedVersion) === Number(scrap.row_version)) return { ...(await postingResult(client, c, scrap.id)), replayed: true };
    throw scrapError(409, "MFG_SCRAP_ALREADY_POSTED");
  }
  if (!UNPOSTED.has(scrap.status)) throw scrapError(409, "MFG_SCRAP_STATE_INVALID", `${scrap.scrap_number} is ${scrap.status.toLowerCase()}.`);
  versionCheck(scrap, input.expectedVersion);
  if (scrap.disposition === "RECOVERABLE" && !has(c, "stock.receive")) throw scrapError(403, "MFG_SCRAP_PERMISSION_DENIED", "Inventory: you also need permission to receive stock into the scrap bin.");
  const order = await withFinishedTracking(client, await loadScrapOrder(client, c, scrap.manufacturing_order_id, { lock: true }));
  if (input.expectedMoVersion !== undefined && input.expectedMoVersion !== null && Number(input.expectedMoVersion) !== Number(order.version)) {
    throw scrapError(409, "MFG_SCRAP_SOURCE_CHANGED", `${order.mo_number} changed since this scrap was checked. Review it again.`);
  }
  requireScrappable(order, scrap.scrap_type);
  const rows = await loadScrapLines(client, c, scrap.id);
  if (!rows.length) throw scrapError(400, "MFG_SCRAP_SOURCE_REQUIRED");
  if (contentHash(scrap, rows) !== scrap.content_hash) throw scrapError(409, "MFG_SCRAP_DOCUMENT_CHANGED");
  // The claim: the sources locked with the order and checked again.
  if (scrap.scrap_type === "ISSUED_MATERIAL") await client.query(`SELECT id FROM tenant.manufacturing_order_materials WHERE organization_id = $1 AND manufacturing_order_id = $2 FOR UPDATE`, [c.organizationId, order.id]);
  else await client.query(`SELECT id FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND manufacturing_order_id = $2 FOR UPDATE`, [c.organizationId, order.id]);
  let lines;
  try { ({ lines } = await resolveLines(client, c, order, scrap.scrap_type, asInput(rows))); } catch (error) {
    if (["MFG_SCRAP_EXCEEDS_CUSTODY", "MFG_SCRAP_ALREADY_DISPOSED"].includes(error.code)) throw scrapError(409, "MFG_SCRAP_SOURCE_CHANGED", `${error.message} Another transaction used it: review the record.`, error.details);
    throw error;
  }
  const cost = costOf(order, lines, scrap);
  if (cost.status !== "VALUED") throw scrapError(409, "MFG_SCRAP_VALUATION_MISSING", cost.message);
  const reasons = approvalReasons(await scrapSettings(client, c), scrap, cost.total);
  if (reasons.length && !(scrap.approval_status === "APPROVED" && scrap.approval_hash === scrap.content_hash)) {
    throw scrapError(409, scrap.approval_status === "APPROVED" ? "MFG_SCRAP_APPROVAL_STALE" : "MFG_SCRAP_APPROVAL_REQUIRED", `Needs approval: ${reasons.join(", ")}.`, { reasons });
  }
  const reference = `${scrap.scrap_number} · ${order.mo_number}`;
  // 1. Inventory: only recoverable scrap moves stock — into the damaged-stock bin, at its source value.
  const movementsByLine = [];
  let total = ZERO;
  for (const [index, line] of lines.entries()) {
    let movementIds = [];
    let value = cost.perLine[index];
    if (scrap.disposition === "RECOVERABLE") {
      try {
        const movement = await postStockMovement(client, stockCtx(c), { movementType: "receipt", itemId: line.itemId, warehouseId: scrap.destination_warehouse_id, warehouseLocationId: scrap.destination_location_id,
          batchId: line.batchId ?? undefined, quantity: q(line.baseQuantity), unitCost: q(line.rate), referenceType: SOURCE, referenceId: order.id, sourceLineId: rows[index].id,
          reason: `Recoverable scrap ${reference}`, idempotencyKey: `${postingKey}:${index + 1}` });
        movementIds = [movement.id];
        const valued = await valuationOfMovements(client, c.organizationId, movementIds);
        value = D(money(D(Math.abs(Number(valued.total)).toFixed(6))));
      } catch (error) { throw stockFailure(error, "MFG_SCRAP_WAREHOUSE_INVALID"); }
    }
    movementsByLine.push({ movementIds, value });
    total = add(total, value);
  }
  // 2. Finance: value leaves work in progress only for recoverable scrap (to inventory) or an abnormal loss (to manufacturing variance).
  let journal = null;
  const leaves = scrap.disposition === "RECOVERABLE" || scrap.loss_class === "ABNORMAL";
  if (leaves && total > ZERO) {
    journal = await postJournal(client, c, { event: "manufacturing_scrap", sourceType: "manufacturing_scrap", sourceId: scrap.id, sourceNumber: scrap.scrap_number, reference,
      description: scrap.disposition === "RECOVERABLE" ? `Recoverable scrap from ${order.mo_number}` : `Abnormal scrap loss on ${order.mo_number}`,
      lines: [scrap.disposition === "RECOVERABLE"
        ? { mappingKey: "inventory", itemId: lines[0].itemId, label: "Scrap inventory", debit: total }
        : { mappingKey: "manufacturing_variance", label: "Abnormal scrap loss", debit: total },
      { mappingKey: "wip", label: "Work in progress", credit: total }] });
  }
  // 3. Manufacturing: custody (per identity) or rejected output disposed of, once.
  for (const [index, line] of lines.entries()) {
    const row = rows[index];
    if (scrap.scrap_type === "ISSUED_MATERIAL") {
      const parts = line.serialIds?.length ? line.serialIds.map((serialId) => ({ batchId: null, serialId, quantity: 1_000_000n })) : [{ batchId: line.batchId, serialId: null, quantity: line.baseQuantity }];
      for (const [partIndex, part] of parts.entries()) {
        await client.query(`INSERT INTO tenant.manufacturing_material_scrap (organization_id, manufacturing_order_id, material_id, batch_id, serial_id, quantity, reason, idempotency_key, recorded_by, scrap_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [c.organizationId, order.id, line.material.id, part.batchId, part.serialId, q(part.quantity),
          `${REASONS[scrap.reason_code]}${scrap.description ? `: ${scrap.description}` : ""} (${scrap.scrap_number})`.slice(0, 1000), `${postingKey}:${index + 1}:${partIndex}`, c.userId ?? null, scrap.id]);
      }
      await client.query(`UPDATE tenant.manufacturing_order_materials SET scrapped_quantity = scrapped_quantity + $3, version = version + 1 WHERE organization_id = $1 AND id = $2`,
        [c.organizationId, line.material.id, q(line.baseQuantity)]);
    } else {
      await client.query(`UPDATE tenant.manufacturing_production_entries SET output_scrapped_quantity = output_scrapped_quantity + $3 WHERE organization_id = $1 AND id = $2`,
        [c.organizationId, line.entryId, q(line.baseQuantity)]);
      await client.query(`INSERT INTO tenant.manufacturing_production_entry_events (organization_id, production_entry_id, action, summary, details, actor_user_id) VALUES ($1,$2,'SCRAPPED',$3,'{}'::jsonb,$4)`,
        [c.organizationId, line.entryId, `${scrap.scrap_number}: ${q(line.baseQuantity)} rejected output scrapped (${scrap.disposition.toLowerCase()})`, c.userId ?? null]);
    }
    const value = movementsByLine[index].value;
    await client.query(`UPDATE tenant.manufacturing_scrap_lines SET unit_cost = $3, total_cost = $4, stock_movement_ids = $5::uuid[] WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, row.id, q(div(value, line.baseQuantity)), money(value), movementsByLine[index].movementIds]);
  }
  if (leaves) await client.query(`UPDATE tenant.manufacturing_orders SET wip_scrap_cost = wip_scrap_cost + $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, order.id, money(total)]);
  await client.query(`UPDATE tenant.manufacturing_orders SET version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, order.id]);
  const allMovements = movementsByLine.flatMap((part) => part.movementIds);
  const financeStatus = journal ? "POSTED" : "NOT_REQUIRED";
  await client.query(`INSERT INTO tenant.manufacturing_scrap_postings (organization_id, scrap_id, command_key, document_version, kind, inventory_status, stock_movement_ids, finance_status, journal_entry_id,
      amount, created_by) VALUES ($1,$2,$3,$4,'SCRAP',$5,$6::uuid[],$7,$8,$9,$10)`,
    [c.organizationId, scrap.id, postingKey, scrap.row_version, allMovements.length ? "CONFIRMED" : "NOT_REQUIRED", allMovements, financeStatus, journal, money(total), c.userId ?? null]);
  await client.query(`UPDATE tenant.manufacturing_scraps SET status = 'POSTED', posting_key = $3, posted_mo_version = $4, posted_by = $5, posted_at = clock_timestamp(), total_cost = $6, cost_status = 'VALUED',
      finance_status = $7, journal_entry_id = $8 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, scrap.id, postingKey, order.version, c.userId ?? null, money(total), financeStatus, journal]);
  const summary = rows.map((row) => `${row.material_id ? row.item_code : row.entry_number} ${q(D(row.base_quantity))}`).join(", ");
  await scrapEvent(client, c, scrap.id, "POSTED", { from: scrap.status, to: "POSTED", summary: `${summary} · ${scrap.disposition.toLowerCase()} · ${scrap.loss_class.toLowerCase()} loss`, details: { postingKey } });
  await orderEvent(client, c, order.id, scrap.scrap_type === "ISSUED_MATERIAL" ? "MATERIAL_SCRAPPED" : "OUTPUT_SCRAPPED", { summary: `${scrap.scrap_number}: ${summary} (${REASONS[scrap.reason_code].toLowerCase()})`,
    details: { scrapId: scrap.id } });
  return postingResult(client, c, scrap.id);
}

async function postingResult(client, c, id) {
  const scrap = await getManufacturingScrap(client, c, id);
  return { scrapId: scrap.id, scrapNumber: scrap.number, status: scrap.status, inventoryTransactionIds: scrap.posting?.stockMovementIds ?? [], financeStatus: scrap.posting?.financeStatus ?? null,
    postedAt: scrap.postedAt, scrap };
}

// input: { reason, expectedVersion? }
export async function cancelScrap(client, c, id, input = {}) {
  needScrap(c, SCRAP.editDraft);
  const scrap = await loadScrap(client, c, id, { lock: true });
  if (scrap.status === "CANCELLED") return getManufacturingScrap(client, c, scrap.id);
  if (!UNPOSTED.has(scrap.status)) throw scrapError(409, scrap.status === "POSTED" ? "MFG_SCRAP_ALREADY_POSTED" : "MFG_SCRAP_STATE_INVALID",
    scrap.status === "POSTED" ? "A posted scrap note is not cancelled: request a correction instead." : undefined);
  versionCheck(scrap, input.expectedVersion);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw scrapError(400, "MFG_SCRAP_REASON_REQUIRED", "Say why the scrap note is cancelled.");
  await client.query(`UPDATE tenant.manufacturing_scraps SET status = 'CANCELLED', cancelled_by = $3, cancelled_at = clock_timestamp(), cancel_reason = $4, row_version = row_version + 1
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, scrap.id, c.userId ?? null, reason]);
  await scrapEvent(client, c, scrap.id, "CANCELLED", { from: scrap.status, to: "CANCELLED", summary: reason });
  return getManufacturingScrap(client, c, scrap.id);
}

// ------------------------------------------------------------------ the order's direct "Scrap issued material" (the same posting path)
// input: { lines: [{ materialId, quantity, reason, batchId?, serialId? }], idempotencyKey }. A scrap note created and posted at once (irrecoverable,
// normal loss). Where the company's policy asks for an approval, it stays a draft and says so.
export async function recordMaterialScrapThroughNote(client, c, orderId, input = {}) {
  const key = text(input.idempotencyKey, 200);
  if (!key) throw moError(400, "MFG_MO_KEY_REQUIRED");
  const noteKey = `mo-scrap:${key}`;
  const existing = (await client.query(`SELECT id, status FROM tenant.manufacturing_scraps WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, noteKey])).rows[0];
  if (existing) return { orderId, scrapId: existing.id, replayed: true };
  const lines = Array.isArray(input.lines) ? input.lines.filter((line) => line && Number(line.quantity) > 0) : [];
  const reason = text(lines[0]?.reason, 500);
  if (lines.some((line) => text(line.reason, 500).length < 3)) throw scrapError(400, "MFG_SCRAP_REASON_REQUIRED", "Say why each material is scrapped.");
  return atomically(client, async () => {
    const draft = await createScrapDraft(client, c, { manufacturingOrderId: orderId, scrapType: "ISSUED_MATERIAL", reasonCode: "OTHER", description: reason, disposition: "IRRECOVERABLE",
      lossClass: "NORMAL", idempotencyKey: noteKey, lines: lines.map((line) => ({ materialId: line.materialId, quantity: String(line.quantity), batchId: line.batchId ?? undefined,
        serialIds: line.serialId ? [line.serialId] : undefined, notes: line.reason })) });
    if (draft.approval.required) throw scrapError(409, "MFG_SCRAP_APPROVAL_REQUIRED", `Needs approval: ${draft.approval.reasons.join(", ")}. Record it from the Scrap page.`);
    const posted = await postScrap(client, c, draft.id, { expectedVersion: draft.rowVersion });
    return { orderId, scrapId: posted.scrapId, scrapNumber: posted.scrapNumber };
  });
}

// ------------------------------------------------------------------ correction
// A posted note is never edited. A correction is requested with a reason; for irrecoverable scrap the requester confirms the units still
// physically exist (destroyed stock is never brought back). Someone else approves it: the whole note is reversed — recoverable stock leaves the
// scrap bin, the value returns to work in progress, and the material goes back to production custody (or the output back to rejected,
// undisposed). Nothing ever returns to usable inventory this way.
// input: { reason, evidence?, physicallyPresent?, idempotencyKey }
export async function requestScrapCorrection(client, c, id, input = {}) {
  needScrap(c, SCRAP.correct);
  const key = text(input.idempotencyKey, 200);
  if (!key) throw moError(400, "MFG_MO_KEY_REQUIRED");
  const done = (await client.query(`SELECT scrap_id FROM tenant.manufacturing_scrap_corrections WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
  if (done) return { ...(await getManufacturingScrap(client, c, done.scrap_id)), replayed: true };
  const scrap = await loadScrap(client, c, id, { lock: true });
  if (scrap.status !== "POSTED") throw scrapError(409, "MFG_SCRAP_STATE_INVALID", "Only a posted scrap note is corrected; a draft is edited or cancelled.");
  if (scrap.correction_status === "REVERSED") throw scrapError(409, "MFG_SCRAP_CORRECTION_BLOCKED", `${scrap.scrap_number} is reversed already.`);
  if (scrap.correction_status === "REQUESTED") throw scrapError(409, "MFG_SCRAP_STATE_INVALID", `A correction of ${scrap.scrap_number} already waits for a decision.`);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw scrapError(400, "MFG_SCRAP_REASON_REQUIRED", "Say what was recorded wrongly.");
  if (scrap.disposition === "IRRECOVERABLE" && input.physicallyPresent !== true) {
    throw scrapError(409, "MFG_SCRAP_CORRECTION_BLOCKED", "Irrecoverable scrap is corrected only when the units still physically exist (the loss was recorded in error). Destroyed stock is never restored.");
  }
  const order = await loadScrapOrder(client, c, scrap.manufacturing_order_id);
  if (["COMPLETED", "CANCELLED"].includes(order.status)) throw scrapError(409, "MFG_SCRAP_CORRECTION_BLOCKED", `${order.mo_number} is ${order.status.toLowerCase()}: its scrap is history.`);
  const number = await nextNumber(client, c, "manufacturing_scrap_correction");
  await client.query(`INSERT INTO tenant.manufacturing_scrap_corrections (organization_id, correction_number, scrap_id, reason, evidence, physically_present, requested_by, idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [c.organizationId, number, scrap.id, reason, text(input.evidence, 1000) || null, input.physicallyPresent === true, c.userId ?? null, key]);
  await client.query(`UPDATE tenant.manufacturing_scraps SET correction_status = 'REQUESTED' WHERE organization_id = $1 AND id = $2`, [c.organizationId, scrap.id]);
  await scrapEvent(client, c, scrap.id, "CORRECTION_REQUESTED", { summary: `${number}: ${reason}` });
  return getManufacturingScrap(client, c, scrap.id);
}

// input: { decision: APPROVE | REJECT, note? }
export async function decideScrapCorrection(client, c, id, input = {}) {
  needScrap(c, SCRAP.approve);
  const scrap = await loadScrap(client, c, id, { lock: true });
  const correction = (await client.query(`SELECT * FROM tenant.manufacturing_scrap_corrections WHERE organization_id = $1 AND scrap_id = $2 AND status = 'REQUESTED' FOR UPDATE`, [c.organizationId, scrap.id])).rows[0];
  if (!correction) {
    if (["REVERSED", "REJECTED"].includes(scrap.correction_status)) return { ...(await getManufacturingScrap(client, c, scrap.id)), replayed: true };
    throw scrapError(409, "MFG_SCRAP_STATE_INVALID", "No correction of this scrap note waits for a decision.");
  }
  const settings = await scrapSettings(client, c);
  if (correction.requested_by === c.userId && !settings.varianceSelfApproval) throw scrapError(409, "MFG_SCRAP_APPROVAL_SELF");
  const decision = String(input.decision ?? "").toUpperCase();
  if (!["APPROVE", "REJECT"].includes(decision)) throw scrapError(400, "MFG_SCRAP_STATE_INVALID", "Approve or reject the correction.");
  const note = text(input.note, 1000) || null;
  if (decision === "REJECT") {
    if (!note || note.length < 3) throw scrapError(400, "MFG_SCRAP_REASON_REQUIRED", "Say why the correction is rejected.");
    await client.query(`UPDATE tenant.manufacturing_scrap_corrections SET status = 'REJECTED', decided_by = $3, decided_at = clock_timestamp(), decision_note = $4 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, correction.id, c.userId ?? null, note]);
    await client.query(`UPDATE tenant.manufacturing_scraps SET correction_status = 'REJECTED' WHERE organization_id = $1 AND id = $2`, [c.organizationId, scrap.id]);
    await scrapEvent(client, c, scrap.id, "CORRECTION_REJECTED", { summary: `${correction.correction_number}: ${note}` });
    return getManufacturingScrap(client, c, scrap.id);
  }
  const order = await loadScrapOrder(client, c, scrap.manufacturing_order_id, { lock: true });
  if (["COMPLETED", "CANCELLED"].includes(order.status)) throw scrapError(409, "MFG_SCRAP_CORRECTION_BLOCKED", `${order.mo_number} is ${order.status.toLowerCase()}: its scrap is history.`);
  const rows = await loadScrapLines(client, c, scrap.id);
  // 1. Inventory: recoverable scrap leaves the scrap bin by its exact movements (Inventory refuses if it was sold, moved or used since).
  let back = { movements: [] };
  const movements = rows.flatMap((row) => row.stock_movement_ids ?? []);
  if (movements.length) {
    if (!has(c, "stock.issue")) throw scrapError(403, "MFG_SCRAP_PERMISSION_DENIED", "Inventory: you also need permission to issue stock to reverse recoverable scrap.");
    try {
      back = await reverseStockMovements(client, stockCtx(c), movements, { reason: `Reversal of ${scrap.scrap_number}: ${correction.reason}`, referenceType: SOURCE, referenceId: order.id, keyPrefix: `msc:${correction.id}` });
    } catch (error) { throw stockFailure(error, "MFG_SCRAP_CORRECTION_BLOCKED"); }
  }
  // 2. Finance: what left work in progress comes back.
  const total = D(scrap.total_cost ?? 0);
  const leaves = scrap.disposition === "RECOVERABLE" || scrap.loss_class === "ABNORMAL";
  let journal = null;
  if (leaves && total > ZERO) {
    journal = await postJournal(client, c, { event: "manufacturing_scrap_reversal", sourceType: "manufacturing_scrap_correction", sourceId: correction.id, sourceNumber: correction.correction_number,
      reference: `${correction.correction_number} · ${scrap.scrap_number} · ${order.mo_number}`, description: `Reversal of ${scrap.scrap_number}`,
      lines: [{ mappingKey: "wip", label: "Work in progress", debit: total },
        scrap.disposition === "RECOVERABLE" ? { mappingKey: "inventory", itemId: rows[0].item_id, label: "Scrap inventory", credit: total } : { mappingKey: "manufacturing_variance", label: "Abnormal scrap loss", credit: total }] });
    await client.query(`UPDATE tenant.manufacturing_orders SET wip_scrap_cost = wip_scrap_cost - $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, order.id, money(total)]);
  }
  // 3. Manufacturing: custody (per identity) or rejected output given back.
  for (const row of rows) {
    if (row.material_id) {
      const parts = (await client.query(`SELECT batch_id, serial_id, quantity FROM tenant.manufacturing_material_scrap WHERE organization_id = $1 AND scrap_id = $2 AND material_id = $3`,
        [c.organizationId, scrap.id, row.material_id])).rows;
      for (const part of parts) {
        await client.query(`INSERT INTO tenant.manufacturing_material_scrap_reversals (organization_id, manufacturing_order_id, material_id, scrap_id, correction_id, batch_id, serial_id, quantity)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [c.organizationId, order.id, row.material_id, scrap.id, correction.id, part.batch_id, part.serial_id, part.quantity]);
      }
      await client.query(`UPDATE tenant.manufacturing_order_materials SET scrapped_quantity = scrapped_quantity - $3, scrap_reversed_quantity = scrap_reversed_quantity + $3, version = version + 1
          WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.material_id, q(D(row.base_quantity))]);
    } else {
      await client.query(`UPDATE tenant.manufacturing_production_entries SET output_scrap_reversed_quantity = output_scrap_reversed_quantity + $3 WHERE organization_id = $1 AND id = $2`,
        [c.organizationId, row.production_entry_id, q(D(row.base_quantity))]);
      await client.query(`INSERT INTO tenant.manufacturing_production_entry_events (organization_id, production_entry_id, action, summary, details, actor_user_id) VALUES ($1,$2,'SCRAP_REVERSED',$3,'{}'::jsonb,$4)`,
        [c.organizationId, row.production_entry_id, `${correction.correction_number}: ${q(D(row.base_quantity))} back to rejected, undisposed`, c.userId ?? null]);
    }
  }
  await client.query(`UPDATE tenant.manufacturing_orders SET version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, order.id]);
  const backIds = back.movements.map((movement) => movement.id);
  await client.query(`UPDATE tenant.manufacturing_scrap_corrections SET status = 'APPROVED', decided_by = $3, decided_at = clock_timestamp(), decision_note = $4, stock_movement_ids = $5::uuid[], total_cost = $6,
      journal_entry_id = $7 WHERE organization_id = $1 AND id = $2`, [c.organizationId, correction.id, c.userId ?? null, note, backIds, money(total), journal]);
  await client.query(`INSERT INTO tenant.manufacturing_scrap_postings (organization_id, scrap_id, command_key, document_version, kind, inventory_status, stock_movement_ids, finance_status, journal_entry_id,
      amount, created_by) VALUES ($1,$2,$3,$4,'REVERSAL',$5,$6::uuid[],$7,$8,$9,$10)`,
    [c.organizationId, scrap.id, `msc:${correction.id}`, scrap.row_version, backIds.length ? "CONFIRMED" : "NOT_REQUIRED", backIds, journal ? "POSTED" : "NOT_REQUIRED", journal, money(total), c.userId ?? null]);
  await client.query(`UPDATE tenant.manufacturing_scraps SET correction_status = 'REVERSED' WHERE organization_id = $1 AND id = $2`, [c.organizationId, scrap.id]);
  await scrapEvent(client, c, scrap.id, "REVERSED", { summary: `${correction.correction_number}: ${correction.reason}${note ? ` (${note})` : ""}` });
  await orderEvent(client, c, order.id, "SCRAP_REVERSED", { summary: `${scrap.scrap_number} reversed by ${correction.correction_number}: ${correction.reason}` });
  return getManufacturingScrap(client, c, scrap.id);
}

// ------------------------------------------------------------------ printing and recovery
export async function recordScrapPrint(client, c, id) {
  needScrap(c, SCRAP.export);
  const scrap = await loadScrap(client, c, id, { lock: true });
  await client.query(`UPDATE tenant.manufacturing_scraps SET print_count = print_count + 1, last_printed_at = clock_timestamp() WHERE organization_id = $1 AND id = $2`, [c.organizationId, scrap.id]);
  await scrapEvent(client, c, scrap.id, scrap.print_count > 0 ? "REPRINTED" : "PRINTED", { summary: scrap.status === "POSTED" ? `Copy ${scrap.print_count + 1}` : "Draft preview" });
  return getManufacturingScrap(client, c, scrap.id);
}

export async function recoverScrap(client, c, id) {
  needScrap(c, SCRAP.approve);
  const { checkScrapPosting } = await import("./scrap-read.js");
  const scrap = await loadScrap(client, c, id, { lock: true });
  if (!["POSTED", "RECOVERY_REQUIRED"].includes(scrap.status)) throw scrapError(409, "MFG_SCRAP_STATE_INVALID", "Only a posted scrap note is checked against Inventory and Finance.");
  const check = await checkScrapPosting(client, c, scrap.id);
  const to = check.consistent ? "POSTED" : "RECOVERY_REQUIRED";
  if (to !== scrap.status) {
    await client.query(`UPDATE tenant.manufacturing_scraps SET status = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, scrap.id, to]);
    await scrapEvent(client, c, scrap.id, to === "POSTED" ? "RECOVERED" : "RECOVERY_REQUIRED", { from: scrap.status, to, summary: check.problems.join(" ") || "Inventory and Finance agree" });
  }
  return { check, scrap: await getManufacturingScrap(client, c, scrap.id) };
}

export { sub };
