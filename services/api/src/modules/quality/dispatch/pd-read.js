// Quality — Inspection Linked to Delivery: reading. The delivery status of one inspection (the gate, the delivery as Sales records it, the
// hold case Inventory keeps), the dashboard, the exceptions, the reports and their export, and the options. One inspection and its queues
// are the shared reads (../incoming/in-read.js) with type "pre_dispatch".
import { qx } from "../common.js";
import { DP, WORKFLOW, has, inError, need, round6 } from "../incoming/in-rules.js";

const n = (v) => (v === null || v === undefined ? null : Number(v));
const STATUS_LABEL = { draft: "Draft", ready: "Ready to dispatch", dispatched: "Dispatched", delivered: "Delivered", cancelled: "Cancelled" };

// The requirements on undispatched deliveries that still hold something back (or are an exception that clears nothing).
async function openGates(client, c) {
  return (await qx(client, `SELECT o.*, p.qcp_code, d.request_number, d.delivery_status, d.id AS delivery_id FROM tenant.quality_inspection_obligations o
      JOIN tenant.quality_control_points p ON p.id = o.control_point_id JOIN tenant.sales_fulfillment_requests d ON d.id = o.source_document_id
     WHERE o.organization_id = $1 AND o.source_type = 'sales_delivery_line' AND o.blocking AND o.status IN ('PENDING', 'EXCEPTION') AND d.delivery_status IN ('draft', 'ready')
     ORDER BY o.created_at`, [c.organizationId])).rows;
}

// What the inspected delivery line is allowed and what happened to it, read from Sales, the requirement and Inventory — never stored here.
export async function dispatchStatus(client, c, row) {
  const ctx = (await qx(client, `SELECT * FROM tenant.quality_dispatch_contexts WHERE inspection_id = $1`, [row.id])).rows[0];
  if (!ctx) return null;
  const delivery = (await qx(client, `SELECT d.id, d.request_number, d.delivery_status, d.dispatched_at, line.quantity, line.base_quantity, line.item_name_snapshot
      FROM tenant.sales_fulfillment_requests d LEFT JOIN tenant.sales_delivery_lines line ON line.delivery_id = d.id AND line.sales_order_line_id = $2 WHERE d.id = $1`,
  [ctx.delivery_id, ctx.sales_order_line_id])).rows[0];
  let root = row;
  for (let i = 0; i < 20 && root.reinspection_of_id; i += 1) root = (await qx(client, `SELECT * FROM tenant.quality_inspections WHERE id = $1`, [root.reinspection_of_id])).rows[0];
  const ob = (root.obligation_id ?? row.obligation_id) ? (await qx(client, `SELECT * FROM tenant.quality_inspection_obligations WHERE id = $1`, [root.obligation_id ?? row.obligation_id])).rows[0] : null;
  const holds = (await qx(client, `SELECT h.id, h.document_number, h.status, d.disposition_number, d.reject_quantity,
        (SELECT COALESCE(sum(unresolved_base_quantity), 0) FROM tenant.inventory_stock_hold_lines l WHERE l.hold_id = h.id) AS unresolved
      FROM tenant.quality_dispositions d JOIN tenant.inventory_stock_holds h ON h.id = d.stock_hold_id WHERE d.inspection_id IN (SELECT id FROM tenant.quality_inspections WHERE id = $1 OR reinspection_of_id = $1 OR id = $2)
      ORDER BY h.created_at`, [row.id, root.id])).rows;
  const line = delivery ? round6(Number(delivery.base_quantity ?? delivery.quantity)) : null;
  return {
    delivery: delivery ? { id: delivery.id, number: delivery.request_number, status: delivery.delivery_status, statusLabel: STATUS_LABEL[delivery.delivery_status] ?? delivery.delivery_status,
      dispatchedAt: delivery.dispatched_at, lineQuantity: line } : null,
    context: { order: ctx.order_number, orderId: ctx.sales_order_id, customer: ctx.customer_name, checkpoint: ctx.checkpoint_type, inspected: n(ctx.line_quantity) },
    gate: ob ? { requirement: (await qx(client, `SELECT qcp_code FROM tenant.quality_control_points WHERE id = $1`, [ob.control_point_id])).rows[0]?.qcp_code ?? null, status: ob.status,
      label: ob.outcome_label, blocking: ob.blocking, controlled: n(ob.controlled_quantity), cleared: n(ob.allowance_quantity), rejected: n(ob.rejected_quantity),
      shippable: line === null ? null : round6(Math.min(line, Number(ob.allowance_quantity ?? 0))), blockedNow: line === null ? null : round6(Math.max(line - Number(ob.allowance_quantity ?? 0), 0)) } : null,
    holds: holds.map((h) => ({ id: h.id, number: h.document_number, status: h.status, disposition: h.disposition_number, rejected: n(h.reject_quantity), unresolved: n(h.unresolved) })),
  };
}

