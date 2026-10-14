// Production Quality Inspection — the reads: one inspection (checklist with each result evaluated, defects, the decision, its review, what it
// posted, history and what the viewer may do), the list, the inspection queue (output awaiting inspection per entry, with holds), an order's
// quality summary, checklists with their revisions, the exceptions queue and the reports.
import {
  D, OPEN, QI, QI_STATUS_LABEL, STATUS_LABEL, ZERO, add, decisionProblems, evaluate, has, inspectableSources, isoDay, loadDefects, loadInspection, loadQiOrder, loadResults, needQi, q,
  qiError, qiSettings, reviewReasons, sub, uuid,
} from "./qi-core.js";

const names = async (client, ids) => {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  return new Map((await client.query(`SELECT id, COALESCE(NULLIF(full_name, ''), email) AS name FROM public.users WHERE id = ANY($1::uuid[])`, [list])).rows.map((row) => [row.id, row.name]));
};
const ACTION_LABEL = Object.freeze({ CREATED: "Inspection started", RECORDED: "Results recorded", SUBMITTED: "Submitted for review", RETURNED: "Returned by the reviewer", REVIEWED: "Review approved",
  FINALIZED: "Finalized", CANCELLED: "Cancelled", PRINTED: "Printed", REPRINTED: "Reprinted", FILE_ADDED: "Evidence added", FILE_REMOVED: "Evidence removed",
  RECOVERY_REQUIRED: "Marked for recovery", RECOVERED: "Recovered: the decision agrees" });
const pct = (part, whole) => (whole > ZERO ? (Number(part) / Number(whole) * 100).toFixed(2) : null);
const label = (value) => (value ? String(value).toLowerCase().replace(/_/g, " ") : null);

