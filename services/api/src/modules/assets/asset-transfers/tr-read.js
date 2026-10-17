// Assets — Asset Transfers, the reads: the directory (by view, scoped to what the person may see), one transfer with its lines, receipt
// progress, approvals, exceptions, history and the actions open to the person; the asset's movement panel (last confirmed location, physical
// movement, destination, accountable custodian, pending receipt); exceptions, reconciliation, reports and the export.
import { has, uuid } from "../common.js";
import { APPROVAL, EXCEPTION, LINE_STATUS, REASON, RESOLUTION, STATUS, TR, TYPE, dayOfDb, manages, seesAll, seesTransfers, trError } from "./tr-rules.js";

const NAME = (alias) => `COALESCE(NULLIF(${alias}.full_name, ''), ${alias}.email)`;
const idOf = (v, label) => { try { return uuid(v, label); } catch { throw trError(404, "ASSET_TRANSFER_NOT_FOUND"); } };
const requireSees = (c) => { if (!seesTransfers(c)) throw trError(403, "ASSET_TRANSFER_PERMISSION_DENIED"); };
// Those without Company-wide transfer rights see the transfers they requested, hold or receive, or whose locations they manage.
const scope = (c, values) => {
  if (seesAll(c)) return "";
  values.push(c.userId);
  const p = `$${values.length}`;
  return `AND (o.requested_by = ${p} OR EXISTS (SELECT 1 FROM tenant.asset_transfer_lines sl LEFT JOIN tenant.assets sa ON sa.id = sl.asset_id LEFT JOIN tenant.asset_locations fl ON fl.id = sl.from_location_id
    LEFT JOIN tenant.asset_locations tl ON tl.id = sl.to_location_id WHERE sl.transfer_id = o.id AND (sl.to_user_id = ${p} OR sa.current_user_id = ${p} OR fl.manager_user_id = ${p} OR tl.manager_user_id = ${p})))`;
};
const VIEWS = Object.freeze({ drafts: "('DRAFT', 'CHANGES_REQUESTED')", pending: "('PENDING_APPROVAL')", ready: "('APPROVED')", in_transit: "('IN_TRANSIT', 'PARTIALLY_RECEIVED')",
  exceptions: "('RECEIPT_EXCEPTION', 'RECOVERY_REQUIRED')", completed: "('COMPLETED')", closed: "('CANCELLED', 'REJECTED')" });
const LIST = `SELECT o.*, ${NAME("u")} AS requester,
    (SELECT count(*)::int FROM tenant.asset_transfer_lines l WHERE l.transfer_id = o.id AND l.line_status NOT IN ('CANCELLED', 'REJECTED')) AS assets,
    (SELECT count(*)::int FROM tenant.asset_transfer_lines l WHERE l.transfer_id = o.id AND l.line_status IN ('COMPLETED', 'RETURNED')) AS received,
    (SELECT count(*)::int FROM tenant.asset_transfer_lines l WHERE l.transfer_id = o.id AND l.line_status IN ('DISPATCHED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS')) AS outstanding,
    (SELECT string_agg(DISTINCT fl.name, ', ') FROM tenant.asset_transfer_lines l JOIN tenant.asset_locations fl ON fl.id = l.from_location_id WHERE l.transfer_id = o.id) AS from_names,
    (SELECT string_agg(DISTINCT tl.name, ', ') FROM tenant.asset_transfer_lines l JOIN tenant.asset_locations tl ON tl.id = l.to_location_id WHERE l.transfer_id = o.id) AS to_names,
    (SELECT string_agg(DISTINCT COALESCE(NULLIF(tu.full_name, ''), tu.email), ', ') FROM tenant.asset_transfer_lines l JOIN public.users tu ON tu.id = l.to_user_id WHERE l.transfer_id = o.id) AS to_people
  FROM tenant.asset_transfer_orders o LEFT JOIN public.users u ON u.id = o.requested_by`;
const rowOf = (o) => ({ id: o.id, number: o.transfer_number, type: o.transfer_type, typeLabel: TYPE[o.transfer_type], reason: REASON[o.reason_code], status: o.status, statusLabel: STATUS[o.status],
  approval: o.approval_status, approvalLabel: APPROVAL[o.approval_status], assets: o.assets, received: o.received, outstanding: o.outstanding, from: o.from_names ?? "—",
  to: [o.to_names, o.to_people].filter(Boolean).join(" · ") || "—", requestedBy: o.requester, requestedAt: o.created_at, plannedDate: dayOfDb(o.planned_date), expectedArrival: o.expected_arrival_at,
  expectedReturn: dayOfDb(o.expected_return_at), overdue: Boolean(o.expected_arrival_at && o.outstanding > 0 && new Date(o.expected_arrival_at) < new Date()), href: `/assets/transfers/${o.id}` });

