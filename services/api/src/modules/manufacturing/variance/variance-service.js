// Material Consumption Variance — the commands: a variance exception opened on a material line (its figures kept as a snapshot), investigated
// (reason, explanation, evidence, owner), submitted for review bound to the exact evaluation, approved / rejected / sent back for evidence by
// someone else, and resolved (an authorized variance, a corrected source, back within tolerance, extra material, a hold, a BOM review).
// Approval never edits the BOM, moves stock or posts to Finance; a rejected exception leaves the posted consumption as it is. Plus the
// tolerance overrides, BOM review requests, and the completion check and final snapshot.
import { randomUUID } from "node:crypto";

import { nextNumber } from "../orders/mo-core.js";
import {
  D, MO, NEEDS_APPROVAL, REASONS, VAR, ZERO, companyPolicy, evaluateOrder, has, loadVarOrder, needVar, q, snapshot, text, uuid, varError, varianceEvent,
} from "./variance-core.js";

const DECIDED = new Set(["APPROVED", "REJECTED"]);
async function loadException(client, c, id, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_material_variance_exceptions WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, uuid(id, "Variance exception")])).rows[0];
  if (!row) throw varError(404, "MFG_VAR_NOT_FOUND");
  return row;
}
// The line as it stands now (on the reported-output basis every decision uses).
export async function currentLine(client, c, order, materialId) {
  const evaluation = await evaluateOrder(client, c, order);
  const line = evaluation.lines.find((row) => row.material.id === materialId);
  if (!line) throw varError(404, "MFG_VAR_NOT_FOUND", "That material is not on this order.");
  return { evaluation, line };
}
const versionCheck = (row, expected) => {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(row.row_version)) throw varError(409, "MFG_VAR_SOURCE_CHANGED", "The exception changed. Refresh it.");
};

