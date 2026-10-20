// Quality — Final Inspection: reading. The dashboard (finished output awaiting inspection, held from finished goods, awaiting Manufacturing's
// acceptance, rework, lots), the sixteen reports and their export, and the options. One inspection, its queues and exceptions are the shared
// reads (../incoming/in-read.js, ./ip-read.js) with type "final".
import { qx } from "../common.js";
import { EPS, FP, WORKFLOW, has, inError, need, round6 } from "../incoming/in-rules.js";
import { listIncomingInspections } from "../incoming/in-read.js";
import { openGates } from "./ip-read.js";

export async function getFinalDashboard(client, c) {
  need(c, FP.view);
  const { getIncomingCounts } = await import("../incoming/in-read.js");
  const counts = await getIncomingCounts(client, c, { type: "final" });
  const gates = await openGates(client, c, { final: true });
  const held = round6(gates.reduce((sum, o) => sum + Math.max(Number(o.controlled_quantity) - Number(o.allowance_quantity) - Number(o.rejected_quantity), 0), 0));
  // Cleared by Quality but not yet accepted by Manufacturing (and so not yet receivable as finished goods).
  const awaitingAcceptance = Number((await qx(client, `SELECT COALESCE(sum(GREATEST(o.allowance_quantity - COALESCE(m.accepted, 0), 0)), 0) AS q
      FROM tenant.quality_inspection_obligations o
      LEFT JOIN (SELECT production_entry_id, sum(accepted_quantity) AS accepted FROM tenant.manufacturing_quality_decisions WHERE organization_id = $1 GROUP BY 1) m ON m.production_entry_id = o.source_line_id
     WHERE o.organization_id = $1 AND o.source_type = 'production_entry' AND o.resolution->>'checkpoint' = 'FINAL_OUTPUT' AND o.status <> 'CANCELLED'`, [c.organizationId])).rows[0].q);
  const stats = (await qx(client, `SELECT count(*) FILTER (WHERE proposed_outcome = 'FAIL')::int AS failed, count(*) FILTER (WHERE workflow_status = 'COMPLETED')::int AS completed,
      avg(EXTRACT(EPOCH FROM completed_at - created_at) / 3600) FILTER (WHERE completed_at IS NOT NULL) AS hours
      FROM tenant.quality_inspections WHERE organization_id = $1 AND inspection_type = 'final' AND created_at >= now() - interval '90 days'`, [c.organizationId])).rows[0];
  const rework = Number((await qx(client, `SELECT count(*)::int AS n FROM tenant.quality_inprocess_contexts ctx JOIN tenant.quality_inspections i ON i.id = ctx.inspection_id
      WHERE ctx.organization_id = $1 AND i.inspection_type = 'final' AND ctx.rework_required AND ctx.rework_completed_at IS NULL AND i.workflow_status <> 'CANCELLED'`, [c.organizationId])).rows[0].n);
  const lots = (await qx(client, `SELECT i.id, i.inspection_number, i.workflow_status, i.disposition_status, ctx.mo_number, ctx.batch_reference, ctx.entry_number, item.name AS item
      FROM tenant.quality_inspections i JOIN tenant.quality_inprocess_contexts ctx ON ctx.inspection_id = i.id LEFT JOIN tenant.items item ON item.id = i.item_id
     WHERE i.organization_id = $1 AND i.inspection_type = 'final' AND (i.workflow_status NOT IN ('COMPLETED', 'CANCELLED') OR (i.workflow_status = 'COMPLETED' AND i.disposition_status <> 'DECIDED'))
     ORDER BY i.created_at DESC LIMIT 12`, [c.organizationId])).rows;
  const blocked = [];
  for (const o of gates) {
    const inspection = o.inspection_id ? (await qx(client, `SELECT id, inspection_number, workflow_status FROM tenant.quality_inspections WHERE id = $1`, [o.inspection_id])).rows[0] : null;
    blocked.push({ order: o.mo_number, orderId: o.order_id, label: o.source_label, requirement: o.qcp_code, status: o.status, exception: o.exception_code, scope: "Held from finished goods",
      held: round6(Math.max(Number(o.controlled_quantity) - Number(o.allowance_quantity) - Number(o.rejected_quantity), 0)),
      inspection: inspection ? { id: inspection.id, number: inspection.inspection_number, status: WORKFLOW[inspection.workflow_status] } : null,
      href: inspection ? `/quality/final/${inspection.id}` : "/quality/control-points?view=requirements" });
  }
  return { counts, lotsOnHold: blocked.length, heldQuantity: held, awaitingAcceptance: round6(awaitingAcceptance), failed90: stats.failed, completed90: stats.completed, reworkRequired: rework,
    averageHours: stats.hours === null ? null : Math.round(Number(stats.hours) * 10) / 10,
    lots: lots.map((l) => ({ id: l.id, number: l.inspection_number, status: WORKFLOW[l.workflow_status], disposition: l.disposition_status, order: l.mo_number, lot: l.batch_reference, entry: l.entry_number, item: l.item })),
    blocked: blocked.slice(0, 50) };
}

