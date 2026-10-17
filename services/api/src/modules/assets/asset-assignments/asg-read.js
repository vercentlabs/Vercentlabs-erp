// Assets — Asset Assignment, the reads: the directory by view (scoped: employees see their own), one request with the asset's current
// location and custodian read back, its reservation, handover and acknowledgment, the assets free to assign, the asset's assignment panel,
// the employee's own requests, exceptions, reports and the export. Every state shown comes from the custody records it points to.
import { has, uuid } from "../common.js";
import { ACK, ASG, RECIPIENT, STATUS, asgError, assetTeam, dayOfDb, seesAssignments } from "./asg-rules.js";
import { syncAssignment } from "./asg-commands.js";

const NAME = (alias) => `COALESCE(NULLIF(${alias}.full_name, ''), ${alias}.email)`;
const idOf = (v, label) => { try { return uuid(v, label); } catch { throw asgError(404, "ASSET_ASSIGNMENT_NOT_FOUND"); } };
const requireSees = (c) => { if (!seesAssignments(c)) throw asgError(403, "ASSET_ASSIGNMENT_PERMISSION_DENIED"); };
const LIST = `SELECT r.*, a.asset_number, a.name AS asset_name, a.serial_number, cat.name AS category, ${NAME("u")} AS to_user, d.name AS to_department, s.name AS to_store, l.name AS location_name,
    ${NAME("rq")} AS requester FROM tenant.asset_assignment_requests r LEFT JOIN tenant.assets a ON a.id = r.asset_id LEFT JOIN tenant.asset_categories cat ON cat.id = r.category_id
    LEFT JOIN public.users u ON u.id = r.to_user_id LEFT JOIN public.departments d ON d.id = r.to_department_id LEFT JOIN tenant.asset_locations s ON s.id = r.to_store_location_id
    LEFT JOIN tenant.asset_locations l ON l.id = a.location_id LEFT JOIN public.users rq ON rq.id = r.requested_by`;
const VIEWS = Object.freeze({
  pending: "r.status IN ('DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUESTED')", ready: "r.status IN ('READY_TO_ISSUE', 'IN_TRANSFER')", awaiting: "r.status = 'ISSUED_AWAITING_ACKNOWLEDGMENT' AND r.returned_at IS NULL",
  active: "r.status IN ('FULFILLED', 'ISSUED_AWAITING_ACKNOWLEDGMENT') AND r.returned_at IS NULL", returns_due: "r.assignment_type = 'TEMPORARY' AND r.issued_at IS NOT NULL AND r.returned_at IS NULL AND r.expected_return_date <= current_date + 7",
  returned: "r.returned_at IS NOT NULL", closed: "r.status IN ('REJECTED', 'CANCELLED', 'RECOVERY_REQUIRED')",
});
const rowOf = (r) => ({ id: r.id, number: r.request_number, assetId: r.asset_id, asset: r.asset_id ? `${r.asset_number} · ${r.asset_name}` : `Any ${r.category ?? "asset"}`, serialNumber: r.serial_number ?? null,
  recipientType: r.recipient_type, recipientLabel: RECIPIENT[r.recipient_type], recipient: r.to_user ?? r.to_department ?? r.to_store ?? "—", location: r.location_name ?? "—", purpose: r.purpose,
  assignmentType: r.assignment_type, status: r.status, statusLabel: STATUS[r.status], acknowledgment: r.acknowledgment, acknowledgmentLabel: r.acknowledgment ? ACK[r.acknowledgment] : null, issuedAt: r.issued_at,
  expectedReturn: dayOfDb(r.expected_return_date), originalExpectedReturn: dayOfDb(r.original_expected_return_date), returnedAt: r.returned_at, requestedBy: r.requester, requestedAt: r.created_at,
  overdue: Boolean(r.assignment_type === "TEMPORARY" && r.issued_at && !r.returned_at && r.expected_return_date && dayOfDb(r.expected_return_date) < new Date().toISOString().slice(0, 10)), href: `/assets/assignments/${r.id}` });
