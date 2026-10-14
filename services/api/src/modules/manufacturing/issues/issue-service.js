// Material Issue — the commands: create and edit a draft, check it (nothing moves), ask for and decide an approval of excess, post it,
// cancel a draft, reverse a posting error, scrap issued material, and count a print. Posting is one database transaction across
// Manufacturing, Inventory and Finance: every line posts or none does. Its identity is the note and its version (`mi:<id>:v<version>`), so
// a retry — or a second click after a timeout — finds the posted note and returns it; it never issues again.
import { randomUUID } from "node:crypto";

import { consumeStockReservation, postStockMovement, reverseStockMovements } from "../../stock/index.js";
import { valuationOfMovements } from "../../stock/valuation-engine.js";
import { MoError, SOURCE, atomically, div, event as orderEvent, money, moError, needMo, nextNumber, postJournal } from "../orders/mo-core.js";
import {
  D, ISSUE, MO, STATUS_LABEL, UNPOSTED, approvalState, VARIANCE_TYPES, ISSUE_REASONS, ZERO, add, contentHash, excessOf, has, issueError, issueSettings, lineFigures, loadIssue, loadIssueLines, loadIssueOrder,
  loadMaterials, needIssue, planStock, q, requireIssuable, resolveLines, storedLines, text, toleratedExcess, uuid,
} from "./issue-core.js";
import { getMaterialIssue } from "./issue-read.js";

const needStock = (c, permission, what) => { if (!has(c, permission)) throw issueError(403, "MFG_ISSUE_PERMISSION_DENIED", `Inventory: you also need permission to ${what} stock.`); };
const stockCtx = (c, ...extra) => ({ ...c, permissions: [...new Set([...(c.permissions ?? []), "stock.view", "stock.reserve", ...extra])] });
async function issueEvent(client, c, issueId, action, { from = null, to = null, summary = null, details = {} } = {}) {
  await client.query(`INSERT INTO tenant.manufacturing_material_issue_events (organization_id, material_issue_id, action, from_status, to_status, summary, details, actor_user_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`, [c.organizationId, issueId, action, from, to, summary ? String(summary).slice(0, 1000) : null, JSON.stringify(details), c.userId ?? null]);
}
const versionCheck = (issue, expected) => {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(issue.row_version)) throw issueError(409, "MFG_ISSUE_DOCUMENT_CHANGED");
};
// An Inventory refusal in the issue's own words.
function stockFailure(error, code) {
  if (error instanceof MoError) return error;
  const map = { STOCK_INSUFFICIENT: "MFG_ISSUE_STOCK_SHORTAGE", NEGATIVE_STOCK_BLOCKED: "MFG_ISSUE_STOCK_SHORTAGE", NEGATIVE_BATCH_STOCK_BLOCKED: "MFG_ISSUE_STOCK_SHORTAGE",
    NEGATIVE_SERIAL_STOCK_BLOCKED: "MFG_ISSUE_SERIAL_INVALID", STOCK_SERIAL_RESERVED: "MFG_ISSUE_RESERVATION_CONFLICT", STOCK_SERIAL_NOT_AT_LOCATION: "MFG_ISSUE_SERIAL_INVALID",
    STOCK_SERIAL_NOT_AVAILABLE: "MFG_ISSUE_SERIAL_INVALID", STOCK_SERIAL_NOT_FOUND: "MFG_ISSUE_SERIAL_INVALID", STOCK_RESERVATION_INELIGIBLE: "MFG_ISSUE_BATCH_INVALID",
    STOCK_RESERVATION_EXCEEDS_ACTIVE: "MFG_ISSUE_DOCUMENT_CHANGED" };
  if (error?.status && error.status < 500 && error.code) return issueError(error.status === 403 ? 403 : 409, error.status === 403 ? "MFG_ISSUE_PERMISSION_DENIED" : map[error.code] ?? code, `Inventory: ${error.message}`);
  return error;
}

// ------------------------------------------------------------------ drafts
async function writeLines(client, c, issueId, lines, excess) {
  await client.query(`DELETE FROM tenant.manufacturing_material_issue_lines WHERE organization_id = $1 AND material_issue_id = $2`, [c.organizationId, issueId]);
  for (const [index, line] of lines.entries()) {
    await client.query(
      `INSERT INTO tenant.manufacturing_material_issue_lines (organization_id, material_issue_id, line_number, material_id, item_id, quantity, uom_id, conversion_factor, base_quantity, batch_id,
         serial_ids, source_location_id, excess_quantity, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid[],$12,$13,$14)`,
      [c.organizationId, issueId, index + 1, line.material.id, line.material.component_item_id, line.quantity, line.uomId, q(line.factor, 9), q(line.baseQuantity), line.batchId, line.serialIds,
        line.sourceLocationId, q(excess[index]), line.notes]);
  }
}
async function checkLocations(client, c, order, input) {
  const check = async (locationId, warehouseId, label) => {
    if (!locationId) return null;
    const row = (await client.query(`SELECT id FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2 AND warehouse_id = $3`, [c.organizationId, uuid(locationId, label), warehouseId])).rows[0];
    if (!row) throw issueError(400, "MFG_ISSUE_WAREHOUSE_INVALID", `${label} is not a location of the order's ${label.startsWith("Source") ? "material" : "manufacturing"} warehouse.`);
    return row.id;
  };
  return { source: await check(input.sourceLocationId, order.material_warehouse_id, "Source location"), production: await check(input.productionLocationId, order.manufacturing_warehouse_id, "Production location") };
}
function sourceWarehouseOf(order, input) {
  // Material leaves only from the order's own material warehouse: another warehouse's stock reaches it by an Inventory transfer first.
  if (input.sourceWarehouseId && input.sourceWarehouseId !== order.material_warehouse_id) {
    throw issueError(400, "MFG_ISSUE_WAREHOUSE_INVALID", "Materials for this order are issued from its material warehouse; move other stock there with an Inventory transfer first.");
  }
  return order.material_warehouse_id;
}