export const FINAL_REPORTS = Object.freeze({
  register: "Final inspection register", by_order: "Inspections by production order", by_product: "Inspections by product", pending_lots: "Finished-goods lots pending QC",
  pass_rate: "Final inspection pass / fail rate", failed_characteristics: "Failed characteristics", rework: "Rework from final inspection", scrap: "Scrap from final inspection",
  partial_by_lot: "Partial acceptance by lot", fg_hold: "Finished-goods quality hold", stock_release: "Inspection-to-stock release", conditional: "Conditional acceptance / deviation",
  nonconformances: "Final inspection nonconformances", cycle_time: "Inspection cycle time", spec_usage: "Specification version usage", source_corrections: "Final inspection source corrections",
});
export async function getFinalReport(client, c, kind, filters = {}) {
  need(c, FP.view);
  if (!FINAL_REPORTS[kind]) throw inError(404, "QUALITY_INCOMING_NOT_FOUND", "Unknown report.");
  const from = filters.from ? String(filters.from).slice(0, 10) : "1900-01-01";
  const to = filters.to ? String(filters.to).slice(0, 10) : "2999-12-31";
  const base = `FROM tenant.quality_inspections i JOIN tenant.quality_inprocess_contexts ctx ON ctx.inspection_id = i.id LEFT JOIN tenant.items item ON item.id = i.item_id
     WHERE i.organization_id = $1 AND i.inspection_type = 'final' AND i.created_at >= $2::date AND i.created_at < $3::date + 1`;
  const v = [c.organizationId, from, to];
  const run = async (sql) => (await qx(client, sql, v)).rows;
  const dispositions = `FROM tenant.quality_dispositions d JOIN tenant.quality_inspections i ON i.id = d.inspection_id JOIN tenant.quality_inprocess_contexts ctx ON ctx.inspection_id = i.id
     LEFT JOIN tenant.items item ON item.id = i.item_id WHERE d.organization_id = $1 AND i.inspection_type = 'final' AND d.decided_at >= $2::date AND d.decided_at < $3::date + 1`;
  let rows;
  switch (kind) {
    case "register":
      rows = (await listIncomingInspections(client, c, { type: "final", from: filters.from, to: filters.to })).map((r) => ({ inspection: r.number, production_order: r.production?.order ?? "",
        output: r.production?.entry ?? "", lot: r.production?.run ?? "", item: r.item ? `${r.item.code} ${r.item.name}` : "", quantity: r.quantity, status: r.statusLabel, proposed: r.proposed,
        accepted: r.accepted, rejected: r.rejected })); break;
    case "by_order": rows = await run(`SELECT ctx.mo_number AS production_order, count(*)::int AS inspections, count(*) FILTER (WHERE i.proposed_outcome = 'FAIL')::int AS failed,
        COALESCE(sum(i.lot_quantity) FILTER (WHERE i.reinspection_of_id IS NULL), 0) AS inspected, COALESCE(sum(i.accepted_quantity) FILTER (WHERE i.reinspection_of_id IS NULL), 0) AS accepted,
        COALESCE(sum(i.rejected_quantity) FILTER (WHERE i.reinspection_of_id IS NULL), 0) AS rejected ${base} GROUP BY ctx.mo_number ORDER BY ctx.mo_number`); break;
    case "by_product": rows = await run(`SELECT item.code, item.name, count(*)::int AS inspections, count(*) FILTER (WHERE i.proposed_outcome = 'FAIL')::int AS failed,
        COALESCE(sum(i.accepted_quantity) FILTER (WHERE i.reinspection_of_id IS NULL), 0) AS accepted, COALESCE(sum(i.rejected_quantity) FILTER (WHERE i.reinspection_of_id IS NULL), 0) AS rejected
        ${base} GROUP BY item.code, item.name ORDER BY failed DESC, inspections DESC`); break;
    case "pending_lots": rows = (await listIncomingInspections(client, c, { type: "final" })).filter((r) => !["COMPLETED", "CANCELLED"].includes(r.status) || r.disposition !== "DECIDED")
      .filter((r) => r.status !== "CANCELLED").map((r) => ({ inspection: r.number, production_order: r.production?.order ?? "", lot: r.production?.run ?? "", item: r.item?.name ?? "",
        quantity: r.quantity, status: r.statusLabel, due: r.dueAt, overdue: r.overdue ? "Yes" : "" })); break;
    case "pass_rate": rows = await run(`SELECT to_char(g.m, 'YYYY-MM') AS month, count(*) FILTER (WHERE g.proposed_outcome = 'PASS')::int AS inspections_passed,
        count(*) FILTER (WHERE g.proposed_outcome = 'FAIL')::int AS inspections_failed, COALESCE(sum(g.accepted_quantity), 0) AS lot_level_accepted, COALESCE(sum(g.rejected_quantity), 0) AS lot_level_rejected
        FROM (SELECT date_trunc('month', i.created_at) AS m, i.proposed_outcome, i.accepted_quantity, i.rejected_quantity ${base} AND i.reinspection_of_id IS NULL) g GROUP BY g.m ORDER BY g.m`); break;
    case "failed_characteristics": rows = await run(`SELECT ch.name AS characteristic, ch.criticality, count(*)::int AS failed_observations, count(DISTINCT o.inspection_id)::int AS inspections
        FROM tenant.quality_inspection_observations o JOIN tenant.quality_inspection_characteristics ch ON ch.id = o.characteristic_id JOIN tenant.quality_inspections i ON i.id = o.inspection_id
        WHERE i.organization_id = $1 AND i.inspection_type = 'final' AND o.is_current AND o.outcome = 'FAIL' AND i.created_at >= $2::date AND i.created_at < $3::date + 1
        GROUP BY ch.name, ch.criticality ORDER BY failed_observations DESC`); break;
    case "rework": rows = await run(`SELECT d.disposition_number AS disposition, i.inspection_number AS inspection, ctx.mo_number AS production_order, ctx.batch_reference AS lot, d.rework_quantity,
        d.rework_instruction AS instruction, ri.inspection_number AS reinspection, ri.workflow_status AS reinspection_status, rc.rework_reference, ri.accepted_quantity AS accepted_after
        ${dispositions.replace("WHERE", "LEFT JOIN tenant.quality_inspections ri ON ri.id = d.reinspection_id LEFT JOIN tenant.quality_inprocess_contexts rc ON rc.inspection_id = ri.id WHERE")}
        AND d.rework_quantity > 0 ORDER BY d.decided_at DESC`); break;
    case "scrap": rows = await run(`SELECT d.disposition_number AS disposition, i.inspection_number AS inspection, ctx.mo_number AS production_order, ctx.batch_reference AS lot, d.reject_quantity AS scrap_quantity,
        d.reason, CASE WHEN d.manufacturing_decision_id IS NULL THEN 'Awaiting Manufacturing' ELSE 'Recorded by Manufacturing' END AS manufacturing
        ${dispositions} AND d.reject_route = 'SCRAP' AND d.reject_quantity > 0 ORDER BY d.decided_at DESC`); break;
    case "partial_by_lot": rows = await run(`SELECT ctx.mo_number AS production_order, ctx.batch_reference AS lot, i.inspection_number AS inspection, i.lot_quantity AS inspected,
        COALESCE(sum(d.accept_quantity), 0) AS accepted, COALESCE(sum(d.conditional_quantity), 0) AS under_deviation, COALESCE(sum(d.reject_quantity), 0) AS rejected,
        COALESCE(sum(d.rework_quantity), 0) AS rework, COALESCE(sum(d.reinspect_quantity), 0) AS reinspect
        ${base.replace("WHERE", "LEFT JOIN tenant.quality_dispositions d ON d.inspection_id = i.id WHERE")} AND i.reinspection_of_id IS NULL
        GROUP BY ctx.mo_number, ctx.batch_reference, i.inspection_number, i.lot_quantity, i.created_at ORDER BY i.created_at DESC`); break;
    case "fg_hold": rows = (await openGates(client, c, { final: true })).map((o) => ({ production_order: o.mo_number, output: o.source_label, requirement: o.qcp_code, status: o.status,
        exception: o.exception_code ?? "", held: round6(Math.max(Number(o.controlled_quantity) - Number(o.allowance_quantity) - Number(o.rejected_quantity), 0)) })).filter((r) => r.held > EPS); break;
    case "stock_release": rows = await run(`SELECT ctx.mo_number AS production_order, ctx.entry_number AS output, ctx.batch_reference AS lot, i.inspection_number AS inspection,
        o.controlled_quantity AS controlled, o.allowance_quantity AS cleared_by_quality,
        (SELECT COALESCE(sum(accepted_quantity), 0) FROM tenant.manufacturing_quality_decisions m WHERE m.production_entry_id = ctx.production_entry_id) AS accepted_by_manufacturing,
        e.received_quantity AS received_as_finished_goods, e.pending_remaining AS still_awaiting_inspection
        ${base.replace("WHERE", `JOIN tenant.quality_inspection_obligations o ON o.id = i.obligation_id LEFT JOIN tenant.manufacturing_production_entries e ON e.id = ctx.production_entry_id WHERE`)}
        AND i.reinspection_of_id IS NULL ORDER BY i.created_at DESC`); break;
    case "conditional": rows = await run(`SELECT d.disposition_number AS disposition, i.inspection_number AS inspection, ctx.batch_reference AS lot, item.name AS item, d.conditional_quantity AS quantity,
        d.conditions, d.reason, d.decided_at ${dispositions} AND d.conditional_quantity > 0 ORDER BY d.decided_at DESC`); break;
    case "nonconformances": rows = await run(`SELECT nc.nonconformance_number AS nonconformance, i.inspection_number AS inspection, ctx.mo_number AS production_order, ctx.batch_reference AS lot, nc.severity,
        nc.status, nc.description FROM tenant.quality_nonconformances nc JOIN tenant.quality_inspections i ON i.id = nc.inspection_id JOIN tenant.quality_inprocess_contexts ctx ON ctx.inspection_id = i.id
        WHERE nc.organization_id = $1 AND i.inspection_type = 'final' AND nc.created_at >= $2::date AND nc.created_at < $3::date + 1 ORDER BY nc.created_at DESC`); break;
    case "cycle_time": rows = await run(`SELECT i.inspection_number AS inspection, ctx.mo_number AS production_order, i.created_at, i.started_at, i.submitted_at, i.completed_at,
        round(EXTRACT(EPOCH FROM i.completed_at - i.created_at) / 3600, 1) AS hours_to_complete,
        round(EXTRACT(EPOCH FROM (SELECT min(decided_at) FROM tenant.quality_dispositions d WHERE d.inspection_id = i.id) - i.created_at) / 3600, 1) AS hours_to_first_decision
        ${base} ORDER BY i.created_at DESC`); break;
    case "spec_usage": rows = await run(`SELECT s.specification_code AS specification, sv.version_number AS version, count(*)::int AS inspections, min(i.created_at) AS first_used, max(i.created_at) AS last_used
        ${base.replace("WHERE", "JOIN tenant.quality_inspection_spec_versions sv ON sv.id = i.spec_version_id JOIN tenant.quality_inspection_specifications s ON s.id = sv.specification_id WHERE")}
        GROUP BY s.specification_code, sv.version_number ORDER BY s.specification_code, sv.version_number`); break;
    case "source_corrections": rows = await run(`SELECT i.inspection_number AS inspection, ctx.mo_number AS production_order, ctx.entry_number AS output, e.payload->>'reason' AS correction, e.occurred_at
        FROM tenant.quality_events e JOIN tenant.quality_inspections i ON i.id = e.aggregate_id JOIN tenant.quality_inprocess_contexts ctx ON ctx.inspection_id = i.id
        WHERE e.organization_id = $1 AND i.inspection_type = 'final' AND e.event_type = 'quality.inprocess.source_corrected' AND e.occurred_at >= $2::date AND e.occurred_at < $3::date + 1
        ORDER BY e.occurred_at DESC`); break;
    default: rows = [];
  }
  return { kind, title: FINAL_REPORTS[kind], rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, val]) => [k, typeof val === "string" && /^-?\d+\.\d+$/.test(val) ? Number(val) : val]))) };
}
export async function exportFinalReport(client, c, kind = "register", filters = {}) {
  need(c, FP.export);
  const report = await getFinalReport(client, c, kind, filters);
  const columns = [...new Set(report.rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [columns.join(","), ...report.rows.map((r) => columns.map((k) => cell(r[k])).join(","))].join("\n");
  return { fileName: `final-${kind.replace(/_/g, "-")}.csv`, mimeType: "text/csv", body };
}
export async function listFinalOptions(client, c) {
  need(c, FP.view);
  const { listInProcessOptions } = await import("./ip-read.js");
  const base = await listInProcessOptions(client, { ...c, permissions: [...(c.permissions ?? []), "quality.inprocess.view", ...(has(c, FP.create) ? ["quality.inprocess.create"] : [])] });
  const inspectors = (await qx(client, `SELECT DISTINCT u.id, u.full_name FROM organization_memberships m JOIN public.users u ON u.id = m.user_id
      JOIN user_role_assignments a ON a.organization_id = m.organization_id AND a.user_id = m.user_id AND a.status = 'active'
      JOIN roles r ON r.id = a.role_id AND r.status = 'active' LEFT JOIN role_permissions p ON p.role_id = r.id AND p.permission_key = $2
     WHERE m.organization_id = $1 AND m.status = 'active' AND (p.permission_key IS NOT NULL OR r.slug = 'organization_owner') ORDER BY u.full_name`, [c.organizationId, FP.start])).rows;
  return { ...base, inspectors: inspectors.map((u) => ({ value: u.id, label: u.full_name })), reports: Object.entries(FINAL_REPORTS).map(([value, label]) => ({ value, label })), canCreate: has(c, FP.create) };
}