// ------------------------------------------------------------------ one inspection
export async function getQualityInspection(client, c, id) {
  needQi(c, QI.view);
  const inspection = await loadInspection(client, c, id);
  const order = await loadQiOrder(client, c, inspection.manufacturing_order_id);
  const results = await loadResults(client, c, inspection.id);
  const defects = await loadDefects(client, c, inspection.id);
  const settings = await qiSettings(client, c);
  const evaluated = evaluate(inspection.criteria ?? [], results);
  const open = OPEN.has(inspection.status);
  const { problems, deviation } = decisionProblems(inspection, evaluated, defects, settings);
  const reasons = open ? reviewReasons(settings, deviation) : (inspection.review_reasons ?? []);
  const reviewed = inspection.review_decision === "APPROVED" && inspection.review_hash === inspection.content_hash;
  const item = (await client.query(`SELECT item.code, item.name, uom.code AS uom FROM tenant.items item LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id WHERE item.id = $1`,
    [inspection.finished_item_id])).rows[0] ?? {};
  const entered = (await client.query(`SELECT code FROM tenant.units_of_measure WHERE id = $1`, [inspection.uom_id])).rows[0]?.code ?? null;
  const entry = (await client.query(
    `SELECT entry.entry_number, entry.row_version, entry.posted_by, batch.batch_reference FROM tenant.manufacturing_production_entries entry
       LEFT JOIN tenant.manufacturing_production_batches batch ON batch.id = entry.production_batch_id WHERE entry.id = $1`, [inspection.production_entry_id])).rows[0] ?? {};
  const template = inspection.template_revision_id ? (await client.query(
    `SELECT template.id, template.template_number, template.name, revision.revision_number, revision.status FROM tenant.manufacturing_quality_template_revisions revision
       JOIN tenant.manufacturing_quality_templates template ON template.id = revision.template_id WHERE revision.id = $1`, [inspection.template_revision_id])).rows[0] : null;
  const location = inspection.production_location_id ? (await client.query(`SELECT code, name FROM tenant.warehouse_locations WHERE id = $1`, [inspection.production_location_id])).rows[0] : null;
  const hold = inspection.hold_id ? (await client.query(`SELECT * FROM tenant.manufacturing_quality_holds WHERE id = $1`, [inspection.hold_id])).rows[0] : null;
  const events = (await client.query(`SELECT * FROM tenant.manufacturing_quality_inspection_events WHERE organization_id = $1 AND inspection_id = $2 ORDER BY occurred_at`, [c.organizationId, inspection.id])).rows;
  const corrections = (await client.query(`SELECT * FROM tenant.manufacturing_quality_corrections WHERE organization_id = $1 AND inspection_id = $2 ORDER BY corrected_at`, [c.organizationId, inspection.id])).rows;
  const people = await names(client, [inspection.inspector_id, inspection.created_by, inspection.submitted_by, inspection.reviewer_id, inspection.finalized_by, inspection.cancelled_by,
    hold?.released_by, ...events.map((row) => row.actor_user_id), ...corrections.map((row) => row.corrected_by)]);
  let available = null;
  let live = true;
  if (open) {
    try {
      if (!["IN_PROGRESS", "ON_HOLD"].includes(order.status)) live = false;
      const source = (await inspectableSources(client, c, order)).find((row) => row.row.id === inspection.production_entry_id);
      available = source ? q(source.available) : "0";
    } catch { live = false; }
  }
  const selfReview = [inspection.inspector_id, inspection.submitted_by].includes(c.userId) && !settings.varianceSelfApproval;
  const reporterBlocked = entry.posted_by && entry.posted_by === c.userId && !settings.selfApproval;
  const finalized = inspection.status === "FINALIZED";
  return {
    id: inspection.id, number: inspection.inspection_number, status: inspection.status, statusLabel: QI_STATUS_LABEL[inspection.status], rowVersion: inspection.row_version,
    stage: inspection.inspection_stage, samplingBasis: inspection.sampling_basis,
    order: { id: order.id, number: order.mo_number, status: order.status, statusLabel: STATUS_LABEL[order.status] },
    entry: { id: inspection.production_entry_id, number: entry.entry_number ?? null, rowVersion: entry.row_version ?? null, batch: entry.batch_reference ?? null },
    item: { id: inspection.finished_item_id, code: item.code ?? null, name: item.name ?? null }, uom: item.uom ?? null, location: location ?? null,
    template: template ? { id: template.id, number: template.template_number, name: template.name, revision: template.revision_number, current: template.status === "ACTIVE" } : null,
    quantities: { scope: q(D(inspection.scope_quantity)), entered: q(D(inspection.entered_quantity)), enteredUom: entered, examined: q(D(inspection.examined_quantity)),
      accepted: q(D(inspection.accepted_quantity)), rejected: q(D(inspection.rejected_quantity)), held: q(D(inspection.hold_quantity)),
      undecided: q(sub(D(inspection.scope_quantity), add(add(D(inspection.accepted_quantity), D(inspection.rejected_quantity)), D(inspection.hold_quantity)))), available },
    checks: evaluated.map((row, index) => {
      const criterion = (inspection.criteria ?? [])[index] ?? {};
      return { ...row, unit: criterion.unit ?? null, lower: criterion.lower ?? null, upper: criterion.upper ?? null, choices: criterion.choices ?? [], acceptedChoices: criterion.acceptedChoices ?? [],
        instructions: criterion.instructions ?? null };
    }),
    defects: defects.map((row) => ({ id: row.id, reasonCode: row.reason_code, reasonLabel: label(row.reason_code), severity: row.severity, affectedQuantity: q(D(row.affected_quantity)), observation: row.observation })),
    decision: { rejectionReason: inspection.rejection_reason, rejectionDisposition: inspection.rejection_disposition, reworkAssignedTo: inspection.rework_assigned_to,
      holdReason: inspection.hold_reason, deviationRequested: inspection.deviation_requested, deviation, qualityDecisionId: inspection.quality_decision_id },
    problems: open ? problems : [],
    criticalFailure: evaluated.some((row) => row.result === "FAIL" && row.critical) || defects.some((row) => row.severity === "CRITICAL"),
    review: { required: reasons.length > 0, reasons, approved: reviewed, decision: inspection.review_decision, note: inspection.review_note, submittedBy: people.get(inspection.submitted_by) ?? null,
      submittedAt: inspection.submitted_at, reviewer: people.get(inspection.reviewer_id) ?? null, reviewedAt: inspection.reviewed_at, stale: inspection.review_decision === "APPROVED" && !reviewed },
    hold: hold ? { id: hold.id, quantity: q(D(hold.quantity)), reason: hold.reason, status: hold.status, releasedBy: people.get(hold.released_by) ?? null, releasedAt: hold.released_at, note: hold.release_note } : null,
    corrections: corrections.map((row) => ({ id: row.id, number: row.correction_number, direction: row.direction, kind: row.kind, quantity: q(D(row.quantity)), reason: row.reason,
      by: people.get(row.corrected_by) ?? null, at: row.corrected_at })),
    notes: inspection.notes, inspector: people.get(inspection.inspector_id) ?? null, inspectedAt: inspection.inspected_at, createdAt: inspection.created_at,
    finalizedBy: people.get(inspection.finalized_by) ?? null, finalizedAt: inspection.finalized_at, finalizeKey: inspection.finalize_key,
    cancelledBy: people.get(inspection.cancelled_by) ?? null, cancelledAt: inspection.cancelled_at, cancelReason: inspection.cancel_reason,
    print: { count: inspection.print_count, lastPrintedAt: inspection.last_printed_at, watermark: finalized ? null : inspection.status === "CANCELLED" ? "CANCELLED" : "DRAFT" },
    history: events.map((row) => ({ action: row.action, label: ACTION_LABEL[row.action] ?? row.action, fromStatus: row.from_status, toStatus: row.to_status, summary: row.summary,
      actor: people.get(row.actor_user_id) ?? null, at: row.occurred_at })),
    can: {
      record: open && live && has(c, QI.editDraft), cancel: open && has(c, QI.editDraft),
      submit: ["DRAFT", "IN_PROGRESS"].includes(inspection.status) && live && has(c, QI.submit) && reasons.length > 0 && !problems.length,
      review: inspection.status === "PENDING_REVIEW" && has(c, QI.approveException) && !selfReview,
      finalize: ["DRAFT", "IN_PROGRESS"].includes(inspection.status) && live && has(c, QI.finalize) && !problems.length && (!reasons.length || reviewed) && !reporterBlocked,
      reinspect: Boolean(hold && hold.status === "ACTIVE") && has(c, QI.reinspect) && has(c, QI.create),
      releaseHold: Boolean(hold && hold.status === "ACTIVE") && has(c, QI.releaseHold),
      correct: finalized && has(c, QI.correct), print: has(c, QI.export), recover: ["FINALIZED", "RECOVERY_REQUIRED"].includes(inspection.status) && has(c, QI.approveException),
      attach: has(c, QI.editDraft),
    },
    reporterBlocked: Boolean(reporterBlocked),
  };
}