// input: { manufacturingOrderId, lines, sourceLocationId?, productionLocationId?, issueReason?, notes?, receivedBy?, idempotencyKey? }
export async function createMaterialIssueDraft(client, c, input = {}) {
  needMo(c, MO.issue);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const existing = (await client.query(`SELECT id FROM tenant.manufacturing_material_issues WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (existing) return { ...(await getMaterialIssue(client, c, existing.id)), replayed: true };
  }
  const order = await loadIssueOrder(client, c, input.manufacturingOrderId, { lock: true });
  requireIssuable(order);
  const warehouseId = sourceWarehouseOf(order, input);
  const locations = await checkLocations(client, c, order, input);
  const materials = await loadMaterials(client, c, order.id);
  const lines = await resolveLines(client, c, order, materials, input.lines);
  const reason = String(input.issueReason ?? "NORMAL").toUpperCase();
  if (!ISSUE_REASONS.has(reason)) throw issueError(400, "MFG_ISSUE_QTY_INVALID", "Choose why the material is issued.");
  const id = randomUUID();
  const number = await nextNumber(client, c, "manufacturing_material_issue_note");
  const hash = contentHash({ manufacturing_order_id: order.id, source_warehouse_id: warehouseId, source_location_id: locations.source, production_location_id: locations.production }, lines);
  await client.query(
    `INSERT INTO tenant.manufacturing_material_issues (id, organization_id, issue_number, manufacturing_order_id, source_warehouse_id, source_location_id, production_warehouse_id, production_location_id,
       issue_reason, notes, received_by, content_hash, created_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [id, c.organizationId, number, order.id, warehouseId, locations.source, order.manufacturing_warehouse_id, locations.production, reason, text(input.notes, 1000) || null,
      text(input.receivedBy, 200) || null, hash, c.userId ?? null, key]);
  await writeLines(client, c, id, lines, excessOf(lines, materials));
  await issueEvent(client, c, id, "CREATED", { to: "DRAFT", summary: `${number} for ${order.mo_number}: ${lines.map((line) => `${line.material.item_code} ${line.quantity}`).join(", ")}` });
  return getMaterialIssue(client, c, id);
}

// input: { expectedVersion, lines?, sourceLocationId?, productionLocationId?, issueReason?, notes?, receivedBy? }. Any edit returns the note to
// a draft and withdraws an approval: an approval binds to the exact content it saw.
export async function updateMaterialIssueDraft(client, c, id, input = {}) {
  needMo(c, MO.issue);
  const issue = await loadIssue(client, c, id, { lock: true });
  if (!UNPOSTED.has(issue.status)) throw issueError(409, issue.status === "POSTED" ? "MFG_ISSUE_ALREADY_POSTED" : "MFG_ISSUE_STATE_INVALID");
  versionCheck(issue, input.expectedVersion);
  const order = await loadIssueOrder(client, c, issue.manufacturing_order_id, { lock: true });
  requireIssuable(order);
  const locations = await checkLocations(client, c, order, { sourceLocationId: input.sourceLocationId === undefined ? issue.source_location_id : input.sourceLocationId,
    productionLocationId: input.productionLocationId === undefined ? issue.production_location_id : input.productionLocationId });
  const materials = await loadMaterials(client, c, order.id);
  const lines = input.lines ? await resolveLines(client, c, order, materials, input.lines) : storedLines(await loadIssueLines(client, c, issue.id), materials);
  const reason = input.issueReason ? String(input.issueReason).toUpperCase() : issue.issue_reason;
  if (!ISSUE_REASONS.has(reason)) throw issueError(400, "MFG_ISSUE_QTY_INVALID", "Choose why the material is issued.");
  const hash = contentHash({ ...issue, source_location_id: locations.source, production_location_id: locations.production }, lines);
  if (input.lines) await writeLines(client, c, issue.id, lines, excessOf(lines, materials));
  await client.query(
    `UPDATE tenant.manufacturing_material_issues SET source_location_id = $3, production_location_id = $4, issue_reason = $5, notes = $6, received_by = $7, content_hash = $8, status = 'DRAFT',
       approval_status = 'NOT_REQUIRED', approval_hash = NULL, approval_snapshot_id = NULL, approved_by = NULL, approved_at = NULL, approval_note = NULL, row_version = row_version + 1
      WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, issue.id, locations.source, locations.production, reason, input.notes === undefined ? issue.notes : text(input.notes, 1000) || null,
      input.receivedBy === undefined ? issue.received_by : text(input.receivedBy, 200) || null, hash]);
  await issueEvent(client, c, issue.id, "EDITED", { from: issue.status, to: "DRAFT", summary: issue.approval_status === "APPROVED" || issue.approval_status === "REQUESTED" ? "Edited: the approval was withdrawn" : "Edited" });
  return getMaterialIssue(client, c, issue.id);
}

// What posting would do now, without doing it: per line the stock it would take (reserved first), the excess and whether it needs an
// approval, and every problem. The result is a moment's truth — posting checks it all again.
export async function previewMaterialIssue(client, c, id) {
  needMo(c, MO.issue);
  const issue = await loadIssue(client, c, id);
  const order = await loadIssueOrder(client, c, issue.manufacturing_order_id);
  const materials = await loadMaterials(client, c, order.id);
  const lines = storedLines(await loadIssueLines(client, c, issue.id), materials);
  const settings = await issueSettings(client, c);
  const problems = [];
  if (!UNPOSTED.has(issue.status)) problems.push({ code: issue.status === "POSTED" ? "MFG_ISSUE_ALREADY_POSTED" : "MFG_ISSUE_STATE_INVALID", message: `${issue.issue_number} is ${issue.status.toLowerCase().replace(/_/g, " ")}.` });
  try { requireIssuable(order); } catch (error) { problems.push({ code: error.code, message: error.message }); }
  if (!order.bom_snapshot_id && order.bom_revision_id) problems.push({ code: "MFG_ISSUE_MO_STATUS_INVALID", message: `${order.mo_number} has no frozen recipe.` });
  const excess = excessOf(lines, materials);
  const approval = approvalState(issue, lines, excess, materials, settings, order);
  if (approval.required && !approval.valid) problems.push({ code: "MFG_ISSUE_APPROVAL_REQUIRED", message: approval.message });
  const plan = await planStock(client, c, order, issue, lines, settings, { strict: false });
  problems.push(...plan.problems);
  return {
    issueId: issue.id, issueNumber: issue.issue_number, previewOnly: true, checkedAt: new Date().toISOString(), ok: problems.length === 0,
    readiness: problems.length === 0 ? "READY_TO_POST" : approval.required && !approval.valid && problems.length === 1 ? "PENDING_APPROVAL" : "BLOCKED",
    approval, problems,
    lines: lines.map((line, index) => ({
      lineId: line.id, materialId: line.material.id, code: line.material.item_code, quantity: line.quantity, baseQuantity: q(line.baseQuantity), uom: line.material.uom_code,
      remainingBefore: q(lineFigures(line.material).toIssue), excess: q(excess[index]), fromReservation: q(plan.lines[index].fromReservation), fromFree: q(plan.lines[index].fromFree),
      short: q(plan.lines[index].short),
      plan: plan.lines[index].plan.map((part) => ({ source: part.source, batch: part.batch ?? null, serial: part.serial ?? null, expiresOn: part.expiresOn ?? null, locationId: part.locationId, quantity: q(part.quantity) })),
    })),
  };
}

// input: { expectedVersion? }. A clean check marks the note ready to post (a transient state: posting checks again).
export async function validateMaterialIssue(client, c, id, input = {}) {
  const preview = await previewMaterialIssue(client, c, id);
  const issue = await loadIssue(client, c, id, { lock: true });
  versionCheck(issue, input.expectedVersion);
  if (preview.ok && issue.status === "DRAFT") {
    await client.query(`UPDATE tenant.manufacturing_material_issues SET status = 'READY_TO_POST' WHERE organization_id = $1 AND id = $2`, [c.organizationId, issue.id]);
    await issueEvent(client, c, issue.id, "VALIDATED", { from: "DRAFT", to: "READY_TO_POST" });
  }
  return { preview, issue: await getMaterialIssue(client, c, issue.id) };
}

// ------------------------------------------------------------------ approval of excess
// input: { reason, varianceType, expectedVersion? }
export async function requestMaterialIssueApproval(client, c, id, input = {}) {
  needMo(c, MO.extra);
  const issue = await loadIssue(client, c, id, { lock: true });
  if (!UNPOSTED.has(issue.status)) throw issueError(409, issue.status === "POSTED" ? "MFG_ISSUE_ALREADY_POSTED" : "MFG_ISSUE_STATE_INVALID");
  versionCheck(issue, input.expectedVersion);
  const order = await loadIssueOrder(client, c, issue.manufacturing_order_id);
  requireIssuable(order);
  const materials = await loadMaterials(client, c, order.id);
  const rows = await loadIssueLines(client, c, issue.id);
  const lines = storedLines(rows, materials);
  const excess = excessOf(lines, materials);
  const settings = await issueSettings(client, c);
  if (!lines.some((line, index) => excess[index] > toleratedExcess(line.material, settings))) {
    throw issueError(409, "MFG_ISSUE_STATE_INVALID", "Nothing on this note is beyond what the order may still issue; no approval is needed.");
  }
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw issueError(400, "MFG_ISSUE_REASON_REQUIRED", "Say why the additional material is needed.");
  const type = String(input.varianceType ?? "EXCESS_USAGE").toUpperCase();
  if (!VARIANCE_TYPES.has(type)) throw issueError(400, "MFG_ISSUE_QTY_INVALID", "Choose the kind of variance.");
  for (const [index, row] of rows.entries()) {
    await client.query(`UPDATE tenant.manufacturing_material_issue_lines SET excess_quantity = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, q(excess[index])]);
  }
  await client.query(
    `UPDATE tenant.manufacturing_material_issues SET status = 'PENDING_APPROVAL', approval_status = 'REQUESTED', approval_hash = content_hash, approval_snapshot_id = $3, approval_reason = $4,
       variance_type = $5, approval_policy = $6::jsonb, approval_requested_by = $7, approval_requested_at = clock_timestamp(), approved_by = NULL, approved_at = NULL, approval_note = NULL,
       row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, issue.id, order.bom_snapshot_id, reason, type, JSON.stringify({ tolerancePct: q(settings.tolerancePct), selfApproval: settings.selfApproval, orderVersion: order.version }), c.userId ?? null]);
  await issueEvent(client, c, issue.id, "APPROVAL_REQUESTED", { from: issue.status, to: "PENDING_APPROVAL", summary: `${type.toLowerCase().replace(/_/g, " ")}: ${reason}`,
    details: { excess: lines.map((line, index) => ({ code: line.material.item_code, excess: q(excess[index]) })).filter((row) => Number(row.excess) > 0) } });
  return getMaterialIssue(client, c, issue.id);
}

// input: { decision: APPROVE | REJECT, note?, expectedVersion? }. By someone other than the requester unless the company allows it.
export async function decideMaterialIssueApproval(client, c, id, input = {}) {
  needMo(c, MO.approveVariance);
  const issue = await loadIssue(client, c, id, { lock: true });
  if (issue.status !== "PENDING_APPROVAL" || issue.approval_status !== "REQUESTED") throw issueError(409, "MFG_ISSUE_STATE_INVALID", "This note is not waiting for an approval.");
  versionCheck(issue, input.expectedVersion);
  const settings = await issueSettings(client, c);
  if (issue.approval_requested_by === c.userId && !settings.selfApproval) throw issueError(409, "MFG_ISSUE_APPROVAL_SELF");
  const decision = String(input.decision ?? "").toUpperCase();
  if (!["APPROVE", "REJECT"].includes(decision)) throw issueError(400, "MFG_ISSUE_QTY_INVALID", "Approve or reject the request.");
  const note = text(input.note, 1000) || null;
  if (decision === "REJECT" && (!note || note.length < 3)) throw issueError(400, "MFG_ISSUE_REASON_REQUIRED", "Say why the additional material is rejected.");
  if (issue.approval_hash !== issue.content_hash) throw issueError(409, "MFG_ISSUE_DOCUMENT_CHANGED");
  const to = decision === "APPROVE" ? "READY_TO_POST" : "DRAFT";
  await client.query(`UPDATE tenant.manufacturing_material_issues SET status = $3, approval_status = $4, approved_by = $5, approved_at = clock_timestamp(), approval_note = $6, row_version = row_version + 1
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, issue.id, to, decision === "APPROVE" ? "APPROVED" : "REJECTED", c.userId ?? null, note]);
  await issueEvent(client, c, issue.id, decision === "APPROVE" ? "APPROVED" : "REJECTED", { from: issue.status, to, summary: note });
  return getMaterialIssue(client, c, issue.id);
}

