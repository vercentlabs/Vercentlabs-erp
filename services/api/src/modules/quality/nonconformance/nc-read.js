// Quality — Nonconformance (NCR): reading. The queues with their counts, one NCR (affected items, the source inspection and its failed
// observations, containment, investigation, actions, verification, dependencies — the ones recorded here and the ones derived from the
// inspection's dispositions: rejection cases and Inventory hold cases —, evidence, history and the actions the person may take), the
// dashboard, the reports and their export, and the options.
import { listFiles } from "../../../core/platform/files/index.js";
import { qx } from "../common.js";
import { ACTION_TYPES, ACTIVE, LINK_TYPES, METHODS, NC, SEVERITY, SOURCES, STATUS, has, ncError, need, text, uuid } from "./nc-rules.js";

const n = (v) => (v === null || v === undefined ? null : Number(v));
const VIEWS = {
  open: "nc.status IN ('OPEN', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'VERIFICATION_PENDING')",
  mine: "nc.owner_user_id = $2 AND nc.status IN ('OPEN', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'VERIFICATION_PENDING')",
  new: "nc.status = 'OPEN'",
  review: "nc.status = 'UNDER_REVIEW'",
  action: "nc.status = 'ACTION_REQUIRED'",
  verification: "nc.status = 'VERIFICATION_PENDING'",
  resolved: "nc.status = 'RESOLVED'",
  closed: "nc.status = 'CLOSED'",
  overdue: "nc.due_date < current_date AND nc.status IN ('OPEN', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'VERIFICATION_PENDING')",
  critical: "nc.severity = 'critical' AND nc.status NOT IN ('CLOSED', 'CANCELLED')",
  cancelled: "nc.status = 'CANCELLED'",
};
const LIST_SELECT = `SELECT nc.*, owner.full_name AS owner_name, item.code AS item_code, item.name AS item_name, party.display_name AS supplier_name, i.inspection_number, i.inspection_type,
       (SELECT count(*) FROM tenant.quality_nonconformance_actions a WHERE a.nonconformance_id = nc.id AND a.status = 'OPEN')::int AS open_actions,
       (SELECT count(*) FROM tenant.quality_nonconformance_actions a WHERE a.nonconformance_id = nc.id AND a.status = 'OPEN' AND a.due_date < current_date)::int AS overdue_actions
  FROM tenant.quality_nonconformances nc
  LEFT JOIN public.users owner ON owner.id = nc.owner_user_id
  LEFT JOIN tenant.items item ON item.id = nc.item_id
  LEFT JOIN tenant.procurement_suppliers sup ON sup.id = nc.supplier_id
  LEFT JOIN tenant.business_parties party ON party.id = sup.party_id
  LEFT JOIN tenant.quality_inspections i ON i.id = nc.inspection_id`;
const KIND_ROUTE = { incoming: "incoming", in_process: "in-process", final: "final", pre_dispatch: "dispatch" };
function listView(row) {
  return {
    id: row.id, number: row.nonconformance_number, title: row.title ?? row.description?.slice(0, 120), status: row.status, statusLabel: STATUS[row.status] ?? row.status,
    severity: row.severity, severityLabel: SEVERITY[row.severity] ?? row.severity, source: row.source_type, sourceLabel: row.source_label ?? SOURCES[row.source_type] ?? row.source_type,
    item: row.item_id ? { id: row.item_id, code: row.item_code, name: row.item_name } : null, supplier: row.supplier_name ?? null,
    inspection: row.inspection_id ? { id: row.inspection_id, number: row.inspection_number, href: `/quality/${KIND_ROUTE[row.inspection_type] ?? "incoming"}/${row.inspection_id}` } : null,
    owner: row.owner_user_id ? { id: row.owner_user_id, name: row.owner_name } : null, affected: n(row.affected_quantity), dueDate: row.due_date,
    overdue: Boolean(row.due_date && ACTIVE.includes(row.status) && new Date(row.due_date) < new Date(new Date().toDateString())), openActions: row.open_actions ?? 0,
    overdueActions: row.overdue_actions ?? 0, detectedAt: row.detected_at ?? row.created_at, closedAt: row.closed_at, reopened: row.reopened_count ?? 0,
  };
}

