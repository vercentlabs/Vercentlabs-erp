// Quality — Incoming Inspection: reading. The queues (awaiting inspection, mine, in progress, awaiting review, awaiting disposition,
// reinspection, completed, exceptions) with their counts; one inspection with its source receipt, samples and observations (and every
// superseded one), reviews, dispositions, linked nonconformances and rejection cases, the authoritative stock status (held / released /
// rejected / returned, read from Inventory and the receipt — never kept here), files and trail; the dashboard; and the reports.
import { listFiles } from "../../../core/platform/files/index.js";
import { qx } from "../common.js";
import { criterionText, samplingSentence } from "../specifications/qs-rules.js";
import { inspectionTotals } from "./dispositions.js";
import { EPS, IN, WORKFLOW, DECISIONS, OUTCOMES, has, inError, need, permsOf, round6, text, uuid } from "./in-rules.js";

// The queues serve incoming and in-process inspections alike (filters.type: "incoming" | "in_process"), each under its own view key.
export const typeOf = (filters) => (["in_process", "final", "pre_dispatch"].includes(filters?.type) ? filters.type : "incoming");
const viewKey = (type) => permsOf({ inspection_type: type }).view;

const n = (v) => (v === null || v === undefined ? null : Number(v));
const VIEWS = {
  awaiting: "i.workflow_status IN ('PENDING', 'ASSIGNED')",
  mine: "i.assigned_inspector_id = $2 AND i.workflow_status NOT IN ('COMPLETED', 'CANCELLED')",
  in_progress: "i.workflow_status IN ('IN_PROGRESS', 'CHANGES_REQUESTED')",
  review: "i.workflow_status = 'AWAITING_REVIEW'",
  disposition: "i.workflow_status = 'COMPLETED' AND i.disposition_status <> 'DECIDED' AND NOT i.source_reversed",
  reinspection: "i.reinspection_of_id IS NOT NULL AND i.workflow_status NOT IN ('COMPLETED', 'CANCELLED')",
  completed: "i.workflow_status = 'COMPLETED' AND (i.disposition_status = 'DECIDED' OR i.source_reversed)",
  overdue: "i.due_at < now() AND i.workflow_status NOT IN ('COMPLETED', 'CANCELLED')",
  cancelled: "i.workflow_status = 'CANCELLED'",
};
const LIST_SELECT = `SELECT i.*, item.code AS item_code, item.name AS item_name, party.display_name AS supplier_name, w.code AS warehouse_code, inspector.full_name AS inspector_name,
       gr.receipt_number, gl.line_number AS receipt_line_number, root.inspection_number AS reinspection_of_number, gr.purchase_order_id, po.purchase_order_number, uom.code AS uom_code,
       batch.batch_number, ctx.manufacturing_order_id, ctx.mo_number, ctx.entry_number, ctx.production_entry_id, ctx.batch_reference AS run_reference, ctx.operation_label, ctx.checkpoint_type,
       ctx.location_label, ctx.rework_required, ctx.rework_completed_at, ctx.rework_instruction, dctx.delivery_id, dctx.delivery_number, dctx.order_number AS delivery_order_number,
       dctx.sales_order_id AS delivery_order_id, dctx.customer_name AS delivery_customer, dctx.checkpoint_type AS delivery_checkpoint
  FROM tenant.quality_inspections i
  LEFT JOIN tenant.quality_inprocess_contexts ctx ON ctx.inspection_id = i.id
  LEFT JOIN tenant.quality_dispatch_contexts dctx ON dctx.inspection_id = i.id
  LEFT JOIN tenant.items item ON item.id = i.item_id
  LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
  LEFT JOIN tenant.stock_batches batch ON batch.id = i.batch_id
  LEFT JOIN tenant.procurement_suppliers sup ON sup.id = i.supplier_id
  LEFT JOIN tenant.business_parties party ON party.id = sup.party_id
  LEFT JOIN tenant.warehouses w ON w.id = i.warehouse_id
  LEFT JOIN public.users inspector ON inspector.id = i.assigned_inspector_id
  LEFT JOIN tenant.goods_receipt_lines gl ON gl.id = i.goods_receipt_line_id
  LEFT JOIN tenant.goods_receipts gr ON gr.id = COALESCE(gl.goods_receipt_id, CASE WHEN i.source_type = 'procurement_receipt' THEN i.source_id END)
  LEFT JOIN tenant.purchase_orders po ON po.id = gr.purchase_order_id
  LEFT JOIN tenant.quality_inspections root ON root.id = i.reinspection_of_id`;