// ------------------------------------------------------------------ posting
// input: { expectedVersion?, expectedMoVersion? }. Revalidates everything under the order's lock, then moves the stock (each reserved part
// through its own reservation, at the very balance it was reserved in), values it, posts one work-in-progress journal, and records it.
export async function postMaterialIssue(client, c, id, input = {}) {
  needMo(c, MO.issue);
  needStock(c, "stock.issue", "issue");
  const issue = await loadIssue(client, c, id, { lock: true });
  const postingKey = `mi:${issue.id}:v${issue.row_version}`;
  if (issue.status === "POSTED" || issue.status === "RECOVERY_REQUIRED") {
    // The same version posted already: this is a retry, and gets the first result.
    if (input.expectedVersion === undefined || input.expectedVersion === null || Number(input.expectedVersion) === Number(issue.row_version)) {
      return { ...(await postingResult(client, c, issue.id)), replayed: true };
    }
    throw issueError(409, "MFG_ISSUE_ALREADY_POSTED");
  }
  if (!UNPOSTED.has(issue.status)) throw issueError(409, "MFG_ISSUE_STATE_INVALID", `${issue.issue_number} is ${issue.status.toLowerCase()}.`);
  versionCheck(issue, input.expectedVersion);
  const order = await loadIssueOrder(client, c, issue.manufacturing_order_id, { lock: true });
  if (input.expectedMoVersion !== undefined && input.expectedMoVersion !== null && Number(input.expectedMoVersion) !== Number(order.version)) throw issueError(409, "MFG_ISSUE_DOCUMENT_CHANGED", `${order.mo_number} changed since this note was checked. Review it again.`);
  requireIssuable(order);
  if (issue.source_warehouse_id !== order.material_warehouse_id) throw issueError(409, "MFG_ISSUE_WAREHOUSE_INVALID");
  const materials = await loadMaterials(client, c, order.id, { lock: true });
  const rows = await loadIssueLines(client, c, issue.id);
  const lines = storedLines(rows, materials);
  if (!lines.length) throw issueError(400, "MFG_ISSUE_EMPTY");
  if (contentHash(issue, rows) !== issue.content_hash) throw issueError(409, "MFG_ISSUE_DOCUMENT_CHANGED");
  const settings = await issueSettings(client, c);
  const excess = excessOf(lines, materials);
  const approval = approvalState(issue, lines, excess, materials, settings, order);
  if (approval.required && !approval.valid) throw issueError(409, "MFG_ISSUE_APPROVAL_REQUIRED", approval.message, { excess: approval.excess });
  const plan = await planStock(client, c, order, issue, lines, settings, { strict: true });

  // Excess (approved, or within tolerance) becomes this order's authorized extra material — never the BOM.
  for (const [index, line] of lines.entries()) {
    if (excess[index] <= ZERO) continue;
    const approved = approval.required && excess[index] > toleratedExcess(line.material, settings);
    await client.query(
      `INSERT INTO tenant.manufacturing_order_material_variances (organization_id, manufacturing_order_id, material_id, component_item_id, quantity, reason, status, requested_by, requested_at,
         decided_by, decided_at, decision_note, variance_type, material_issue_id) VALUES ($1,$2,$3,$4,$5,$6,'APPROVED',$7,COALESCE($8, clock_timestamp()),$9,clock_timestamp(),$10,$11,$12)`,
      [c.organizationId, order.id, line.material.id, line.material.component_item_id, q(excess[index]), approved ? issue.approval_reason : `Within the company's ${q(settings.tolerancePct)}% issue tolerance`,
        approved ? issue.approval_requested_by : c.userId ?? null, approved ? issue.approval_requested_at : null, approved ? issue.approved_by : c.userId ?? null,
        approved ? `${issue.issue_number}${issue.approval_note ? `: ${issue.approval_note}` : ""}` : issue.issue_number, approved ? issue.variance_type ?? "EXCESS_USAGE" : "EXCESS_USAGE", issue.id]);
    await client.query(`UPDATE tenant.manufacturing_order_materials SET authorized_extra_quantity = authorized_extra_quantity + $3, version = version + 1 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, line.material.id, q(excess[index])]);
  }

  const reference = `${issue.issue_number} · ${order.mo_number}`;
  // 1. Inventory: every part of every line (an Inventory refusal stops the whole note; nothing posts).
  const moved = [];
  let total = ZERO;
  let missingCost = false;
  for (const [index, line] of lines.entries()) {
    const allocations = [];
    try {
      for (const [partIndex, part] of plan.lines[index].plan.entries()) {
        const keyOf = `${postingKey}:${line.lineNumber}:${partIndex}`;
        const movementId = part.source === "RESERVATION"
          ? (await consumeStockReservation(client, stockCtx(c, "stock.issue"), part.reservationId, q(part.quantity),
            { issue: { referenceType: SOURCE, referenceId: order.id, reason: `Issue ${reference}`, idempotencyKey: keyOf, sourceLineId: line.id } })).stockMovementId
          : (await postStockMovement(client, stockCtx(c), { movementType: "issue", itemId: line.material.component_item_id, warehouseId: issue.source_warehouse_id,
            warehouseLocationId: part.locationId, batchId: part.batchId, serialId: part.serialId ?? undefined, quantity: q(part.quantity), referenceType: SOURCE, referenceId: order.id,
            sourceLineId: line.id, reason: `Issue ${reference}`, idempotencyKey: keyOf })).id;
        allocations.push({ ...part, movementId });
      }
    } catch (error) { throw stockFailure(error, "MFG_ISSUE_STOCK_SHORTAGE"); }
    const movements = allocations.map((part) => part.movementId);
    const value = await valuationOfMovements(client, c.organizationId, movements);
    if (movements.some((movementId) => !value.byMovement.has(movementId))) missingCost = true;
    const cost = D(money(D(Math.abs(Number(value.total)).toFixed(6))));
    total = add(total, cost);
    moved.push({ line, allocations, movements, cost, number: `${issue.issue_number}-${line.lineNumber}` });
  }

  // 2. Finance: one work-in-progress journal for the note, at Inventory's valuation (never re-priced here).
  const journal = await postJournal(client, c, { event: "manufacturing_material_issue", sourceType: "manufacturing_material_issue", sourceId: issue.id, sourceNumber: issue.issue_number, reference,
    description: `Material issued to ${order.mo_number}`, lines: [{ mappingKey: "wip", label: "Work in progress", debit: total },
      ...moved.map((row) => ({ mappingKey: "inventory", itemId: row.line.material.component_item_id, label: "Inventory", credit: row.cost }))] });

  // 3. Manufacturing: the order's movement record, the exact allocations, the line's issued quantity and cost.
  const allMovementIds = [];
  const posted = [];
  for (const row of moved) {
    const { line, allocations, movements, cost } = row;
    const movementRowId = randomUUID();
    await client.query(
      `INSERT INTO tenant.manufacturing_order_material_movements (id, organization_id, manufacturing_order_id, material_id, movement_number, direction, item_id, warehouse_id, quantity, unit_cost,
         total_cost, allocations, stock_movement_ids, journal_entry_id, idempotency_key, posted_by, material_issue_id) VALUES ($1,$2,$3,$4,$5,'ISSUE',$6,$7,$8,$9,$10,$11::jsonb,$12::uuid[],$13,$14,$15,$16)`,
      [movementRowId, c.organizationId, order.id, line.material.id, row.number, line.material.component_item_id, issue.source_warehouse_id, q(line.baseQuantity),
        q(div(cost, line.baseQuantity)), money(cost),
        JSON.stringify(allocations.map((part) => ({ locationId: part.locationId, batchId: part.batchId, batch: part.batch ?? null, serialId: part.serialId ?? null, quantity: q(part.quantity),
          fromReservation: part.source === "RESERVATION" }))), movements, journal, `${postingKey}:${line.lineNumber}`, c.userId ?? null, issue.id]);
    for (const part of allocations) {
      await client.query(`INSERT INTO tenant.manufacturing_material_issue_allocations (organization_id, issue_line_id, stock_movement_id, warehouse_location_id, batch_id, serial_id, quantity, reservation_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [c.organizationId, line.id, part.movementId, part.locationId, part.batchId, part.serialId ?? null, q(part.quantity), part.reservationId]);
    }
    const fromReservation = allocations.filter((part) => part.source === "RESERVATION").reduce((sum, part) => add(sum, part.quantity), ZERO);
    await client.query(`UPDATE tenant.manufacturing_material_issue_lines SET movement_id = $3, from_reservation_quantity = $4, unit_cost = $5, total_cost = $6 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, line.id, movementRowId, q(fromReservation), q(div(cost, line.baseQuantity)), money(cost)]);
    await client.query(`UPDATE tenant.manufacturing_order_materials SET issued_quantity = issued_quantity + $3, issued_cost = issued_cost + $4, version = version + 1 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, line.material.id, q(line.baseQuantity), money(cost)]);
    allMovementIds.push(...movements);
    posted.push({ number: row.number, code: line.material.item_code, quantity: q(line.baseQuantity), cost: money(cost) });
  }
  const financeStatus = missingCost ? "COST_MISSING" : journal ? "POSTED" : "NOT_REQUIRED";
  await client.query(`INSERT INTO tenant.manufacturing_material_issue_postings (organization_id, material_issue_id, command_key, document_version, inventory_status, stock_movement_ids, finance_status,
      journal_entry_id, amount, created_by) VALUES ($1,$2,$3,$4,'CONFIRMED',$5::uuid[],$6,$7,$8,$9)`,
    [c.organizationId, issue.id, postingKey, issue.row_version, allMovementIds, financeStatus, journal, money(total), c.userId ?? null]);
  await client.query(`UPDATE tenant.manufacturing_orders SET wip_material_cost = wip_material_cost + $3, version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, order.id, money(total)]);
  await client.query(
    `UPDATE tenant.manufacturing_material_issues SET status = 'POSTED', posting_key = $3, posted_mo_version = $4, posted_by = $5, posted_at = clock_timestamp(), issue_date = current_date, total_cost = $6,
       cost_status = $7, journal_entry_id = $8 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, issue.id, postingKey, order.version, c.userId ?? null, money(total), missingCost ? "MISSING" : "VALUED", journal]);
  await issueEvent(client, c, issue.id, "POSTED", { from: issue.status, to: "POSTED", summary: posted.map((row) => `${row.code} ${row.quantity}`).join(", "),
    details: { postingKey, movements: allMovementIds.length, financeStatus } });
  await orderEvent(client, c, order.id, "MATERIAL_ISSUED", { summary: `${issue.issue_number}: ${posted.map((row) => `${row.code} ${row.quantity}`).join(", ")}`, details: { issueId: issue.id, issued: posted } });
  return postingResult(client, c, issue.id);
}