export async function getDispatchDashboard(client, c) {
  need(c, DP.view);
  const { getIncomingCounts } = await import("../incoming/in-read.js");
  const counts = await getIncomingCounts(client, c, { type: "pre_dispatch" });
  const gates = await openGates(client, c);
  const deliveries = new Set(gates.map((o) => o.delivery_id));
  const held = round6(gates.reduce((sum, o) => sum + Math.max(Number(o.controlled_quantity) - Number(o.allowance_quantity) - Number(o.rejected_quantity), 0), 0));
  const rejected = (await qx(client, `SELECT count(*) FILTER (WHERE h.id IS NULL OR h.status = 'draft')::int AS unheld, COALESCE(sum(d.reject_quantity), 0) AS quantity
      FROM tenant.quality_dispositions d JOIN tenant.quality_inspections i ON i.id = d.inspection_id LEFT JOIN tenant.inventory_stock_holds h ON h.id = d.stock_hold_id
     WHERE d.organization_id = $1 AND i.inspection_type = 'pre_dispatch' AND d.reject_quantity > 0`, [c.organizationId])).rows[0];
  const stats = (await qx(client, `SELECT count(*) FILTER (WHERE proposed_outcome = 'FAIL')::int AS failed, count(*) FILTER (WHERE workflow_status = 'COMPLETED')::int AS completed,
      avg(EXTRACT(EPOCH FROM completed_at - created_at) / 3600) FILTER (WHERE completed_at IS NOT NULL) AS hours
      FROM tenant.quality_inspections WHERE organization_id = $1 AND inspection_type = 'pre_dispatch' AND created_at >= now() - interval '90 days'`, [c.organizationId])).rows[0];
  const blocked = [];
  for (const o of gates) {
    const inspection = o.inspection_id ? (await qx(client, `SELECT id, inspection_number, workflow_status FROM tenant.quality_inspections WHERE id = $1`, [o.inspection_id])).rows[0] : null;
    blocked.push({ delivery: o.request_number, deliveryId: o.delivery_id, label: o.source_label, requirement: o.qcp_code, status: o.status, exception: o.exception_code,
      held: round6(Math.max(Number(o.controlled_quantity) - Number(o.allowance_quantity) - Number(o.rejected_quantity), 0)),
      inspection: inspection ? { id: inspection.id, number: inspection.inspection_number, status: WORKFLOW[inspection.workflow_status] } : null,
      href: inspection ? `/quality/dispatch/${inspection.id}` : "/quality/control-points?view=requirements" });
  }
  return { counts, deliveriesBlocked: deliveries.size, heldQuantity: held, rejectedQuantity: round6(Number(rejected.quantity)), rejectedNotHeld: rejected.unheld,
    failed90: stats.failed, completed90: stats.completed, averageHours: stats.hours === null ? null : Math.round(Number(stats.hours) * 10) / 10, blocked: blocked.slice(0, 50) };
}

