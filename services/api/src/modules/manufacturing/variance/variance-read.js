// Material Consumption Variance — the reads: an order's variance per material line on a chosen basis (with the other bases for comparison),
// one line in detail (its consumption, scrap, issues and returns, exceptions and snapshots), the exceptions and their review queue, the
// order's variance history, the tolerances, BOM review requests and the reports. Quantities are never summed across units; values only for
// those who may see cost.
import {
  BAND_LABEL, BASES, D, NEEDS_APPROVAL, NEEDS_REVIEW, REASONS, STATUS_LABEL, VAR, ZERO, add, canSeeVarianceCost, div, evaluateOrder, has, lineView, loadVarOrder, mul, needVar, q, sub, uuid, varError,
} from "./variance-core.js";

const names = async (client, ids) => {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  return new Map((await client.query(`SELECT id, COALESCE(NULLIF(full_name, ''), email) AS name FROM public.users WHERE id = ANY($1::uuid[])`, [list])).rows.map((row) => [row.id, row.name]));
};
const STATUS = Object.freeze({ OPEN: "Investigating", SUBMITTED: "Awaiting approval", APPROVED: "Approved", REJECTED: "Rejected", RESOLVED: "Resolved" });
const ACTION_LABEL = Object.freeze({ EXCEPTION_OPENED: "Exception opened", EXCEPTION_UPDATED: "Investigation updated", EXCEPTION_SUBMITTED: "Submitted for approval", EXCEPTION_APPROVED: "Approved",
  EXCEPTION_REJECTED: "Rejected", MORE_EVIDENCE_REQUESTED: "More evidence requested", EXCEPTION_RESOLVED: "Resolved", BOM_REVIEW_REQUESTED: "BOM review requested", BOM_REVIEW_CLOSED: "BOM review closed",
  HOLD_RECOMMENDED: "Hold recommended", HOLD_PLACED: "Order put on hold", EXTRA_MATERIAL_REQUESTED: "Extra material requested", FINAL_RECONCILED: "Final variance recorded" });
const money = (value) => (value === null || value === undefined ? null : q(D(value), 2));

// Exceptions of an order (or one line), with whether an approval still covers the figures now.
async function exceptionsOf(client, c, orderId, hashes = new Map()) {
  const rows = (await client.query(`SELECT * FROM tenant.manufacturing_material_variance_exceptions WHERE organization_id = $1 AND manufacturing_order_id = $2 ORDER BY created_at DESC`,
    [c.organizationId, orderId])).rows;
  return rows.map((row) => ({ row, approvalValid: (row.status === "APPROVED" || (row.status === "RESOLVED" && row.resolution_type === "AUTHORIZED_VARIANCE")) && hashes.get(row.material_id) === row.submitted_hash }));
}
const exceptionSummary = (entry, people) => ({
  id: entry.row.id, number: entry.row.exception_number, status: entry.row.status, statusLabel: STATUS[entry.row.status], reasonCode: entry.row.reason_code,
  reasonLabel: entry.row.reason_code ? REASONS[entry.row.reason_code] : null, assignedTo: people.get(entry.row.assigned_to) ?? null, approvalValid: entry.approvalValid,
  approvalStale: (entry.row.status === "APPROVED") && !entry.approvalValid, resolutionType: entry.row.resolution_type, createdAt: entry.row.created_at,
});