// ------------------------------------------------------------------ list
// filters: { status, stage, orderId, itemId, entryId, outcome (ACCEPTED | REJECTED | HELD), from, to, search }
export async function listQualityInspections(client, c, filters = {}) {
  needQi(c, QI.view);
  const values = [c.organizationId];
  const where = ["qi.organization_id = $1"];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  if (filters.status) where.push(`qi.status = ${bind(String(filters.status).toUpperCase())}`);
  if (filters.stage) where.push(`qi.inspection_stage = ${bind(String(filters.stage).toUpperCase())}`);
  if (filters.orderId) where.push(`qi.manufacturing_order_id = ${bind(uuid(filters.orderId, "Manufacturing order"))}`);
  if (filters.entryId) where.push(`qi.production_entry_id = ${bind(uuid(filters.entryId, "Production entry"))}`);
  if (filters.itemId) where.push(`qi.finished_item_id = ${bind(uuid(filters.itemId, "Item"))}`);
  if (filters.outcome === "ACCEPTED") where.push("qi.accepted_quantity > 0");
  if (filters.outcome === "REJECTED") where.push("qi.rejected_quantity > 0");
  if (filters.outcome === "HELD") where.push("qi.hold_quantity > 0");
  if (filters.from) where.push(`qi.inspected_at >= ${bind(String(filters.from))}::date`);
  if (filters.to) where.push(`qi.inspected_at < (${bind(String(filters.to))}::date + 1)`);
  if (filters.search) {
    const term = bind(`%${String(filters.search).trim().toLowerCase()}%`);
    where.push(`(lower(qi.inspection_number) LIKE ${term} OR lower(mo.mo_number) LIKE ${term} OR lower(item.code) LIKE ${term} OR lower(item.name) LIKE ${term} OR lower(entry.entry_number) LIKE ${term})`);
  }
  const rows = (await client.query(
    `SELECT qi.*, mo.mo_number, item.code AS item_code, item.name AS item_name, uom.code AS uom, entry.entry_number, batch.batch_reference, COALESCE(NULLIF(person.full_name, ''), person.email) AS inspector,
            (SELECT count(*)::int FROM tenant.manufacturing_quality_defects defect WHERE defect.inspection_id = qi.id) AS defects
       FROM tenant.manufacturing_quality_inspections qi JOIN tenant.manufacturing_orders mo ON mo.id = qi.manufacturing_order_id JOIN tenant.items item ON item.id = qi.finished_item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id JOIN tenant.manufacturing_production_entries entry ON entry.id = qi.production_entry_id
       LEFT JOIN tenant.manufacturing_production_batches batch ON batch.id = qi.production_batch_id LEFT JOIN public.users person ON person.id = qi.inspector_id
      WHERE ${where.join(" AND ")} ORDER BY qi.created_at DESC LIMIT 500`, values)).rows;
  return rows.map(listRow);
}
const listRow = (row) => ({
  id: row.id, number: row.inspection_number, status: row.status, statusLabel: QI_STATUS_LABEL[row.status], stage: row.inspection_stage, orderId: row.manufacturing_order_id, orderNumber: row.mo_number,
  entryId: row.production_entry_id, entryNumber: row.entry_number, batch: row.batch_reference ?? null, itemCode: row.item_code, itemName: row.item_name, uom: row.uom,
  scope: q(D(row.scope_quantity)), examined: q(D(row.examined_quantity)), accepted: q(D(row.accepted_quantity)), rejected: q(D(row.rejected_quantity)), held: q(D(row.hold_quantity)),
  disposition: row.rejection_disposition, defects: row.defects, inspector: row.inspector ?? null, inspectedAt: row.inspected_at, finalizedAt: row.finalized_at,
  reviewPending: row.status === "PENDING_REVIEW",
});

// ------------------------------------------------------------------ the inspection queue
// Every reported entry with output awaiting inspection: how much, how much is held, open inspections over it, its age.
export async function getInspectionQueue(client, c, filters = {}) {
  needQi(c, QI.view);
  const values = [c.organizationId];
  const extra = [];
  if (filters.orderId) { values.push(uuid(filters.orderId, "Manufacturing order")); extra.push(`AND mo.id = $${values.length}`); }
  if (filters.itemId) { values.push(uuid(filters.itemId, "Item")); extra.push(`AND mo.finished_item_id = $${values.length}`); }
  const rows = (await client.query(
    `SELECT entry.id, entry.entry_number, entry.pending_remaining, entry.quality_hold_quantity, entry.posted_at, entry.posted_by, mo.id AS order_id, mo.mo_number, mo.status AS order_status,
            item.id AS item_id, item.code AS item_code, item.name AS item_name, uom.code AS uom, batch.batch_reference,
            (SELECT count(*)::int FROM tenant.manufacturing_quality_inspections qi WHERE qi.production_entry_id = entry.id AND qi.status IN ('DRAFT', 'IN_PROGRESS', 'PENDING_REVIEW')) AS open_inspections,
            (SELECT min(qi.id::text) FROM tenant.manufacturing_quality_inspections qi WHERE qi.production_entry_id = entry.id AND qi.status IN ('DRAFT', 'IN_PROGRESS', 'PENDING_REVIEW')) AS open_inspection_id,
            EXISTS (SELECT 1 FROM tenant.manufacturing_quality_templates template WHERE template.organization_id = entry.organization_id AND template.status = 'ACTIVE' AND template.inspection_stage = 'FINAL'
              AND (template.finished_item_id = mo.finished_item_id OR template.finished_item_id IS NULL)) AS has_checklist
       FROM tenant.manufacturing_production_entries entry JOIN tenant.manufacturing_orders mo ON mo.id = entry.manufacturing_order_id JOIN tenant.items item ON item.id = mo.finished_item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id LEFT JOIN tenant.manufacturing_production_batches batch ON batch.id = entry.production_batch_id
      WHERE entry.organization_id = $1 AND entry.status = 'REPORTED' AND entry.pending_remaining > 0 AND mo.status IN ('IN_PROGRESS', 'ON_HOLD') ${extra.join(" ")}
      ORDER BY entry.posted_at LIMIT 500`, values)).rows;
  return rows.map((row) => ({
    entryId: row.id, entryNumber: row.entry_number, orderId: row.order_id, orderNumber: row.mo_number, orderStatus: row.order_status, orderStatusLabel: STATUS_LABEL[row.order_status],
    itemId: row.item_id, itemCode: row.item_code, itemName: row.item_name, uom: row.uom, batch: row.batch_reference ?? null,
    pending: q(D(row.pending_remaining)), held: q(D(row.quality_hold_quantity)), available: q(sub(D(row.pending_remaining), D(row.quality_hold_quantity))),
    reportedAt: row.posted_at, ageHours: row.posted_at ? Math.max(0, Math.round((Date.now() - new Date(row.posted_at).getTime()) / 36e5)) : null,
    openInspections: row.open_inspections, openInspectionId: row.open_inspection_id, hasChecklist: row.has_checklist, reportedByMe: row.posted_by === c.userId,
  }));
}