async function postingResult(client, c, id) {
  const issue = await getMaterialIssue(client, c, id);
  return { materialIssueId: issue.id, issueNumber: issue.number, status: issue.status, inventoryTransactionIds: issue.posting?.stockMovementIds ?? [],
    financeReconciliationStatus: issue.posting?.financeStatus ?? null, postedAt: issue.postedAt, issue };
}

// input: { reason, expectedVersion? }. Only a note that never posted; it stays, cancelled, in the history.
export async function cancelMaterialIssue(client, c, id, input = {}) {
  needMo(c, MO.issue);
  const issue = await loadIssue(client, c, id, { lock: true });
  if (issue.status === "CANCELLED") return getMaterialIssue(client, c, issue.id);
  if (!UNPOSTED.has(issue.status)) throw issueError(409, issue.status === "POSTED" ? "MFG_ISSUE_ALREADY_POSTED" : "MFG_ISSUE_STATE_INVALID", issue.status === "POSTED" ? "A posted issue is not cancelled: return unused material, or reverse a posting error." : undefined);
  versionCheck(issue, input.expectedVersion);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw issueError(400, "MFG_ISSUE_REASON_REQUIRED", "Say why the note is cancelled.");
  await client.query(`UPDATE tenant.manufacturing_material_issues SET status = 'CANCELLED', cancelled_by = $3, cancelled_at = clock_timestamp(), cancel_reason = $4, row_version = row_version + 1
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, issue.id, c.userId ?? null, reason]);
  await issueEvent(client, c, issue.id, "CANCELLED", { from: issue.status, to: "CANCELLED", summary: reason });
  return getMaterialIssue(client, c, issue.id);
}

// ------------------------------------------------------------------ the order's direct issue (the same posting path)
// The order's "Issue materials" (input: { lines: [{ materialId, quantity, batchId?, serialIds? }], idempotencyKey }): an issue note created and
// posted at once, under the request key — one posting path, whatever the entry point.
export async function issueThroughNote(client, c, orderId, input = {}) {
  needMo(c, MO.issue);
  needStock(c, "stock.issue", "issue");
  const key = text(input.idempotencyKey, 200);
  if (!key) throw moError(400, "MFG_MO_KEY_REQUIRED");
  const noteKey = `mo-issue:${key}`;
  const existing = (await client.query(`SELECT id, manufacturing_order_id, status FROM tenant.manufacturing_material_issues WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, noteKey])).rows[0];
  if (existing) {
    if (existing.manufacturing_order_id !== orderId) throw issueError(409, "MFG_ISSUE_DOCUMENT_CHANGED", "That request key was used for another order.");
    const result = existing.status === "POSTED" ? await postingResult(client, c, existing.id) : await postMaterialIssue(client, c, existing.id, {});
    return { ...summaryOf(result), replayed: existing.status === "POSTED" };
  }
  return atomically(client, async () => {
    const draft = await createMaterialIssueDraft(client, c, { manufacturingOrderId: orderId, lines: input.lines, notes: input.note, idempotencyKey: noteKey, issueReason: "NORMAL" });
    if (draft.approval?.required && !draft.approval?.valid) throw issueError(409, "MFG_ISSUE_EXCEEDS_REQUIREMENT", draft.approval.message);
    return summaryOf(await postMaterialIssue(client, c, draft.id, { expectedVersion: draft.rowVersion }));
  });
}
function summaryOf(result) {
  return { orderId: result.issue.order.id, issueId: result.materialIssueId, issueNumber: result.issueNumber,
    issued: result.issue.lines.map((line) => ({ number: line.posted?.movementNumber, code: line.code, quantity: line.baseQuantity, cost: line.posted?.totalCost ?? null })) };
}

