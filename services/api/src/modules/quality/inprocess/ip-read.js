// Quality — In-Process Inspection: reading. The production status of one inspection (the order, the run, the entry's output as
// Manufacturing holds it, what Quality cleared and what Manufacturing accepted, scrapped or holds — read from their owners), the dashboard
// (pending by production order, blocked production, WIP on hold, failures, rework), exceptions, the fifteen reports and the options.
import { qx } from "../common.js";
import { EPS, FP, IP, WORKFLOW, has, inError, need, round6 } from "../incoming/in-rules.js";
import { listIncomingInspections } from "../incoming/in-read.js";

const n = (v) => (v === null || v === undefined ? null : Number(v));
const OPEN = ["PENDING", "EXCEPTION"];

// Blocking production requirements still holding something back: open, or cleared for less than they control.
// final: the final-inspection gates (finished output) rather than the in-process ones.
export async function openGates(client, c, { orderId = null, final = false } = {}) {
  return (await qx(client, `SELECT o.*, p.qcp_code, mo.mo_number, mo.id AS order_id FROM tenant.quality_inspection_obligations o JOIN tenant.quality_control_points p ON p.id = o.control_point_id
      JOIN tenant.manufacturing_orders mo ON mo.id = o.source_document_id
     WHERE o.organization_id = $1 AND o.source_type IN ('production_entry', 'production_run') AND o.blocking AND o.status <> 'CANCELLED' AND ($2::uuid IS NULL OR o.source_document_id = $2)
       AND (o.status = ANY($3) OR o.allowance_quantity + o.rejected_quantity < o.controlled_quantity - 0.000001)
       AND (COALESCE(o.resolution->>'checkpoint', '') = 'FINAL_OUTPUT') = $4
     ORDER BY o.created_at`, [c.organizationId, orderId, OPEN, final])).rows;
}

export async function productionStatus(client, c, row) {
  const ctx = (await qx(client, `SELECT * FROM tenant.quality_inprocess_contexts WHERE inspection_id = $1`, [row.id])).rows[0];
  if (!ctx) return null;
  const order = (await qx(client, `SELECT id, mo_number, status, reported_quantity, accepted_quantity, rejected_quantity, pending_inspection_quantity FROM tenant.manufacturing_orders WHERE id = $1`,
    [ctx.manufacturing_order_id])).rows[0];
  const entry = ctx.production_entry_id ? (await qx(client, `SELECT id, entry_number, status, reported_quantity, pending_quantity, pending_remaining, quality_hold_quantity, corrected_pending_quantity, received_quantity, batch_reference
      FROM tenant.manufacturing_production_entries WHERE id = $1`, [ctx.production_entry_id])).rows[0] : null;
  const decisions = entry ? (await qx(client, `SELECT COALESCE(sum(accepted_quantity), 0) AS accepted, COALESCE(sum(rejected_quantity) FILTER (WHERE disposition = 'SCRAP'), 0) AS scrapped,
      COALESCE(sum(rejected_quantity), 0) AS rejected FROM tenant.manufacturing_quality_decisions WHERE organization_id = $1 AND production_entry_id = $2`, [c.organizationId, entry.id])).rows[0] : null;
  let root = row;
  for (let i = 0; i < 20 && root.reinspection_of_id; i += 1) root = (await qx(client, `SELECT * FROM tenant.quality_inspections WHERE id = $1`, [root.reinspection_of_id])).rows[0];
  const ob = (row.obligation_id ?? root.obligation_id) ? (await qx(client, `SELECT o.*, p.qcp_code FROM tenant.quality_inspection_obligations o JOIN tenant.quality_control_points p ON p.id = o.control_point_id
      WHERE o.id = $1`, [row.obligation_id ?? root.obligation_id])).rows[0] : null;
  const run = ctx.production_batch_id ? (await qx(client, `SELECT id, batch_reference, status, setup_confirmed_at FROM tenant.manufacturing_production_batches WHERE id = $1`, [ctx.production_batch_id])).rows[0] : null;
  const accepted = decisions ? Number(decisions.accepted) : 0;
  return {
    order: order ? { id: order.id, number: order.mo_number, status: order.status, reported: n(order.reported_quantity), accepted: n(order.accepted_quantity), rejected: n(order.rejected_quantity),
      awaitingInspection: n(order.pending_inspection_quantity) } : null,
    entry: entry ? { id: entry.id, number: entry.entry_number, status: entry.status, reported: n(entry.reported_quantity), awaitingInspection: n(entry.pending_remaining), held: n(entry.quality_hold_quantity),
      corrected: n(entry.corrected_pending_quantity), acceptedByManufacturing: accepted, scrapped: n(decisions?.scrapped), rejected: n(decisions?.rejected),
      received: n(entry.received_quantity), lot: entry.batch_reference ?? null } : null,
    run: run ? { id: run.id, reference: run.batch_reference, status: run.status, setupConfirmedAt: run.setup_confirmed_at } : null,
    context: { operation: ctx.operation_label, checkpoint: ctx.checkpoint_type, sequence: ctx.checkpoint_sequence, location: ctx.location_label, produced: n(ctx.produced_quantity),
      cumulative: n(ctx.cumulative_quantity), operatorId: ctx.operator_user_id, operator: ctx.operator_user_id ? (await qx(client, `SELECT full_name FROM public.users WHERE id = $1`, [ctx.operator_user_id])).rows[0]?.full_name ?? null : null,
      bomRevisionId: ctx.bom_revision_id, reworkRequired: ctx.rework_required, reworkInstruction: ctx.rework_instruction, reworkReference: ctx.rework_reference, reworkCompletedAt: ctx.rework_completed_at },
    gate: ob ? { requirement: ob.qcp_code, status: ob.status, label: ob.outcome_label, blocking: ob.blocking, controlled: Number(ob.controlled_quantity), cleared: Number(ob.allowance_quantity),
      awaitingAcceptance: Math.max(round6(Number(ob.allowance_quantity) - accepted), 0), scope: ob.source_type === "production_run" ? "RUN" : "OUTPUT" } : null,
  };
}

