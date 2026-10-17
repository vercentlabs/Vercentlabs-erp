// Assets — Custodian, the reads: one asset's custody (current custodian, accountable person, since when, expected return, condition at
// issue, acknowledgment; any open handover; the legal owner, registered location and physical whereabouts shown apart); its custody
// history; the custody workspace views; an employee's own assets and clearance; exceptions; reports and export.
import { has, qx, text, uuid } from "../common.js";
import { LIFECYCLE, seesRegister } from "../asset-register/register-rules.js";
import { ACKNOWLEDGMENT, CUSTODIAN_TYPE, CUSTODY, DISPUTE_REASON, EXCEPTION_KIND, HANDOVER_KIND, HANDOVER_STATUS, custodyError, managesCustody, seesCustodyHistory } from "./custody-rules.js";

const NAME = (alias) => `COALESCE(NULLIF(${alias}.full_name, ''), ${alias}.email)`;
// A custody period with its holder's names.
const ASSIGNMENT = `SELECT x.*, ${NAME("u")} AS user_name, d.name AS department_name, s.name AS store_name, ${NAME("acc")} AS accountable_name, m.status AS member_status,
    a.asset_number, a.name AS asset_name, a.lifecycle_status, a.location_id
  FROM tenant.asset_custody_assignments x JOIN tenant.assets a ON a.id = x.asset_id LEFT JOIN public.users u ON u.id = x.user_id LEFT JOIN public.departments d ON d.id = x.department_id
  LEFT JOIN tenant.asset_locations s ON s.id = x.store_location_id LEFT JOIN public.users acc ON acc.id = x.accountable_user_id
  LEFT JOIN public.organization_memberships m ON m.user_id = x.user_id AND m.organization_id = x.organization_id`;
const holderOf = (r) => (r.custodian_type === "EMPLOYEE" ? r.user_name : r.custodian_type === "DEPARTMENT" ? r.department_name : r.store_name);
function assignmentOf(r) {
  return { id: r.id, assetId: r.asset_id, asset: `${r.asset_number} · ${r.asset_name}`, assetHref: `/assets/register/${r.asset_id}?tab=custody`, lifecycleLabel: LIFECYCLE[r.lifecycle_status],
    type: r.custodian_type, typeLabel: CUSTODIAN_TYPE[r.custodian_type], custodian: holderOf(r), userId: r.user_id, department: r.department_name ?? null, storeLocationId: r.store_location_id,
    accountable: r.accountable_name ?? null, accountableUserId: r.accountable_user_id, since: r.effective_from, until: r.effective_to, conditionAtIssue: r.condition_at_issue, conditionAtReturn: r.condition_at_return,
    expectedReturn: r.expected_return_at ?? null, overdue: Boolean(r.expected_return_at && r.status === "ACTIVE" && new Date(r.expected_return_at) < new Date(new Date().toISOString().slice(0, 10))),
    returnRequestedAt: r.return_requested_at ?? null, acknowledgment: r.acknowledgment, acknowledgmentLabel: ACKNOWLEDGMENT[r.acknowledgment], source: r.source, status: r.status,
    custodianInactive: r.custodian_type === "EMPLOYEE" && r.member_status !== "active" };
}
const HANDOVER = `SELECT h.*, a.asset_number, a.name AS asset_name, ${NAME("tu")} AS to_user_name, td.name AS to_department_name, ts.name AS to_store_name, ${NAME("r")} AS recipient_name, ${NAME("i")} AS issuer_name
  FROM tenant.asset_custody_handovers h JOIN tenant.assets a ON a.id = h.asset_id LEFT JOIN public.users tu ON tu.id = h.to_user_id LEFT JOIN public.departments td ON td.id = h.to_department_id
  LEFT JOIN tenant.asset_locations ts ON ts.id = h.to_store_location_id LEFT JOIN public.users r ON r.id = h.recipient_user_id LEFT JOIN public.users i ON i.id = h.issued_by`;