// ------------------------------------------------------------------ an order
export async function getMoMaterialVariances(client, c, orderId, { basis = "REPORTED_OUTPUT" } = {}) {
  needVar(c, VAR.view);
  const order = await loadVarOrder(client, c, orderId);
  const evaluation = await evaluateOrder(client, c, order, { basis });
  const current = basis === "REPORTED_OUTPUT" ? evaluation : await evaluateOrder(client, c, order);
  const hashes = new Map(current.lines.map((line) => [line.material.id, line.hash]));
  const exceptions = await exceptionsOf(client, c, order.id, hashes);
  const people = await names(client, exceptions.map((entry) => entry.row.assigned_to));
  const lines = evaluation.lines.map((line) => {
    const mine = exceptions.filter((entry) => entry.row.material_id === line.material.id);
    const open = mine.find((entry) => ["OPEN", "SUBMITTED"].includes(entry.row.status)) ?? null;
    const authorized = mine.some((entry) => entry.approvalValid);
    return { ...lineView(line, c), exception: open ? exceptionSummary(open, people) : null, authorized, exceptions: mine.length,
      nextStep: !NEEDS_REVIEW.has(line.band) ? null : authorized ? "Approved for these figures" : open?.row.status === "SUBMITTED" ? "Waiting for approval"
        : open ? "Complete the investigation and submit it" : NEEDS_APPROVAL.has(line.band) ? "Open an exception for approval" : line.band === "SAVING_REVIEW" ? "Check for missing consumption" : "Supervisor review" };
  });
  const cost = canSeeVarianceCost(c);
  const sum = (field) => (cost ? q(evaluation.lines.reduce((total, line) => (line[field] === null ? total : add(total, line[field])), ZERO), 2) : null);
  const reviewing = lines.filter((row) => row.needsReview && !row.authorized);
  return {
    orderId: order.id, orderNumber: order.mo_number, orderStatus: order.status, orderStatusLabel: STATUS_LABEL[order.status], bomRevisionId: order.bom_revision_id, snapshotId: order.bom_snapshot_id,
    basis, basisLabel: BASES[basis], bases: Object.entries(BASES).map(([key, label]) => ({ key, label, quantity: key === "AUTHORIZED_PLAN" ? null : q(evaluation.quantities[key]) })),
    status: evaluation.failure ? "NOT_CALCULABLE" : evaluation.final ? "FINAL" : "PROVISIONAL", failure: evaluation.failure, recoveryRequired: evaluation.recovery > 0,
    overall: reviewing.some((row) => row.needsApproval) ? "APPROVAL_REQUIRED" : reviewing.length ? "REVIEW_REQUIRED" : "WITHIN_TOLERANCE",
    policy: { warningPct: q(evaluation.company.warningPct), approvalPct: q(evaluation.company.approvalPct), savingReviewPct: q(evaluation.company.savingReviewPct),
      valueAbove: evaluation.company.valueAbove === null ? null : q(evaluation.company.valueAbove), blockCompletion: evaluation.company.blockCompletion },
    lines, totals: { usageCost: sum("usageCost"), expectedCost: sum("expectedCost"), actualCost: sum("actualCost"), totalCostVariance: sum("totalCostVariance") },
    can: { investigate: has(c, VAR.investigate) && order.status !== "CANCELLED", approve: has(c, VAR.approve), viewCost: cost, export: has(c, VAR.export) },
  };
}