// filters: { view?: all | drafts | pending | ready | in_transit | exceptions | completed | closed, search?, assetId? }
export async function listAssetTransfers(client, c, filters = {}) {
  requireSees(c);
  const values = [c.organizationId];
  const where = [`o.organization_id = $1`];
  if (VIEWS[filters.view]) where.push(`o.status IN ${VIEWS[filters.view]}`);
  if (filters.search) { values.push(`%${String(filters.search).slice(0, 100)}%`); where.push(`(o.transfer_number ILIKE $${values.length} OR EXISTS (SELECT 1 FROM tenant.asset_transfer_lines l JOIN tenant.assets a ON a.id = l.asset_id WHERE l.transfer_id = o.id AND (a.asset_number ILIKE $${values.length} OR a.name ILIKE $${values.length})))`); }
  if (filters.assetId) { values.push(idOf(filters.assetId, "Asset")); where.push(`EXISTS (SELECT 1 FROM tenant.asset_transfer_lines l WHERE l.transfer_id = o.id AND l.asset_id = $${values.length})`); }
  const s = scope(c, values);
  const rows = (await client.query(`${LIST} WHERE ${where.join(" AND ")} ${s} ORDER BY o.created_at DESC LIMIT 500`, values)).rows;
  const counts = (await client.query(`SELECT status, count(*)::int AS n FROM tenant.asset_transfer_orders o WHERE o.organization_id = $1 ${scope(c, [c.organizationId])} GROUP BY 1`,
    seesAll(c) ? [c.organizationId] : [c.organizationId, c.userId])).rows;
  return { rows: rows.map(rowOf), counts: Object.fromEntries(counts.map((r) => [r.status, r.n])),
    can: { create: has(c, TR.create), bulk: has(c, TR.bulk), export: has(c, TR.export), manage: manages(c) } };
}
export async function getAssetTransfer(client, c, transferId) {
  requireSees(c);
  const values = [c.organizationId, idOf(transferId, "Transfer")];
  const o = (await client.query(`${LIST} WHERE o.organization_id = $1 AND o.id = $2 ${scope(c, values)}`, values)).rows[0];
  if (!o) throw trError(404, "ASSET_TRANSFER_NOT_FOUND");
  const lines = (await client.query(`SELECT l.*, a.asset_number, a.name, a.serial_number, a.lifecycle_status, a.location_id AS asset_location, fl.name AS from_name, tl.name AS to_name,
      ${NAME("tu")} AS to_user, td.name AS to_department, ts.name AS to_store, ${NAME("ru")} AS receiver, ${NAME("du")} AS dispatcher,
      (SELECT h.status FROM tenant.asset_custody_handovers h WHERE h.id = l.custody_handover_id) AS handover_status
      FROM tenant.asset_transfer_lines l JOIN tenant.assets a ON a.id = l.asset_id LEFT JOIN tenant.asset_locations fl ON fl.id = l.from_location_id LEFT JOIN tenant.asset_locations tl ON tl.id = l.to_location_id
      LEFT JOIN public.users tu ON tu.id = l.to_user_id LEFT JOIN public.departments td ON td.id = l.to_department_id LEFT JOIN tenant.asset_locations ts ON ts.id = l.to_store_location_id
      LEFT JOIN public.users ru ON ru.id = l.received_by LEFT JOIN public.users du ON du.id = l.dispatched_by WHERE l.transfer_id = $1 ORDER BY l.line_number`, [o.id])).rows;
  const exceptions = (await client.query(`SELECT x.*, ${NAME("u")} AS reporter, a.asset_number FROM tenant.asset_transfer_exceptions x LEFT JOIN public.users u ON u.id = x.reported_by JOIN tenant.assets a ON a.id = x.asset_id
      WHERE x.transfer_id = $1 ORDER BY x.reported_at`, [o.id])).rows;
  const events = (await client.query(`SELECT e.*, ${NAME("u")} AS actor, a.asset_number FROM tenant.asset_transfer_events e LEFT JOIN public.users u ON u.id = e.actor_user_id LEFT JOIN tenant.assets a ON a.id = e.asset_id
      WHERE e.transfer_id = $1 ORDER BY e.occurred_at`, [o.id])).rows;
  const approvedBy = o.approved_by ? (await client.query(`SELECT ${NAME("u")} AS n FROM public.users u WHERE u.id = $1`, [o.approved_by])).rows[0]?.n : null;
  const returnLeg = (await client.query(`SELECT id, transfer_number, status FROM tenant.asset_transfer_orders WHERE return_of_id = $1 AND status NOT IN ('CANCELLED', 'REJECTED') ORDER BY created_at DESC LIMIT 1`, [o.id])).rows[0];
  const returnOf = o.return_of_id ? (await client.query(`SELECT id, transfer_number FROM tenant.asset_transfer_orders WHERE id = $1`, [o.return_of_id])).rows[0] : null;
  const open = ["DRAFT", "CHANGES_REQUESTED", "PENDING_APPROVAL", "APPROVED"].includes(o.status) && !lines.some((l) => l.dispatched_at);
  const mine = o.requested_by === c.userId;
  return {
    ...rowOf(o), reasonCode: o.reason_code, reasonDetail: o.reason_detail, approvalReasons: o.approval_reasons ?? [], approvedBy, approvedAt: o.approved_at, decisionNote: o.decision_note, carrier: o.carrier,
    trackingReference: o.tracking_reference, notes: o.notes, cancelReason: o.cancel_reason, completedAt: o.completed_at, version: o.row_version,
    returnLeg: returnLeg ? { id: returnLeg.id, number: returnLeg.transfer_number, status: STATUS[returnLeg.status], href: `/assets/transfers/${returnLeg.id}` } : null,
    returnOf: returnOf ? { id: returnOf.id, number: returnOf.transfer_number, href: `/assets/transfers/${returnOf.id}` } : null,
    progress: { assets: o.assets, dispatched: lines.filter((l) => l.dispatched_at).length, received: o.received, outstanding: o.outstanding },
    lines: lines.map((l) => ({ id: l.id, line: l.line_number, assetId: l.asset_id, asset: `${l.asset_number} · ${l.name}`, serialNumber: l.serial_number, assetHref: `/assets/register/${l.asset_id}?tab=custody`,
      from: l.from_name ?? "—", fromCustodian: l.from_custodian_label, to: l.to_name ?? "Same location", toCustodian: l.to_user ?? l.to_department ?? l.to_store ?? null, status: l.line_status, statusLabel: LINE_STATUS[l.line_status],
      dispatchCondition: l.dispatch_condition, dispatchedAt: l.dispatched_at, dispatchedBy: l.dispatcher, transitHolder: l.transit_holder, receiptCondition: l.receipt_condition, receivedAt: l.received_at, receivedBy: l.receiver,
      receiptIdentifier: l.receipt_identifier, custodyOutcome: l.custody_outcome, handoverStatus: l.handover_status, closeReason: l.close_reason, confirmedLocation: l.asset_location === l.to_location_id ? "Destination" : "Source" })),
    exceptions: exceptions.map((x) => ({ id: x.id, number: `TEX-${x.exception_number}`, lineId: x.line_id, asset: x.asset_number, type: x.exception_type, typeLabel: EXCEPTION[x.exception_type], description: x.description,
      expected: x.expected_identifier, observed: x.observed_identifier, condition: x.observed_condition, status: x.status, resolution: x.resolution, resolutionLabel: x.resolution ? RESOLUTION[x.resolution] : null,
      resolutionNote: x.resolution_note, reportedBy: x.reporter, reportedAt: x.reported_at, incidentId: x.related_incident_id })),
    events: (has(c, TR.history) || manages(c) || mine) ? events.map((e) => ({ id: e.id, action: e.action, from: e.from_status, to: e.to_status, asset: e.asset_number, reason: e.reason, by: e.actor, at: e.occurred_at })) : [],
    can: {
      edit: ["DRAFT", "CHANGES_REQUESTED"].includes(o.status) && (mine || manages(c)) && has(c, TR.create), submit: ["DRAFT", "CHANGES_REQUESTED"].includes(o.status) && has(c, TR.submit),
      approve: o.status === "PENDING_APPROVAL" && has(c, TR.approve) && !mine, reject: ["PENDING_APPROVAL", "CHANGES_REQUESTED"].includes(o.status) && has(c, TR.reject),
      dispatch: lines.some((l) => l.line_status === "APPROVED") && has(c, TR.dispatch) && ["APPROVED", "IN_TRANSIT", "PARTIALLY_RECEIVED", "RECEIPT_EXCEPTION"].includes(o.status),
      receive: lines.some((l) => l.line_status === "DISPATCHED") && has(c, TR.receive), cancel: open && (has(c, TR.cancel) || (mine && o.status !== "APPROVED")),
      reportException: has(c, TR.reportException) && lines.some((l) => ["DISPATCHED", "RECEIPT_EXCEPTION", "COMPLETED"].includes(l.line_status)), resolve: manages(c) && exceptions.some((x) => x.status !== "RESOLVED"),
      createReturn: o.transfer_type === "TEMPORARY" && !returnLeg && lines.some((l) => l.line_status === "COMPLETED") && has(c, TR.create),
    },
  };
}
// The asset's movement panel (Custody & Location tab).
export async function getAssetTransferPanel(client, c, assetId) {
  const a = (await client.query(`SELECT a.*, l.name AS location_name, tenant.asset_effective_availability(a) AS effective FROM tenant.assets a LEFT JOIN tenant.asset_locations l ON l.id = a.location_id
      WHERE a.organization_id = $1 AND a.id = $2`, [c.organizationId, idOf(assetId, "Asset")])).rows[0];
  if (!a) throw trError(404, "ASSET_TRANSFER_NOT_FOUND", "This asset is not available.");
  if (!seesTransfers(c) && a.current_user_id !== c.userId) return { visible: false };
  const active = (await client.query(`SELECT l.*, o.transfer_number, o.status AS order_status, o.expected_arrival_at, o.transfer_type, tl.name AS to_name, ${NAME("tu")} AS to_user
      FROM tenant.asset_transfer_lines l JOIN tenant.asset_transfer_orders o ON o.id = l.transfer_id LEFT JOIN tenant.asset_locations tl ON tl.id = l.to_location_id LEFT JOIN public.users tu ON tu.id = l.to_user_id
      WHERE l.asset_id = $1 AND l.line_status IN ('PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS') LIMIT 1`, [a.id])).rows[0];
  const holder = (await client.query(`SELECT COALESCE(NULLIF(u.full_name, ''), u.email, d.name, s.name) AS label, k.custodian_type FROM tenant.asset_custody_assignments k LEFT JOIN public.users u ON u.id = k.user_id
      LEFT JOIN public.departments d ON d.id = k.department_id LEFT JOIN tenant.asset_locations s ON s.id = k.store_location_id WHERE k.asset_id = $1 AND k.status = 'ACTIVE'`, [a.id])).rows[0];
  const history = (await client.query(`SELECT l.line_status, l.dispatched_at, l.received_at, l.completed_at, o.id, o.transfer_number, o.transfer_type, o.created_at, fl.name AS from_name, tl.name AS to_name
      FROM tenant.asset_transfer_lines l JOIN tenant.asset_transfer_orders o ON o.id = l.transfer_id LEFT JOIN tenant.asset_locations fl ON fl.id = l.from_location_id LEFT JOIN tenant.asset_locations tl ON tl.id = l.to_location_id
      WHERE l.asset_id = $1 ORDER BY o.created_at DESC LIMIT 50`, [a.id])).rows;
  return {
    visible: true, assetId: a.id, confirmedLocation: a.location_name ?? null, custodian: holder?.label ?? null, effective: a.effective,
    movement: active ? { transferId: active.transfer_id, number: active.transfer_number, type: TYPE[active.transfer_type], status: LINE_STATUS[active.line_status], destination: active.to_name ?? "Same location",
      receivingCustodian: active.to_user ?? null, transitHolder: active.transit_holder, expectedArrival: active.expected_arrival_at, receipt: active.line_status === "DISPATCHED" ? "Pending" : active.line_status === "RECEIPT_EXCEPTION" ? "Exception" : null,
      href: `/assets/transfers/${active.transfer_id}` } : null,
    history: history.map((h) => ({ transferId: h.id, number: h.transfer_number, type: TYPE[h.transfer_type], from: h.from_name ?? "—", to: h.to_name ?? "Same location", status: LINE_STATUS[h.line_status], at: h.completed_at ?? h.dispatched_at ?? h.created_at, href: `/assets/transfers/${h.id}` })),
    can: { initiate: has(c, TR.create) && !active && (manages(c) || a.current_user_id === c.userId) },
    note: "The registered location changes only when a transfer is received; while in transit it stays at the last confirmed place.",
  };
}