// ------------------------------------------------------------------ dashboard and exceptions
export async function getInProcessDashboard(client, c) {
  need(c, IP.view);
  const { getIncomingCounts } = await import("../incoming/in-read.js");
  const counts = await getIncomingCounts(client, c, { type: "in_process" });
  const gates = await openGates(client, c);
  const wipOnHold = round6(gates.reduce((sum, o) => sum + Math.max(Number(o.controlled_quantity) - Number(o.allowance_quantity) - Number(o.rejected_quantity), 0), 0));
  const stats = (await qx(client, `SELECT count(*) FILTER (WHERE proposed_outcome = 'FAIL')::int AS failed, count(*) FILTER (WHERE workflow_status = 'COMPLETED')::int AS completed,
      avg(EXTRACT(EPOCH FROM completed_at - created_at) / 3600) FILTER (WHERE completed_at IS NOT NULL) AS hours
      FROM tenant.quality_inspections WHERE organization_id = $1 AND inspection_type = 'in_process' AND created_at >= now() - interval '90 days'`, [c.organizationId])).rows[0];
  const rework = Number((await qx(client, `SELECT count(*)::int AS n FROM tenant.quality_inprocess_contexts ctx JOIN tenant.quality_inspections i ON i.id = ctx.inspection_id
      WHERE ctx.organization_id = $1 AND ctx.rework_required AND ctx.rework_completed_at IS NULL AND i.workflow_status <> 'CANCELLED'`, [c.organizationId])).rows[0].n);
  const byOrder = (await qx(client, `SELECT ctx.manufacturing_order_id AS id, ctx.mo_number AS number, count(*)::int AS pending FROM tenant.quality_inspections i
      JOIN tenant.quality_inprocess_contexts ctx ON ctx.inspection_id = i.id WHERE i.organization_id = $1 AND i.inspection_type = 'in_process'
      AND (i.workflow_status NOT IN ('COMPLETED', 'CANCELLED') OR (i.workflow_status = 'COMPLETED' AND i.disposition_status <> 'DECIDED'))
      GROUP BY 1, 2 ORDER BY pending DESC, number LIMIT 10`, [c.organizationId])).rows;
  const blocked = [];
  for (const o of gates) {
    const inspection = o.inspection_id ? (await qx(client, `SELECT id, inspection_number, workflow_status FROM tenant.quality_inspections WHERE id = $1`, [o.inspection_id])).rows[0] : null;
    blocked.push({ order: o.mo_number, orderId: o.order_id, label: o.source_label, requirement: o.qcp_code, status: o.status, exception: o.exception_code,
      scope: o.source_type === "production_run" ? "Run cannot continue" : "Output cannot be accepted", held: round6(Math.max(Number(o.controlled_quantity) - Number(o.allowance_quantity) - Number(o.rejected_quantity), 0)),
      inspection: inspection ? { id: inspection.id, number: inspection.inspection_number, status: WORKFLOW[inspection.workflow_status] } : null, href: inspection ? `/quality/in-process/${inspection.id}` : "/quality/control-points?view=requirements" });
  }
  return { counts, blockedOperations: blocked.length, wipOnHold, failed90: stats.failed, completed90: stats.completed, reworkRequired: rework,
    averageHours: stats.hours === null ? null : Math.round(Number(stats.hours) * 10) / 10, pendingByOrder: byOrder, blocked: blocked.slice(0, 50) };
}
export async function listInProcessExceptions(client, c, { type = "in_process" } = {}) {
  need(c, type === "final" ? FP.view : IP.view);
  const base = type === "final" ? "/quality/final" : "/quality/in-process";
  const out = [];
  const exceptions = (await qx(client, `SELECT o.id, o.source_label, o.exception_code, o.created_at, p.qcp_code FROM tenant.quality_inspection_obligations o
      JOIN tenant.quality_control_points p ON p.id = o.control_point_id WHERE o.organization_id = $1 AND o.status = 'EXCEPTION' AND o.source_type IN ('production_entry', 'production_run')
      AND (COALESCE(o.resolution->>'checkpoint', '') = 'FINAL_OUTPUT') = $2`, [c.organizationId, type === "final"])).rows;
  for (const e of exceptions) out.push({ kind: e.exception_code === "RULE_CONFLICT" ? "CONFLICT" : "SPEC_MISSING", label: `${e.source_label}: ${e.exception_code === "RULE_CONFLICT" ? "two control points conflict" : "no approved specification"} (${e.qcp_code}) — the output stays restricted`,
    href: "/quality/control-points?view=requirements", at: e.created_at });
  const recovery = (await qx(client, `SELECT id, inspection_number, updated_at FROM tenant.quality_inspections WHERE organization_id = $1 AND inspection_type = $2 AND workflow_status = 'RECOVERY_REQUIRED'`, [c.organizationId, type])).rows;
  for (const r of recovery) out.push({ kind: "RECOVERY", label: `${r.inspection_number}: needs recovery`, href: `${base}/${r.id}`, at: r.updated_at });
  const rework = (await qx(client, `SELECT i.id, i.inspection_number, i.created_at, ctx.mo_number FROM tenant.quality_inprocess_contexts ctx JOIN tenant.quality_inspections i ON i.id = ctx.inspection_id
      WHERE ctx.organization_id = $1 AND i.inspection_type = $2 AND ctx.rework_required AND ctx.rework_completed_at IS NULL AND i.workflow_status <> 'CANCELLED'
        AND i.created_at < now() - interval '2 days'`, [c.organizationId, type])).rows;
  for (const r of rework) out.push({ kind: "REWORK_OVERDUE", label: `${r.inspection_number} (${r.mo_number}): rework not confirmed after two days`, href: `${base}/${r.id}`, at: r.created_at });
  const scrap = (await qx(client, `SELECT d.disposition_number, i.id, d.decided_at, d.reject_quantity FROM tenant.quality_dispositions d JOIN tenant.quality_inspections i ON i.id = d.inspection_id
      WHERE d.organization_id = $1 AND i.inspection_type = $2 AND d.reject_route = 'SCRAP' AND d.reject_quantity > 0 AND d.manufacturing_decision_id IS NULL`, [c.organizationId, type])).rows;
  for (const r of scrap) out.push({ kind: "SCRAP_PENDING", label: `${r.disposition_number}: ${Number(r.reject_quantity)} to scrap, not yet recorded by Manufacturing`, href: `${base}/${r.id}`, at: r.decided_at });
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// ------------------------------------------------------------------ reports
export const INPROCESS_REPORTS = Object.freeze({
  register: "In-process inspection register", by_order: "Inspections by production order", by_operation: "Inspections by operation", by_location: "Inspections by work center / location",
  pending: "Pending / overdue inspections", blocked: "Blocked production", wip_on_hold: "WIP on Quality hold", first_piece: "First-piece inspection outcomes",
  periodic: "Periodic checkpoint compliance", failed_characteristics: "Failed characteristics", nonconformances: "In-process nonconformances", rework: "Rework quantity and outcomes",
  scrap: "Scrap from in-process failure", traceability: "Inspection-to-production traceability", reconciliation: "Quality gate and WIP reconciliation",
});
export async function getInProcessReport(client, c, kind, filters = {}) {
  need(c, IP.view);
  if (!INPROCESS_REPORTS[kind]) throw inError(404, "QUALITY_INCOMING_NOT_FOUND", "Unknown report.");
  const from = filters.from ? String(filters.from).slice(0, 10) : "1900-01-01";
  const to = filters.to ? String(filters.to).slice(0, 10) : "2999-12-31";
  const base = `FROM tenant.quality_inspections i JOIN tenant.quality_inprocess_contexts ctx ON ctx.inspection_id = i.id LEFT JOIN tenant.items item ON item.id = i.item_id
     WHERE i.organization_id = $1 AND i.inspection_type = 'in_process' AND i.created_at >= $2::date AND i.created_at < $3::date + 1`;
  const v = [c.organizationId, from, to];
  const run = async (sql) => (await qx(client, sql, v)).rows;
  const list = (view) => listIncomingInspections(client, c, { type: "in_process", view, from: filters.from, to: filters.to });
  let rows;
  switch (kind) {
    case "register": case "traceability":
      rows = (await list(undefined)).map((r) => ({ inspection: r.number, production_order: r.production?.order ?? "", entry: r.production?.entry ?? "", run: r.production?.run ?? "",
        operation: r.production?.operation ?? "", checkpoint: r.production?.checkpoint ?? "", item: r.item ? `${r.item.code} ${r.item.name}` : "", quantity: r.quantity, status: r.statusLabel,
        proposed: r.proposed, accepted: r.accepted, rejected: r.rejected })); break;
    case "by_order": rows = await run(`SELECT ctx.mo_number AS production_order, count(*)::int AS inspections, count(*) FILTER (WHERE i.proposed_outcome = 'FAIL')::int AS failed,
        COALESCE(sum(i.lot_quantity) FILTER (WHERE i.reinspection_of_id IS NULL), 0) AS inspected, COALESCE(sum(i.accepted_quantity) FILTER (WHERE i.reinspection_of_id IS NULL), 0) AS accepted,
        COALESCE(sum(i.rejected_quantity) FILTER (WHERE i.reinspection_of_id IS NULL), 0) AS rejected ${base} GROUP BY ctx.mo_number ORDER BY ctx.mo_number`); break;
    case "by_operation": rows = await run(`SELECT COALESCE(ctx.operation_label, '(not named)') AS operation, count(*)::int AS inspections, count(*) FILTER (WHERE i.proposed_outcome = 'FAIL')::int AS failed,
        count(*) FILTER (WHERE ctx.checkpoint_type = 'REWORK')::int AS after_rework ${base} GROUP BY 1 ORDER BY failed DESC, inspections DESC`); break;
    case "by_location": rows = await run(`SELECT COALESCE(ctx.location_label, '(no location)') AS work_center, count(*)::int AS inspections, count(*) FILTER (WHERE i.proposed_outcome = 'FAIL')::int AS failed
        ${base} GROUP BY 1 ORDER BY failed DESC, inspections DESC`); break;
    case "pending": rows = [...(await list("awaiting")), ...(await list("in_progress")), ...(await list("review"))].map((r) => ({ inspection: r.number, production_order: r.production?.order ?? "",
        operation: r.production?.operation ?? "", status: r.statusLabel, due: r.dueAt, overdue: r.overdue ? "Yes" : "", inspector: r.inspector?.name ?? "" })); break;
    case "blocked": rows = (await openGates(client, c)).map((o) => ({ production_order: o.mo_number, source: o.source_label, requirement: o.qcp_code, status: o.status, exception: o.exception_code ?? "",
        controlled: Number(o.controlled_quantity), cleared: Number(o.allowance_quantity), rejected: Number(o.rejected_quantity), scope: o.source_type === "production_run" ? "Run" : "Output" })); break;
    case "wip_on_hold": rows = (await openGates(client, c)).map((o) => ({ production_order: o.mo_number, source: o.source_label, requirement: o.qcp_code,
        on_hold: round6(Math.max(Number(o.controlled_quantity) - Number(o.allowance_quantity) - Number(o.rejected_quantity), 0)) })).filter((r) => r.on_hold > EPS); break;
    case "first_piece": rows = await run(`SELECT ctx.mo_number AS production_order, ctx.batch_reference AS run, i.inspection_number AS inspection, i.workflow_status AS status, i.proposed_outcome AS result,
        i.accepted_quantity AS accepted, i.rejected_quantity AS rejected ${base} AND ctx.checkpoint_type = 'FIRST_PIECE' ORDER BY i.created_at DESC`); break;
    case "periodic": rows = (await qx(client, `SELECT mo.mo_number AS production_order, p.qcp_code AS control_point, k.checkpoint_sequence AS checkpoint, k.threshold_quantity AS at_units,
        i.inspection_number AS inspection, i.workflow_status AS status, i.proposed_outcome AS result FROM tenant.quality_inprocess_checkpoints k
        JOIN tenant.manufacturing_orders mo ON mo.id = k.manufacturing_order_id JOIN tenant.quality_control_points p ON p.id = k.control_point_id
        LEFT JOIN tenant.quality_inspection_obligations o ON o.id = k.obligation_id LEFT JOIN tenant.quality_inspections i ON i.id = o.inspection_id
        WHERE k.organization_id = $1 AND k.checkpoint_type = 'PERIODIC' AND k.created_at >= $2::date AND k.created_at < $3::date + 1 ORDER BY mo.mo_number, k.checkpoint_sequence`, v)).rows; break;
    case "failed_characteristics": rows = await run(`SELECT ch.name AS characteristic, ch.criticality, COALESCE(ctx.operation_label, '') AS operation, count(*)::int AS failed_observations,
        count(DISTINCT o.inspection_id)::int AS inspections FROM tenant.quality_inspection_observations o JOIN tenant.quality_inspection_characteristics ch ON ch.id = o.characteristic_id
        JOIN tenant.quality_inspections i ON i.id = o.inspection_id JOIN tenant.quality_inprocess_contexts ctx ON ctx.inspection_id = i.id
        WHERE i.organization_id = $1 AND o.is_current AND o.outcome = 'FAIL' AND i.created_at >= $2::date AND i.created_at < $3::date + 1
        GROUP BY ch.name, ch.criticality, ctx.operation_label ORDER BY failed_observations DESC`); break;
    case "nonconformances": rows = await run(`SELECT nc.nonconformance_number AS nonconformance, i.inspection_number AS inspection, ctx.mo_number AS production_order, nc.severity, nc.status, nc.description
        FROM tenant.quality_nonconformances nc JOIN tenant.quality_inspections i ON i.id = nc.inspection_id JOIN tenant.quality_inprocess_contexts ctx ON ctx.inspection_id = i.id
        WHERE nc.organization_id = $1 AND nc.created_at >= $2::date AND nc.created_at < $3::date + 1 ORDER BY nc.created_at DESC`); break;
    case "rework": rows = await run(`SELECT d.disposition_number AS disposition, i.inspection_number AS inspection, ctx.mo_number AS production_order, d.rework_quantity AS rework_quantity, d.rework_instruction AS instruction,
        ri.inspection_number AS reinspection, ri.workflow_status AS reinspection_status, rc.rework_reference, ri.accepted_quantity AS accepted_after, ri.rejected_quantity AS rejected_after
        FROM tenant.quality_dispositions d JOIN tenant.quality_inspections i ON i.id = d.inspection_id JOIN tenant.quality_inprocess_contexts ctx ON ctx.inspection_id = i.id
        LEFT JOIN tenant.quality_inspections ri ON ri.id = d.reinspection_id LEFT JOIN tenant.quality_inprocess_contexts rc ON rc.inspection_id = ri.id
        WHERE d.organization_id = $1 AND d.rework_quantity > 0 AND d.decided_at >= $2::date AND d.decided_at < $3::date + 1 ORDER BY d.decided_at DESC`); break;
    case "scrap": rows = await run(`SELECT d.disposition_number AS disposition, i.inspection_number AS inspection, ctx.mo_number AS production_order, ctx.entry_number AS entry, d.reject_quantity AS scrap_quantity,
        d.reason, CASE WHEN d.manufacturing_decision_id IS NULL THEN 'Awaiting Manufacturing' ELSE 'Recorded by Manufacturing' END AS manufacturing
        FROM tenant.quality_dispositions d JOIN tenant.quality_inspections i ON i.id = d.inspection_id JOIN tenant.quality_inprocess_contexts ctx ON ctx.inspection_id = i.id
        WHERE d.organization_id = $1 AND d.reject_route = 'SCRAP' AND d.reject_quantity > 0 AND d.decided_at >= $2::date AND d.decided_at < $3::date + 1 ORDER BY d.decided_at DESC`); break;
    case "reconciliation": rows = await run(`SELECT ctx.mo_number AS production_order, ctx.entry_number AS entry, i.inspection_number AS inspection, o.controlled_quantity AS controlled,
        o.allowance_quantity AS cleared_by_quality, o.rejected_quantity AS rejected_by_quality,
        (SELECT COALESCE(sum(accepted_quantity), 0) FROM tenant.manufacturing_quality_decisions m WHERE m.production_entry_id = ctx.production_entry_id) AS accepted_by_manufacturing,
        (SELECT COALESCE(sum(rejected_quantity), 0) FROM tenant.manufacturing_quality_decisions m WHERE m.production_entry_id = ctx.production_entry_id AND m.disposition = 'SCRAP') AS scrapped_by_manufacturing,
        e.pending_remaining AS still_awaiting_inspection ${base.replace("WHERE", `JOIN tenant.quality_inspection_obligations o ON o.id = i.obligation_id
          LEFT JOIN tenant.manufacturing_production_entries e ON e.id = ctx.production_entry_id WHERE`)} AND i.reinspection_of_id IS NULL ORDER BY i.created_at DESC`); break;
    default: rows = [];
  }
  return { kind, title: INPROCESS_REPORTS[kind], rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, val]) => [k, typeof val === "string" && /^-?\d+\.\d+$/.test(val) ? Number(val) : val]))) };
}
export async function exportInProcessReport(client, c, kind = "register", filters = {}) {
  need(c, IP.export);
  const report = await getInProcessReport(client, c, kind, filters);
  const columns = [...new Set(report.rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [columns.join(","), ...report.rows.map((r) => columns.map((k) => cell(r[k])).join(","))].join("\n");
  return { fileName: `in-process-${kind.replace(/_/g, "-")}.csv`, mimeType: "text/csv", body };
}

// What the screens offer: inspectors, recent reported production output (for a manual request), vocabularies and reports.
export async function listInProcessOptions(client, c) {
  need(c, IP.view);
  const inspectors = (await qx(client, `SELECT DISTINCT u.id, u.full_name FROM organization_memberships m JOIN public.users u ON u.id = m.user_id
      JOIN user_role_assignments a ON a.organization_id = m.organization_id AND a.user_id = m.user_id AND a.status = 'active'
      JOIN roles r ON r.id = a.role_id AND r.status = 'active' LEFT JOIN role_permissions p ON p.role_id = r.id AND p.permission_key = $2
     WHERE m.organization_id = $1 AND m.status = 'active' AND (p.permission_key IS NOT NULL OR r.slug = 'organization_owner') ORDER BY u.full_name`, [c.organizationId, IP.start])).rows;
  const entries = has(c, IP.create) ? (await qx(client, `SELECT e.id, e.entry_number, e.reported_quantity, mo.mo_number, e.batch_reference, item.code, item.name FROM tenant.manufacturing_production_entries e
      JOIN tenant.manufacturing_orders mo ON mo.id = e.manufacturing_order_id LEFT JOIN tenant.items item ON item.id = mo.finished_item_id
     WHERE e.organization_id = $1 AND e.status = 'REPORTED' AND mo.status IN ('IN_PROGRESS', 'ON_HOLD') ORDER BY e.posted_at DESC NULLS LAST LIMIT 300`, [c.organizationId])).rows : [];
  return {
    inspectors: inspectors.map((u) => ({ value: u.id, label: u.full_name })),
    entries: entries.map((e) => ({ value: e.id, label: `${e.mo_number} · ${e.entry_number} (${e.batch_reference ?? "—"}) · ${e.code ?? ""} ${e.name ?? ""} · ${Number(e.reported_quantity)}`, quantity: Number(e.reported_quantity) })),
    priorities: [{ value: "URGENT", label: "Urgent" }, { value: "HIGH", label: "High" }, { value: "NORMAL", label: "Normal" }, { value: "LOW", label: "Low" }],
    reports: Object.entries(INPROCESS_REPORTS).map(([value, label]) => ({ value, label })),
    canCreate: has(c, IP.create),
  };
}