// One line: every basis, its posted consumption and scrap, issues and returns, exceptions and snapshots.
export async function getMoMaterialVarianceLine(client, c, orderId, materialId) {
  needVar(c, VAR.view);
  const view = await getMoMaterialVariances(client, c, orderId);
  const line = view.lines.find((row) => row.materialId === materialId);
  if (!line) throw varError(404, "MFG_VAR_NOT_FOUND", "That material is not on this order.");
  const cost = canSeeVarianceCost(c);
  const consumption = (await client.query(
    `SELECT note.id, note.consumption_number, note.status, note.posted_at, line.base_quantity, line.corrected_quantity, line.expected_quantity, line.variance_quantity, line.variance_band, line.variance_reason,
            line.total_cost, entry.entry_number, batch.batch_reference
       FROM tenant.manufacturing_material_consumption_lines line JOIN tenant.manufacturing_material_consumptions note ON note.id = line.consumption_id
       LEFT JOIN tenant.manufacturing_production_entries entry ON entry.id = note.production_entry_id LEFT JOIN tenant.manufacturing_production_batches batch ON batch.id = entry.production_batch_id
      WHERE note.organization_id = $1 AND line.material_id = $2 ORDER BY note.created_at`, [c.organizationId, materialId])).rows;
  const scrap = (await client.query(
    `SELECT scrap.id, scrap.scrap_number, scrap.status, scrap.correction_status, scrap.posted_at, scrap.reason_code, scrap.loss_class, line.base_quantity, line.total_cost
       FROM tenant.manufacturing_scrap_lines line JOIN tenant.manufacturing_scraps scrap ON scrap.id = line.scrap_id WHERE scrap.organization_id = $1 AND line.material_id = $2 ORDER BY scrap.created_at`,
    [c.organizationId, materialId])).rows;
  const snapshots = (await client.query(`SELECT * FROM tenant.manufacturing_material_variance_evaluations WHERE organization_id = $1 AND material_id = $2 ORDER BY calculated_at DESC LIMIT 50`,
    [c.organizationId, materialId])).rows;
  const exceptions = (await client.query(`SELECT * FROM tenant.manufacturing_material_variance_exceptions WHERE organization_id = $1 AND material_id = $2 ORDER BY created_at DESC`, [c.organizationId, materialId])).rows;
  return {
    ...line, orderId: view.orderId, orderNumber: view.orderNumber, orderStatus: view.orderStatus, basisLabel: view.basisLabel,
    consumption: consumption.map((row) => ({ id: row.id, number: row.consumption_number, status: row.status, postedAt: row.posted_at, quantity: q(D(row.base_quantity)),
      corrected: q(D(row.corrected_quantity ?? 0)), expected: row.expected_quantity === null ? null : q(D(row.expected_quantity)), variance: row.variance_quantity === null ? null : q(D(row.variance_quantity)),
      band: row.variance_band, reason: row.variance_reason, entry: row.entry_number, batch: row.batch_reference, cost: cost ? money(row.total_cost) : null })),
    scrap: scrap.map((row) => ({ id: row.id, number: row.scrap_number, status: row.status, reversed: row.correction_status === "REVERSED", postedAt: row.posted_at, reason: row.reason_code,
      lossClass: row.loss_class, quantity: q(D(row.base_quantity)), cost: cost ? money(row.total_cost) : null })),
    snapshots: snapshots.map((row) => ({ id: row.id, purpose: row.purpose, status: row.calculation_status, band: row.band, bandLabel: BAND_LABEL[row.band] ?? row.band,
      expected: row.expected_quantity === null ? null : q(D(row.expected_quantity)), consumed: q(D(row.consumed_quantity)), scrapped: q(D(row.scrap_quantity)),
      variance: row.variance_quantity === null ? null : q(D(row.variance_quantity)), pct: row.variance_pct === null ? null : q(D(row.variance_pct), 2), usageCost: cost ? money(row.usage_cost_variance) : null,
      policy: row.policy, hash: row.content_hash, current: row.content_hash === line.hash, at: row.calculated_at })),
    exceptionList: exceptions.map((row) => ({ id: row.id, number: row.exception_number, status: row.status, statusLabel: STATUS[row.status], reason: row.reason_code ? REASONS[row.reason_code] : null,
      createdAt: row.created_at, resolutionType: row.resolution_type })),
  };
}