// ------------------------------------------------------------------ correction
// A reversal of whole issue lines that never physically happened (wrong batch, handed over to nobody): Inventory reverses the exact
// movements (same batches, serial units and locations, at their original valuation), work in progress gives the value back, and the note
// stays posted with the reversal beside it. Only what is still in production custody — never material used, scrapped or returned.
// input: { lineIds?, reason, evidence?, idempotencyKey }
export async function reverseMaterialIssue(client, c, id, input = {}) {
  needIssue(c, ISSUE.reverse);
  needStock(c, "stock.receive", "receive");
  const key = text(input.idempotencyKey, 200);
  if (!key) throw moError(400, "MFG_MO_KEY_REQUIRED");
  const issue = await loadIssue(client, c, id, { lock: true });
  if (issue.status !== "POSTED") throw issueError(409, "MFG_ISSUE_STATE_INVALID", "Only a posted issue is reversed; a draft is edited or cancelled.");
  const done = (await client.query(`SELECT 1 FROM tenant.manufacturing_material_issue_reversals WHERE organization_id = $1 AND idempotency_key = $2 LIMIT 1`, [c.organizationId, key])).rows[0];
  if (done) return { ...(await getMaterialIssue(client, c, issue.id)), replayed: true };
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw issueError(400, "MFG_ISSUE_REASON_REQUIRED", "Say what went wrong (the reversal is evidence of a posting error).");
  const order = await loadIssueOrder(client, c, issue.manufacturing_order_id, { lock: true });
  if (!["RELEASED", "IN_PROGRESS", "ON_HOLD"].includes(order.status)) throw issueError(409, "MFG_ISSUE_MO_STATUS_INVALID", `${order.mo_number} is ${STATUS_LABEL[order.status].toLowerCase()}: its issues are history.`);
  const materials = await loadMaterials(client, c, order.id, { lock: true });
  const rows = (await loadIssueLines(client, c, issue.id)).filter((row) => !input.lineIds?.length || input.lineIds.includes(row.id));
  if (!rows.length) throw issueError(400, "MFG_ISSUE_EMPTY", "Choose the lines to reverse.");
  let total = ZERO;
  const reversed = [];
  for (const row of rows) {
    if (D(row.reversed_quantity) > ZERO) throw issueError(409, "MFG_ISSUE_REVERSAL_BLOCKED", `${row.item_code} on ${issue.issue_number} is reversed already.`);
    const material = materials.find((line) => line.id === row.material_id);
    const custody = lineFigures(material).custody;
    if (D(row.base_quantity) > custody) {
      throw issueError(409, "MFG_ISSUE_REVERSAL_BLOCKED", `${row.item_code}: only ${q(custody)} of the ${q(D(row.base_quantity))} issued is still in production custody — the rest was used, scrapped or returned. Return what is unused instead.`);
    }
    const movementIds = (await client.query(`SELECT stock_movement_id FROM tenant.manufacturing_material_issue_allocations WHERE organization_id = $1 AND issue_line_id = $2`, [c.organizationId, row.id])).rows.map((part) => part.stock_movement_id);
    let back;
    try {
      back = await reverseStockMovements(client, stockCtx(c, "stock.receive", "stock.issue"), movementIds, { reason: `Reversal of ${issue.issue_number}: ${reason}`, referenceType: SOURCE, referenceId: order.id, keyPrefix: `mir:${key}` });
    } catch (error) { throw stockFailure(error, "MFG_ISSUE_REVERSAL_BLOCKED"); }
    const cost = D(row.total_cost ?? 0);
    const number = await nextNumber(client, c, "manufacturing_material_issue_reversal");
    const movementRowId = randomUUID();
    await client.query(
      `INSERT INTO tenant.manufacturing_order_material_movements (id, organization_id, manufacturing_order_id, material_id, movement_number, direction, item_id, warehouse_id, quantity, unit_cost,
         total_cost, allocations, stock_movement_ids, reason, idempotency_key, posted_by, material_issue_id) VALUES ($1,$2,$3,$4,$5,'RETURN',$6,$7,$8,$9,$10,'[]'::jsonb,$11::uuid[],$12,$13,$14,$15)`,
      [movementRowId, c.organizationId, order.id, material.id, number, row.item_id, issue.source_warehouse_id, q(D(row.base_quantity)), q(D(row.unit_cost ?? 0)), money(cost),
        back.movements.map((movement) => movement.id), `Reversal of ${issue.issue_number}: ${reason}`, `mir:${key}:${row.id}`, c.userId ?? null, issue.id]);
    const reversalId = randomUUID();
    const journal = await postJournal(client, c, { event: "manufacturing_material_return", sourceType: "manufacturing_material_issue_reversal", sourceId: reversalId, sourceNumber: number,
      reference: `${number} · ${issue.issue_number} · ${order.mo_number}`, description: `Reversal of ${issue.issue_number}`,
      lines: [{ mappingKey: "inventory", itemId: row.item_id, label: "Inventory", debit: cost }, { mappingKey: "wip", label: "Work in progress", credit: cost }] });
    await client.query(`INSERT INTO tenant.manufacturing_material_issue_reversals (id, organization_id, reversal_number, material_issue_id, issue_line_id, quantity, reason, evidence, movement_id,
        stock_movement_ids, total_cost, journal_entry_id, idempotency_key, reversed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid[],$11,$12,$13,$14)`,
      [reversalId, c.organizationId, number, issue.id, row.id, q(D(row.base_quantity)), reason, text(input.evidence, 1000) || null, movementRowId, back.movements.map((movement) => movement.id),
        money(cost), journal, key, c.userId ?? null]);
    await client.query(`INSERT INTO tenant.manufacturing_material_issue_postings (organization_id, material_issue_id, command_key, document_version, kind, inventory_status, stock_movement_ids, finance_status,
        journal_entry_id, amount, created_by) VALUES ($1,$2,$3,$4,'REVERSAL','CONFIRMED',$5::uuid[],$6,$7,$8,$9)`,
      [c.organizationId, issue.id, `mir:${key}:${row.id}`, issue.row_version, back.movements.map((movement) => movement.id), journal ? "POSTED" : "NOT_REQUIRED", journal, money(cost), c.userId ?? null]);
    await client.query(`UPDATE tenant.manufacturing_material_issue_lines SET reversed_quantity = base_quantity WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id]);
    await client.query(`UPDATE tenant.manufacturing_order_materials SET returned_quantity = returned_quantity + $3, returned_cost = returned_cost + $4, reversed_quantity = reversed_quantity + $3,
        version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, material.id, q(D(row.base_quantity)), money(cost)]);
    material.returned_quantity = q(add(D(material.returned_quantity), D(row.base_quantity)));
    total = add(total, cost);
    reversed.push({ number, code: row.item_code, quantity: q(D(row.base_quantity)) });
  }
  await client.query(`UPDATE tenant.manufacturing_orders SET wip_material_cost = wip_material_cost - $3, version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, order.id, money(total)]);
  await issueEvent(client, c, issue.id, "REVERSED", { summary: `${reversed.map((row) => `${row.number} ${row.code} ${row.quantity}`).join(", ")}: ${reason}` });
  await orderEvent(client, c, order.id, "MATERIAL_ISSUE_REVERSED", { summary: `${issue.issue_number}: ${reversed.map((row) => `${row.code} ${row.quantity}`).join(", ")} — ${reason}` });
  return getMaterialIssue(client, c, issue.id);
}

// Scrap of issued material from the order (input: { lines: [{ materialId, quantity, reason, batchId?, serialId? }], idempotencyKey }): a scrap note
// created and posted at once through the one scrap posting path (Scrap, 0119) — irrecoverable, a normal loss whose cost stays in the order.
export async function recordMaterialScrap(client, c, orderId, input = {}) {
  needIssue(c, ISSUE.scrap);
  const { recordMaterialScrapThroughNote } = await import("../scrap/scrap-service.js");
  const ctx = { ...c, permissions: [...new Set([...(c.permissions ?? []), "manufacturing.scrap.view", "manufacturing.scrap.create", "manufacturing.scrap.post"])] };
  return recordMaterialScrapThroughNote(client, ctx, orderId, input);
}

// ------------------------------------------------------------------ printing
// The note to print (a draft prints as DRAFT): counted, never posting anything.
export async function recordMaterialIssuePrint(client, c, id) {
  needIssue(c, ISSUE.export);
  const issue = await loadIssue(client, c, id, { lock: true });
  await client.query(`UPDATE tenant.manufacturing_material_issues SET print_count = print_count + 1, last_printed_at = clock_timestamp() WHERE organization_id = $1 AND id = $2`, [c.organizationId, issue.id]);
  await issueEvent(client, c, issue.id, issue.print_count > 0 ? "REPRINTED" : "PRINTED", { summary: issue.status === "POSTED" ? `Copy ${issue.print_count + 1}` : "Draft preview" });
  return getMaterialIssue(client, c, issue.id);
}

// Recovery: re-check a posted note against Inventory and Finance; a note that disagrees is marked for recovery, one that agrees again returns to posted.
export async function recoverMaterialIssue(client, c, id) {
  needIssue(c, ISSUE.reverse);
  const { checkMaterialIssuePosting } = await import("./issue-read.js");
  const issue = await loadIssue(client, c, id, { lock: true });
  if (!["POSTED", "RECOVERY_REQUIRED"].includes(issue.status)) throw issueError(409, "MFG_ISSUE_STATE_INVALID", "Only a posted note is checked against Inventory and Finance.");
  const check = await checkMaterialIssuePosting(client, c, issue.id);
  const to = check.consistent ? "POSTED" : "RECOVERY_REQUIRED";
  if (to !== issue.status) {
    await client.query(`UPDATE tenant.manufacturing_material_issues SET status = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, issue.id, to]);
    await issueEvent(client, c, issue.id, to === "POSTED" ? "RECOVERED" : "RECOVERY_REQUIRED", { from: issue.status, to, summary: check.problems.join(" ") || "Inventory and Finance agree" });
  }
  return { check, issue: await getMaterialIssue(client, c, issue.id) };
}