// filters: view, search, severity, from, to
export async function listNonconformances(client, c, filters = {}) {
  need(c, NC.view, NC.manage);
  const values = [c.organizationId, c.userId ?? null];
  const where = ["nc.organization_id = $1"];
  if (VIEWS[filters.view]) where.push(VIEWS[filters.view]);
  if (filters.severity && SEVERITY[filters.severity]) { values.push(filters.severity); where.push(`nc.severity = $${values.length}`); }
  if (filters.status && STATUS[filters.status]) { values.push(filters.status); where.push(`nc.status = $${values.length}`); }
  if (filters.from) { values.push(String(filters.from).slice(0, 10)); where.push(`nc.created_at >= $${values.length}::date`); }
  if (filters.to) { values.push(String(filters.to).slice(0, 10)); where.push(`nc.created_at < $${values.length}::date + 1`); }
  if (filters.search) {
    values.push(`%${text(filters.search, 100)}%`);
    const at = `$${values.length}`;
    where.push(`(nc.nonconformance_number ILIKE ${at} OR nc.title ILIKE ${at} OR nc.description ILIKE ${at} OR item.name ILIKE ${at} OR item.code ILIKE ${at} OR party.display_name ILIKE ${at} OR i.inspection_number ILIKE ${at})`);
  }
  const rows = (await qx(client, `${LIST_SELECT} WHERE ${where.join(" AND ")} AND ($2::uuid IS NULL OR $2::uuid IS NOT NULL)
      ORDER BY CASE nc.severity WHEN 'critical' THEN 0 WHEN 'major' THEN 1 ELSE 2 END, nc.due_date NULLS LAST, nc.created_at DESC LIMIT 500`, values)).rows;
  return rows.map(listView);
}
export async function getNonconformanceCounts(client, c) {
  need(c, NC.view, NC.manage);
  const parts = Object.entries(VIEWS).map(([key, sql]) => `count(*) FILTER (WHERE ${sql})::int AS ${key}`).join(", ");
  return (await qx(client, `SELECT ${parts} FROM tenant.quality_nonconformances nc WHERE nc.organization_id = $1 AND ($2::uuid IS NULL OR $2::uuid IS NOT NULL)`,
    [c.organizationId, c.userId ?? null])).rows[0];
}