function listView(row) {
  return {
    id: row.id, number: row.inspection_number, status: row.workflow_status, statusLabel: WORKFLOW[row.workflow_status] ?? row.workflow_status, disposition: row.disposition_status,
    proposed: row.proposed_outcome, criticalFailure: row.critical_failure, priority: row.priority, dueAt: row.due_at, overdue: Boolean(row.due_at && new Date(row.due_at) < new Date() && !["COMPLETED", "CANCELLED"].includes(row.workflow_status)),
    item: row.item_id ? { id: row.item_id, code: row.item_code, name: row.item_name } : null, supplier: row.supplier_name ?? null, warehouse: row.warehouse_code ?? null,
    receipt: row.receipt_number ? { number: row.receipt_number, line: row.receipt_line_number } : null,
    purchaseOrder: row.purchase_order_id ? { id: row.purchase_order_id, number: row.purchase_order_number } : null, unit: row.uom_code ?? null, batch: row.batch_number ?? null,
    quantity: n(row.lot_quantity), samples: n(row.sample_quantity),
    accepted: n(row.accepted_quantity), rejected: n(row.rejected_quantity), inspector: row.assigned_inspector_id ? { id: row.assigned_inspector_id, name: row.inspector_name } : null,
    reinspectionOf: row.reinspection_of_id ? { id: row.reinspection_of_id, number: row.reinspection_of_number } : null, sourceReversed: row.source_reversed, createdAt: row.created_at,
    completedAt: row.completed_at, type: row.inspection_type,
    production: row.mo_number ? { orderId: row.manufacturing_order_id, order: row.mo_number, entryId: row.production_entry_id, entry: row.entry_number, run: row.run_reference,
      operation: row.operation_label, checkpoint: row.checkpoint_type, location: row.location_label, reworkPending: Boolean(row.rework_required && !row.rework_completed_at),
      reworkInstruction: row.rework_instruction } : null,
    delivery: row.delivery_id ? { id: row.delivery_id, number: row.delivery_number, order: row.delivery_order_number, orderId: row.delivery_order_id, customer: row.delivery_customer,
      checkpoint: row.delivery_checkpoint } : null,
  };
}

// filters: view, search, supplierId, itemId, from, to
export async function listIncomingInspections(client, c, filters = {}) {
  const type = typeOf(filters);
  need(c, viewKey(type));
  const values = [c.organizationId, c.userId ?? null, type];
  const where = ["i.organization_id = $1", "i.inspection_type = $3"];
  if (VIEWS[filters.view]) where.push(VIEWS[filters.view]);
  if (filters.supplierId) { values.push(uuid(filters.supplierId, "Supplier")); where.push(`i.supplier_id = $${values.length}`); }
  if (filters.itemId) { values.push(uuid(filters.itemId, "Item")); where.push(`i.item_id = $${values.length}`); }
  if (filters.orderId) { values.push(uuid(filters.orderId, "Production order")); where.push(`ctx.manufacturing_order_id = $${values.length}`); }
  if (filters.deliveryId) { values.push(uuid(filters.deliveryId, "Delivery")); where.push(`dctx.delivery_id = $${values.length}`); }
  if (filters.salesOrderId) { values.push(uuid(filters.salesOrderId, "Sales order")); where.push(`dctx.sales_order_id = $${values.length}`); }
  if (filters.from) { values.push(String(filters.from).slice(0, 10)); where.push(`i.created_at >= $${values.length}::date`); }
  if (filters.to) { values.push(String(filters.to).slice(0, 10)); where.push(`i.created_at < $${values.length}::date + 1`); }
  if (filters.search) {
    values.push(`%${text(filters.search, 100)}%`);
    const at = `$${values.length}`;
    where.push(`(i.inspection_number ILIKE ${at} OR item.code ILIKE ${at} OR item.name ILIKE ${at} OR party.display_name ILIKE ${at} OR gr.receipt_number ILIKE ${at} OR ctx.mo_number ILIKE ${at} OR ctx.entry_number ILIKE ${at} OR ctx.operation_label ILIKE ${at} OR dctx.delivery_number ILIKE ${at} OR dctx.order_number ILIKE ${at} OR dctx.customer_name ILIKE ${at})`);
  }
  const rows = (await qx(client, `${LIST_SELECT} WHERE ${where.join(" AND ")} AND ($2::uuid IS NULL OR $2::uuid IS NOT NULL)
      ORDER BY CASE i.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, i.due_at NULLS LAST, i.created_at DESC LIMIT 500`, values)).rows;
  return rows.map(listView);
}

export async function getIncomingCounts(client, c, filters = {}) {
  const type = typeOf(filters);
  need(c, viewKey(type));
  const parts = Object.entries(VIEWS).map(([key, sql]) => `count(*) FILTER (WHERE ${sql})::int AS ${key}`).join(", ");
  const row = (await qx(client, `SELECT ${parts} FROM tenant.quality_inspections i WHERE i.organization_id = $1 AND i.inspection_type = $3 AND ($2::uuid IS NULL OR $2::uuid IS NOT NULL)`,
    [c.organizationId, c.userId ?? null, type])).rows[0];
  if (type === "pre_dispatch") {
    const { listDispatchExceptions } = await import("../dispatch/pd-read.js");
    return { ...row, exceptions: (await listDispatchExceptions(client, c)).length };
  }
  if (type !== "incoming") {
    const { listInProcessExceptions } = await import("../inprocess/ip-read.js");
    return { ...row, exceptions: (await listInProcessExceptions(client, c, { type })).length };
  }
  return { ...row, exceptions: (await listIncomingExceptions(client, c)).length };
}