async function scoped(client, c, where, values) {
  if (assetTeam(c)) return { where, values };
  values.push(c.userId);
  return { where: `${where} AND (r.requested_by = $${values.length} OR r.to_user_id = $${values.length})`, values };
}
// filters: { view?: all | pending | ready | awaiting | active | returns_due | returned | closed, search?, assetId?, userId? }
export async function listAssignmentRequests(client, c, filters = {}) {
  requireSees(c);
  const values = [c.organizationId];
  let where = "r.organization_id = $1";
  if (VIEWS[filters.view]) where += ` AND ${VIEWS[filters.view]}`;
  if (filters.search) { values.push(`%${String(filters.search).slice(0, 100)}%`); where += ` AND (r.request_number ILIKE $${values.length} OR a.asset_number ILIKE $${values.length} OR a.name ILIKE $${values.length} OR u.full_name ILIKE $${values.length})`; }
  if (filters.assetId) { values.push(idOf(filters.assetId, "Asset")); where += ` AND r.asset_id = $${values.length}`; }
  if (filters.userId) { values.push(idOf(filters.userId, "Employee")); where += ` AND r.to_user_id = $${values.length}`; }
  const s = await scoped(client, c, where, values);
  // Bring the visible open requests in step with their custody records first.
  for (const r of (await client.query(`SELECT * FROM tenant.asset_assignment_requests r WHERE r.organization_id = $1 AND r.status IN ('IN_TRANSFER', 'ISSUED_AWAITING_ACKNOWLEDGMENT', 'FULFILLED') AND r.returned_at IS NULL LIMIT 500`, [c.organizationId])).rows) {
    await syncAssignment(client, c, r);
  }
  const rows = (await client.query(`${LIST} WHERE ${s.where} ORDER BY r.created_at DESC LIMIT 500`, s.values)).rows;
  return { rows: rows.map(rowOf), can: { request: has(c, ASG.request), team: assetTeam(c), bulk: has(c, ASG.bulk), export: has(c, ASG.export) } };
}
export async function getAssignmentRequest(client, c, requestId) {
  requireSees(c);
  const values = [c.organizationId, idOf(requestId, "Assignment")];
  const s = await scoped(client, c, "r.organization_id = $1 AND r.id = $2", values);
  const found = (await client.query(`SELECT r.* FROM tenant.asset_assignment_requests r LEFT JOIN public.users u ON u.id = r.to_user_id LEFT JOIN tenant.assets a ON a.id = r.asset_id WHERE ${s.where}`, s.values)).rows[0];
  if (!found) throw asgError(404, "ASSET_ASSIGNMENT_NOT_FOUND");
  await syncAssignment(client, c, found);
  const r = (await client.query(`${LIST} WHERE r.id = $1`, [found.id])).rows[0];
  const holder = r.asset_id ? (await client.query(`SELECT k.*, COALESCE(NULLIF(u.full_name, ''), u.email, d.name, st.name) AS label FROM tenant.asset_custody_assignments k LEFT JOIN public.users u ON u.id = k.user_id
      LEFT JOIN public.departments d ON d.id = k.department_id LEFT JOIN tenant.asset_locations st ON st.id = k.store_location_id WHERE k.asset_id = $1 AND k.status = 'ACTIVE'`, [r.asset_id])).rows[0] : null;
  const reservation = (await client.query(`SELECT status, created_at, released_at, release_reason FROM tenant.asset_operation_reservations WHERE source_type = 'ASSIGNMENT' AND source_id = $1 ORDER BY created_at DESC LIMIT 1`, [r.id])).rows[0];
  const handover = r.custody_handover_id ? (await client.query(`SELECT h.handover_number, h.status, h.physical_handover_at, h.accessories, (SELECT decision FROM tenant.asset_custody_acknowledgments k WHERE k.handover_id = h.id ORDER BY k.recorded_at DESC LIMIT 1) AS decision,
      (SELECT dispute_reason FROM tenant.asset_custody_acknowledgments k WHERE k.handover_id = h.id ORDER BY k.recorded_at DESC LIMIT 1) AS dispute FROM tenant.asset_custody_handovers h WHERE h.id = $1`, [r.custody_handover_id])).rows[0] : null;
  const transfer = r.transfer_id ? (await client.query(`SELECT id, transfer_number, status FROM tenant.asset_transfer_orders WHERE id = $1`, [r.transfer_id])).rows[0] : null;
  const events = (await client.query(`SELECT e.*, ${NAME("u")} AS actor FROM tenant.asset_assignment_events e LEFT JOIN public.users u ON u.id = e.actor_user_id WHERE e.request_id = $1 ORDER BY e.occurred_at`, [r.id])).rows;
  const mine = r.requested_by === c.userId;
  const recipient = r.to_user_id === c.userId;
  const issued = Boolean(r.issued_at) && !r.returned_at;
  return {
    ...rowOf(r), category: r.category, deliverToLocationId: r.deliver_to_location_id, requestedIssueDate: dayOfDb(r.requested_issue_date), approvalStatus: r.approval_status, decisionNote: r.decision_note,
    issueCondition: r.issue_condition, accessories: r.accessories, returnCondition: r.return_condition, cancelReason: r.cancel_reason, version: r.row_version,
    current: { custodian: holder?.label ?? null, since: holder?.effective_from ?? null, location: r.location_name ?? null },
    reservation: reservation ? { status: reservation.status, since: reservation.created_at, releasedAt: reservation.released_at, reason: reservation.release_reason } : null,
    handover: handover ? { number: `HND-${handover.handover_number}`, status: handover.status, at: handover.physical_handover_at, decision: handover.decision, dispute: handover.dispute } : null,
    transfer: transfer ? { id: transfer.id, number: transfer.transfer_number, status: transfer.status, href: `/assets/transfers/${transfer.id}` } : null,
    events: events.map((e) => ({ id: e.id, action: e.action, from: e.from_status, to: e.to_status, reason: e.reason, by: e.actor, at: e.occurred_at })),
    can: {
      submit: ["DRAFT", "CHANGES_REQUESTED"].includes(r.status) && (mine || has(c, ASG.manage)) && has(c, ASG.request), approve: r.status === "PENDING_APPROVAL" && has(c, ASG.approve) && !mine,
      chooseAsset: r.status === "PENDING_APPROVAL" && !r.asset_id && has(c, ASG.approve) && !mine, reject: ["PENDING_APPROVAL", "CHANGES_REQUESTED"].includes(r.status) && has(c, ASG.approve),
      issue: r.status === "READY_TO_ISSUE" && has(c, ASG.issue), cancel: ["DRAFT", "PENDING_APPROVAL", "CHANGES_REQUESTED", "READY_TO_ISSUE"].includes(r.status) && (mine || has(c, ASG.manage)),
      acknowledge: issued && recipient && r.acknowledgment === "PENDING", requestReturn: issued && (recipient || has(c, ASG.manage)), receiveReturn: issued && has(c, ASG.return),
      extend: issued && r.assignment_type === "TEMPORARY" && has(c, ASG.extend), reassign: issued && has(c, ASG.request) && assetTeam(c),
    },
    note: "The request is the decision; custody changes only at the physical handover, and the acknowledgment is the recipient's own.",
  };
}
// Assets free to assign now: in service (or in a store), serviceable, not reserved, not in transfer or under maintenance, not held by a person.
export async function getAssignableAssets(client, c, filters = {}) {
  if (!assetTeam(c)) throw asgError(403, "ASSET_ASSIGNMENT_PERMISSION_DENIED");
  const values = [c.organizationId];
  let where = "";
  if (filters.categoryId) { values.push(idOf(filters.categoryId, "Category")); where += ` AND a.category_id = $${values.length}`; }
  if (filters.search) { values.push(`%${String(filters.search).slice(0, 100)}%`); where += ` AND (a.asset_number ILIKE $${values.length} OR a.name ILIKE $${values.length} OR a.serial_number ILIKE $${values.length})`; }
  const rows = (await client.query(`SELECT a.id, a.asset_number, a.name, a.serial_number, a.condition, cat.name AS category, l.name AS location, s.name AS store FROM tenant.assets a JOIN tenant.asset_categories cat ON cat.id = a.category_id
      LEFT JOIN tenant.asset_locations l ON l.id = a.location_id LEFT JOIN tenant.asset_locations s ON s.id = a.current_store_location_id
      WHERE a.organization_id = $1 AND a.archived_at IS NULL AND a.lifecycle_status = 'ACTIVE' AND a.condition IS DISTINCT FROM 'UNSERVICEABLE' AND cat.custodian_policy <> 'NOT_APPLICABLE'
        AND tenant.asset_effective_availability(a) = 'AVAILABLE' AND a.current_user_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM tenant.asset_operation_reservations r WHERE r.asset_id = a.id AND r.status = 'ACTIVE')
        AND NOT EXISTS (SELECT 1 FROM tenant.asset_custody_handovers h WHERE h.asset_id = a.id AND h.status = 'PENDING_HANDOVER') ${where} ORDER BY a.asset_number LIMIT 300`, values)).rows;
  return { rows: rows.map((r) => ({ assetId: r.id, asset: `${r.asset_number} · ${r.name}`, serialNumber: r.serial_number, category: r.category, location: r.location, store: r.store, condition: r.condition })) };
}
// The asset's assignment panel (Custody & Location tab).
export async function getAssetAssignmentPanel(client, c, assetId) {
  const id = idOf(assetId, "Asset");
  if (!seesAssignments(c)) return { visible: false };
  const rows = (await client.query(`${LIST} WHERE r.organization_id = $1 AND r.asset_id = $2 ORDER BY r.created_at DESC LIMIT 50`, [c.organizationId, id])).rows;
  if (!assetTeam(c) && !rows.some((r) => r.to_user_id === c.userId || r.requested_by === c.userId)) return { visible: false };
  for (const r of rows.filter((x) => ["IN_TRANSFER", "ISSUED_AWAITING_ACKNOWLEDGMENT", "FULFILLED"].includes(x.status) && !x.returned_at)) await syncAssignment(client, c, r);
  const fresh = (await client.query(`${LIST} WHERE r.organization_id = $1 AND r.asset_id = $2 ORDER BY r.created_at DESC LIMIT 50`, [c.organizationId, id])).rows.map(rowOf);
  const current = fresh.find((r) => r.issuedAt && !r.returnedAt && ["ISSUED_AWAITING_ACKNOWLEDGMENT", "FULFILLED"].includes(r.status)) ?? null;
  const open = fresh.find((r) => ["DRAFT", "PENDING_APPROVAL", "CHANGES_REQUESTED", "READY_TO_ISSUE", "IN_TRANSFER"].includes(r.status)) ?? null;
  return { visible: true, assetId: id, current, open, history: fresh, can: { assign: assetTeam(c) && has(c, ASG.request) && !open } };
}
// The employee's own requests (My Assets).
export async function getMyAssignmentRequests(client, c) {
  requireSees(c);
  const rows = (await client.query(`${LIST} WHERE r.organization_id = $1 AND (r.requested_by = $2 OR r.to_user_id = $2) ORDER BY r.created_at DESC LIMIT 100`, [c.organizationId, c.userId])).rows;
  return { rows: rows.map(rowOf), can: { request: has(c, ASG.request) } };
}