// ------------------------------------------------------------------ an order's quality
export async function getMoQualitySummary(client, c, orderId) {
  needQi(c, QI.view);
  const order = await loadQiOrder(client, c, orderId);
  const sources = await inspectableSources(client, c, order);
  const inspections = (await client.query(
    `SELECT qi.*, mo.mo_number, item.code AS item_code, item.name AS item_name, uom.code AS uom, entry.entry_number, batch.batch_reference, COALESCE(NULLIF(person.full_name, ''), person.email) AS inspector,
            (SELECT count(*)::int FROM tenant.manufacturing_quality_defects defect WHERE defect.inspection_id = qi.id) AS defects
       FROM tenant.manufacturing_quality_inspections qi JOIN tenant.manufacturing_orders mo ON mo.id = qi.manufacturing_order_id JOIN tenant.items item ON item.id = qi.finished_item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id JOIN tenant.manufacturing_production_entries entry ON entry.id = qi.production_entry_id
       LEFT JOIN tenant.manufacturing_production_batches batch ON batch.id = qi.production_batch_id LEFT JOIN public.users person ON person.id = qi.inspector_id
      WHERE qi.organization_id = $1 AND qi.manufacturing_order_id = $2 ORDER BY qi.created_at DESC`, [c.organizationId, order.id])).rows.map(listRow);
  const holds = (await client.query(
    `SELECT hold.*, entry.entry_number, qi.inspection_number FROM tenant.manufacturing_quality_holds hold JOIN tenant.manufacturing_production_entries entry ON entry.id = hold.production_entry_id
       LEFT JOIN tenant.manufacturing_quality_inspections qi ON qi.id = hold.inspection_id WHERE hold.organization_id = $1 AND hold.manufacturing_order_id = $2 ORDER BY hold.placed_at DESC`,
    [c.organizationId, order.id])).rows;
  const corrections = (await client.query(`SELECT correction.*, entry.entry_number FROM tenant.manufacturing_quality_corrections correction
      JOIN tenant.manufacturing_production_entries entry ON entry.id = correction.production_entry_id WHERE correction.organization_id = $1 AND correction.manufacturing_order_id = $2 ORDER BY corrected_at DESC`,
    [c.organizationId, order.id])).rows;
  const people = await names(client, [...holds.flatMap((row) => [row.placed_by, row.released_by]), ...corrections.map((row) => row.corrected_by)]);
  const settings = await qiSettings(client, c);
  const checklist = (await client.query(`SELECT 1 FROM tenant.manufacturing_quality_templates WHERE organization_id = $1 AND status = 'ACTIVE' AND inspection_stage = 'FINAL'
      AND (finished_item_id = $2 OR finished_item_id IS NULL) LIMIT 1`, [c.organizationId, order.finished_item_id])).rows.length > 0;
  const total = (field) => sources.reduce((sum, entry) => add(sum, entry.figures[field]), ZERO);
  const inspectable = ["IN_PROGRESS", "ON_HOLD"].includes(order.status);
  return {
    orderId: order.id, orderNumber: order.mo_number, orderStatus: order.status, hasChecklist: checklist, templateRequired: settings.templateRequired, reviewRequired: settings.reviewRequired,
    totals: { reported: q(total("reported")), pending: q(total("pending")), held: q(total("held")), accepted: q(total("accepted")), rejected: q(total("rejected")), received: q(total("received")),
      scrapped: q(total("scrapped")), rejectionRatePct: pct(total("rejected"), add(total("accepted"), total("rejected"))) },
    entries: sources.map((entry) => ({ id: entry.row.id, number: entry.row.entry_number, status: entry.row.status, batch: entry.row.batch_reference ?? null, rowVersion: entry.row.row_version,
      reported: q(entry.figures.reported), pending: q(entry.figures.pending), held: q(entry.figures.held), available: q(entry.available), accepted: q(entry.figures.accepted),
      rejected: q(entry.figures.rejected), received: q(entry.figures.received), receivable: q(entry.figures.receivable), scrapped: q(entry.figures.scrapped), undisposed: q(entry.figures.undisposed),
      reportedByMe: entry.row.posted_by === c.userId })),
    inspections,
    holds: holds.map((row) => ({ id: row.id, entryId: row.production_entry_id, entryNumber: row.entry_number, inspectionId: row.inspection_id, inspectionNumber: row.inspection_number,
      quantity: q(D(row.quantity)), reason: row.reason, status: row.status, placedBy: people.get(row.placed_by) ?? null, placedAt: row.placed_at, releasedBy: people.get(row.released_by) ?? null,
      releasedAt: row.released_at, note: row.release_note })),
    corrections: corrections.map((row) => ({ id: row.id, number: row.correction_number, entryNumber: row.entry_number, direction: row.direction, kind: row.kind, quantity: q(D(row.quantity)),
      reason: row.reason, disposition: row.rejection_disposition, by: people.get(row.corrected_by) ?? null, at: row.corrected_at })),
    can: { inspect: inspectable && has(c, QI.create), hold: inspectable && has(c, QI.hold), releaseHold: has(c, QI.releaseHold), reinspect: has(c, QI.reinspect) && has(c, QI.create),
      correct: !["COMPLETED", "CANCELLED"].includes(order.status) && has(c, QI.correct) },
  };
}