// ------------------------------------------------------------------ one NCR
export async function getNonconformance(client, c, idValue) {
  need(c, NC.view, NC.manage);
  const row = (await qx(client, `${LIST_SELECT} WHERE nc.organization_id = $1 AND nc.id = $2`, [c.organizationId, uuid(idValue, "Nonconformance")])).rows[0];
  if (!row) throw ncError(404, "QUALITY_NC_NOT_FOUND");
  const people = async (ids) => {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return new Map();
    return new Map((await qx(client, `SELECT id, full_name FROM public.users WHERE id = ANY($1::uuid[])`, [list])).rows.map((u) => [u.id, u.full_name]));
  };
  const items = (await qx(client, `SELECT x.*, item.code, item.name, b.batch_number, s.serial_number, w.code AS warehouse_code FROM tenant.quality_nonconformance_items x
      LEFT JOIN tenant.items item ON item.id = x.item_id LEFT JOIN tenant.stock_batches b ON b.id = x.batch_id LEFT JOIN tenant.stock_serials s ON s.id = x.serial_id
      LEFT JOIN tenant.warehouses w ON w.id = x.warehouse_id WHERE x.nonconformance_id = $1 ORDER BY x.created_at`, [row.id])).rows;
  const actions = (await qx(client, `SELECT * FROM tenant.quality_nonconformance_actions WHERE nonconformance_id = $1 ORDER BY sequence`, [row.id])).rows;
  const links = (await qx(client, `SELECT * FROM tenant.quality_nonconformance_links WHERE nonconformance_id = $1 ORDER BY created_at`, [row.id])).rows;
  // Derived from the dispositions that raised or linked this NCR: what Procurement and Inventory are doing with the affected goods.
  const derived = (await qx(client, `SELECT d.disposition_number, d.decision, d.reject_quantity, rj.id AS rejection_id, rj.rejection_number, rj.status AS rejection_status,
        h.id AS hold_id, h.document_number AS hold_number, h.status AS hold_status
      FROM tenant.quality_dispositions d LEFT JOIN tenant.receiving_rejections rj ON rj.id = d.rejection_id LEFT JOIN tenant.inventory_stock_holds h ON h.id = d.stock_hold_id
     WHERE d.organization_id = $1 AND d.nonconformance_id = $2 ORDER BY d.decided_at`, [c.organizationId, row.id])).rows;
  const observations = row.observation_ids?.length ? (await qx(client, `SELECT o.id, o.outcome, o.outcome_reason, o.numeric_value, o.boolean_value, o.choice, o.judgement, ch.name AS characteristic,
        ch.criticality, s.sample_code FROM tenant.quality_inspection_observations o JOIN tenant.quality_inspection_characteristics ch ON ch.id = o.characteristic_id
        LEFT JOIN tenant.quality_inspection_samples s ON s.id = o.sample_id WHERE o.id = ANY($1::uuid[])`, [row.observation_ids])).rows : [];
  const history = (await qx(client, `SELECT e.event_type, e.payload, e.occurred_at, u.full_name AS actor FROM tenant.quality_events e LEFT JOIN public.users u ON u.id = e.actor_user_id
      WHERE e.organization_id = $1 AND e.aggregate_type = 'nonconformance' AND e.aggregate_id = $2 ORDER BY e.occurred_at DESC`, [c.organizationId, row.id])).rows;
  const files = await listFiles(client, { organizationId: c.organizationId, entityType: "quality.nonconformance", entityId: row.id });
  const who = await people([row.detected_by, row.contained_by, row.investigated_by, row.verified_by, row.resolved_by, row.closed_by,
    ...actions.flatMap((a) => [a.owner_user_id, a.completed_by, a.verified_by]), ...links.map((l) => l.done_by)]);
  const open = actions.filter((a) => a.status === "OPEN");
  const s = row.status;
  const manage = has(c, NC.manage);
  const ownedOpen = open.some((a) => a.owner_user_id === c.userId);
  return {
    ...listView(row), description: row.description, category: row.category, defectCode: row.defect_code, detected: n(row.detected_quantity), rowVersion: row.row_version,
    detectedBy: who.get(row.detected_by) ?? null,
    containment: row.containment_action ? { action: row.containment_action, due: row.containment_due, at: row.contained_at, by: who.get(row.contained_by) ?? null } : null,
    investigation: row.root_cause ? { rootCause: row.root_cause, method: row.root_cause_method, methodLabel: METHODS[row.root_cause_method] ?? null, summary: row.investigation_summary,
      at: row.investigated_at, by: who.get(row.investigated_by) ?? null } : null,
    verification: row.verified_at || row.verification_summary ? { summary: row.verification_summary, at: row.verified_at, by: who.get(row.verified_by) ?? null } : null,
    resolution: row.resolution_summary ? { summary: row.resolution_summary, at: row.resolved_at, by: who.get(row.resolved_by) ?? null } : null,
    closure: row.closed_at ? { note: row.closure_note ?? row.cancel_reason, at: row.closed_at, by: who.get(row.closed_by) ?? null } : null,
    items: items.map((x) => ({ id: x.id, item: x.item_id ? `${x.code} · ${x.name}` : null, batch: x.batch_number, serial: x.serial_number, warehouse: x.warehouse_code, quantity: n(x.quantity),
      description: x.description })),
    observations: observations.map((o) => ({ id: o.id, sample: o.sample_code, characteristic: o.characteristic, criticality: o.criticality, outcome: o.outcome, reason: o.outcome_reason,
      value: o.numeric_value !== null ? String(Number(o.numeric_value)) : o.boolean_value !== null ? String(o.boolean_value) : o.choice ?? o.judgement ?? null })),
    actions: actions.map((a) => ({ id: a.id, sequence: a.sequence, type: a.action_type, typeLabel: ACTION_TYPES[a.action_type], description: a.description, owner: who.get(a.owner_user_id) ?? null,
      ownerId: a.owner_user_id, dueDate: a.due_date, status: a.status, overdue: a.status === "OPEN" && Boolean(a.due_date) && new Date(a.due_date) < new Date(new Date().toDateString()),
      completedBy: who.get(a.completed_by) ?? null, completedAt: a.completed_at, note: a.completion_note, evidence: a.evidence_file_ids ?? [], effectiveness: a.effectiveness,
      verifiedBy: who.get(a.verified_by) ?? null, verifiedAt: a.verified_at, cancelReason: a.cancel_reason })),
    dependencies: [
      ...links.map((l) => ({ id: l.id, kind: "LINK", type: l.link_type, label: LINK_TYPES[l.link_type], reference: l.reference, note: l.note, blocking: l.blocks_closure, status: l.status,
        doneBy: who.get(l.done_by) ?? null, doneAt: l.done_at, doneNote: l.done_note, href: null })),
      ...derived.filter((d) => d.rejection_id).map((d) => ({ id: d.rejection_id, kind: "REJECTION", type: "REJECTION_CASE", label: "Procurement rejection case", reference: d.rejection_number,
        note: `From ${d.disposition_number}`, blocking: false, status: d.rejection_status, href: null })),
      ...derived.filter((d) => d.hold_id).map((d) => ({ id: d.hold_id, kind: "HOLD", type: "STOCK_HOLD", label: "Inventory quality hold", reference: d.hold_number, note: `From ${d.disposition_number}`,
        blocking: false, status: d.hold_status, href: `/inventory/quality-holds/${d.hold_id}` })),
    ],
    files,
    history: history.map((e) => ({ type: e.event_type, label: EVENT_LABEL[e.event_type] ?? e.event_type.replace(/^quality\.nonconformance\./, "").replace(/_/g, " "), at: e.occurred_at, actor: e.actor,
      detail: e.payload?.reason ?? e.payload?.note ?? (e.payload?.reference ? `${e.payload.type ?? ""} ${e.payload.reference}`.trim() : null) })),
    can: {
      edit: manage && ["OPEN", "UNDER_REVIEW"].includes(s), assign: manage && !["CLOSED", "CANCELLED"].includes(s), startReview: manage && s === "OPEN",
      contain: manage && ["UNDER_REVIEW", "ACTION_REQUIRED"].includes(s), investigate: manage && ["UNDER_REVIEW", "ACTION_REQUIRED"].includes(s),
      addAction: manage && ["UNDER_REVIEW", "ACTION_REQUIRED"].includes(s), completeAction: (manage || ownedOpen) && ["UNDER_REVIEW", "ACTION_REQUIRED"].includes(s),
      requireAction: manage && s === "UNDER_REVIEW", submit: manage && s === "ACTION_REQUIRED" && !open.length, verify: has(c, NC.verify) && s === "VERIFICATION_PENDING",
      close: has(c, NC.close) && s === "RESOLVED", reopen: has(c, NC.close) && ["RESOLVED", "CLOSED"].includes(s), cancel: manage && ["OPEN", "UNDER_REVIEW"].includes(s),
      link: manage && !["CLOSED", "CANCELLED"].includes(s), upload: manage && !["CLOSED", "CANCELLED"].includes(s),
    },
  };
}
const EVENT_LABEL = {
  "quality.nonconformance.created": "Raised", "quality.nonconformance.updated": "Details changed", "quality.nonconformance.assigned": "Owner assigned",
  "quality.nonconformance.review_started": "Review started", "quality.nonconformance.contained": "Containment recorded", "quality.nonconformance.investigated": "Root cause recorded",
  "quality.nonconformance.action_added": "Action planned", "quality.nonconformance.action_completed": "Action completed", "quality.nonconformance.action_cancelled": "Action cancelled",
  "quality.nonconformance.action_required": "Action required", "quality.nonconformance.submitted_for_verification": "Submitted for verification",
  "quality.nonconformance.verification_failed": "Not effective — more action", "quality.nonconformance.resolved": "Verified and resolved", "quality.nonconformance.closed": "Closed",
  "quality.nonconformance.reopened": "Reopened", "quality.nonconformance.cancelled": "Cancelled", "quality.nonconformance.dependency_added": "Dependency added",
  "quality.nonconformance.dependency_done": "Dependency settled", "quality.nonconformance.file_added": "Evidence added",
};