// ------------------------------------------------------------------ exceptions, reports, history, export
export async function getAssignmentExceptions(client, c) {
  requireSees(c);
  const out = [];
  const team = assetTeam(c);
  const q = async (sql) => (await client.query(sql, team ? [c.organizationId] : [c.organizationId, c.userId])).rows;
  const scope = team ? "" : "AND (r.requested_by = $2 OR r.to_user_id = $2)";
  for (const r of await q(`${LIST} WHERE r.organization_id = $1 AND r.acknowledgment = 'DISPUTED' AND r.returned_at IS NULL ${scope}`)) out.push({ kind: "DISPUTED", label: "Receipt disputed", ...rowOf(r) });
  for (const r of await q(`${LIST} WHERE r.organization_id = $1 AND r.assignment_type = 'TEMPORARY' AND r.issued_at IS NOT NULL AND r.returned_at IS NULL AND r.expected_return_date < current_date ${scope}`)) out.push({ kind: "OVERDUE_RETURN", label: "Return overdue", ...rowOf(r) });
  for (const r of await q(`${LIST} WHERE r.organization_id = $1 AND r.status = 'READY_TO_ISSUE' AND r.updated_at < now() - interval '7 days' ${scope}`)) out.push({ kind: "NOT_ISSUED", label: "Reserved but not issued for a week", ...rowOf(r) });
  for (const r of await q(`${LIST} WHERE r.organization_id = $1 AND r.status = 'RECOVERY_REQUIRED' ${scope}`)) out.push({ kind: "TRANSFER_CONFLICT", label: "The delivery transfer did not complete", ...rowOf(r) });
  for (const r of await q(`${LIST} WHERE r.organization_id = $1 AND r.issued_at IS NOT NULL AND r.returned_at IS NULL AND r.recipient_type = 'EMPLOYEE' ${scope}
      AND EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.organization_id = r.organization_id AND m.user_id = r.to_user_id AND m.status <> 'active')`)) out.push({ kind: "INACTIVE_RECIPIENT", label: "Holder is no longer an active member", ...rowOf(r) });
  for (const r of await q(`${LIST} WHERE r.organization_id = $1 AND r.issued_at IS NOT NULL AND r.returned_at IS NULL ${scope}
      AND (a.condition IN ('DAMAGED', 'UNSERVICEABLE') OR EXISTS (SELECT 1 FROM tenant.asset_missing_incidents i WHERE i.asset_id = r.asset_id AND i.status = 'OPEN'))`)) out.push({ kind: "DAMAGED_MISSING", label: "Assigned asset damaged or missing", ...rowOf(r) });
  return out;
}
export const ASSIGNMENT_REPORTS = Object.freeze(["assets-by-employee", "assets-by-department", "available-for-assignment", "pending-requests", "reserved-not-issued", "issued-not-acknowledged", "temporary-assignments",
  "overdue-returns", "employee-clearance", "damaged-missing", "assignment-history", "assignment-transfer-conflicts", "bulk-results"]);