function handoverOf(h, c) {
  return { id: h.id, number: `HND-${h.handover_number}`, assetId: h.asset_id, asset: `${h.asset_number} · ${h.asset_name}`, assetHref: `/assets/register/${h.asset_id}?tab=custody`,
    kind: h.kind, kindLabel: HANDOVER_KIND[h.kind], toType: h.to_type, to: h.to_type === "EMPLOYEE" ? h.to_user_name : h.to_type === "DEPARTMENT" ? h.to_department_name : h.to_store_name,
    recipient: h.recipient_name, recipientUserId: h.recipient_user_id, issuedBy: h.issuer_name, status: h.status, statusLabel: HANDOVER_STATUS[h.status], physicalAt: h.physical_handover_at,
    acknowledgedAt: h.acknowledged_at, condition: h.condition_at_handover, accessories: h.accessories, expectedReturn: h.expected_return_at, notes: h.notes, createdAt: h.created_at,
    mine: c ? h.recipient_user_id === c.userId : false };
}
async function assetFor(client, c, assetId) {
  const { loadAssetRow } = await import("../asset-register/register-commands.js");
  return loadAssetRow(client, c, assetId);
}

// ------------------------------------------------------------------ one asset
export async function getAssetCustody(client, c, assetId) {
  const asset = await assetFor(client, c, assetId);
  const current = (await qx(client, `${ASSIGNMENT} WHERE x.asset_id = $1 AND x.status = 'ACTIVE'`, [asset.id])).rows[0] ?? null;
  const open = (await qx(client, `${HANDOVER} WHERE h.asset_id = $1 AND h.status IN ('PENDING_HANDOVER', 'AWAITING_ACKNOWLEDGMENT', 'DISPUTED')`, [asset.id])).rows[0] ?? null;
  const owner = (await client.query(`SELECT name FROM public.organizations WHERE id = $1`, [c.organizationId]).catch(() => ({ rows: [] }))).rows[0]?.name ?? null;
  const repair = (await client.query(`SELECT o.observed_location_text, l.name FROM tenant.asset_location_observations o LEFT JOIN tenant.asset_locations l ON l.id = o.observed_location_id
      WHERE o.asset_id = $1 AND o.kind = 'MAINTENANCE' AND o.ended_at IS NULL AND (o.expires_at IS NULL OR o.expires_at > now()) ORDER BY o.observed_at DESC LIMIT 1`, [asset.id]).catch(() => ({ rows: [] }))).rows[0];
  const exception = (await client.query(`SELECT id, kind, description FROM tenant.asset_custody_exceptions WHERE asset_id = $1 AND status = 'OPEN' ORDER BY created_at DESC LIMIT 1`, [asset.id])).rows[0] ?? null;
  const ended = ["DISPOSED", "LOST"].includes(asset.lifecycle_status) || Boolean(asset.archived_at);
  const isCustodian = current?.user_id === c.userId;
  return {
    assetId: asset.id, legalOwner: owner, current: current ? assignmentOf(current) : null, openHandover: open ? handoverOf(open, c) : null,
    physicalHolder: repair ? `At maintenance: ${repair.name ?? repair.observed_location_text}` : null,
    exception: exception ? { id: exception.id, kind: exception.kind, kindLabel: EXCEPTION_KIND[exception.kind], description: exception.description } : null,
    note: "Custody is accountability for safeguarding the asset. The legal owner and the registered location do not change with it.",
    can: {
      issue: !ended && !open && has(c, (!current || current.custodian_type === "ASSET_STORE") ? CUSTODY.assign : CUSTODY.reassign),
      return: !ended && Boolean(current) && current.custodian_type !== "ASSET_STORE" && has(c, CUSTODY.return),
      confirmHandover: open?.status === "PENDING_HANDOVER" && managesCustody(c), cancel: open?.status === "PENDING_HANDOVER" && (managesCustody(c) || open.created_by === c.userId),
      acknowledge: open?.status === "AWAITING_ACKNOWLEDGMENT" && open.recipient_user_id === c.userId && has(c, CUSTODY.acknowledge),
      dispute: open?.status === "AWAITING_ACKNOWLEDGMENT" && open.recipient_user_id === c.userId && has(c, CUSTODY.dispute),
      waive: open?.status === "AWAITING_ACKNOWLEDGMENT" && has(c, CUSTODY.exceptions), resolve: Boolean(exception) && has(c, CUSTODY.exceptions),
      requestReturn: isCustodian && !current?.return_requested_at, history: seesCustodyHistory(c) || isCustodian,
    },
  };
}
export async function getAssetCustodyHistory(client, c, assetId) {
  const asset = await assetFor(client, c, assetId);
  if (!seesCustodyHistory(c) && !seesRegister(c)) throw custodyError(403, "ASSET_CUSTODY_PERMISSION_DENIED");
  const assignments = (await qx(client, `${ASSIGNMENT} WHERE x.asset_id = $1 ORDER BY x.effective_from DESC, x.created_at DESC`, [asset.id])).rows.map(assignmentOf);
  const handovers = (await qx(client, `${HANDOVER} WHERE h.asset_id = $1 ORDER BY h.created_at DESC`, [asset.id])).rows.map((h) => handoverOf(h, c));
  const acks = (await client.query(`SELECT k.*, ${NAME("u")} AS by FROM tenant.asset_custody_acknowledgments k JOIN tenant.asset_custody_handovers h ON h.id = k.handover_id LEFT JOIN public.users u ON u.id = k.user_id
      WHERE h.asset_id = $1 ORDER BY k.recorded_at DESC`, [asset.id])).rows.map((k) => ({ id: k.id, handoverId: k.handover_id, decision: k.decision, reason: k.dispute_reason ? DISPUTE_REASON[k.dispute_reason] : null,
    comment: k.comment, onBehalf: k.on_behalf, by: k.by, at: k.recorded_at }));
  return { assignments, handovers, acknowledgments: acks };
}