// ------------------------------------------------------------------ exceptions
export async function getVarianceException(client, c, id) {
  needVar(c, VAR.view);
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_material_variance_exceptions WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(id, "Variance exception")])).rows[0];
  if (!row) throw varError(404, "MFG_VAR_NOT_FOUND");
  const order = await loadVarOrder(client, c, row.manufacturing_order_id);
  const evaluation = await evaluateOrder(client, c, order);
  const line = evaluation.lines.find((entry) => entry.material.id === row.material_id);
  const evaluations = (await client.query(`SELECT * FROM tenant.manufacturing_material_variance_evaluations WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    [c.organizationId, [row.opened_evaluation_id, row.submitted_evaluation_id].filter(Boolean)])).rows;
  const events = (await client.query(`SELECT * FROM tenant.manufacturing_material_variance_events WHERE organization_id = $1 AND exception_id = $2 ORDER BY occurred_at`, [c.organizationId, row.id])).rows;
  const reviews = (await client.query(`SELECT * FROM tenant.manufacturing_bom_review_requests WHERE organization_id = $1 AND exception_id = $2 ORDER BY requested_at`, [c.organizationId, row.id])).rows;
  const people = await names(client, [row.assigned_to, row.created_by, row.submitted_by, row.decided_by, row.resolved_by, ...events.map((entry) => entry.actor_user_id)]);
  const cost = canSeeVarianceCost(c);
  const snap = (evaluationId) => {
    const found = evaluations.find((entry) => entry.id === evaluationId);
    return found ? { id: found.id, band: found.band, bandLabel: BAND_LABEL[found.band] ?? found.band, expected: found.expected_quantity === null ? null : q(D(found.expected_quantity)),
      consumed: q(D(found.consumed_quantity)), scrapped: q(D(found.scrap_quantity)), variance: found.variance_quantity === null ? null : q(D(found.variance_quantity)),
      pct: found.variance_pct === null ? null : q(D(found.variance_pct), 2), usageCost: cost ? money(found.usage_cost_variance) : null, policy: found.policy, at: found.calculated_at } : null;
  };
  const policy = evaluation.company;
  const current = line ? lineView(line, c) : null;
  const stale = Boolean(row.submitted_hash) && line?.hash !== row.submitted_hash;
  const selfReview = row.submitted_by === c.userId && !policy.selfApproval;
  return {
    id: row.id, number: row.exception_number, status: row.status, statusLabel: STATUS[row.status], rowVersion: row.row_version,
    order: { id: order.id, number: order.mo_number, status: order.status, statusLabel: STATUS_LABEL[order.status] },
    material: current, reasonCode: row.reason_code, reasonLabel: row.reason_code ? REASONS[row.reason_code] : null, explanation: row.explanation, evidence: row.evidence,
    assignedTo: people.get(row.assigned_to) ?? null, assignedToId: row.assigned_to, createdBy: people.get(row.created_by) ?? null, createdAt: row.created_at,
    opened: snap(row.opened_evaluation_id), submitted: snap(row.submitted_evaluation_id), stale,
    review: { submittedBy: people.get(row.submitted_by) ?? null, submittedAt: row.submitted_at, decidedBy: people.get(row.decided_by) ?? null, decidedAt: row.decided_at, note: row.decision_note },
    resolution: row.resolution_type ? { type: row.resolution_type, note: row.resolution_note, by: people.get(row.resolved_by) ?? null, at: row.resolved_at, referenceId: row.resolution_reference_id } : null,
    bomReviewRequested: row.bom_review_requested, holdRecommended: row.hold_recommended,
    bomReviews: reviews.map((entry) => ({ id: entry.id, status: entry.status, reason: entry.reason, requestedAt: entry.requested_at, closeNote: entry.close_note })),
    history: events.map((entry) => ({ action: entry.action, label: ACTION_LABEL[entry.action] ?? entry.action, summary: entry.summary, actor: people.get(entry.actor_user_id) ?? null, at: entry.occurred_at })),
    can: {
      edit: row.status === "OPEN" && has(c, VAR.investigate), submit: ["OPEN", "SUBMITTED"].includes(row.status) && has(c, VAR.submit),
      decide: row.status === "SUBMITTED" && has(c, VAR.approve) && !selfReview, resolve: ["OPEN", "APPROVED", "REJECTED"].includes(row.status) && has(c, VAR.resolve),
      bomReview: row.status !== "RESOLVED" && (has(c, VAR.resolve) || has(c, VAR.approve)), recommendHold: row.status !== "RESOLVED" && has(c, VAR.investigate), placeHold: has(c, "manufacturing.mo.hold"),
      requestMaterial: row.status !== "RESOLVED" && has(c, VAR.investigate) && has(c, "manufacturing.mo.extra_material"),
    },
  };
}
// filters: { status (open = OPEN|SUBMITTED, default), reason, orderId, search }
export async function listVarianceExceptions(client, c, filters = {}) {
  needVar(c, VAR.view);
  const values = [c.organizationId];
  const where = ["exception.organization_id = $1"];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const status = String(filters.status ?? "open");
  if (status === "open") where.push("exception.status IN ('OPEN', 'SUBMITTED')");
  else if (status !== "all") where.push(`exception.status = ${bind(status.toUpperCase())}`);
  if (filters.reason) where.push(`exception.reason_code = ${bind(String(filters.reason).toUpperCase())}`);
  if (filters.orderId) where.push(`exception.manufacturing_order_id = ${bind(uuid(filters.orderId, "Manufacturing order"))}`);
  if (filters.search) {
    const term = bind(`%${String(filters.search).trim().toLowerCase()}%`);
    where.push(`(lower(exception.exception_number) LIKE ${term} OR lower(mo.mo_number) LIKE ${term} OR lower(item.code) LIKE ${term} OR lower(item.name) LIKE ${term})`);
  }
  const rows = (await client.query(
    `SELECT exception.*, mo.mo_number, mo.status AS order_status, item.code, item.name, uom.code AS uom, evaluation.variance_quantity, evaluation.variance_pct, evaluation.band, evaluation.usage_cost_variance,
            COALESCE(NULLIF(assignee.full_name, ''), assignee.email) AS assignee
       FROM tenant.manufacturing_material_variance_exceptions exception JOIN tenant.manufacturing_orders mo ON mo.id = exception.manufacturing_order_id
       JOIN tenant.items item ON item.id = exception.component_item_id LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
       LEFT JOIN tenant.manufacturing_material_variance_evaluations evaluation ON evaluation.id = COALESCE(exception.submitted_evaluation_id, exception.opened_evaluation_id)
       LEFT JOIN public.users assignee ON assignee.id = exception.assigned_to
      WHERE ${where.join(" AND ")} ORDER BY exception.created_at DESC LIMIT 500`, values)).rows;
  const cost = canSeeVarianceCost(c);
  return rows.map((row) => ({ id: row.id, number: row.exception_number, status: row.status, statusLabel: STATUS[row.status], orderId: row.manufacturing_order_id, orderNumber: row.mo_number,
    orderStatusLabel: STATUS_LABEL[row.order_status], code: row.code, name: row.name, uom: row.uom, variance: row.variance_quantity === null ? null : q(D(row.variance_quantity)),
    variancePct: row.variance_pct === null ? null : q(D(row.variance_pct), 2), band: row.band, bandLabel: BAND_LABEL[row.band] ?? row.band, usageCost: cost ? money(row.usage_cost_variance) : null,
    reason: row.reason_code ? REASONS[row.reason_code] : null, assignee: row.assignee ?? null, createdAt: row.created_at, submittedAt: row.submitted_at, resolutionType: row.resolution_type }));
}
// The review queue: open exceptions, and lines of live orders that need review but nobody has opened an exception for.
export async function getVarianceReviewQueue(client, c) {
  needVar(c, VAR.view);
  const exceptions = await listVarianceExceptions(client, c, { status: "open" });
  const orders = (await client.query(
    `SELECT DISTINCT mo.* FROM tenant.manufacturing_orders mo JOIN tenant.manufacturing_order_materials material ON material.manufacturing_order_id = mo.id
      WHERE mo.organization_id = $1 AND mo.status IN ('IN_PROGRESS', 'ON_HOLD', 'COMPLETION_PENDING') AND (material.consumed_quantity > 0 OR material.scrapped_quantity > 0)
      ORDER BY mo.updated_at DESC LIMIT 100`, [c.organizationId])).rows;
  const unopened = [];
  for (const order of orders) {
    const evaluation = await evaluateOrder(client, c, order);
    const covered = new Set((await client.query(`SELECT material_id, submitted_hash, status, resolution_type FROM tenant.manufacturing_material_variance_exceptions
        WHERE organization_id = $1 AND manufacturing_order_id = $2`, [c.organizationId, order.id])).rows
      .filter((row) => ["OPEN", "SUBMITTED"].includes(row.status) || ((row.status === "APPROVED" || row.resolution_type === "AUTHORIZED_VARIANCE") && evaluation.lines.find((line) => line.material.id === row.material_id)?.hash === row.submitted_hash))
      .map((row) => row.material_id));
    for (const line of evaluation.lines) {
      if (!NEEDS_REVIEW.has(line.band) || covered.has(line.material.id)) continue;
      unopened.push({ orderId: order.id, orderNumber: order.mo_number, ...lineView(line, c) });
    }
  }
  return { exceptions, unopened };
}
export async function getMoVarianceHistory(client, c, orderId) {
  needVar(c, VAR.view);
  const order = await loadVarOrder(client, c, orderId);
  const events = (await client.query(`SELECT event.*, exception.exception_number FROM tenant.manufacturing_material_variance_events event
      LEFT JOIN tenant.manufacturing_material_variance_exceptions exception ON exception.id = event.exception_id WHERE event.organization_id = $1 AND event.manufacturing_order_id = $2 ORDER BY event.occurred_at DESC`,
    [c.organizationId, order.id])).rows;
  const people = await names(client, events.map((row) => row.actor_user_id));
  return events.map((row) => ({ action: row.action, label: ACTION_LABEL[row.action] ?? row.action, exceptionId: row.exception_id, exceptionNumber: row.exception_number, summary: row.summary,
    actor: people.get(row.actor_user_id) ?? null, at: row.occurred_at }));
}

// ------------------------------------------------------------------ tolerances and BOM reviews
export async function listVarianceTolerances(client, c) {
  needVar(c, VAR.view);
  const rows = (await client.query(
    `SELECT tolerance.*, item.code AS item_code, item.name AS item_name, item_group.name AS group_name FROM tenant.manufacturing_variance_tolerances tolerance
       LEFT JOIN tenant.items item ON item.id = tolerance.item_id LEFT JOIN tenant.item_groups item_group ON item_group.id = tolerance.item_group_id
      WHERE tolerance.organization_id = $1 AND tolerance.status = 'ACTIVE' ORDER BY tolerance.scope, COALESCE(item.code, item_group.name)`, [c.organizationId])).rows;
  return rows.map((row) => ({ id: row.id, scope: row.scope, itemId: row.item_id, itemGroupId: row.item_group_id, label: row.scope === "ITEM" ? `${row.item_code} · ${row.item_name}` : row.group_name,
    warningPct: q(D(row.warning_pct)), approvalPct: q(D(row.approval_pct)), savingReviewPct: row.saving_review_pct === null ? null : q(D(row.saving_review_pct)),
    approvalValueAbove: row.approval_value_above === null ? null : q(D(row.approval_value_above), 2), approvalQuantityAbove: row.approval_quantity_above === null ? null : q(D(row.approval_quantity_above)),
    critical: row.critical, version: row.version, notes: row.notes, updatedAt: row.updated_at }));
}
// The item groups a tolerance may name.
export async function listVarianceGroups(client, c) {
  needVar(c, VAR.view);
  return (await client.query(`SELECT id, name FROM tenant.item_groups WHERE organization_id = $1 ORDER BY name LIMIT 500`, [c.organizationId])).rows.map((row) => ({ id: row.id, name: row.name }));
}
export async function listBomReviewRequests(client, c, filters = {}) {
  needVar(c, VAR.view);
  const rows = (await client.query(
    `SELECT request.*, finished.code AS finished_code, component.code AS component_code, mo.mo_number, exception.exception_number, COALESCE(NULLIF(person.full_name, ''), person.email) AS requester
       FROM tenant.manufacturing_bom_review_requests request JOIN tenant.items finished ON finished.id = request.finished_item_id JOIN tenant.items component ON component.id = request.component_item_id
       LEFT JOIN tenant.manufacturing_orders mo ON mo.id = request.manufacturing_order_id LEFT JOIN tenant.manufacturing_material_variance_exceptions exception ON exception.id = request.exception_id
       LEFT JOIN public.users person ON person.id = request.requested_by
      WHERE request.organization_id = $1 ${filters.status === "all" ? "" : "AND request.status = 'OPEN'"} ORDER BY request.requested_at DESC LIMIT 500`, [c.organizationId])).rows;
  return rows.map((row) => ({ id: row.id, status: row.status, finished: row.finished_code, component: row.component_code, orderId: row.manufacturing_order_id, orderNumber: row.mo_number,
    exceptionId: row.exception_id, exceptionNumber: row.exception_number, reason: row.reason, requester: row.requester, requestedAt: row.requested_at, closeNote: row.close_note }));
}

// ------------------------------------------------------------------ reports
export const VARIANCE_REPORTS = Object.freeze(["by-mo", "by-component", "by-product", "by-batch", "by-period", "favorable-unfavorable", "cost", "scrap-vs-consumption", "by-reason", "approvals",
  "open-exceptions", "bom-review-candidates"]);
// Over orders in production or completed (filters: from, to on the order's start; orderId; itemId). Evaluated from posted source records.
export async function getMaterialVarianceReport(client, c, kind = "by-mo", filters = {}) {
  needVar(c, VAR.view);
  if (!VARIANCE_REPORTS.includes(kind)) throw varError(400, "MFG_VAR_STATE_INVALID", "Choose a variance report.");
  const cost = canSeeVarianceCost(c);
  if (kind === "open-exceptions") return listVarianceExceptions(client, c, { status: "open" });
  if (kind === "approvals" || kind === "by-reason") {
    const rows = await listVarianceExceptions(client, c, { status: "all" });
    if (kind === "approvals") return rows.filter((row) => row.status !== "OPEN");
    const byReason = new Map();
    for (const row of rows) {
      const key = row.reason ?? "Not yet given";
      const entry = byReason.get(key) ?? { reason: key, exceptions: 0, approved: 0, rejected: 0, usageCost: cost ? ZERO : null };
      entry.exceptions += 1; entry.approved += row.status === "APPROVED" || row.resolutionType === "AUTHORIZED_VARIANCE" ? 1 : 0; entry.rejected += row.status === "REJECTED" ? 1 : 0;
      if (cost && row.usageCost !== null) entry.usageCost = add(entry.usageCost, D(row.usageCost));
      byReason.set(key, entry);
    }
    return [...byReason.values()].map((entry) => ({ ...entry, usageCost: entry.usageCost === null ? null : q(entry.usageCost, 2) }));
  }
  if (kind === "by-batch") {
    const rows = (await client.query(
      `SELECT mo.id AS order_id, mo.mo_number, batch.batch_reference, item.code, uom.code AS uom, sum(line.base_quantity - line.corrected_quantity) AS consumed, sum(line.expected_quantity) AS expected,
              sum(line.total_cost) AS cost
         FROM tenant.manufacturing_material_consumption_lines line JOIN tenant.manufacturing_material_consumptions note ON note.id = line.consumption_id
         JOIN tenant.manufacturing_orders mo ON mo.id = note.manufacturing_order_id JOIN tenant.items item ON item.id = line.item_id LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
         JOIN tenant.manufacturing_production_entries entry ON entry.id = note.production_entry_id LEFT JOIN tenant.manufacturing_production_batches batch ON batch.id = entry.production_batch_id
        WHERE note.organization_id = $1 AND note.status = 'POSTED' ${filters.orderId ? "AND mo.id = $2" : ""} GROUP BY 1, 2, 3, 4, 5 ORDER BY 2 DESC, 3, 4 LIMIT 2000`,
      filters.orderId ? [c.organizationId, uuid(filters.orderId, "Manufacturing order")] : [c.organizationId])).rows;
    return rows.map((row) => {
      const variance = row.expected === null ? null : sub(D(row.consumed), D(row.expected));
      return { orderId: row.order_id, orderNumber: row.mo_number, batch: row.batch_reference, code: row.code, uom: row.uom, consumed: q(D(row.consumed)), expected: row.expected === null ? null : q(D(row.expected)),
        variance: variance === null ? null : q(variance), variancePct: variance === null || D(row.expected) === ZERO ? null : q(div(mul(variance, 100n * 1_000_000n), D(row.expected)), 2) };
    });
  }
  // The rest: every line of every order in scope, evaluated now on the reported-output basis.
  const values = [c.organizationId];
  const where = ["mo.organization_id = $1", "mo.status IN ('IN_PROGRESS', 'ON_HOLD', 'COMPLETION_PENDING', 'COMPLETED')", "mo.reported_quantity > 0"];
  if (filters.from) { values.push(String(filters.from)); where.push(`COALESCE(mo.actual_start_at, mo.created_at) >= $${values.length}::date`); }
  if (filters.to) { values.push(String(filters.to)); where.push(`COALESCE(mo.actual_start_at, mo.created_at) < ($${values.length}::date + 1)`); }
  if (filters.orderId) { values.push(uuid(filters.orderId, "Manufacturing order")); where.push(`mo.id = $${values.length}`); }
  if (filters.itemId) { values.push(uuid(filters.itemId, "Item")); where.push(`mo.finished_item_id = $${values.length}`); }
  const orders = (await client.query(`SELECT mo.*, item.code AS finished_code, item.name AS finished_name FROM tenant.manufacturing_orders mo JOIN tenant.items item ON item.id = mo.finished_item_id
      WHERE ${where.join(" AND ")} ORDER BY COALESCE(mo.actual_start_at, mo.created_at) DESC LIMIT 200`, values)).rows;
  const lines = [];
  for (const order of orders) {
    const evaluation = await evaluateOrder(client, c, order);
    for (const line of evaluation.lines) lines.push({ order, line });
  }
  const val = (value) => (cost && value !== null ? value : null);
  const group = (keyOf, labelOf) => {
    const map = new Map();
    for (const { order, line } of lines) {
      if (line.variance === null) continue;
      const key = keyOf(order, line);
      const entry = map.get(key) ?? { key, label: labelOf(order, line), lines: 0, unfavorable: 0, favorable: 0, review: 0, usageCost: ZERO, expectedCost: ZERO, actualCost: ZERO, quantities: new Map() };
      entry.lines += 1; entry.unfavorable += line.classification === "UNFAVORABLE" ? 1 : 0; entry.favorable += line.classification === "FAVORABLE" ? 1 : 0; entry.review += NEEDS_REVIEW.has(line.band) ? 1 : 0;
      if (line.usageCost !== null) entry.usageCost = add(entry.usageCost, line.usageCost);
      if (line.expectedCost !== null) entry.expectedCost = add(entry.expectedCost, line.expectedCost);
      if (line.actualCost !== null) entry.actualCost = add(entry.actualCost, line.actualCost);
      // Quantities only within one unit.
      const unit = line.material.uom_code;
      const quantity = entry.quantities.get(unit) ?? { expected: ZERO, actual: ZERO };
      entry.quantities.set(unit, { expected: add(quantity.expected, line.expected), actual: add(quantity.actual, line.actual) });
      map.set(key, entry);
    }
    return [...map.values()].map((entry) => ({ key: entry.key, label: entry.label, lines: entry.lines, unfavorable: entry.unfavorable, favorable: entry.favorable, review: entry.review,
      usageCost: val(q(entry.usageCost, 2)), expectedCost: val(q(entry.expectedCost, 2)), actualCost: val(q(entry.actualCost, 2)),
      quantities: [...entry.quantities.entries()].map(([unit, quantity]) => ({ unit, expected: q(quantity.expected), actual: q(quantity.actual), variance: q(sub(quantity.actual, quantity.expected)) })) }));
  };
  switch (kind) {
    case "by-mo": return group((order) => order.id, (order) => `${order.mo_number} · ${order.finished_code}`).map((row) => ({ ...row, orderId: row.key }));
    case "by-component": return group((order, line) => line.material.component_item_id, (order, line) => `${line.material.item_code} · ${line.material.item_name}`);
    case "by-product": return group((order) => order.finished_item_id, (order) => `${order.finished_code} · ${order.finished_name}`);
    case "by-period": return group((order) => String(order.actual_start_at ?? order.created_at).slice(0, 7), (order) => new Date(order.actual_start_at ?? order.created_at).toISOString().slice(0, 7));
    case "favorable-unfavorable": return group((order, line) => line.classification, (order, line) => line.classification.toLowerCase());
    case "cost": return lines.filter(({ line }) => line.variance !== null).map(({ order, line }) => ({ orderId: order.id, orderNumber: order.mo_number, code: line.material.item_code,
      expectedCost: val(line.expectedCost === null ? null : q(line.expectedCost, 2)), actualCost: val(line.actualCost === null ? null : q(line.actualCost, 2)),
      usageCost: val(line.usageCost === null ? null : q(line.usageCost, 2)), priceVariance: val(line.priceVariance === null ? null : q(line.priceVariance, 2)),
      totalCostVariance: val(line.totalCostVariance === null ? null : q(line.totalCostVariance, 2)) }));
    case "scrap-vs-consumption": return lines.filter(({ line }) => line.variance !== null).map(({ order, line }) => ({ orderId: order.id, orderNumber: order.mo_number, code: line.material.item_code,
      uom: line.material.uom_code, expected: q(line.expected), allowance: q(sub(line.expected, line.productive)), consumed: q(line.figures.consumed), scrapped: q(line.figures.scrapped),
      variance: q(line.variance), consumptionOnly: q(sub(line.figures.consumed, line.expected)), band: line.band, bandLabel: BAND_LABEL[line.band] }));
    case "bom-review-candidates": {
      // A component over its tolerance on at least two orders of the same product.
      const map = new Map();
      for (const { order, line } of lines) {
        if (line.variance === null || line.classification !== "UNFAVORABLE" || !NEEDS_REVIEW.has(line.band)) continue;
        const key = `${order.finished_item_id}:${line.material.component_item_id}`;
        const entry = map.get(key) ?? { product: order.finished_code, component: line.material.item_code, uom: line.material.uom_code, orders: new Set(), excess: ZERO, pcts: [] };
        entry.orders.add(order.mo_number); entry.excess = add(entry.excess, line.variance); if (line.pct !== null) entry.pcts.push(Number(q(line.pct, 2)));
        map.set(key, entry);
      }
      return [...map.values()].filter((entry) => entry.orders.size >= 2).map((entry) => ({ product: entry.product, component: entry.component, uom: entry.uom, orders: [...entry.orders],
        totalExcess: q(entry.excess), averagePct: entry.pcts.length ? (entry.pcts.reduce((sum, value) => sum + value, 0) / entry.pcts.length).toFixed(2) : null }));
    }
    default: return [];
  }
}

export { has };