// ------------------------------------------------------------------ one inspection
export async function getIncomingInspection(client, c, idValue) {
  const row = (await qx(client, `${LIST_SELECT} WHERE i.organization_id = $1 AND i.id = $2`, [c.organizationId, uuid(idValue, "Inspection")])).rows[0];
  if (!row) throw inError(404, "QUALITY_INCOMING_NOT_FOUND");
  const P = permsOf(row);
  need(c, P.view);
  const version = row.spec_version_id ? (await qx(client, `SELECT v.*, s.specification_code, s.name AS specification_name FROM tenant.quality_inspection_spec_versions v
      JOIN tenant.quality_inspection_specifications s ON s.id = v.specification_id WHERE v.id = $1`, [row.spec_version_id])).rows[0] : null;
  const characteristics = row.spec_version_id ? (await qx(client, `SELECT * FROM tenant.quality_inspection_characteristics WHERE version_id = $1 ORDER BY sequence`, [row.spec_version_id])).rows : [];
  const samples = (await qx(client, `SELECT s.*, u.full_name AS selected_by_name FROM tenant.quality_inspection_samples s LEFT JOIN public.users u ON u.id = s.selected_by
      WHERE s.inspection_id = $1 ORDER BY s.sequence`, [row.id])).rows;
  const observations = (await qx(client, `SELECT o.*, u.full_name AS recorded_by_name FROM tenant.quality_inspection_observations o LEFT JOIN public.users u ON u.id = o.recorded_by
      WHERE o.inspection_id = $1 ORDER BY o.recorded_at`, [row.id])).rows;
  const reviews = (await qx(client, `SELECT r.*, u.full_name AS actor_name FROM tenant.quality_inspection_reviews r LEFT JOIN public.users u ON u.id = r.actor_user_id
      WHERE r.inspection_id = $1 ORDER BY r.occurred_at`, [row.id])).rows;
  const dispositions = (await qx(client, `SELECT d.*, u.full_name AS decided_by_name, nc.nonconformance_number, ri.inspection_number AS reinspection_number, rj.rejection_number
      FROM tenant.quality_dispositions d LEFT JOIN public.users u ON u.id = d.decided_by LEFT JOIN tenant.quality_nonconformances nc ON nc.id = d.nonconformance_id
      LEFT JOIN tenant.quality_inspections ri ON ri.id = d.reinspection_id LEFT JOIN tenant.receiving_rejections rj ON rj.id = d.rejection_id
     WHERE d.inspection_id = $1 ORDER BY d.decided_at`, [row.id])).rows;
  const totals = await inspectionTotals(client, row.id);
  const reinspections = (await qx(client, `SELECT id, inspection_number, workflow_status, lot_quantity, standard_decision, created_at FROM tenant.quality_inspections WHERE reinspection_of_id = $1
      ORDER BY created_at`, [row.id])).rows;
  const nonconformances = (await qx(client, `SELECT id, nonconformance_number, status, severity, description FROM tenant.quality_nonconformances WHERE organization_id = $1 AND inspection_id = $2
      ORDER BY created_at`, [c.organizationId, row.id])).rows;
  const history = (await qx(client, `SELECT e.event_type, e.payload, e.occurred_at AS created_at, u.full_name AS actor FROM tenant.quality_events e LEFT JOIN public.users u ON u.id = e.actor_user_id
      WHERE e.organization_id = $1 AND e.aggregate_type = 'inspection' AND e.aggregate_id = $2 ORDER BY e.occurred_at DESC`, [c.organizationId, row.id])).rows;
  const files = await listFiles(client, { organizationId: c.organizationId, entityType: "quality.inspection", entityId: row.id });
  const current = observations.filter((o) => o.is_current);
  const left = round6(Number(row.lot_quantity) - totals.decided);
  return {
    ...listView(row),
    version: version ? { id: version.id, code: version.specification_code, name: version.specification_name, number: version.version_number, rule: version.decision_rule,
      sampling: row.sampling_snapshot?.sentence ?? samplingSentence(version), method: version.sampling_method } : null,
    sampling: row.sampling_snapshot, evaluation: row.evaluation, population: row.population_snapshot, rowVersion: row.row_version,
    submittedAt: row.submitted_at, startedAt: row.started_at, assignedAt: row.assigned_at, cancelReason: row.cancel_reason, reinspectionReason: row.reinspection_reason, standardDecision: row.standard_decision,
    characteristics: characteristics.map((ch) => ({ id: ch.id, code: ch.characteristic_code, name: ch.name, checkType: ch.check_type, criterion: criterionText(ch), instructions: ch.instructions,
      unit: ch.unit_code, criticality: ch.criticality, required: ch.is_required, allowNa: ch.allow_na, evidenceRequired: ch.evidence_required, instrument: ch.instrument_note,
      choices: (ch.allowed_values ?? []).map((a) => ({ value: a.value, label: a.label ?? a.value, acceptable: a.acceptable })), expected: ch.expected_boolean })),
    samples: samples.map((s) => ({ id: s.id, code: s.sample_code, sequence: s.sequence, scope: s.scope, serialNumber: s.serial_number, method: s.selection_method, selectedBy: s.selected_by_name,
      selectedAt: s.selected_at })),
    observations: current.map(observationView),
    superseded: observations.filter((o) => !o.is_current).map(observationView),
    reviews: reviews.map((r) => ({ id: r.id, action: r.action, submission: r.submission_number, proposed: r.proposed_outcome, note: r.note, actor: r.actor_name, at: r.occurred_at })),
    dispositions: dispositions.map((d) => ({ id: d.id, number: d.disposition_number, decision: d.decision, label: DECISIONS[d.decision], accept: n(d.accept_quantity), conditional: n(d.conditional_quantity),
      reject: n(d.reject_quantity), reinspect: n(d.reinspect_quantity), rework: n(d.rework_quantity), reworkInstruction: d.rework_instruction ?? null, manufacturingDecision: Boolean(d.manufacturing_decision_id), hold: n(d.hold_quantity), route: d.reject_route, reason: d.reason, conditions: d.conditions, evidence: d.evidence_reference,
      nonconformance: d.nonconformance_id ? { id: d.nonconformance_id, number: d.nonconformance_number } : null, reinspection: d.reinspection_id ? { id: d.reinspection_id, number: d.reinspection_number } : null,
      rejection: d.rejection_id ? { id: d.rejection_id, number: d.rejection_number } : null, decidedBy: d.decided_by_name, decidedAt: d.decided_at })),
    totals: { ...totals, undecided: left },
    reinspections: reinspections.map((r) => ({ id: r.id, number: r.inspection_number, status: r.workflow_status, quantity: n(r.lot_quantity), standard: r.standard_decision, createdAt: r.created_at })),
    nonconformances: nonconformances.map((x) => ({ id: x.id, number: x.nonconformance_number, status: x.status, severity: x.severity, description: x.description })),
    inventory: row.inspection_type === "incoming" ? await inventoryStatus(client, c, row) : null,
    productionStatus: ["in_process", "final"].includes(row.inspection_type) ? await (await import("../inprocess/ip-read.js")).productionStatus(client, c, row) : null,
    dispatchStatus: row.inspection_type === "pre_dispatch" ? await (await import("../dispatch/pd-read.js")).dispatchStatus(client, c, row) : null,
    files,
    history: history.map((e) => ({ type: e.event_type, label: EVENT_LABEL[e.event_type] ?? e.event_type.replace(/^quality\.(incoming|inspection)\./, "").replace(/_/g, " "), at: e.created_at, actor: e.actor,
      detail: e.payload?.reason ?? e.payload?.note ?? (e.payload?.decision ? `${DECISIONS[e.payload.decision]} — ${e.payload.reason ?? ""}` : null) })),
    actions: {
      assign: has(c, P.assign) && !["COMPLETED", "CANCELLED"].includes(row.workflow_status),
      start: has(c, P.start) && ["PENDING", "ASSIGNED"].includes(row.workflow_status),
      record: has(c, P.record) && ["IN_PROGRESS", "CHANGES_REQUESTED"].includes(row.workflow_status) && (!row.assigned_inspector_id || row.assigned_inspector_id === c.userId || has(c, P.review)),
      submit: has(c, P.submit) && ["IN_PROGRESS", "CHANGES_REQUESTED"].includes(row.workflow_status),
      review: has(c, P.review) && row.workflow_status === "AWAITING_REVIEW",
      decide: has(c, P.dispose) && row.workflow_status === "COMPLETED" && left > EPS && !row.source_reversed,
      waive: has(c, P.waive), reinspect: has(c, P.reinspect),
      amend: has(c, P.correct) && row.workflow_status === "COMPLETED" && row.disposition_status === "NONE",
      cancel: has(c, P.cancel) && row.disposition_status === "NONE" && !["COMPLETED", "CANCELLED"].includes(row.workflow_status),
      release: has(c, "procurement.receipts.release"), nonconformance: has(c, "quality.nonconformance.manage"), upload: has(c, P.record) || has(c, P.review),
      confirmRework: Boolean(row.rework_required && !row.rework_completed_at && row.workflow_status !== "CANCELLED") && (has(c, "manufacturing.production.post") || has(c, "manufacturing.mo.record_production")),
      scrap: has(c, "manufacturing.qi.finalize"),
    },
  };
}
const EVENT_LABEL = {
  "quality.inspection.created": "Created", "quality.incoming.created_manually": "Created by hand", "quality.incoming.assigned": "Inspector assigned", "quality.incoming.started": "Started",
  "quality.incoming.results_recorded": "Results recorded", "quality.incoming.submitted": "Submitted", "quality.incoming.changes_requested": "Sent back for changes",
  "quality.incoming.completed": "Evidence completed", "quality.incoming.amended": "Result corrected", "quality.incoming.disposition": "Disposition", "quality.incoming.cancelled": "Cancelled",
  "quality.inspection.cancelled": "Cancelled", "quality.incoming.reinspection_created": "Reinspection created", "quality.incoming.file_added": "Evidence added",
  "quality.inprocess.context": "Linked to production", "quality.inprocess.created_manually": "Requested by hand", "quality.inprocess.rework_confirmed": "Rework confirmed",
  "quality.inprocess.source_corrected": "Production output corrected",
  "quality.dispatch.context": "Linked to the delivery", "quality.dispatch.created_manually": "Requested by hand", "quality.dispatch.source_changed": "Delivery line changed",
  "quality.dispatch.source_cancelled": "Delivery cancelled", "quality.dispatch.rejected_on_hold": "Rejected units put on hold",
};
function observationView(o) {
  return { id: o.id, sampleId: o.sample_id, characteristicId: o.characteristic_id, value: o.numeric_value !== null ? String(Number(o.numeric_value)) : o.boolean_value !== null ? String(o.boolean_value)
    : o.choice ?? o.text_value ?? null, unit: o.unit_code, judgement: o.judgement, notApplicable: o.not_applicable, naReason: o.na_reason, outcome: o.outcome, outcomeLabel: OUTCOMES[o.outcome] ?? o.outcome,
    reason: o.outcome_reason, measured: o.measured_value, evidence: o.evidence_file_ids ?? [], instrument: o.instrument_note, notes: o.notes, amendment: o.amendment_reason,
    recordedBy: o.recorded_by_name, recordedAt: o.recorded_at, current: o.is_current };
}