// ------------------------------------------------------------------ opening and investigating
// input: { materialId, reasonCode?, explanation?, evidence?, assignedTo?, idempotencyKey? } — one investigation in progress per line (an
// existing one is returned).
export async function openVarianceException(client, c, orderId, input = {}) {
  needVar(c, VAR.investigate);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const done = (await client.query(`SELECT id FROM tenant.manufacturing_material_variance_exceptions WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { exceptionId: done.id, replayed: true };
  }
  const order = await loadVarOrder(client, c, orderId, { lock: true });
  if (order.status === "CANCELLED") throw varError(409, "MFG_VAR_STATE_INVALID", `${order.mo_number} is cancelled.`);
  const materialId = uuid(input.materialId, "Material");
  const open = (await client.query(`SELECT id FROM tenant.manufacturing_material_variance_exceptions WHERE organization_id = $1 AND material_id = $2 AND status IN ('OPEN', 'SUBMITTED')`,
    [c.organizationId, materialId])).rows[0];
  if (open) return { exceptionId: open.id, existing: true };
  const { evaluation, line } = await currentLine(client, c, order, materialId);
  if (evaluation.recovery) throw varError(409, "MFG_VAR_RECOVERY_REQUIRED");
  if (line.band === "NOT_CALCULABLE") throw varError(409, "MFG_VAR_EXPECTED_UNAVAILABLE", line.notes[0]);
  const reason = input.reasonCode ? String(input.reasonCode).toUpperCase() : null;
  if (reason && !REASONS[reason]) throw varError(400, "MFG_VAR_REASON_REQUIRED", "Choose a reason.");
  const assignedTo = input.assignedTo ? uuid(input.assignedTo, "Assignee") : order.production_owner_id ?? null;
  const evaluationId = await snapshot(client, c, order, line, "EXCEPTION");
  const id = randomUUID();
  const number = await nextNumber(client, c, "manufacturing_variance_exception");
  await client.query(
    `INSERT INTO tenant.manufacturing_material_variance_exceptions (id, organization_id, exception_number, manufacturing_order_id, material_id, component_item_id, reason_code, explanation,
       evidence, assigned_to, opened_evaluation_id, created_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, c.organizationId, number, order.id, line.material.id, line.material.component_item_id, reason, text(input.explanation, 2000) || null, text(input.evidence, 1000) || null,
      assignedTo, evaluationId, c.userId ?? null, key]);
  await varianceEvent(client, c, order.id, "EXCEPTION_OPENED", { exceptionId: id, evaluationId,
    summary: `${number}: ${line.material.item_code} ${line.variance === null ? "" : `${line.variance > ZERO ? "+" : ""}${q(line.variance)} ${line.material.uom_code}`} (${line.band.toLowerCase().replace(/_/g, " ")})` });
  return { exceptionId: id, exceptionNumber: number };
}
// input: { reasonCode?, explanation?, evidence?, assignedTo?, expectedVersion? } — while open.
export async function updateVarianceException(client, c, id, input = {}) {
  needVar(c, VAR.investigate);
  const row = await loadException(client, c, id, { lock: true });
  if (row.status !== "OPEN") throw varError(409, row.status === "RESOLVED" ? "MFG_VAR_ALREADY_RESOLVED" : "MFG_VAR_STATE_INVALID");
  versionCheck(row, input.expectedVersion);
  const reason = input.reasonCode === undefined ? row.reason_code : input.reasonCode ? String(input.reasonCode).toUpperCase() : null;
  if (reason && !REASONS[reason]) throw varError(400, "MFG_VAR_REASON_REQUIRED", "Choose a reason.");
  const pick = (field, column, maxLength) => (input[field] === undefined ? row[column] : text(input[field], maxLength) || null);
  await client.query(`UPDATE tenant.manufacturing_material_variance_exceptions SET reason_code = $3, explanation = $4, evidence = $5, assigned_to = $6, row_version = row_version + 1
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, reason, pick("explanation", "explanation", 2000), pick("evidence", "evidence", 1000),
    input.assignedTo === undefined ? row.assigned_to : input.assignedTo ? uuid(input.assignedTo, "Assignee") : null]);
  await varianceEvent(client, c, row.manufacturing_order_id, "EXCEPTION_UPDATED", { exceptionId: row.id, summary: reason ? REASONS[reason] : null });
  return { exceptionId: row.id };
}

// ------------------------------------------------------------------ review
// input: { reasonCode?, explanation?, expectedVersion? } — the reason and an explanation are required; the review binds to the figures now.
export async function submitVarianceException(client, c, id, input = {}) {
  needVar(c, VAR.submit);
  const row = await loadException(client, c, id, { lock: true });
  if (!["OPEN", "SUBMITTED"].includes(row.status)) throw varError(409, row.status === "RESOLVED" ? "MFG_VAR_ALREADY_RESOLVED" : "MFG_VAR_STATE_INVALID");
  versionCheck(row, input.expectedVersion);
  const reason = input.reasonCode ? String(input.reasonCode).toUpperCase() : row.reason_code;
  const explanation = input.explanation === undefined ? row.explanation ?? "" : text(input.explanation, 2000);
  if (!reason || !REASONS[reason] || explanation.length < (reason === "OTHER" ? 10 : 3)) throw varError(400, "MFG_VAR_REASON_REQUIRED");
  const order = await loadVarOrder(client, c, row.manufacturing_order_id, { lock: true });
  const { evaluation, line } = await currentLine(client, c, order, row.material_id);
  if (evaluation.recovery) throw varError(409, "MFG_VAR_RECOVERY_REQUIRED");
  const evaluationId = await snapshot(client, c, order, line, "SUBMITTED");
  await client.query(`UPDATE tenant.manufacturing_material_variance_exceptions SET status = 'SUBMITTED', reason_code = $3, explanation = $4, submitted_evaluation_id = $5, submitted_hash = $6,
      submitted_by = $7, submitted_at = clock_timestamp(), decided_by = NULL, decided_at = NULL, decision_note = NULL, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, reason, explanation, evaluationId, line.hash, c.userId ?? null]);
  await varianceEvent(client, c, order.id, "EXCEPTION_SUBMITTED", { exceptionId: row.id, evaluationId, summary: `${REASONS[reason]}: ${explanation}` });
  return { exceptionId: row.id };
}
// input: { decision: APPROVE | REJECT | MORE_EVIDENCE, note? } — by someone other than the submitter (unless the company allows it), for the
// figures exactly as submitted: a variance that changed since is stale and is submitted again.
export async function decideVarianceException(client, c, id, input = {}) {
  needVar(c, VAR.approve);
  const row = await loadException(client, c, id, { lock: true });
  if (row.status !== "SUBMITTED") throw varError(409, DECIDED.has(row.status) || row.status === "RESOLVED" ? "MFG_VAR_ALREADY_RESOLVED" : "MFG_VAR_STATE_INVALID",
    row.status === "OPEN" ? "This exception is not submitted for review." : undefined);
  const policy = await companyPolicy(client, c);
  if (row.submitted_by === c.userId && !policy.selfApproval) throw varError(403, "MFG_VAR_PERMISSION_DENIED", "Someone other than the person who submitted it reviews this variance.");
  const decision = String(input.decision ?? "").toUpperCase();
  const note = text(input.note, 1000) || null;
  if (!["APPROVE", "REJECT", "MORE_EVIDENCE"].includes(decision)) throw varError(400, "MFG_VAR_STATE_INVALID", "Approve, reject or ask for more evidence.");
  if (decision !== "APPROVE" && (!note || note.length < 3)) throw varError(400, "MFG_VAR_REASON_REQUIRED", "Say why.");
  const order = await loadVarOrder(client, c, row.manufacturing_order_id, { lock: true });
  const { line } = await currentLine(client, c, order, row.material_id);
  if (decision === "APPROVE" && line.hash !== row.submitted_hash) throw varError(409, "MFG_VAR_APPROVAL_STALE");
  const evaluationId = await snapshot(client, c, order, line, "DECIDED");
  const status = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "OPEN";
  await client.query(`UPDATE tenant.manufacturing_material_variance_exceptions SET status = $3, decided_by = $4, decided_at = CASE WHEN $3 = 'OPEN' THEN NULL ELSE clock_timestamp() END,
      decision_note = $5, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, status, c.userId ?? null, note]);
  await varianceEvent(client, c, order.id, decision === "APPROVE" ? "EXCEPTION_APPROVED" : decision === "REJECT" ? "EXCEPTION_REJECTED" : "MORE_EVIDENCE_REQUESTED",
    { exceptionId: row.id, evaluationId, summary: note ?? "Approved" });
  return { exceptionId: row.id, status };
}

// ------------------------------------------------------------------ resolution and follow-up
const RESOLUTIONS = new Set(["AUTHORIZED_VARIANCE", "SOURCE_CORRECTED", "WITHIN_TOLERANCE", "EXTRA_MATERIAL", "PRODUCTION_HOLD", "BOM_REVIEW", "OTHER"]);
// input: { resolutionType, note, referenceId? }. An authorized variance needs an approval still valid for the figures now; "within tolerance"
// needs the line to be within it now; "source corrected" needs the figures to have changed since the exception opened.
export async function resolveVarianceException(client, c, id, input = {}) {
  needVar(c, VAR.resolve);
  const row = await loadException(client, c, id, { lock: true });
  if (row.status === "RESOLVED") throw varError(409, "MFG_VAR_ALREADY_RESOLVED");
  if (row.status === "SUBMITTED") throw varError(409, "MFG_VAR_APPROVAL_REQUIRED", "The exception waits for its review.");
  const type = String(input.resolutionType ?? "").toUpperCase();
  if (!RESOLUTIONS.has(type)) throw varError(400, "MFG_VAR_STATE_INVALID", "Choose how the exception is resolved.");
  const note = text(input.note, 2000);
  if (note.length < 3) throw varError(400, "MFG_VAR_REASON_REQUIRED", "Say how it was resolved.");
  const order = await loadVarOrder(client, c, row.manufacturing_order_id, { lock: true });
  const { line } = await currentLine(client, c, order, row.material_id);
  if (type === "AUTHORIZED_VARIANCE") {
    if (row.status !== "APPROVED") throw varError(409, "MFG_VAR_APPROVAL_REQUIRED");
    if (line.hash !== row.submitted_hash) throw varError(409, "MFG_VAR_APPROVAL_STALE");
  }
  if (type === "WITHIN_TOLERANCE" && line.band !== "WITHIN") throw varError(409, "MFG_VAR_TOLERANCE_EXCEEDED", `${line.material.item_code} is still outside tolerance: ${line.explanation}`);
  if (type === "SOURCE_CORRECTED") {
    const opened = row.opened_evaluation_id ? (await client.query(`SELECT content_hash FROM tenant.manufacturing_material_variance_evaluations WHERE id = $1`, [row.opened_evaluation_id])).rows[0] : null;
    if (opened && opened.content_hash === line.hash) throw varError(409, "MFG_VAR_SOURCE_CHANGED", "Nothing has been corrected since the exception was opened: post the correction first.");
  }
  const evaluationId = await snapshot(client, c, order, line, "RESOLVED");
  await client.query(`UPDATE tenant.manufacturing_material_variance_exceptions SET status = 'RESOLVED', resolution_type = $3, resolution_reference_id = $4, resolution_note = $5, resolved_by = $6,
      resolved_at = clock_timestamp(), row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, type, input.referenceId ? uuid(input.referenceId, "Reference") : null, note, c.userId ?? null]);
  await varianceEvent(client, c, order.id, "EXCEPTION_RESOLVED", { exceptionId: row.id, evaluationId, summary: `${type.toLowerCase().replace(/_/g, " ")}: ${note}` });
  return { exceptionId: row.id, status: "RESOLVED" };
}
// input: { reason } — engineering is asked to review the BOM standard; the revision itself changes only through the BOM workflow.
export async function requestBomReview(client, c, id, input = {}) {
  if (!has(c, VAR.resolve) && !has(c, VAR.approve)) throw varError(403, "MFG_VAR_PERMISSION_DENIED");
  const row = await loadException(client, c, id, { lock: true });
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw varError(400, "MFG_VAR_REASON_REQUIRED", "Say what looks wrong in the BOM.");
  const order = await loadVarOrder(client, c, row.manufacturing_order_id);
  const existing = (await client.query(`SELECT id FROM tenant.manufacturing_bom_review_requests WHERE organization_id = $1 AND exception_id = $2 AND status = 'OPEN'`, [c.organizationId, row.id])).rows[0];
  if (existing) return { requestId: existing.id, replayed: true };
  const requestId = randomUUID();
  await client.query(`INSERT INTO tenant.manufacturing_bom_review_requests (id, organization_id, finished_item_id, component_item_id, bom_revision_id, manufacturing_order_id, exception_id, reason, requested_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [requestId, c.organizationId, order.finished_item_id, row.component_item_id, order.bom_revision_id ?? null, order.id, row.id, reason, c.userId ?? null]);
  if (row.status !== "RESOLVED") await client.query(`UPDATE tenant.manufacturing_material_variance_exceptions SET bom_review_requested = true WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id]);
  await varianceEvent(client, c, order.id, "BOM_REVIEW_REQUESTED", { exceptionId: row.id, summary: reason });
  return { requestId };
}
export async function closeBomReviewRequest(client, c, requestId, input = {}) {
  if (!has(c, "manufacturing.bom.create") && !has(c, VAR.resolve)) throw varError(403, "MFG_VAR_PERMISSION_DENIED");
  const note = text(input.note, 1000);
  if (note.length < 3) throw varError(400, "MFG_VAR_REASON_REQUIRED", "Say what was decided.");
  const row = (await client.query(`UPDATE tenant.manufacturing_bom_review_requests SET status = 'CLOSED', closed_by = $3, closed_at = clock_timestamp(), close_note = $4
      WHERE organization_id = $1 AND id = $2 AND status = 'OPEN' RETURNING id, manufacturing_order_id`, [c.organizationId, uuid(requestId, "Request"), c.userId ?? null, note])).rows[0];
  if (!row) throw varError(409, "MFG_VAR_ALREADY_RESOLVED", "That request is closed already.");
  if (row.manufacturing_order_id) await varianceEvent(client, c, row.manufacturing_order_id, "BOM_REVIEW_CLOSED", { summary: note });
  return { requestId: row.id };
}
// input: { note, placeHold? } — recorded on the exception; with placeHold (and the right to hold orders) the order is put on hold for excess
// consumption, linked to this exception. Routine variance never stops production by itself.
export async function recommendProductionHold(client, c, id, input = {}) {
  needVar(c, VAR.investigate);
  const row = await loadException(client, c, id, { lock: true });
  if (row.status === "RESOLVED") throw varError(409, "MFG_VAR_ALREADY_RESOLVED");
  const note = text(input.note, 1000);
  if (note.length < 3) throw varError(400, "MFG_VAR_REASON_REQUIRED", "Say why production should stop.");
  await client.query(`UPDATE tenant.manufacturing_material_variance_exceptions SET hold_recommended = true, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id]);
  let holdId = null;
  if (input.placeHold) {
    if (!has(c, MO.hold)) throw varError(403, "MFG_VAR_PERMISSION_DENIED", "You may recommend a hold; a production manager places it.");
    const { placeManufacturingOrderOnHold } = await import("../holds/hold-service.js");
    holdId = (await placeManufacturingOrderOnHold(client, c, row.manufacturing_order_id, { reasonCode: "EXCESS_CONSUMPTION", severity: "HIGH", description: note,
      sourceReference: row.exception_number })).holdId;
  }
  await varianceEvent(client, c, row.manufacturing_order_id, holdId ? "HOLD_PLACED" : "HOLD_RECOMMENDED", { exceptionId: row.id, summary: note, details: { holdId } });
  return { exceptionId: row.id, holdId };
}
// input: { quantity, reason } — an extra-material request on the order (approved on its own: approving a usage variance never approves an issue).
export async function requestAdditionalMaterial(client, c, id, input = {}) {
  needVar(c, VAR.investigate);
  const row = await loadException(client, c, id);
  const { requestExtraMaterial } = await import("../orders/mo-execution.js");
  await requestExtraMaterial(client, c, row.manufacturing_order_id, { materialId: row.material_id, quantity: input.quantity, reason: input.reason });
  await varianceEvent(client, c, row.manufacturing_order_id, "EXTRA_MATERIAL_REQUESTED", { exceptionId: row.id, summary: `+${input.quantity}: ${input.reason}` });
  return { exceptionId: row.id };
}

// ------------------------------------------------------------------ tolerances
// input: { scope: ITEM | GROUP, itemId? | itemGroupId?, warningPct, approvalPct, savingReviewPct?, approvalValueAbove?, approvalQuantityAbove?, critical?, notes? }
// Replaces the active override for that item or group (its version goes up).
export async function setVarianceTolerance(client, c, input = {}) {
  needVar(c, VAR.policy);
  const scope = String(input.scope ?? "").toUpperCase();
  if (!["ITEM", "GROUP"].includes(scope)) throw varError(400, "MFG_VAR_POLICY_INVALID", "Choose an item or an item group.");
  const number = (value, label, { optional = false } = {}) => {
    if ((value === undefined || value === null || value === "") && optional) return null;
    if (!/^\d+(\.\d+)?$/.test(String(value ?? "").trim())) throw varError(400, "MFG_VAR_POLICY_INVALID", `${label} must be zero or more.`);
    return String(value).trim();
  };
  const warning = number(input.warningPct, "The warning percent");
  const approval = number(input.approvalPct, "The approval percent");
  if (Number(approval) < Number(warning)) throw varError(400, "MFG_VAR_POLICY_INVALID", "The approval percent is at least the warning percent.");
  const itemId = scope === "ITEM" ? uuid(input.itemId, "Item") : null;
  const groupId = scope === "GROUP" ? uuid(input.itemGroupId, "Item group") : null;
  const exists = scope === "ITEM" ? (await client.query(`SELECT 1 FROM tenant.items WHERE organization_id = $1 AND id = $2`, [c.organizationId, itemId])).rows[0]
    : (await client.query(`SELECT 1 FROM tenant.item_groups WHERE organization_id = $1 AND id = $2`, [c.organizationId, groupId])).rows[0];
  if (!exists) throw varError(400, "MFG_VAR_POLICY_INVALID", "That item or group was not found.");
  const previous = (await client.query(`UPDATE tenant.manufacturing_variance_tolerances SET status = 'INACTIVE', updated_at = now()
      WHERE organization_id = $1 AND status = 'ACTIVE' AND scope = $2 AND (item_id = $3 OR item_group_id = $4) RETURNING version`, [c.organizationId, scope, itemId, groupId])).rows[0];
  const id = randomUUID();
  await client.query(
    `INSERT INTO tenant.manufacturing_variance_tolerances (id, organization_id, scope, item_id, item_group_id, warning_pct, approval_pct, saving_review_pct, approval_value_above, approval_quantity_above,
       critical, version, notes, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [id, c.organizationId, scope, itemId, groupId, warning, approval, number(input.savingReviewPct, "The saving review percent", { optional: true }),
      number(input.approvalValueAbove, "The value threshold", { optional: true }), number(input.approvalQuantityAbove, "The quantity threshold", { optional: true }), input.critical === true,
      (previous?.version ?? 0) + 1, text(input.notes, 500) || null, c.userId ?? null]);
  return { toleranceId: id, version: (previous?.version ?? 0) + 1 };
}
export async function removeVarianceTolerance(client, c, toleranceId) {
  needVar(c, VAR.policy);
  const row = (await client.query(`UPDATE tenant.manufacturing_variance_tolerances SET status = 'INACTIVE', updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2 AND status = 'ACTIVE' RETURNING id`,
    [c.organizationId, uuid(toleranceId, "Tolerance"), c.userId ?? null])).rows[0];
  if (!row) throw varError(404, "MFG_VAR_POLICY_INVALID", "That tolerance is not active.");
  return { removed: true };
}

// ------------------------------------------------------------------ completion
// Where the company blocks completion on unresolved variance (or for a critical material): every line needing approval has an approval still
// valid for its figures now. Messages for the completion check; nothing is written.
export async function varianceCompletionBlockers(client, c, order, projectedUse = null) {
  const policy = await companyPolicy(client, c);
  const evaluation = await evaluateOrder(client, c, order, { extraConsumed: projectedUse });
  const approved = (await client.query(`SELECT material_id, submitted_hash FROM tenant.manufacturing_material_variance_exceptions WHERE organization_id = $1 AND manufacturing_order_id = $2
      AND (status = 'APPROVED' OR (status = 'RESOLVED' AND resolution_type = 'AUTHORIZED_VARIANCE'))`, [c.organizationId, order.id])).rows;
  const blockers = [];
  for (const line of evaluation.lines) {
    if (!NEEDS_APPROVAL.has(line.band) || !(policy.blockCompletion || line.policy.critical)) continue;
    if (approved.some((row) => row.material_id === line.material.id && row.submitted_hash === line.hash)) continue;
    blockers.push(`${line.material.item_code}: ${line.explanation} An approved variance is needed before completion.`);
  }
  return blockers;
}
// At completion: the final figures of every line, kept.
export async function snapshotFinalVariances(client, c, order) {
  const evaluation = await evaluateOrder(client, c, { ...order, status: "COMPLETED" });
  for (const line of evaluation.lines) if (line.band !== "NOT_CALCULABLE") await snapshot(client, c, order, line, "FINAL");
  await varianceEvent(client, c, order.id, "FINAL_RECONCILED", { summary: `${evaluation.lines.length} material line(s) evaluated at completion` });
}

export { D };