// ------------------------------------------------------------------ checklists
export async function listQualityTemplates(client, c, filters = {}) {
  needQi(c, QI.view);
  const values = [c.organizationId];
  const where = ["template.organization_id = $1"];
  if (filters.status) { values.push(String(filters.status).toUpperCase()); where.push(`template.status = $${values.length}`); }
  if (filters.itemId) { values.push(uuid(filters.itemId, "Item")); where.push(`template.finished_item_id = $${values.length}`); }
  const rows = (await client.query(
    `SELECT template.*, item.code AS item_code, item.name AS item_name, revision.revision_number, revision.criteria,
            (SELECT count(*)::int FROM tenant.manufacturing_quality_inspections qi JOIN tenant.manufacturing_quality_template_revisions used ON used.id = qi.template_revision_id WHERE used.template_id = template.id) AS used
       FROM tenant.manufacturing_quality_templates template LEFT JOIN tenant.items item ON item.id = template.finished_item_id
       LEFT JOIN tenant.manufacturing_quality_template_revisions revision ON revision.template_id = template.id AND revision.status = 'ACTIVE'
      WHERE ${where.join(" AND ")} ORDER BY template.name`, values)).rows;
  return rows.map((row) => ({ id: row.id, number: row.template_number, name: row.name, stage: row.inspection_stage, status: row.status, itemId: row.finished_item_id,
    itemCode: row.item_code ?? null, itemName: row.item_name ?? null, revision: row.revision_number ?? null, checks: Array.isArray(row.criteria) ? row.criteria.length : 0,
    critical: Array.isArray(row.criteria) ? row.criteria.filter((entry) => entry.critical).length : 0, used: row.used, updatedAt: row.updated_at }));
}
export async function getQualityTemplate(client, c, id) {
  needQi(c, QI.view);
  const template = (await client.query(`SELECT template.*, item.code AS item_code, item.name AS item_name FROM tenant.manufacturing_quality_templates template
      LEFT JOIN tenant.items item ON item.id = template.finished_item_id WHERE template.organization_id = $1 AND template.id = $2`, [c.organizationId, uuid(id, "Checklist")])).rows[0];
  if (!template) throw qiError(404, "MFG_QI_TEMPLATE_MISSING", "That checklist was not found.");
  const revisions = (await client.query(`SELECT * FROM tenant.manufacturing_quality_template_revisions WHERE organization_id = $1 AND template_id = $2 ORDER BY revision_number DESC`, [c.organizationId, template.id])).rows;
  const people = await names(client, [template.created_by, ...revisions.map((row) => row.created_by)]);
  const active = revisions.find((row) => row.status === "ACTIVE") ?? null;
  return { id: template.id, number: template.template_number, name: template.name, stage: template.inspection_stage, status: template.status,
    item: template.finished_item_id ? { id: template.finished_item_id, code: template.item_code, name: template.item_name } : null, createdBy: people.get(template.created_by) ?? null,
    createdAt: template.created_at, criteria: active?.criteria ?? [], revision: active?.revision_number ?? null,
    revisions: revisions.map((row) => ({ id: row.id, revision: row.revision_number, status: row.status, checks: row.criteria.length, notes: row.notes, createdBy: people.get(row.created_by) ?? null,
      createdAt: row.created_at, supersededAt: row.superseded_at, criteria: row.criteria })),
    can: { manage: has(c, QI.templateManage) } };
}