// What Inventory holds for the inspected goods: the receipt's held quantity and what was released, returned or disposed of; the stock hold
// case; and how much the control point requirement allows released (Quality's clearance) — read from their owners, never stored here.
async function inventoryStatus(client, c, row) {
  let root = row;
  for (let i = 0; i < 20 && root.reinspection_of_id; i += 1) root = (await qx(client, `SELECT * FROM tenant.quality_inspections WHERE id = $1`, [root.reinspection_of_id])).rows[0];
  const held = (await qx(client, `SELECT d.*, l.conversion_factor, l.line_number, gr.receipt_number, gr.id AS receipt_id FROM tenant.goods_receipt_dispositions d
      JOIN tenant.goods_receipt_lines l ON l.id = d.goods_receipt_line_id JOIN tenant.goods_receipts gr ON gr.id = d.goods_receipt_id
     WHERE d.organization_id = $1 AND d.quality_inspection_id = $2`, [c.organizationId, root.id])).rows[0];
  const ob = row.obligation_id ? (await qx(client, `SELECT * FROM tenant.quality_inspection_obligations WHERE id = $1`, [row.obligation_id])).rows[0] : null;
  const hold = held ? (await qx(client, `SELECT h.id, h.document_number, h.status,
        (SELECT COALESCE(sum(unresolved_base_quantity), 0) FROM tenant.inventory_stock_hold_lines l WHERE l.hold_id = h.id) AS unresolved
      FROM tenant.inventory_stock_holds h WHERE h.organization_id = $1 AND h.source_document_type = 'goods_receipt' AND h.source_line_id = $2 ORDER BY h.created_at LIMIT 1`,
    [c.organizationId, held.goods_receipt_line_id])).rows[0] : null;
  if (!held && !ob) return null;
  const factor = Number(held?.conversion_factor ?? 1);
  const base = (v) => round6(Number(v ?? 0) * factor);
  const released = held ? base(held.released_quantity) : null;
  return {
    receipt: held ? { id: held.receipt_id, number: held.receipt_number, line: held.line_number } : null,
    held: held ? base(held.quantity) : null, released, returned: held ? base(held.returned_quantity) : null, disposed: held ? base(held.disposed_quantity) : null,
    blocked: held ? base(held.blocked_quantity) : null,
    stillHeld: held ? round6(base(held.quantity) - released - base(held.returned_quantity) - base(held.disposed_quantity)) : null,
    cleared: ob ? Number(ob.allowance_quantity) : null, awaitingRelease: ob && released !== null ? Math.max(round6(Number(ob.allowance_quantity) - released), 0) : null,
    requirement: ob ? { status: ob.status, controlled: Number(ob.controlled_quantity), label: ob.outcome_label, blocking: ob.blocking } : null,
    hold: hold ? { id: hold.id, number: hold.document_number, status: hold.status, unresolved: Number(hold.unresolved) } : null,
  };
}