// ------------------------------------------------------------------ the workspace
// filters: { view: active | pending | awaiting | returns_due | disputes | store | unacknowledged, userId?, departmentId?, storeLocationId?, search? }
export async function getCustodyWorkspace(client, c, filters = {}) {
  if (!seesRegister(c)) throw custodyError(403, "ASSET_CUSTODY_PERMISSION_DENIED");
  const view = String(filters.view ?? "active");
  const values = [c.organizationId];
  const bind = (v) => { values.push(v); return `$${values.length}`; };
  if (["pending", "awaiting", "disputes"].includes(view)) {
    const status = { pending: "PENDING_HANDOVER", awaiting: "AWAITING_ACKNOWLEDGMENT", disputes: "DISPUTED" }[view];
    const rows = (await qx(client, `${HANDOVER} WHERE h.organization_id = $1 AND h.status = ${bind(status)} ORDER BY h.created_at`, values)).rows.map((h) => handoverOf(h, c));
    return { kind: "handovers", rows };
  }
  const where = ["x.organization_id = $1", "x.status = 'ACTIVE'"];
  if (view === "returns_due") where.push("x.expected_return_at IS NOT NULL AND x.expected_return_at <= current_date + 7");
  if (view === "store") where.push("x.custodian_type = 'ASSET_STORE'");
  if (view === "unacknowledged") where.push("x.acknowledgment IN ('PENDING', 'DISPUTED')");
  if (filters.userId) where.push(`x.user_id = ${bind(uuid(filters.userId, "Employee"))}`);
  if (filters.departmentId) where.push(`x.department_id = ${bind(uuid(filters.departmentId, "Department"))}`);
  if (filters.storeLocationId) where.push(`x.store_location_id = ${bind(uuid(filters.storeLocationId, "Store"))}`);
  if (filters.search) { const t = bind(`%${text(filters.search, 100).replace(/[%_]/g, "\\$&")}%`); where.push(`(a.asset_number ILIKE ${t} OR a.name ILIKE ${t} OR u.full_name ILIKE ${t} OR u.email ILIKE ${t} OR d.name ILIKE ${t} OR s.name ILIKE ${t})`); }
  const rows = (await qx(client, `${ASSIGNMENT} WHERE ${where.join(" AND ")} ORDER BY ${view === "returns_due" ? "x.expected_return_at" : "x.effective_from DESC"} LIMIT 1000`, values)).rows.map(assignmentOf);
  return { kind: "assignments", rows };
}
// The employee's own assets, with anything waiting for them.
export async function getMyCustody(client, c) {
  const rows = (await qx(client, `${ASSIGNMENT} WHERE x.organization_id = $1 AND x.status = 'ACTIVE' AND (x.user_id = $2 OR (x.custodian_type <> 'EMPLOYEE' AND x.accountable_user_id = $2)) ORDER BY x.effective_from DESC`,
    [c.organizationId, c.userId])).rows.map(assignmentOf);
  const waiting = (await qx(client, `${HANDOVER} WHERE h.organization_id = $1 AND h.recipient_user_id = $2 AND h.status = 'AWAITING_ACKNOWLEDGMENT' ORDER BY h.physical_handover_at`, [c.organizationId, c.userId])).rows.map((h) => handoverOf(h, c));
  return { rows, awaitingMe: waiting, can: { acknowledge: has(c, CUSTODY.acknowledge), dispute: has(c, CUSTODY.dispute) } };
}
// What an employee still holds: the clearance list for offboarding. Never a charge, never a liability decision.
export async function getCustodyClearance(client, c, userId) {
  const id = uuid(userId, "Employee");
  if (id !== c.userId && !has(c, CUSTODY.clearance) && !managesCustody(c)) throw custodyError(403, "ASSET_CUSTODY_PERMISSION_DENIED");
  const person = (await client.query(`SELECT u.id, ${NAME("u")} AS name, u.email, m.status AS member_status FROM public.users u LEFT JOIN public.organization_memberships m ON m.user_id = u.id AND m.organization_id = $1 WHERE u.id = $2`,
    [c.organizationId, id])).rows[0];
  if (!person || !person.member_status) throw custodyError(404, "ASSET_CUSTODY_NOT_FOUND", "This person is not a member of the Company.");
  const held = (await qx(client, `${ASSIGNMENT} WHERE x.organization_id = $1 AND x.status = 'ACTIVE' AND x.user_id = $2 ORDER BY x.effective_from`, [c.organizationId, id])).rows.map(assignmentOf);
  const accountable = (await qx(client, `${ASSIGNMENT} WHERE x.organization_id = $1 AND x.status = 'ACTIVE' AND x.custodian_type <> 'EMPLOYEE' AND x.accountable_user_id = $2`, [c.organizationId, id])).rows.map(assignmentOf);
  const handovers = (await qx(client, `${HANDOVER} WHERE h.organization_id = $1 AND h.status IN ('PENDING_HANDOVER', 'AWAITING_ACKNOWLEDGMENT', 'DISPUTED') AND (h.to_user_id = $2 OR h.recipient_user_id = $2)`, [c.organizationId, id])).rows.map((h) => handoverOf(h, c));
  const cannot = (await client.query(`SELECT e.id, e.description, a.asset_number FROM tenant.asset_custody_exceptions e JOIN tenant.asset_custody_assignments x ON x.id = e.assignment_id JOIN tenant.assets a ON a.id = e.asset_id
      WHERE e.organization_id = $1 AND e.kind = 'CANNOT_RETURN' AND x.user_id = $2`, [c.organizationId, id])).rows;
  const open = held.length + handovers.length;
  return { userId: person.id, name: person.name, email: person.email, active: person.member_status === "active", status: open ? "OPEN" : "CLEAR", statusLabel: open ? "Assets to return or hand over" : "Clear",
    assets: held, accountableFor: accountable, openHandovers: handovers, recordedExceptions: cannot.map((e) => ({ id: e.id, asset: e.asset_number, note: e.description })),
    note: "This is the asset clearance status. It does not decide salary, deductions or the end of employment." };
}
// Everyone who still holds assets, inactive members first — the offboarding queue.
export async function getClearanceList(client, c) {
  if (!has(c, CUSTODY.clearance) && !managesCustody(c)) throw custodyError(403, "ASSET_CUSTODY_PERMISSION_DENIED");
  const rows = (await client.query(`SELECT x.user_id, ${NAME("u")} AS name, m.status AS member_status, count(*)::int AS assets, min(x.expected_return_at) AS next_due FROM tenant.asset_custody_assignments x
      JOIN public.users u ON u.id = x.user_id LEFT JOIN public.organization_memberships m ON m.user_id = x.user_id AND m.organization_id = x.organization_id
      WHERE x.organization_id = $1 AND x.status = 'ACTIVE' AND x.custodian_type = 'EMPLOYEE' GROUP BY 1, 2, 3 ORDER BY (m.status = 'active'), 2`, [c.organizationId])).rows;
  return { rows: rows.map((r) => ({ userId: r.user_id, name: r.name, active: r.member_status === "active", assets: r.assets, nextDue: r.next_due, href: `/assets/custody/clearance/${r.user_id}` })) };
}
// Open exceptions plus what the records show: inactive custodians, acknowledgments outstanding a week, overdue returns, no accountable person.
export async function getCustodyExceptions(client, c) {
  if (!seesRegister(c)) throw custodyError(403, "ASSET_CUSTODY_PERMISSION_DENIED");
  const out = (await client.query(`SELECT e.*, a.asset_number, a.name FROM tenant.asset_custody_exceptions e JOIN tenant.assets a ON a.id = e.asset_id WHERE e.organization_id = $1 AND e.status = 'OPEN' ORDER BY e.created_at`, [c.organizationId])).rows
    .map((e) => ({ id: e.id, kind: e.kind, label: EXCEPTION_KIND[e.kind], asset: `${e.asset_number} · ${e.name}`, issue: e.description, href: `/assets/register/${e.asset_id}?tab=custody`, resolvable: true }));
  const derived = async (sql, kind, label, issue) => {
    for (const r of (await qx(client, sql, [c.organizationId])).rows) out.push({ id: null, kind, label, asset: `${r.asset_number} · ${r.asset_name}`, issue: issue(r), href: `/assets/register/${r.asset_id}?tab=custody`, resolvable: false });
  };
  await derived(`${ASSIGNMENT} WHERE x.organization_id = $1 AND x.status = 'ACTIVE' AND x.custodian_type = 'EMPLOYEE' AND m.status IS DISTINCT FROM 'active'`, "INACTIVE_CUSTODIAN", "Custodian has left", (r) => `${r.user_name} is no longer active.`);
  await derived(`${ASSIGNMENT} WHERE x.organization_id = $1 AND x.status = 'ACTIVE' AND x.acknowledgment = 'PENDING' AND x.effective_from < now() - interval '7 days'`, "UNACKNOWLEDGED", "Not acknowledged", (r) => `Handed to ${holderOf(r)} on ${String(r.effective_from).slice(0, 10)}.`);
  await derived(`${ASSIGNMENT} WHERE x.organization_id = $1 AND x.status = 'ACTIVE' AND x.expected_return_at < current_date`, "OVERDUE_RETURN", "Return overdue", (r) => `${holderOf(r)} was due to return it on ${String(r.expected_return_at).slice(0, 10)}.`);
  await derived(`${ASSIGNMENT} WHERE x.organization_id = $1 AND x.status = 'ACTIVE' AND x.accountable_user_id IS NULL`, "NO_ACCOUNTABLE", "No accountable person", (r) => `${CUSTODIAN_TYPE[r.custodian_type]} ${holderOf(r) ?? ""} has no accountable person.`);
  return out;
}
export async function getDepartmentCustodians(client, c) {
  if (!seesRegister(c)) throw custodyError(403, "ASSET_CUSTODY_PERMISSION_DENIED");
  return (await client.query(`SELECT d.id, d.name, d.code, x.accountable_user_id, ${NAME("u")} AS accountable FROM public.departments d LEFT JOIN tenant.asset_department_custody x ON x.department_id = d.id AND x.organization_id = d.organization_id
      LEFT JOIN public.users u ON u.id = x.accountable_user_id WHERE d.organization_id = $1 ORDER BY d.name`, [c.organizationId])).rows.map((r) => ({ id: r.id, name: r.name, code: r.code, accountableUserId: r.accountable_user_id, accountable: r.accountable ?? null }));
}
export async function getAssetStores(client, c) {
  return (await client.query(`SELECT l.id, l.name, l.code, l.manager_user_id, ${NAME("u")} AS manager FROM tenant.asset_locations l LEFT JOIN public.users u ON u.id = l.manager_user_id
      WHERE l.organization_id = $1 AND l.active AND l.is_asset_store ORDER BY l.name`, [c.organizationId])).rows.map((r) => ({ id: r.id, name: r.name, code: r.code, managerUserId: r.manager_user_id, manager: r.manager ?? null }));
}