// ------------------------------------------------------------------ exceptions
export async function getQualityExceptions(client, c) {
  needQi(c, QI.view);
  const rows = [];
  const base = `FROM tenant.manufacturing_quality_inspections qi JOIN tenant.manufacturing_orders mo ON mo.id = qi.manufacturing_order_id JOIN tenant.items item ON item.id = qi.finished_item_id WHERE qi.organization_id = $1`;
  for (const row of (await client.query(`SELECT qi.id, qi.inspection_number, qi.status, qi.submitted_at, qi.created_at, mo.id AS order_id, mo.mo_number, item.code ${base}
      AND qi.status IN ('PENDING_REVIEW', 'RECOVERY_REQUIRED') ORDER BY qi.created_at`, [c.organizationId])).rows) {
    rows.push({ kind: row.status === "PENDING_REVIEW" ? "REVIEW" : "RECOVERY", inspectionId: row.id, inspectionNumber: row.inspection_number, orderId: row.order_id, orderNumber: row.mo_number,
      itemCode: row.code, since: row.submitted_at ?? row.created_at, summary: row.status === "PENDING_REVIEW" ? "Waiting for a review" : "Needs recovery" });
  }
  for (const row of (await client.query(`SELECT qi.id, qi.inspection_number, qi.created_at, mo.id AS order_id, mo.mo_number, item.code ${base}
      AND qi.status IN ('DRAFT', 'IN_PROGRESS') AND qi.created_at < now() - interval '2 days' ORDER BY qi.created_at`, [c.organizationId])).rows) {
    rows.push({ kind: "STALE", inspectionId: row.id, inspectionNumber: row.inspection_number, orderId: row.order_id, orderNumber: row.mo_number, itemCode: row.code, since: row.created_at,
      summary: "Open for more than two days" });
  }
  for (const row of (await client.query(`SELECT hold.id, hold.quantity, hold.reason, hold.placed_at, mo.id AS order_id, mo.mo_number, entry.entry_number, item.code
      FROM tenant.manufacturing_quality_holds hold JOIN tenant.manufacturing_orders mo ON mo.id = hold.manufacturing_order_id JOIN tenant.items item ON item.id = mo.finished_item_id
      JOIN tenant.manufacturing_production_entries entry ON entry.id = hold.production_entry_id WHERE hold.organization_id = $1 AND hold.status = 'ACTIVE' ORDER BY hold.placed_at`, [c.organizationId])).rows) {
    rows.push({ kind: "HOLD", holdId: row.id, orderId: row.order_id, orderNumber: row.mo_number, itemCode: row.code, since: row.placed_at, summary: `${row.entry_number}: ${q(D(row.quantity))} held — ${row.reason}` });
  }
  return rows;
}

// ------------------------------------------------------------------ reports
export const QI_REPORTS = Object.freeze(["pending", "by-mo", "rates", "by-product", "defects-by-reason", "defects-by-severity", "holds", "rework", "rejected-awaiting-scrap", "batch-history",
  "failed-measurements", "turnaround", "inspectors", "corrections", "quality-to-receipt"]);