// ------------------------------------------------------------------ dashboard
export async function getNonconformanceDashboard(client, c) {
  need(c, NC.view, NC.manage);
  const counts = await getNonconformanceCounts(client, c);
  const stats = (await qx(client, `SELECT count(*) FILTER (WHERE created_at >= now() - interval '90 days')::int AS raised90,
      count(*) FILTER (WHERE status = 'CLOSED' AND closed_at >= now() - interval '90 days')::int AS closed90,
      avg(EXTRACT(EPOCH FROM closed_at - created_at) / 86400) FILTER (WHERE status = 'CLOSED') AS days,
      count(*) FILTER (WHERE reopened_count > 0)::int AS reopened
      FROM tenant.quality_nonconformances WHERE organization_id = $1`, [c.organizationId])).rows[0];
  const actions = (await qx(client, `SELECT count(*) FILTER (WHERE status = 'OPEN')::int AS open, count(*) FILTER (WHERE status = 'OPEN' AND due_date < current_date)::int AS overdue,
      count(*) FILTER (WHERE effectiveness = 'NOT_EFFECTIVE')::int AS ineffective FROM tenant.quality_nonconformance_actions WHERE organization_id = $1`, [c.organizationId])).rows[0];
  const bySeverity = (await qx(client, `SELECT severity, count(*)::int AS n FROM tenant.quality_nonconformances WHERE organization_id = $1 AND status NOT IN ('CLOSED', 'CANCELLED') GROUP BY severity`,
    [c.organizationId])).rows;
  return { counts, raised90: stats.raised90, closed90: stats.closed90, averageDays: stats.days === null ? null : Math.round(Number(stats.days) * 10) / 10, reopened: stats.reopened,
    openActions: actions.open, overdueActions: actions.overdue, ineffectiveActions: actions.ineffective,
    bySeverity: Object.fromEntries(Object.keys(SEVERITY).map((k) => [k, bySeverity.find((r) => r.severity === k)?.n ?? 0])) };
}