export async function getAssignmentReport(client, c, kind) {
  if (!ASSIGNMENT_REPORTS.includes(kind)) throw asgError(400, "ASSET_ASSIGNMENT_INVALID", "Unknown report.");
  requireSees(c);
  const list = async (v) => (await listAssignmentRequests(client, c, { view: v })).rows;
  const brief = (r) => ({ assignment: r.number, asset: r.asset, recipient: r.recipient, status: r.statusLabel, href: r.href });
  switch (kind) {
    case "assets-by-employee": return (await list("active")).filter((r) => r.recipientType === "EMPLOYEE").map((r) => ({ employee: r.recipient, asset: r.asset, since: r.issuedAt, acknowledgment: r.acknowledgmentLabel ?? "—", href: r.href }));
    case "assets-by-department": return (await list("active")).filter((r) => r.recipientType === "DEPARTMENT").map((r) => ({ department: r.recipient, asset: r.asset, since: r.issuedAt, href: r.href }));
    case "available-for-assignment": return assetTeam(c) ? (await getAssignableAssets(client, c, {})).rows.map((r) => ({ asset: r.asset, category: r.category, location: r.location ?? "—", store: r.store ?? "—" })) : [];
    case "pending-requests": return (await list("pending")).map(brief);
    case "reserved-not-issued": return (await list("ready")).map(brief);
    case "issued-not-acknowledged": return (await list("awaiting")).map(brief);
    case "temporary-assignments": return (await list("active")).filter((r) => r.assignmentType === "TEMPORARY").map((r) => ({ ...brief(r), expectedReturn: r.expectedReturn }));
    case "overdue-returns": return (await getAssignmentExceptions(client, c)).filter((e) => e.kind === "OVERDUE_RETURN").map((e) => ({ assignment: e.number, asset: e.asset, recipient: e.recipient, expectedReturn: e.expectedReturn, href: e.href }));
    case "employee-clearance": return (await getAssignmentExceptions(client, c)).filter((e) => e.kind === "INACTIVE_RECIPIENT").map((e) => ({ employee: e.recipient, asset: e.asset, assignment: e.number, href: e.href }));
    case "damaged-missing": return (await getAssignmentExceptions(client, c)).filter((e) => e.kind === "DAMAGED_MISSING").map((e) => ({ asset: e.asset, recipient: e.recipient, assignment: e.number, href: e.href }));
    case "assignment-history": return (await list("all")).map((r) => ({ ...brief(r), issued: r.issuedAt ?? "—", returned: r.returnedAt ?? "—" }));
    case "assignment-transfer-conflicts": return (await getAssignmentExceptions(client, c)).filter((e) => e.kind === "TRANSFER_CONFLICT").map((e) => ({ assignment: e.number, asset: e.asset, href: e.href }));
    case "bulk-results": return assetTeam(c) ? (await client.query(`SELECT batch_number, status, succeeded, failed, created_at FROM tenant.asset_assignment_batches WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100`, [c.organizationId])).rows
      .map((b) => ({ batch: b.batch_number, status: b.status, succeeded: b.succeeded, failed: b.failed, at: b.created_at })) : [];
    default: return [];
  }
}
export async function getAssignmentHistory(client, c, filters = {}) {
  if (!has(c, ASG.history) && !has(c, ASG.manage)) throw asgError(403, "ASSET_ASSIGNMENT_PERMISSION_DENIED");
  const values = [c.organizationId];
  let where = "";
  if (filters.assetId) { values.push(idOf(filters.assetId, "Asset")); where = `AND e.asset_id = $${values.length}`; }
  return (await client.query(`SELECT e.*, r.request_number, ${NAME("u")} AS actor, a.asset_number FROM tenant.asset_assignment_events e JOIN tenant.asset_assignment_requests r ON r.id = e.request_id
      LEFT JOIN public.users u ON u.id = e.actor_user_id LEFT JOIN tenant.assets a ON a.id = e.asset_id WHERE e.organization_id = $1 ${where} ORDER BY e.occurred_at DESC LIMIT 1000`, values)).rows
    .map((e) => ({ id: e.id, assignment: e.request_number, action: e.action, from: e.from_status, to: e.to_status, asset: e.asset_number, reason: e.reason, by: e.actor, at: e.occurred_at }));
}
const csvCell = (value) => { const s = value === null || value === undefined ? "" : String(value); return /[",\r\n]/.test(s) || /^[=+@-]/.test(s) ? `"${(/^[=+@-]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
export async function exportAssignments(client, c) {
  if (!has(c, ASG.export)) throw asgError(403, "ASSET_ASSIGNMENT_PERMISSION_DENIED");
  const rows = (await listAssignmentRequests(client, c, {})).rows;
  const header = ["Assignment", "Asset", "Recipient type", "Recipient", "Purpose", "Kind", "Status", "Acknowledgment", "Issued", "Expected return", "Returned"];
  return { fileName: "asset-assignments.csv", csv: [header, ...rows.map((r) => [r.number, r.asset, r.recipientLabel, r.recipient, r.purpose, r.assignmentType === "TEMPORARY" ? "Temporary" : "Ongoing", r.statusLabel,
    r.acknowledgmentLabel ?? "", r.issuedAt ?? "", r.expectedReturn ?? "", r.returnedAt ?? ""])].map((l) => l.map(csvCell).join(",")).join("\r\n") };
}