export async function getQualityReport(client, c, kind = "by-mo", filters = {}) {
  needQi(c, QI.view);
  if (!QI_REPORTS.includes(kind)) throw qiError(400, "MFG_QI_STATE_INVALID", "Choose a quality report.");
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["qi.organization_id = $1", "qi.status IN ('FINALIZED', 'RECOVERY_REQUIRED')", "qi.inspection_stage = 'FINAL'"];
  if (filters.from) where.push(`qi.finalized_at >= ${bind(String(filters.from))}::date`);
  if (filters.to) where.push(`qi.finalized_at < (${bind(String(filters.to))}::date + 1)`);
  if (filters.orderId) where.push(`qi.manufacturing_order_id = ${bind(uuid(filters.orderId, "Manufacturing order"))}`);
  if (filters.itemId) where.push(`qi.finished_item_id = ${bind(uuid(filters.itemId, "Item"))}`);
  const final = `FROM tenant.manufacturing_quality_inspections qi JOIN tenant.manufacturing_orders mo ON mo.id = qi.manufacturing_order_id JOIN tenant.items item ON item.id = qi.finished_item_id
    LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id WHERE ${where.join(" AND ")}`;
  const rate = (row) => pct(D(row.rejected), add(D(row.accepted), D(row.rejected)));
  switch (kind) {
    case "pending": return getInspectionQueue(client, c, filters);
    case "by-mo":
      return (await client.query(`SELECT mo.id, mo.mo_number, item.code, count(*)::int AS inspections, sum(qi.accepted_quantity) AS accepted, sum(qi.rejected_quantity) AS rejected, sum(qi.hold_quantity) AS held,
          max(qi.finalized_at) AS last ${final} GROUP BY mo.id, mo.mo_number, item.code ORDER BY max(qi.finalized_at) DESC`, values)).rows
        .map((row) => ({ orderId: row.id, orderNumber: row.mo_number, code: row.code, inspections: row.inspections, accepted: q(D(row.accepted)), rejected: q(D(row.rejected)), held: q(D(row.held)),
          rejectionRatePct: rate(row), lastAt: row.last }));
    case "rates":
      return (await client.query(`SELECT to_char(qi.finalized_at, 'YYYY-MM') AS month, item.code, uom.code AS uom, count(*)::int AS inspections, sum(qi.accepted_quantity) AS accepted, sum(qi.rejected_quantity) AS rejected
          ${final} GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2`, values)).rows
        .map((row) => ({ month: row.month, code: row.code, uom: row.uom, inspections: row.inspections, accepted: q(D(row.accepted)), rejected: q(D(row.rejected)), acceptanceRatePct: pct(D(row.accepted), add(D(row.accepted), D(row.rejected))), rejectionRatePct: rate(row) }));
    case "by-product":
      return (await client.query(`SELECT item.id, item.code, item.name, uom.code AS uom, count(*)::int AS inspections, count(DISTINCT mo.id)::int AS orders, sum(qi.accepted_quantity) AS accepted,
          sum(qi.rejected_quantity) AS rejected, sum(qi.hold_quantity) AS held ${final} GROUP BY item.id, item.code, item.name, uom.code ORDER BY item.code`, values)).rows
        .map((row) => ({ itemId: row.id, code: row.code, name: row.name, uom: row.uom, inspections: row.inspections, orders: row.orders, accepted: q(D(row.accepted)), rejected: q(D(row.rejected)),
          held: q(D(row.held)), rejectionRatePct: rate(row) }));
    case "defects-by-reason":
    case "defects-by-severity": {
      const group = kind === "defects-by-reason" ? "defect.reason_code" : "defect.severity";
      return (await client.query(`SELECT ${group} AS grouping, count(*)::int AS defects, count(DISTINCT qi.id)::int AS inspections, sum(defect.affected_quantity) AS affected
          FROM tenant.manufacturing_quality_defects defect JOIN tenant.manufacturing_quality_inspections qi ON qi.id = defect.inspection_id JOIN tenant.manufacturing_orders mo ON mo.id = qi.manufacturing_order_id
          JOIN tenant.items item ON item.id = qi.finished_item_id LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id WHERE ${where.join(" AND ")} GROUP BY 1 ORDER BY count(*) DESC`, values)).rows
        .map((row) => ({ [kind === "defects-by-reason" ? "reason" : "severity"]: row.grouping, label: label(row.grouping), defects: row.defects, inspections: row.inspections, affected: q(D(row.affected)) }));
    }
    case "holds":
      return (await client.query(`SELECT hold.*, mo.mo_number, item.code, entry.entry_number, qi.inspection_number FROM tenant.manufacturing_quality_holds hold
          JOIN tenant.manufacturing_orders mo ON mo.id = hold.manufacturing_order_id JOIN tenant.items item ON item.id = mo.finished_item_id
          JOIN tenant.manufacturing_production_entries entry ON entry.id = hold.production_entry_id LEFT JOIN tenant.manufacturing_quality_inspections qi ON qi.id = hold.inspection_id
          WHERE hold.organization_id = $1 ORDER BY (hold.status = 'ACTIVE') DESC, hold.placed_at DESC LIMIT 1000`, [c.organizationId])).rows
        .map((row) => ({ holdId: row.id, orderId: row.manufacturing_order_id, orderNumber: row.mo_number, code: row.code, entryNumber: row.entry_number, inspectionId: row.inspection_id,
          inspectionNumber: row.inspection_number, quantity: q(D(row.quantity)), reason: row.reason, status: row.status, placedAt: row.placed_at, releasedAt: row.released_at, note: row.release_note }));
    case "rework":
      return (await client.query(`SELECT qi.id, qi.inspection_number, mo.id AS order_id, mo.mo_number, item.code, uom.code AS uom, qi.rejected_quantity, qi.rework_assigned_to, qi.finalized_at,
          (SELECT COALESCE(sum(correction.quantity), 0) FROM tenant.manufacturing_quality_corrections correction WHERE correction.inspection_id = qi.id AND correction.kind = 'REWORK') AS reworked
          ${final} AND qi.rejection_disposition = 'REWORK' ORDER BY qi.finalized_at DESC`, values)).rows
        .map((row) => ({ inspectionId: row.id, inspectionNumber: row.inspection_number, orderId: row.order_id, orderNumber: row.mo_number, code: row.code, uom: row.uom,
          rejected: q(D(row.rejected_quantity)), reworked: q(D(row.reworked)), assignedTo: row.rework_assigned_to, at: row.finalized_at }));
    case "rejected-awaiting-scrap":
      return (await client.query(`SELECT qi.id, qi.inspection_number, mo.id AS order_id, mo.mo_number, mo.status AS order_status, item.code, uom.code AS uom, qi.rejected_quantity, qi.finalized_at,
          entry.entry_number, entry.output_scrapped_quantity - entry.output_scrap_reversed_quantity AS scrapped
          ${final.replace("WHERE", "JOIN tenant.manufacturing_production_entries entry ON entry.id = qi.production_entry_id WHERE")} AND qi.rejection_disposition = 'SCRAP' ORDER BY qi.finalized_at`, values)).rows
        .filter((row) => D(row.scrapped) < D(row.rejected_quantity))
        .map((row) => ({ inspectionId: row.id, inspectionNumber: row.inspection_number, orderId: row.order_id, orderNumber: row.mo_number, orderStatusLabel: STATUS_LABEL[row.order_status], code: row.code,
          uom: row.uom, entryNumber: row.entry_number, rejected: q(D(row.rejected_quantity)), scrapped: q(D(row.scrapped)), at: row.finalized_at }));
    case "batch-history":
      return (await client.query(`SELECT qi.id, qi.inspection_number, qi.status, mo.id AS order_id, mo.mo_number, item.code, uom.code AS uom, batch.batch_reference, qi.accepted_quantity, qi.rejected_quantity,
          qi.hold_quantity, qi.finalized_at ${final.replace("WHERE", "JOIN tenant.manufacturing_production_batches batch ON batch.id = qi.production_batch_id WHERE")} ORDER BY batch.batch_reference, qi.finalized_at`, values)).rows
        .map((row) => ({ inspectionId: row.id, inspectionNumber: row.inspection_number, orderId: row.order_id, orderNumber: row.mo_number, code: row.code, uom: row.uom, batch: row.batch_reference,
          accepted: q(D(row.accepted_quantity)), rejected: q(D(row.rejected_quantity)), held: q(D(row.hold_quantity)), at: row.finalized_at }));
    case "failed-measurements":
      return (await client.query(`SELECT qi.id, qi.inspection_number, mo.id AS order_id, mo.mo_number, item.code, result.criterion_key, result.value, qi.criteria, qi.finalized_at
          FROM tenant.manufacturing_quality_inspection_results result JOIN tenant.manufacturing_quality_inspections qi ON qi.id = result.inspection_id
          JOIN tenant.manufacturing_orders mo ON mo.id = qi.manufacturing_order_id JOIN tenant.items item ON item.id = qi.finished_item_id LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
          WHERE ${where.join(" AND ").replace("qi.inspection_stage = 'FINAL'", "TRUE")} AND result.result = 'FAIL' ORDER BY qi.finalized_at DESC LIMIT 2000`, values)).rows
        .map((row) => {
          const criterion = (row.criteria ?? []).find((entry) => entry.key === row.criterion_key) ?? {};
          return { inspectionId: row.id, inspectionNumber: row.inspection_number, orderId: row.order_id, orderNumber: row.mo_number, code: row.code, check: criterion.name ?? row.criterion_key,
            value: row.value, unit: criterion.unit ?? null, lower: criterion.lower ?? null, upper: criterion.upper ?? null, critical: Boolean(criterion.critical), at: row.finalized_at };
        });
    case "turnaround":
      return (await client.query(`SELECT qi.id, qi.inspection_number, mo.id AS order_id, mo.mo_number, item.code, entry.posted_at AS reported_at, qi.finalized_at,
          EXTRACT(EPOCH FROM (qi.finalized_at - entry.posted_at)) / 3600 AS hours
          ${final.replace("WHERE", "JOIN tenant.manufacturing_production_entries entry ON entry.id = qi.production_entry_id WHERE")} ORDER BY qi.finalized_at DESC LIMIT 1000`, values)).rows
        .map((row) => ({ inspectionId: row.id, inspectionNumber: row.inspection_number, orderId: row.order_id, orderNumber: row.mo_number, code: row.code, reportedAt: row.reported_at,
          finalizedAt: row.finalized_at, hours: row.hours === null ? null : Number(row.hours).toFixed(1) }));
    case "inspectors": {
      const rows = (await client.query(`SELECT qi.inspector_id, count(*)::int AS inspections, sum(qi.accepted_quantity) AS accepted, sum(qi.rejected_quantity) AS rejected, sum(qi.hold_quantity) AS held,
          count(*) FILTER (WHERE qi.review_decision = 'APPROVED')::int AS reviewed ${final} GROUP BY 1 ORDER BY count(*) DESC`, values)).rows;
      const people = await names(client, rows.map((row) => row.inspector_id));
      return rows.map((row) => ({ inspector: people.get(row.inspector_id) ?? "—", inspections: row.inspections, accepted: q(D(row.accepted)), rejected: q(D(row.rejected)), held: q(D(row.held)),
        reviewed: row.reviewed, rejectionRatePct: rate(row) }));
    }
    case "corrections": {
      const rows = (await client.query(`SELECT correction.*, mo.mo_number, entry.entry_number, qi.inspection_number FROM tenant.manufacturing_quality_corrections correction
          JOIN tenant.manufacturing_orders mo ON mo.id = correction.manufacturing_order_id JOIN tenant.manufacturing_production_entries entry ON entry.id = correction.production_entry_id
          LEFT JOIN tenant.manufacturing_quality_inspections qi ON qi.id = correction.inspection_id WHERE correction.organization_id = $1 ORDER BY correction.corrected_at DESC LIMIT 1000`, [c.organizationId])).rows;
      const people = await names(client, rows.map((row) => row.corrected_by));
      return rows.map((row) => ({ correctionId: row.id, number: row.correction_number, orderId: row.manufacturing_order_id, orderNumber: row.mo_number, entryNumber: row.entry_number,
        inspectionId: row.inspection_id, inspectionNumber: row.inspection_number, direction: row.direction, kind: row.kind, quantity: q(D(row.quantity)), reason: row.reason,
        disposition: row.rejection_disposition, by: people.get(row.corrected_by) ?? null, at: row.corrected_at }));
    }
    case "quality-to-receipt":
      return (await client.query(`SELECT mo.id, mo.mo_number, mo.status, item.code, uom.code AS uom, mo.accepted_quantity, mo.rejected_quantity, mo.pending_inspection_quantity,
          (SELECT COALESCE(sum(entry.received_quantity - entry.receipt_reversed_quantity), 0) FROM tenant.manufacturing_production_entries entry WHERE entry.manufacturing_order_id = mo.id) AS received,
          (SELECT COALESCE(sum(entry.quality_hold_quantity), 0) FROM tenant.manufacturing_production_entries entry WHERE entry.manufacturing_order_id = mo.id) AS held
          FROM tenant.manufacturing_orders mo JOIN tenant.items item ON item.id = mo.finished_item_id LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
          WHERE mo.organization_id = $1 AND mo.status IN ('IN_PROGRESS', 'ON_HOLD', 'COMPLETED') AND (mo.accepted_quantity > 0 OR mo.pending_inspection_quantity > 0) ${filters.orderId ? "AND mo.id = $2" : ""}
          ORDER BY mo.mo_number DESC LIMIT 1000`, filters.orderId ? [c.organizationId, uuid(filters.orderId, "Manufacturing order")] : [c.organizationId])).rows
        .map((row) => ({ orderId: row.id, orderNumber: row.mo_number, orderStatusLabel: STATUS_LABEL[row.status], code: row.code, uom: row.uom, pending: q(D(row.pending_inspection_quantity)),
          held: q(D(row.held)), accepted: q(D(row.accepted_quantity)), received: q(D(row.received)), awaitingReceipt: q(sub(D(row.accepted_quantity), D(row.received))), rejected: q(D(row.rejected_quantity)) }));
    default: return [];
  }
}

export { isoDay };