// ------------------------------------------------------------------ exceptions and reconciliation
export async function getTransferExceptions(client, c) {
  requireSees(c);
  const out = [];
  const q = async (sql) => (await client.query(sql, [c.organizationId])).rows;
  for (const x of await q(`SELECT x.*, o.transfer_number, a.asset_number FROM tenant.asset_transfer_exceptions x JOIN tenant.asset_transfer_orders o ON o.id = x.transfer_id JOIN tenant.assets a ON a.id = x.asset_id
      WHERE x.organization_id = $1 AND x.status <> 'RESOLVED' ORDER BY x.reported_at`)) {
    out.push({ kind: x.exception_type, label: EXCEPTION[x.exception_type], subject: `${x.transfer_number} · ${x.asset_number}`, detail: x.description, href: `/assets/transfers/${x.transfer_id}` });
  }
  for (const r of await q(`SELECT DISTINCT o.id, o.transfer_number, o.expected_arrival_at FROM tenant.asset_transfer_orders o JOIN tenant.asset_transfer_lines l ON l.transfer_id = o.id
      WHERE o.organization_id = $1 AND l.line_status = 'DISPATCHED' AND o.expected_arrival_at < now()`)) {
    out.push({ kind: "OVERDUE_RECEIPT", label: "Expected arrival passed — no receipt", subject: r.transfer_number, detail: null, href: `/assets/transfers/${r.id}` });
  }
  for (const r of await q(`SELECT o.id, o.transfer_number, o.expected_return_at FROM tenant.asset_transfer_orders o WHERE o.organization_id = $1 AND o.transfer_type = 'TEMPORARY' AND o.status IN ('COMPLETED', 'PARTIALLY_RECEIVED')
      AND o.expected_return_at < current_date AND NOT EXISTS (SELECT 1 FROM tenant.asset_transfer_orders r WHERE r.return_of_id = o.id AND r.status = 'COMPLETED')`)) {
    out.push({ kind: "OVERDUE_RETURN", label: "Temporary movement not returned on time", subject: r.transfer_number, detail: `Expected back ${dayOfDb(r.expected_return_at)}`, href: `/assets/transfers/${r.id}` });
  }
  return out;
}
// Every completed movement agrees with the asset's own records: its location event, and the location it holds now (unless it moved again since).
export async function getTransferReconciliation(client, c) {
  if (!seesAll(c)) throw trError(403, "ASSET_TRANSFER_PERMISSION_DENIED");
  const rows = (await client.query(`SELECT l.id, l.asset_id, l.to_location_id, l.location_event_id, l.completed_at, o.transfer_number, o.id AS transfer_id, a.asset_number, a.location_id,
      (SELECT count(*)::int FROM tenant.asset_location_events e WHERE e.source_id = l.id) AS events,
      EXISTS (SELECT 1 FROM tenant.asset_location_events e WHERE e.asset_id = l.asset_id AND e.recorded_at > l.completed_at) AS moved_since
      FROM tenant.asset_transfer_lines l JOIN tenant.asset_transfer_orders o ON o.id = l.transfer_id JOIN tenant.assets a ON a.id = l.asset_id
      WHERE l.organization_id = $1 AND l.line_status = 'COMPLETED' AND l.to_location_id IS NOT NULL ORDER BY l.completed_at DESC LIMIT 1000`, [c.organizationId])).rows;
  const issues = [];
  for (const r of rows) {
    if (r.events !== 1 && r.to_location_id !== null) issues.push({ transfer: r.transfer_number, asset: r.asset_number, issue: r.events === 0 ? "No location event for the receipt" : "More than one location event for one receipt", href: `/assets/transfers/${r.transfer_id}` });
    else if (!r.moved_since && r.location_id !== r.to_location_id) issues.push({ transfer: r.transfer_number, asset: r.asset_number, issue: "The asset's location differs from where it was received", href: `/assets/transfers/${r.transfer_id}` });
  }
  const transit = (await client.query(`SELECT count(*)::int AS n FROM tenant.asset_transfer_lines WHERE organization_id = $1 AND line_status IN ('DISPATCHED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS')`, [c.organizationId])).rows[0].n;
  return { checked: rows.length, issues, inTransit: transit, note: "A receipt changes the registered location exactly once, through the location record." };
}