// ------------------------------------------------------------------ reports
export const NC_REPORTS = Object.freeze({
  register: "Nonconformance register", by_severity: "Open NCRs by severity and status", by_source: "NCRs by source", by_supplier: "NCRs by supplier", by_item: "NCRs by item",
  ageing: "Open NCR ageing", actions: "Actions and their status", overdue_actions: "Overdue actions", effectiveness: "Action effectiveness", cycle_time: "NCR cycle time",
  dependencies: "Open dependencies",
});
export async function getNonconformanceReport(client, c, kind, filters = {}) {
  need(c, NC.view, NC.manage);
  if (!NC_REPORTS[kind]) throw ncError(404, "QUALITY_NC_NOT_FOUND", "Unknown report.");
  const from = filters.from ? String(filters.from).slice(0, 10) : "1900-01-01";
  const to = filters.to ? String(filters.to).slice(0, 10) : "2999-12-31";
  const base = `FROM tenant.quality_nonconformances nc LEFT JOIN tenant.items item ON item.id = nc.item_id LEFT JOIN tenant.procurement_suppliers sup ON sup.id = nc.supplier_id
     LEFT JOIN tenant.business_parties party ON party.id = sup.party_id LEFT JOIN public.users owner ON owner.id = nc.owner_user_id
     WHERE nc.organization_id = $1 AND nc.created_at >= $2::date AND nc.created_at < $3::date + 1`;
  const v = [c.organizationId, from, to];
  const run = async (sql) => (await qx(client, sql, v)).rows;
  let rows;
  switch (kind) {
    case "register": rows = await run(`SELECT nc.nonconformance_number AS ncr, nc.title, nc.severity, nc.status, nc.source_type AS source, item.name AS item, party.display_name AS supplier,
        nc.affected_quantity AS affected, owner.full_name AS owner, nc.due_date AS due, nc.created_at, nc.resolved_at, nc.closed_at ${base} ORDER BY nc.created_at DESC`); break;
    case "by_severity": rows = await run(`SELECT nc.severity, nc.status, count(*)::int AS ncrs, COALESCE(sum(nc.affected_quantity), 0) AS affected ${base} AND nc.status NOT IN ('CLOSED', 'CANCELLED')
        GROUP BY nc.severity, nc.status ORDER BY nc.severity, nc.status`); break;
    case "by_source": rows = await run(`SELECT nc.source_type AS source, count(*)::int AS ncrs, count(*) FILTER (WHERE nc.severity = 'critical')::int AS critical,
        count(*) FILTER (WHERE nc.status = 'CLOSED')::int AS closed ${base} GROUP BY nc.source_type ORDER BY ncrs DESC`); break;
    case "by_supplier": rows = await run(`SELECT COALESCE(party.display_name, '—') AS supplier, count(*)::int AS ncrs, count(*) FILTER (WHERE nc.severity IN ('major', 'critical'))::int AS major_or_critical,
        COALESCE(sum(nc.affected_quantity), 0) AS affected ${base} AND nc.supplier_id IS NOT NULL GROUP BY party.display_name ORDER BY ncrs DESC`); break;
    case "by_item": rows = await run(`SELECT item.code, item.name, count(*)::int AS ncrs, COALESCE(sum(nc.affected_quantity), 0) AS affected ${base} AND nc.item_id IS NOT NULL
        GROUP BY item.code, item.name ORDER BY ncrs DESC`); break;
    case "ageing": rows = await run(`SELECT nc.nonconformance_number AS ncr, nc.severity, nc.status, owner.full_name AS owner, (current_date - nc.created_at::date) AS days_open,
        CASE WHEN current_date - nc.created_at::date > 60 THEN 'Over 60 days' WHEN current_date - nc.created_at::date > 30 THEN '31–60 days' ELSE '0–30 days' END AS bucket
        ${base} AND nc.status IN ('OPEN', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'VERIFICATION_PENDING') ORDER BY days_open DESC`); break;
    case "actions": case "overdue_actions": case "effectiveness": rows = await run(`SELECT nc.nonconformance_number AS ncr, a.sequence, a.action_type AS type, a.description, au.full_name AS owner,
        a.due_date AS due, a.status, a.completed_at, a.effectiveness, a.verified_at
        FROM tenant.quality_nonconformance_actions a JOIN tenant.quality_nonconformances nc ON nc.id = a.nonconformance_id LEFT JOIN public.users au ON au.id = a.owner_user_id
        WHERE a.organization_id = $1 AND a.created_at >= $2::date AND a.created_at < $3::date + 1
        ${kind === "overdue_actions" ? "AND a.status = 'OPEN' AND a.due_date < current_date" : kind === "effectiveness" ? "AND a.effectiveness IS NOT NULL" : ""} ORDER BY nc.nonconformance_number, a.sequence`); break;
    case "cycle_time": rows = await run(`SELECT nc.nonconformance_number AS ncr, nc.severity, nc.created_at,
        round(EXTRACT(EPOCH FROM nc.contained_at - nc.created_at) / 86400, 1) AS days_to_containment, round(EXTRACT(EPOCH FROM nc.investigated_at - nc.created_at) / 86400, 1) AS days_to_root_cause,
        round(EXTRACT(EPOCH FROM nc.resolved_at - nc.created_at) / 86400, 1) AS days_to_resolution, round(EXTRACT(EPOCH FROM nc.closed_at - nc.created_at) / 86400, 1) AS days_to_closure
        ${base} AND nc.status = 'CLOSED' ORDER BY nc.closed_at DESC`); break;
    case "dependencies": rows = await run(`SELECT nc.nonconformance_number AS ncr, nc.status AS ncr_status, l.link_type AS dependency, l.reference, l.blocks_closure, l.status, l.created_at
        FROM tenant.quality_nonconformance_links l JOIN tenant.quality_nonconformances nc ON nc.id = l.nonconformance_id
        WHERE l.organization_id = $1 AND l.status = 'OPEN' AND l.created_at >= $2::date AND l.created_at < $3::date + 1 ORDER BY l.created_at`); break;
    default: rows = [];
  }
  return { kind, title: NC_REPORTS[kind], rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, val]) => [k, typeof val === "string" && /^-?\d+\.\d+$/.test(val) ? Number(val) : val]))) };
}
export async function exportNonconformanceReport(client, c, kind = "register", filters = {}) {
  need(c, NC.export);
  const report = await getNonconformanceReport(client, c, kind, filters);
  const columns = [...new Set(report.rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [columns.join(","), ...report.rows.map((r) => columns.map((k) => cell(r[k])).join(","))].join("\n");
  return { fileName: `nonconformance-${kind.replace(/_/g, "-")}.csv`, mimeType: "text/csv", body };
}

// What the screens offer: members (owners, action owners), stock items, recent inspections, vocabularies and reports.
export async function listNonconformanceOptions(client, c) {
  need(c, NC.view, NC.manage);
  const members = (await qx(client, `SELECT u.id, u.full_name FROM organization_memberships m JOIN public.users u ON u.id = m.user_id WHERE m.organization_id = $1 AND m.status = 'active'
      ORDER BY u.full_name`, [c.organizationId])).rows;
  const items = (await qx(client, `SELECT id, code, name FROM tenant.items WHERE organization_id = $1 AND item_type <> 'service' AND status = 'active' ORDER BY code LIMIT 500`, [c.organizationId])).rows;
  const inspections = (await qx(client, `SELECT id, inspection_number, inspection_type FROM tenant.quality_inspections WHERE organization_id = $1 AND workflow_status <> 'CANCELLED'
      ORDER BY created_at DESC LIMIT 200`, [c.organizationId])).rows;
  const opt = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));
  return {
    members: members.map((u) => ({ value: u.id, label: u.full_name })), items: items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` })),
    inspections: inspections.map((i) => ({ value: i.id, label: `${i.inspection_number} (${i.inspection_type.replace("_", "-")})` })),
    severities: opt(SEVERITY), sources: opt(SOURCES), actionTypes: opt(ACTION_TYPES), methods: opt(METHODS), linkTypes: opt(LINK_TYPES), reports: opt(NC_REPORTS),
    canCreate: has(c, NC.manage), canExport: has(c, NC.export),
  };
}