// Deliveries held by a configuration exception, inspections needing recovery, and rejected units Inventory has not yet put on hold.
export async function listDispatchExceptions(client, c) {
  need(c, DP.view);
  const out = [];
  const exceptions = (await qx(client, `SELECT o.id, o.source_label, o.exception_code, o.created_at, p.qcp_code FROM tenant.quality_inspection_obligations o
      JOIN tenant.quality_control_points p ON p.id = o.control_point_id WHERE o.organization_id = $1 AND o.status = 'EXCEPTION' AND o.source_type = 'sales_delivery_line'`, [c.organizationId])).rows;
  for (const e of exceptions) out.push({ kind: e.exception_code === "RULE_CONFLICT" ? "CONFLICT" : "SPEC_MISSING", label: `${e.source_label}: ${e.exception_code === "RULE_CONFLICT" ? "two control points conflict" : "no approved specification"} (${e.qcp_code}) — the line can't be dispatched`,
    href: "/quality/control-points?view=requirements", at: e.created_at });
  const recovery = (await qx(client, `SELECT id, inspection_number, updated_at FROM tenant.quality_inspections WHERE organization_id = $1 AND inspection_type = 'pre_dispatch' AND workflow_status = 'RECOVERY_REQUIRED'`,
    [c.organizationId])).rows;
  for (const r of recovery) out.push({ kind: "RECOVERY", label: `${r.inspection_number}: needs recovery`, href: `/quality/dispatch/${r.id}`, at: r.updated_at });
  const unheld = (await qx(client, `SELECT d.disposition_number, d.reject_quantity, d.decided_at, i.id, i.inspection_number, h.document_number FROM tenant.quality_dispositions d
      JOIN tenant.quality_inspections i ON i.id = d.inspection_id LEFT JOIN tenant.inventory_stock_holds h ON h.id = d.stock_hold_id
     WHERE d.organization_id = $1 AND i.inspection_type = 'pre_dispatch' AND d.reject_quantity > 0 AND (h.id IS NULL OR h.status = 'draft')`, [c.organizationId])).rows;
  for (const r of unheld) out.push({ kind: "REJECTED_NOT_HELD", label: `${r.disposition_number} (${r.inspection_number}): ${Number(r.reject_quantity)} rejected ${r.document_number ? `— hold ${r.document_number} not yet placed` : "— not yet on an Inventory hold"}`,
    href: `/quality/dispatch/${r.id}`, at: r.decided_at });
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// ------------------------------------------------------------------ reports
export const DISPATCH_REPORTS = Object.freeze({
  register: "Pre-dispatch inspection register", by_customer: "Inspections by customer", by_delivery: "Inspections by delivery", pending: "Pending / overdue inspections",
  blocked: "Deliveries held by Quality", failed_characteristics: "Failed characteristics", rejected: "Rejected units and their holds", conditional: "Shipped under deviation",
  nonconformances: "Pre-dispatch nonconformances", reconciliation: "Delivery and Quality reconciliation",
});
export async function getDispatchReport(client, c, kind, filters = {}) {
  need(c, DP.view);
  if (!DISPATCH_REPORTS[kind]) throw inError(404, "QUALITY_INCOMING_NOT_FOUND", "Unknown report.");
  const from = filters.from ? String(filters.from).slice(0, 10) : "1900-01-01";
  const to = filters.to ? String(filters.to).slice(0, 10) : "2999-12-31";
  const base = `FROM tenant.quality_inspections i JOIN tenant.quality_dispatch_contexts ctx ON ctx.inspection_id = i.id LEFT JOIN tenant.items item ON item.id = i.item_id
     WHERE i.organization_id = $1 AND i.inspection_type = 'pre_dispatch' AND i.created_at >= $2::date AND i.created_at < $3::date + 1`;
  const dispositions = `FROM tenant.quality_dispositions d JOIN tenant.quality_inspections i ON i.id = d.inspection_id JOIN tenant.quality_dispatch_contexts ctx ON ctx.inspection_id = i.id
     LEFT JOIN tenant.items item ON item.id = i.item_id WHERE d.organization_id = $1 AND i.inspection_type = 'pre_dispatch' AND d.decided_at >= $2::date AND d.decided_at < $3::date + 1`;
  const v = [c.organizationId, from, to];
  const run = async (sql) => (await qx(client, sql, v)).rows;
  let rows;
  switch (kind) {
    case "register": rows = await run(`SELECT i.inspection_number AS inspection, ctx.delivery_number AS delivery, ctx.order_number AS sales_order, ctx.customer_name AS customer, item.name AS item,
        i.lot_quantity AS quantity, i.workflow_status AS status, i.proposed_outcome AS proposed, i.accepted_quantity AS accepted, i.rejected_quantity AS rejected, i.created_at ${base} ORDER BY i.created_at DESC`); break;
    case "by_customer": rows = await run(`SELECT ctx.customer_name AS customer, count(*)::int AS inspections, count(*) FILTER (WHERE i.proposed_outcome = 'FAIL')::int AS failed,
        COALESCE(sum(i.accepted_quantity) FILTER (WHERE i.reinspection_of_id IS NULL), 0) AS accepted, COALESCE(sum(i.rejected_quantity) FILTER (WHERE i.reinspection_of_id IS NULL), 0) AS rejected
        ${base} GROUP BY ctx.customer_name ORDER BY failed DESC, inspections DESC`); break;
    case "by_delivery": rows = await run(`SELECT ctx.delivery_number AS delivery, ctx.order_number AS sales_order, ctx.customer_name AS customer, count(*)::int AS inspections,
        count(*) FILTER (WHERE i.proposed_outcome = 'FAIL')::int AS failed, COALESCE(sum(i.lot_quantity) FILTER (WHERE i.reinspection_of_id IS NULL), 0) AS inspected
        ${base} GROUP BY ctx.delivery_number, ctx.order_number, ctx.customer_name ORDER BY ctx.delivery_number`); break;
    case "pending": rows = await run(`SELECT i.inspection_number AS inspection, ctx.delivery_number AS delivery, ctx.customer_name AS customer, item.name AS item, i.lot_quantity AS quantity,
        i.workflow_status AS status, i.due_at AS due, CASE WHEN i.due_at < now() THEN 'Yes' ELSE '' END AS overdue ${base}
        AND (i.workflow_status NOT IN ('COMPLETED', 'CANCELLED') OR (i.workflow_status = 'COMPLETED' AND i.disposition_status <> 'DECIDED')) ORDER BY i.due_at NULLS LAST`); break;
    case "blocked": rows = (await openGates(client, c)).map((o) => ({ delivery: o.request_number, line: o.source_label, requirement: o.qcp_code, status: o.status, exception: o.exception_code ?? "",
        held: round6(Math.max(Number(o.controlled_quantity) - Number(o.allowance_quantity) - Number(o.rejected_quantity), 0)) })); break;
    case "failed_characteristics": rows = await run(`SELECT ch.name AS characteristic, ch.criticality, count(*)::int AS failed_observations, count(DISTINCT o.inspection_id)::int AS inspections
        FROM tenant.quality_inspection_observations o JOIN tenant.quality_inspection_characteristics ch ON ch.id = o.characteristic_id JOIN tenant.quality_inspections i ON i.id = o.inspection_id
        WHERE i.organization_id = $1 AND i.inspection_type = 'pre_dispatch' AND o.is_current AND o.outcome = 'FAIL' AND i.created_at >= $2::date AND i.created_at < $3::date + 1
        GROUP BY ch.name, ch.criticality ORDER BY failed_observations DESC`); break;
    case "rejected": rows = await run(`SELECT d.disposition_number AS disposition, i.inspection_number AS inspection, ctx.delivery_number AS delivery, item.name AS item, d.reject_quantity AS rejected,
        h.document_number AS hold, COALESCE(h.status, 'not opened') AS hold_status, d.reason
        ${dispositions.replace("WHERE", "LEFT JOIN tenant.inventory_stock_holds h ON h.id = d.stock_hold_id WHERE")} AND d.reject_quantity > 0 ORDER BY d.decided_at DESC`); break;
    case "conditional": rows = await run(`SELECT d.disposition_number AS disposition, i.inspection_number AS inspection, ctx.delivery_number AS delivery, ctx.customer_name AS customer, item.name AS item,
        d.conditional_quantity AS quantity, d.conditions, d.reason, d.decided_at ${dispositions} AND d.conditional_quantity > 0 ORDER BY d.decided_at DESC`); break;
    case "nonconformances": rows = await run(`SELECT nc.nonconformance_number AS nonconformance, i.inspection_number AS inspection, ctx.delivery_number AS delivery, ctx.customer_name AS customer, nc.severity,
        nc.status, nc.description FROM tenant.quality_nonconformances nc JOIN tenant.quality_inspections i ON i.id = nc.inspection_id JOIN tenant.quality_dispatch_contexts ctx ON ctx.inspection_id = i.id
        WHERE nc.organization_id = $1 AND i.inspection_type = 'pre_dispatch' AND nc.created_at >= $2::date AND nc.created_at < $3::date + 1 ORDER BY nc.created_at DESC`); break;
    case "reconciliation": rows = await run(`SELECT ctx.delivery_number AS delivery, item.name AS item, i.inspection_number AS inspection, o.controlled_quantity AS inspected, o.allowance_quantity AS cleared_by_quality,
        o.rejected_quantity AS rejected_by_quality, COALESCE(line.base_quantity, line.quantity) AS on_delivery_line, d.delivery_status,
        CASE WHEN d.delivery_status IN ('dispatched', 'delivered') THEN COALESCE(line.base_quantity, line.quantity) ELSE 0 END AS dispatched
        ${base.replace("WHERE", `JOIN tenant.quality_inspection_obligations o ON o.id = i.obligation_id LEFT JOIN tenant.sales_delivery_lines line ON line.delivery_id = ctx.delivery_id AND line.sales_order_line_id = ctx.sales_order_line_id
          LEFT JOIN tenant.sales_fulfillment_requests d ON d.id = ctx.delivery_id WHERE`)} AND i.reinspection_of_id IS NULL ORDER BY i.created_at DESC`); break;
    default: rows = [];
  }
  return { kind, title: DISPATCH_REPORTS[kind], rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, val]) => [k, typeof val === "string" && /^-?\d+\.\d+$/.test(val) ? Number(val) : val]))) };
}
export async function exportDispatchReport(client, c, kind = "register", filters = {}) {
  need(c, DP.export);
  const report = await getDispatchReport(client, c, kind, filters);
  const columns = [...new Set(report.rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [columns.join(","), ...report.rows.map((r) => columns.map((k) => cell(r[k])).join(","))].join("\n");
  return { fileName: `pre-dispatch-${kind.replace(/_/g, "-")}.csv`, mimeType: "text/csv", body };
}

// What the screens offer: inspectors, delivery lines not yet dispatched (for a manual request), vocabularies and reports.
export async function listDispatchOptions(client, c) {
  need(c, DP.view);
  const inspectors = (await qx(client, `SELECT DISTINCT u.id, u.full_name FROM organization_memberships m JOIN public.users u ON u.id = m.user_id
      JOIN user_role_assignments a ON a.organization_id = m.organization_id AND a.user_id = m.user_id AND a.status = 'active'
      JOIN roles r ON r.id = a.role_id AND r.status = 'active' LEFT JOIN role_permissions p ON p.role_id = r.id AND p.permission_key = $2
     WHERE m.organization_id = $1 AND m.status = 'active' AND (p.permission_key IS NOT NULL OR r.slug = 'organization_owner') ORDER BY u.full_name`, [c.organizationId, DP.start])).rows;
  const lines = has(c, DP.create) ? (await qx(client, `SELECT line.id, line.item_name_snapshot, COALESCE(line.base_quantity, line.quantity) AS quantity, d.request_number, p.display_name AS customer
      FROM tenant.sales_delivery_lines line JOIN tenant.sales_fulfillment_requests d ON d.id = line.delivery_id JOIN tenant.items item ON item.id = line.item_id
      LEFT JOIN tenant.business_parties p ON p.id = d.party_id
     WHERE line.organization_id = $1 AND d.delivery_status IN ('draft', 'ready') AND COALESCE(item.track_inventory, false) AND item.item_type <> 'service'
     ORDER BY d.requested_at DESC NULLS LAST LIMIT 300`, [c.organizationId])).rows : [];
  return {
    inspectors: inspectors.map((u) => ({ value: u.id, label: u.full_name })),
    deliveryLines: lines.map((l) => ({ value: l.id, label: `${l.request_number} · ${l.customer ?? ""} · ${l.item_name_snapshot} · ${Number(l.quantity)}`, quantity: Number(l.quantity) })),
    priorities: [{ value: "URGENT", label: "Urgent" }, { value: "HIGH", label: "High" }, { value: "NORMAL", label: "Normal" }, { value: "LOW", label: "Low" }],
    reports: Object.entries(DISPATCH_REPORTS).map(([value, label]) => ({ value, label })),
    canCreate: has(c, DP.create),
  };
}