// ------------------------------------------------------------------ reports, history, export
export const TRANSFER_REPORTS = Object.freeze(["all-transfers", "pending-approvals", "ready-to-dispatch", "in-transit", "overdue-receipts", "partially-received", "transfer-exceptions", "by-location",
  "by-custodian", "temporary-overdue-returns", "movement-history", "reconciliation"]);
export async function getTransferReport(client, c, kind) {
  if (!TRANSFER_REPORTS.includes(kind)) throw trError(400, "ASSET_TRANSFER_INVALID", "Unknown report.");
  requireSees(c);
  const list = async (view) => (await listAssetTransfers(client, c, { view })).rows;
  const brief = (r) => ({ transfer: r.number, type: r.typeLabel, from: r.from, to: r.to, status: r.statusLabel, assets: r.assets, href: r.href });
  switch (kind) {
    case "all-transfers": return (await list("all")).map(brief);
    case "pending-approvals": return (await list("pending")).map(brief);
    case "ready-to-dispatch": return (await list("ready")).map(brief);
    case "in-transit": return (await client.query(`SELECT o.id, o.transfer_number, a.asset_number, a.name, fl.name AS from_name, tl.name AS to_name, l.dispatched_at, l.transit_holder FROM tenant.asset_transfer_lines l
        JOIN tenant.asset_transfer_orders o ON o.id = l.transfer_id JOIN tenant.assets a ON a.id = l.asset_id LEFT JOIN tenant.asset_locations fl ON fl.id = l.from_location_id LEFT JOIN tenant.asset_locations tl ON tl.id = l.to_location_id
        WHERE l.organization_id = $1 AND l.line_status IN ('DISPATCHED', 'RECEIPT_EXCEPTION') ORDER BY l.dispatched_at`, [c.organizationId])).rows
      .map((r) => ({ asset: `${r.asset_number} · ${r.name}`, transfer: r.transfer_number, from: r.from_name ?? "—", to: r.to_name ?? "—", since: r.dispatched_at, holder: r.transit_holder ?? "—", href: `/assets/transfers/${r.id}` }));
    case "overdue-receipts": return (await getTransferExceptions(client, c)).filter((e) => e.kind === "OVERDUE_RECEIPT").map((e) => ({ transfer: e.subject, issue: e.label, href: e.href }));
    case "partially-received": return (await list("in_transit")).filter((r) => r.received > 0 && r.outstanding > 0).map((r) => ({ ...brief(r), received: r.received, outstanding: r.outstanding }));
    case "transfer-exceptions": return (await getTransferExceptions(client, c)).map((e) => ({ exception: e.label, about: e.subject, detail: e.detail ?? "", href: e.href }));
    case "by-location": return (await client.query(`SELECT COALESCE(fl.name, '—') AS from_name, COALESCE(tl.name, '—') AS to_name, count(*)::int AS moves FROM tenant.asset_transfer_lines l
        LEFT JOIN tenant.asset_locations fl ON fl.id = l.from_location_id LEFT JOIN tenant.asset_locations tl ON tl.id = l.to_location_id WHERE l.organization_id = $1 AND l.line_status = 'COMPLETED' AND l.to_location_id IS NOT NULL
        GROUP BY 1, 2 ORDER BY 3 DESC`, [c.organizationId])).rows.map((r) => ({ from: r.from_name, to: r.to_name, moves: r.moves }));
    case "by-custodian": return (await client.query(`SELECT COALESCE(l.from_custodian_label, '—') AS from_label, COALESCE(${NAME("tu")}, td.name, ts.name, '—') AS to_label, count(*)::int AS changes
        FROM tenant.asset_transfer_lines l LEFT JOIN public.users tu ON tu.id = l.to_user_id LEFT JOIN public.departments td ON td.id = l.to_department_id LEFT JOIN tenant.asset_locations ts ON ts.id = l.to_store_location_id
        WHERE l.organization_id = $1 AND l.line_status = 'COMPLETED' AND l.to_custodian_type IS NOT NULL GROUP BY 1, 2 ORDER BY 3 DESC`, [c.organizationId])).rows.map((r) => ({ from: r.from_label, to: r.to_label, changes: r.changes }));
    case "temporary-overdue-returns": return (await getTransferExceptions(client, c)).filter((e) => e.kind === "OVERDUE_RETURN").map((e) => ({ transfer: e.subject, expected: e.detail, href: e.href }));
    case "movement-history": return (await client.query(`SELECT a.id, a.asset_number, o.transfer_number, fl.name AS from_name, tl.name AS to_name, l.completed_at FROM tenant.asset_transfer_lines l JOIN tenant.asset_transfer_orders o ON o.id = l.transfer_id
        JOIN tenant.assets a ON a.id = l.asset_id LEFT JOIN tenant.asset_locations fl ON fl.id = l.from_location_id LEFT JOIN tenant.asset_locations tl ON tl.id = l.to_location_id
        WHERE l.organization_id = $1 AND l.line_status = 'COMPLETED' ORDER BY a.asset_number, l.completed_at LIMIT 2000`, [c.organizationId])).rows
      .map((r) => ({ asset: r.asset_number, transfer: r.transfer_number, from: r.from_name ?? "—", to: r.to_name ?? "Same location", at: r.completed_at, href: `/assets/register/${r.id}?tab=custody` }));
    case "reconciliation": return seesAll(c) ? (await getTransferReconciliation(client, c)).issues : [];
    default: return [];
  }
}
export async function getTransferHistory(client, c, filters = {}) {
  if (!has(c, TR.history) && !manages(c)) throw trError(403, "ASSET_TRANSFER_PERMISSION_DENIED");
  const values = [c.organizationId];
  let where = "";
  if (filters.assetId) { values.push(idOf(filters.assetId, "Asset")); where = `AND e.asset_id = $${values.length}`; }
  return (await client.query(`SELECT e.*, o.transfer_number, ${NAME("u")} AS actor, a.asset_number FROM tenant.asset_transfer_events e JOIN tenant.asset_transfer_orders o ON o.id = e.transfer_id
      LEFT JOIN public.users u ON u.id = e.actor_user_id LEFT JOIN tenant.assets a ON a.id = e.asset_id WHERE e.organization_id = $1 ${where} ORDER BY e.occurred_at DESC LIMIT 1000`, values)).rows
    .map((e) => ({ id: e.id, transfer: e.transfer_number, transferId: e.transfer_id, action: e.action, from: e.from_status, to: e.to_status, asset: e.asset_number, reason: e.reason, by: e.actor, at: e.occurred_at }));
}
const csvCell = (value) => { const s = value === null || value === undefined ? "" : String(value); return /[",\r\n]/.test(s) || /^[=+@-]/.test(s) ? `"${(/^[=+@-]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
export async function exportAssetTransfers(client, c) {
  if (!has(c, TR.export)) throw trError(403, "ASSET_TRANSFER_PERMISSION_DENIED");
  const rows = (await client.query(`SELECT o.transfer_number, o.transfer_type, o.reason_code, o.status, a.asset_number, a.name, fl.name AS from_name, tl.name AS to_name, l.line_status, l.dispatched_at, l.received_at, l.dispatch_condition, l.receipt_condition
      FROM tenant.asset_transfer_lines l JOIN tenant.asset_transfer_orders o ON o.id = l.transfer_id JOIN tenant.assets a ON a.id = l.asset_id LEFT JOIN tenant.asset_locations fl ON fl.id = l.from_location_id
      LEFT JOIN tenant.asset_locations tl ON tl.id = l.to_location_id WHERE l.organization_id = $1 ORDER BY o.created_at DESC, l.line_number LIMIT 10000`, [c.organizationId])).rows;
  const header = ["Transfer", "Type", "Reason", "Transfer status", "Asset", "Name", "From", "To", "Line status", "Dispatched", "Received", "Condition at dispatch", "Condition at receipt"];
  return { fileName: "asset-transfers.csv", csv: [header, ...rows.map((r) => [r.transfer_number, TYPE[r.transfer_type], REASON[r.reason_code], STATUS[r.status], r.asset_number, r.name, r.from_name, r.to_name,
    LINE_STATUS[r.line_status], r.dispatched_at, r.received_at, r.dispatch_condition, r.receipt_condition])].map((l) => l.map(csvCell).join(",")).join("\r\n") };
}