export async function getIncomingInventoryStatus(client, c, idValue) {
  const row = (await qx(client, `SELECT * FROM tenant.quality_inspections WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(idValue, "Inspection")])).rows[0];
  if (!row) throw inError(404, "QUALITY_INCOMING_NOT_FOUND");
  need(c, permsOf(row).view);
  return { id: row.id, number: row.inspection_number, inventory: await inventoryStatus(client, c, row) };
}

// ------------------------------------------------------------------ exceptions and dashboard
// Source conflicts and loose ends: requirements held by a configuration exception, inspections of reversed receipts still undecided,
// overdue work, and cleared stock Inventory hasn't released after two days.
export async function listIncomingExceptions(client, c) {
  need(c, IN.view);
  const out = [];
  const exceptions = (await qx(client, `SELECT o.id, o.source_label, o.exception_code, o.created_at, p.qcp_code FROM tenant.quality_inspection_obligations o
      JOIN tenant.quality_control_points p ON p.id = o.control_point_id WHERE o.organization_id = $1 AND o.status = 'EXCEPTION' AND o.source_type = 'goods_receipt'`, [c.organizationId])).rows;
  for (const e of exceptions) out.push({ kind: e.exception_code === "RULE_CONFLICT" ? "CONFLICT" : "SPEC_MISSING", label: `${e.source_label}: ${e.exception_code === "RULE_CONFLICT" ? "two control points conflict" : "no approved specification"} (${e.qcp_code})`,
    href: "/quality/control-points?view=requirements", at: e.created_at });
  const reversed = (await qx(client, `SELECT id, inspection_number, updated_at FROM tenant.quality_inspections WHERE organization_id = $1 AND source_reversed AND disposition_status <> 'DECIDED'
      AND workflow_status <> 'CANCELLED'`, [c.organizationId])).rows;
  for (const r of reversed) out.push({ kind: "SOURCE_REVERSED", label: `${r.inspection_number}: its goods receipt was reversed`, href: `/quality/incoming/${r.id}`, at: r.updated_at });
  const recovery = (await qx(client, `SELECT id, inspection_number, updated_at FROM tenant.quality_inspections WHERE organization_id = $1 AND workflow_status = 'RECOVERY_REQUIRED'`, [c.organizationId])).rows;
  for (const r of recovery) out.push({ kind: "RECOVERY", label: `${r.inspection_number}: needs recovery`, href: `/quality/incoming/${r.id}`, at: r.updated_at });
  const unreleased = (await qx(client, `SELECT i.id, i.inspection_number, o.allowance_quantity, d.released_quantity * l.conversion_factor AS released, max(x.decided_at) AS decided
      FROM tenant.quality_inspection_obligations o JOIN tenant.quality_inspections i ON i.obligation_id = o.id AND i.reinspection_of_id IS NULL
      JOIN tenant.goods_receipt_dispositions d ON d.quality_inspection_id = i.id JOIN tenant.goods_receipt_lines l ON l.id = d.goods_receipt_line_id
      JOIN tenant.quality_dispositions x ON x.obligation_id = o.id
     WHERE o.organization_id = $1 AND o.allowance_quantity > d.released_quantity * l.conversion_factor + 0.000001
     GROUP BY i.id, i.inspection_number, o.allowance_quantity, d.released_quantity, l.conversion_factor HAVING max(x.decided_at) < now() - interval '2 days'`, [c.organizationId])).rows;
  for (const r of unreleased) out.push({ kind: "AWAITING_RELEASE", label: `${r.inspection_number}: ${round6(Number(r.allowance_quantity) - Number(r.released))} cleared by Quality but not released by Inventory`,
    href: `/quality/incoming/${r.id}`, at: r.decided });
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export async function getIncomingDashboard(client, c) {
  need(c, IN.view);
  const counts = await getIncomingCounts(client, c);
  const held = (await qx(client, `SELECT count(*)::int AS receipts, COALESCE(sum(d.quantity - d.released_quantity - d.returned_quantity - d.disposed_quantity), 0) AS quantity
      FROM tenant.goods_receipt_dispositions d WHERE d.organization_id = $1 AND d.disposition = 'inspection_hold' AND d.quantity - d.released_quantity - d.returned_quantity - d.disposed_quantity > 0`,
    [c.organizationId])).rows[0];
  const stats = (await qx(client, `SELECT count(*) FILTER (WHERE proposed_outcome = 'FAIL')::int AS failed, count(*) FILTER (WHERE workflow_status = 'COMPLETED')::int AS completed,
      avg(EXTRACT(EPOCH FROM completed_at - created_at) / 3600) FILTER (WHERE completed_at IS NOT NULL) AS hours
      FROM tenant.quality_inspections WHERE organization_id = $1 AND inspection_type = 'incoming' AND created_at >= now() - interval '90 days'`, [c.organizationId])).rows[0];
  return { counts, receiptsHeld: held.receipts, quantityHeld: Number(held.quantity), failed90: stats.failed, completed90: stats.completed,
    averageHours: stats.hours === null ? null : Math.round(Number(stats.hours) * 10) / 10 };
}

// ------------------------------------------------------------------ reports
export const INCOMING_REPORTS = Object.freeze({
  register: "Incoming inspection register", pending: "Pending incoming inspections", overdue: "Overdue incoming inspections", by_supplier: "Inspection by supplier",
  by_product: "Inspection by product", failed_characteristics: "Failed characteristics", pass_rate: "Pass / fail rate", received_accepted: "Received versus accepted quantity",
  rejected_by_supplier: "Rejected quantity by supplier", held_lots: "Lots held for Quality", reinspections: "Reinspection history", conditional: "Conditional acceptances",
  nonconformances: "Incoming inspection nonconformances", traceability: "Inspection-to-goods-receipt traceability", hold_reconciliation: "Quality hold / release reconciliation",
});
export async function getIncomingReport(client, c, kind, filters = {}) {
  need(c, IN.view);
  if (!INCOMING_REPORTS[kind]) throw inError(404, "QUALITY_INCOMING_NOT_FOUND", "Unknown report.");
  const from = filters.from ? String(filters.from).slice(0, 10) : "1900-01-01";
  const to = filters.to ? String(filters.to).slice(0, 10) : "2999-12-31";
  const base = `FROM tenant.quality_inspections i LEFT JOIN tenant.items item ON item.id = i.item_id
     LEFT JOIN tenant.procurement_suppliers sup ON sup.id = i.supplier_id LEFT JOIN tenant.business_parties party ON party.id = sup.party_id
     WHERE i.organization_id = $1 AND i.inspection_type = 'incoming' AND i.created_at >= $2::date AND i.created_at < $3::date + 1`;
  const v = [c.organizationId, from, to];
  const run = async (sql) => (await qx(client, sql, v)).rows;
  let rows;
  switch (kind) {
    case "register": case "traceability":
      rows = (await listIncomingInspections(client, c, { from: filters.from, to: filters.to })).map((r) => ({ inspection: r.number, receipt: r.receipt ? `${r.receipt.number} / ${r.receipt.line ?? ""}` : "",
        supplier: r.supplier, item: r.item ? `${r.item.code} ${r.item.name}` : "", quantity: r.quantity, status: r.statusLabel, proposed: r.proposed, accepted: r.accepted, rejected: r.rejected })); break;
    case "pending": rows = (await listIncomingInspections(client, c, { view: "awaiting" })).map((r) => ({ inspection: r.number, item: r.item?.name, supplier: r.supplier, due: r.dueAt, inspector: r.inspector?.name ?? "" })); break;
    case "overdue": rows = (await listIncomingInspections(client, c, { view: "overdue" })).map((r) => ({ inspection: r.number, item: r.item?.name, status: r.statusLabel, due: r.dueAt, inspector: r.inspector?.name ?? "" })); break;
    case "by_supplier": rows = await run(`SELECT party.display_name AS supplier, count(*)::int AS inspections, count(*) FILTER (WHERE i.proposed_outcome = 'FAIL')::int AS failed,
        COALESCE(sum(i.lot_quantity), 0) AS inspected, COALESCE(sum(i.accepted_quantity), 0) AS accepted, COALESCE(sum(i.rejected_quantity), 0) AS rejected ${base} AND i.reinspection_of_id IS NULL
        GROUP BY party.display_name ORDER BY failed DESC, inspections DESC`); break;
    case "by_product": rows = await run(`SELECT item.code, item.name, count(*)::int AS inspections, count(*) FILTER (WHERE i.proposed_outcome = 'FAIL')::int AS failed,
        COALESCE(sum(i.accepted_quantity), 0) AS accepted, COALESCE(sum(i.rejected_quantity), 0) AS rejected ${base} AND i.reinspection_of_id IS NULL GROUP BY item.code, item.name ORDER BY failed DESC`); break;
    case "failed_characteristics": rows = await run(`SELECT ch.name AS characteristic, ch.criticality, count(*)::int AS failed_observations, count(DISTINCT o.inspection_id)::int AS inspections
        FROM tenant.quality_inspection_observations o JOIN tenant.quality_inspection_characteristics ch ON ch.id = o.characteristic_id JOIN tenant.quality_inspections i ON i.id = o.inspection_id
        WHERE i.organization_id = $1 AND i.inspection_type = 'incoming' AND o.is_current AND o.outcome = 'FAIL' AND i.created_at >= $2::date AND i.created_at < $3::date + 1
        GROUP BY ch.name, ch.criticality ORDER BY failed_observations DESC`); break;
    case "pass_rate": rows = await run(`SELECT to_char(g.m, 'YYYY-MM') AS month, count(*) FILTER (WHERE g.proposed_outcome = 'PASS')::int AS inspections_passed,
        count(*) FILTER (WHERE g.proposed_outcome = 'FAIL')::int AS inspections_failed,
        (SELECT count(*) FROM tenant.quality_inspection_observations o JOIN tenant.quality_inspections x ON x.id = o.inspection_id WHERE x.organization_id = $1 AND x.inspection_type = 'incoming'
           AND date_trunc('month', x.created_at) = g.m AND o.is_current AND o.outcome = 'FAIL')::int AS sample_level_failures,
        COALESCE(sum(g.accepted_quantity), 0) AS lot_level_accepted, COALESCE(sum(g.rejected_quantity), 0) AS lot_level_rejected
        FROM (SELECT date_trunc('month', i.created_at) AS m, i.proposed_outcome, i.accepted_quantity, i.rejected_quantity ${base}) g GROUP BY g.m ORDER BY g.m`); break;
    case "received_accepted": rows = await run(`SELECT i.inspection_number AS inspection, item.name AS item, i.lot_quantity AS received, i.accepted_quantity AS accepted, i.rejected_quantity AS rejected,
        i.lot_quantity - i.accepted_quantity - i.rejected_quantity AS undecided ${base} AND i.reinspection_of_id IS NULL ORDER BY i.created_at DESC`); break;
    case "rejected_by_supplier": rows = await run(`SELECT party.display_name AS supplier, COALESCE(sum(i.rejected_quantity), 0) AS rejected, COALESCE(sum(i.lot_quantity), 0) AS inspected ${base}
        AND i.reinspection_of_id IS NULL GROUP BY party.display_name HAVING sum(i.rejected_quantity) > 0 ORDER BY rejected DESC`); break;
    case "held_lots": case "hold_reconciliation": rows = await run(`SELECT i.inspection_number AS inspection, item.name AS item, d.quantity * l.conversion_factor AS held, d.released_quantity * l.conversion_factor AS released,
        d.returned_quantity * l.conversion_factor AS returned, d.disposed_quantity * l.conversion_factor AS disposed, o.allowance_quantity AS cleared_by_quality,
        o.allowance_quantity - d.released_quantity * l.conversion_factor AS cleared_not_released
        FROM tenant.goods_receipt_dispositions d JOIN tenant.goods_receipt_lines l ON l.id = d.goods_receipt_line_id JOIN tenant.quality_inspections i ON i.id = d.quality_inspection_id
        LEFT JOIN tenant.items item ON item.id = i.item_id LEFT JOIN tenant.quality_inspection_obligations o ON o.id = i.obligation_id
        WHERE d.organization_id = $1 AND i.created_at >= $2::date AND i.created_at < $3::date + 1 ${kind === "held_lots" ? "AND d.quantity - d.released_quantity - d.returned_quantity - d.disposed_quantity > 0" : ""}
        ORDER BY i.created_at DESC`); break;
    case "reinspections": rows = await run(`SELECT i.inspection_number AS reinspection, root.inspection_number AS of_inspection, i.lot_quantity AS quantity, i.standard_decision AS standard, i.reinspection_reason AS reason,
        i.workflow_status AS status, i.proposed_outcome AS result ${base.replace("WHERE", "LEFT JOIN tenant.quality_inspections root ON root.id = i.reinspection_of_id WHERE")} AND i.reinspection_of_id IS NOT NULL ORDER BY i.created_at DESC`); break;
    case "conditional": rows = await run(`SELECT d.disposition_number AS disposition, i.inspection_number AS inspection, item.name AS item, d.conditional_quantity AS quantity, d.conditions, d.reason, u.full_name AS approved_by, d.decided_at
        FROM tenant.quality_dispositions d JOIN tenant.quality_inspections i ON i.id = d.inspection_id LEFT JOIN tenant.items item ON item.id = i.item_id LEFT JOIN public.users u ON u.id = d.decided_by
        WHERE d.organization_id = $1 AND d.conditional_quantity > 0 AND d.decided_at >= $2::date AND d.decided_at < $3::date + 1 ORDER BY d.decided_at DESC`); break;
    case "nonconformances": rows = await run(`SELECT nc.nonconformance_number AS nonconformance, i.inspection_number AS inspection, nc.severity, nc.status, nc.description
        FROM tenant.quality_nonconformances nc JOIN tenant.quality_inspections i ON i.id = nc.inspection_id WHERE nc.organization_id = $1 AND i.inspection_type = 'incoming'
        AND nc.created_at >= $2::date AND nc.created_at < $3::date + 1 ORDER BY nc.created_at DESC`); break;
    default: rows = [];
  }
  return { kind, title: INCOMING_REPORTS[kind], rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, val]) => [k, typeof val === "string" && /^-?\d+\.\d+$/.test(val) ? Number(val) : val]))) };
}

// What the screens offer: the people who may inspect (for assignment), recent posted receipt lines of stocked goods (for a manual
// inspection), and the vocabularies.
export async function listIncomingOptions(client, c) {
  need(c, IN.view);
  const inspectors = (await qx(client, `SELECT DISTINCT u.id, u.full_name FROM organization_memberships m JOIN public.users u ON u.id = m.user_id
      JOIN user_role_assignments a ON a.organization_id = m.organization_id AND a.user_id = m.user_id AND a.status = 'active'
      JOIN roles r ON r.id = a.role_id AND r.status = 'active'
      LEFT JOIN role_permissions p ON p.role_id = r.id AND p.permission_key = $2
     WHERE m.organization_id = $1 AND m.status = 'active' AND (p.permission_key IS NOT NULL OR r.slug = 'organization_owner') ORDER BY u.full_name`, [c.organizationId, IN.start])).rows;
  const lines = has(c, IN.create) ? (await qx(client, `SELECT l.id, gr.receipt_number, l.line_number, item.code, item.name, l.base_quantity, party.display_name AS supplier
      FROM tenant.goods_receipt_lines l JOIN tenant.goods_receipts gr ON gr.id = l.goods_receipt_id JOIN tenant.items item ON item.id = l.product_id
      LEFT JOIN tenant.procurement_suppliers sup ON sup.id = gr.supplier_id LEFT JOIN tenant.business_parties party ON party.id = sup.party_id
     WHERE l.organization_id = $1 AND gr.status = 'posted' AND gr.reversed_at IS NULL AND l.product_type = 'stock' AND gr.receipt_date >= current_date - 90
     ORDER BY gr.receipt_date DESC, gr.receipt_number DESC, l.line_number LIMIT 300`, [c.organizationId])).rows : [];
  return {
    inspectors: inspectors.map((u) => ({ value: u.id, label: u.full_name })),
    receiptLines: lines.map((l) => ({ value: l.id, label: `${l.receipt_number} / ${l.line_number} · ${l.code} ${l.name} · ${Number(l.base_quantity)}${l.supplier ? ` · ${l.supplier}` : ""}`,
      quantity: Number(l.base_quantity) })),
    decisions: Object.entries(DECISIONS).map(([value, label]) => ({ value, label })),
    priorities: [{ value: "URGENT", label: "Urgent" }, { value: "HIGH", label: "High" }, { value: "NORMAL", label: "Normal" }, { value: "LOW", label: "Low" }],
    reports: Object.entries(INCOMING_REPORTS).map(([value, label]) => ({ value, label })),
  };
}

// A report as CSV (export permission). Sample-level failures and lot-level quantities stay in their own, labelled columns.
export async function exportIncomingReport(client, c, kind = "register", filters = {}) {
  need(c, IN.export);
  const report = await getIncomingReport(client, c, kind, filters);
  const columns = [...new Set(report.rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [columns.join(","), ...report.rows.map((r) => columns.map((k) => cell(r[k])).join(","))].join("\n");
  return { fileName: `incoming-${kind.replace(/_/g, "-")}.csv`, mimeType: "text/csv", body };
}