// ------------------------------------------------------------------ reports and export
export const CUSTODY_REPORTS = Object.freeze(["custody-by-custodian", "custody-by-employee", "custody-by-department", "store-custody", "pending-handovers", "unacknowledged", "overdue-returns", "employee-clearance",
  "custody-history", "damaged-lost-by-custodian", "custody-disputes", "no-accountable", "inactive-with-assets", "custody-trend"]);
export async function getCustodyReport(client, c, kind) {
  if (!CUSTODY_REPORTS.includes(kind)) throw custodyError(400, "ASSET_CUSTODY_INVALID", "Unknown report.");
  if (!seesRegister(c)) throw custodyError(403, "ASSET_CUSTODY_PERMISSION_DENIED");
  const active = async (where = "") => (await qx(client, `${ASSIGNMENT} WHERE x.organization_id = $1 AND x.status = 'ACTIVE' ${where} ORDER BY 1`, [c.organizationId])).rows.map(assignmentOf);
  const group = (rows, keyOf) => { const m = new Map(); for (const r of rows) { const k = keyOf(r) ?? "—"; m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()].map(([k, n]) => ({ custodian: k, assets: n })).sort((a, b) => b.assets - a.assets); };
  switch (kind) {
    case "custody-by-custodian": return group(await active(), (r) => `${r.typeLabel}: ${r.custodian}`);
    case "custody-by-employee": return group(await active("AND x.custodian_type = 'EMPLOYEE'"), (r) => r.custodian);
    case "custody-by-department": return group(await active("AND x.department_id IS NOT NULL"), (r) => r.department);
    case "store-custody": return (await active("AND x.custodian_type = 'ASSET_STORE'")).map((r) => ({ store: r.custodian, asset: r.asset, since: r.since, accountable: r.accountable, href: r.assetHref }));
    case "pending-handovers": return (await getCustodyWorkspace(client, c, { view: "pending" })).rows.map((h) => ({ handover: h.number, asset: h.asset, to: h.to, kind: h.kindLabel, since: h.createdAt, href: h.assetHref }));
    case "unacknowledged": return (await active("AND x.acknowledgment IN ('PENDING', 'DISPUTED')")).map((r) => ({ asset: r.asset, custodian: r.custodian, since: r.since, state: r.acknowledgmentLabel, href: r.assetHref }));
    case "overdue-returns": return (await active("AND x.expected_return_at < current_date")).map((r) => ({ asset: r.asset, custodian: r.custodian, due: r.expectedReturn, href: r.assetHref }));
    case "employee-clearance": return (await getClearanceList(client, c)).rows.map((r) => ({ employee: r.name, status: r.active ? "Active" : "Left the Company", assets: r.assets, nextDue: r.nextDue ?? "—", href: r.href }));
    case "custody-history": return (await qx(client, `${ASSIGNMENT} WHERE x.organization_id = $1 ORDER BY x.effective_from DESC LIMIT 1000`, [c.organizationId])).rows.map(assignmentOf)
      .map((r) => ({ asset: r.asset, custodian: `${r.typeLabel}: ${r.custodian}`, from: r.since, until: r.until ?? "Current", acknowledgment: r.acknowledgmentLabel, href: r.assetHref }));
    case "damaged-lost-by-custodian": return (await qx(client, `${ASSIGNMENT} WHERE x.organization_id = $1 AND x.status = 'ACTIVE' AND (a.condition IN ('DAMAGED', 'UNSERVICEABLE') OR a.lifecycle_status = 'LOST'
        OR EXISTS (SELECT 1 FROM tenant.asset_missing_incidents i WHERE i.asset_id = a.id AND i.status = 'OPEN'))`, [c.organizationId])).rows.map(assignmentOf)
      .map((r) => ({ asset: r.asset, custodian: r.custodian, status: r.lifecycleLabel, note: "For investigation — not a finding of fault", href: r.assetHref }));
    case "custody-disputes": return (await getCustodyWorkspace(client, c, { view: "disputes" })).rows.map((h) => ({ handover: h.number, asset: h.asset, to: h.to, href: h.assetHref }));
    case "no-accountable": return (await active("AND x.accountable_user_id IS NULL")).map((r) => ({ asset: r.asset, custodian: `${r.typeLabel}: ${r.custodian}`, href: r.assetHref }));
    case "inactive-with-assets": return (await active("AND x.custodian_type = 'EMPLOYEE' AND m.status IS DISTINCT FROM 'active'")).map((r) => ({ employee: r.custodian, asset: r.asset, since: r.since, href: r.assetHref }));
    case "custody-trend": return (await client.query(`SELECT to_char(date_trunc('month', h.physical_handover_at), 'YYYY-MM') AS month, count(*) FILTER (WHERE h.kind <> 'RETURN')::int AS issued, count(*) FILTER (WHERE h.kind = 'RETURN')::int AS returned
        FROM tenant.asset_custody_handovers h WHERE h.organization_id = $1 AND h.physical_handover_at IS NOT NULL GROUP BY 1 ORDER BY 1 DESC LIMIT 24`, [c.organizationId])).rows;
    default: return [];
  }
}
const csvCell = (value) => { const s = value === null || value === undefined ? "" : String(value); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export async function exportCustody(client, c) {
  if (!has(c, CUSTODY.export)) throw custodyError(403, "ASSET_CUSTODY_PERMISSION_DENIED");
  const rows = (await getCustodyWorkspace(client, c, { view: "active" })).rows;
  const header = ["Asset", "Custodian type", "Custodian", "Department", "Accountable", "Since", "Expected return", "Acknowledgment", "Condition at issue"];
  return { fileName: "asset-custody.csv", csv: [header, ...rows.map((r) => [r.asset, r.typeLabel, r.custodian, r.department, r.accountable, r.since, r.expectedReturn, r.acknowledgmentLabel, r.conditionAtIssue])]
    .map((l) => l.map(csvCell).join(",")).join("\r\n") };
}
