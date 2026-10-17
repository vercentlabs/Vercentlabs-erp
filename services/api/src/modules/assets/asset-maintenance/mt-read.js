// Assets — Asset Maintenance, the reads: the workspace overview, requests and Work Orders by view (scoped: anyone outside the maintenance
// team sees what they reported, hold or are assigned), one Work Order with its checklist, verifications, restrictions and a cost summary
// derived from the authoritative Inventory, Procurement and Finance documents, plans and occurrences, the asset's maintenance panel,
// downtime (the union of restriction intervals), exceptions, source reconciliation, reports, the export and the audit.
import { has, uuid } from "../common.js";
import { warrantyOf } from "./mt-commands.js";
import { MT, OPEN_WO, OUTCOME, REQUEST_STATUS, TYPE_LABEL, WO_STATUS, dayOfDb, maintenanceTeam, mtError, seesMaintenance, unionMs } from "./mt-rules.js";

const NAME = (alias) => `COALESCE(NULLIF(${alias}.full_name, ''), ${alias}.email)`;
const idOf = (v, label) => { try { return uuid(v, label); } catch { throw mtError(404, "ASSET_MAINTENANCE_NOT_FOUND"); } };
const requireSees = (c) => { if (!seesMaintenance(c)) throw mtError(403, "ASSET_MAINTENANCE_PERMISSION_DENIED"); };
const today = () => new Date().toISOString().slice(0, 10);
const money = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);
const SUPPLIER = (alias) => `(SELECT bp.display_name FROM tenant.procurement_suppliers sp JOIN tenant.business_parties bp ON bp.organization_id = sp.organization_id AND bp.id = sp.party_id WHERE sp.id = ${alias})`;
const holds = (alias) => `EXISTS (SELECT 1 FROM tenant.asset_custody_assignments k WHERE k.asset_id = ${alias} AND k.status = 'ACTIVE' AND (k.user_id = $U OR k.accountable_user_id = $U))`;

// ------------------------------------------------------------------ requests
const REQUEST_VIEWS = Object.freeze({ open: "r.status IN ('OPEN', 'NEEDS_INFORMATION')", accepted: "r.status = 'ACCEPTED'", closed: "r.status IN ('REJECTED', 'CLOSED')", safety: "r.safety_concern = 'YES'" });
const REQ_LIST = `SELECT r.*, a.asset_number, a.name AS asset_name, ${NAME("u")} AS reporter, w.work_order_number, w.status AS wo_status, d.request_number AS duplicate_of
    FROM tenant.asset_maintenance_requests r JOIN tenant.assets a ON a.id = r.asset_id LEFT JOIN public.users u ON u.id = r.reported_by
    LEFT JOIN tenant.asset_maintenance_work_orders w ON w.id = r.work_order_id LEFT JOIN tenant.asset_maintenance_requests d ON d.id = r.duplicate_of_request_id`;
const requestRow = (r) => ({ id: r.id, number: r.request_number, assetId: r.asset_id, asset: `${r.asset_number} · ${r.asset_name}`, type: r.maintenance_type, typeLabel: TYPE_LABEL[r.maintenance_type],
  priority: r.priority, description: r.description, symptoms: r.symptoms, safetyConcern: r.safety_concern, observedCondition: r.observed_condition, location: r.location_label, custodian: r.custodian_label,
  status: r.status, statusLabel: REQUEST_STATUS[r.status], triageNote: r.triage_note, duplicateOf: r.duplicate_of ?? null, workOrderId: r.work_order_id, workOrder: r.work_order_number ?? null,
  workOrderStatus: r.wo_status ? WO_STATUS[r.wo_status] : null, reportedBy: r.reporter, reportedAt: r.reported_at, version: r.row_version, href: `/assets/maintenance/requests/${r.id}` });
// wide: the storekeeper (who links parts) sees every Work Order too.
function scope(c, where, values, { asset = "r.asset_id", mine = ["r.reported_by"], wide = false } = {}) {
  if (maintenanceTeam(c) || wide) return { where, values };
  values.push(c.userId);
  const u = `$${values.length}`;
  return { where: `${where} AND (${mine.map((m) => `${m} = ${u}`).join(" OR ")} OR ${holds(asset).replace(/\$U/g, u)})`, values };
}
// filters: { view?: all | open | accepted | closed | safety, search?, assetId? }
export async function listMaintenanceRequests(client, c, filters = {}) {
  requireSees(c);
  const values = [c.organizationId];
  let where = "r.organization_id = $1";
  if (REQUEST_VIEWS[filters.view]) where += ` AND ${REQUEST_VIEWS[filters.view]}`;
  if (filters.search) { values.push(`%${String(filters.search).slice(0, 100)}%`); where += ` AND (r.request_number ILIKE $${values.length} OR a.asset_number ILIKE $${values.length} OR a.name ILIKE $${values.length} OR r.description ILIKE $${values.length})`; }
  if (filters.assetId) { values.push(idOf(filters.assetId, "Asset")); where += ` AND r.asset_id = $${values.length}`; }
  const s = scope(c, where, values);
  const rows = (await client.query(`${REQ_LIST} WHERE ${s.where} ORDER BY (r.status IN ('OPEN', 'NEEDS_INFORMATION')) DESC, r.reported_at DESC LIMIT 500`, s.values)).rows;
  return { rows: rows.map(requestRow), can: { request: has(c, MT.request), triage: has(c, MT.triage), create: has(c, MT.create), export: has(c, MT.export) } };
}
export async function getMaintenanceRequest(client, c, requestId) {
  requireSees(c);
  const s = scope(c, "r.organization_id = $1 AND r.id = $2", [c.organizationId, idOf(requestId, "Request")]);
  const r = (await client.query(`${REQ_LIST} WHERE ${s.where}`, s.values)).rows[0];
  if (!r) throw mtError(404, "ASSET_MAINTENANCE_NOT_FOUND");
  const restriction = (await client.query(`SELECT status, started_at, ended_at, release_reason FROM tenant.asset_maintenance_restrictions WHERE source_type = 'SAFETY_REPORT' AND source_id = $1 ORDER BY started_at DESC LIMIT 1`, [r.id])).rows[0] ?? null;
  const events = await eventsOf(client, c, "request_id", r.id);
  return { ...requestRow(r), safetyRestriction: restriction ? { status: restriction.status, since: restriction.started_at, ended: restriction.ended_at, releaseReason: restriction.release_reason } : null,
    events, can: { triage: has(c, MT.triage) && ["OPEN", "NEEDS_INFORMATION"].includes(r.status), respond: r.status === "NEEDS_INFORMATION" && (r.reported_by === c.userId || maintenanceTeam(c)),
      createWorkOrder: has(c, MT.create) && !["REJECTED", "CLOSED"].includes(r.status) && !r.work_order_id } };
}

// ------------------------------------------------------------------ Work Orders
const WO_VIEWS = Object.freeze({
  open: `w.status = ANY('{${OPEN_WO.join(",")}}'::text[])`, approval: "w.status IN ('DRAFT', 'PENDING_APPROVAL')", scheduled: "w.status IN ('APPROVED', 'SCHEDULED')",
  in_progress: "w.status = 'IN_PROGRESS'", waiting: "w.status IN ('WAITING_FOR_PARTS', 'WAITING_FOR_VENDOR')", verification: "w.status IN ('WORK_COMPLETED', 'PENDING_VERIFICATION')",
  completed: "w.status = 'CLOSED'", cancelled: "w.status = 'CANCELLED'", preventive: "w.plan_id IS NOT NULL",
  overdue: `w.status = ANY('{${OPEN_WO.join(",")}}'::text[]) AND w.expected_completion_at IS NOT NULL AND w.expected_completion_at < now()`,
});
const WO_LIST = `SELECT w.*, a.asset_number, a.name AS asset_name, a.location_id, l.name AS location_name, ${NAME("t")} AS technician, ${SUPPLIER("w.supplier_id")} AS supplier, r.request_number, p.plan_number
    FROM tenant.asset_maintenance_work_orders w JOIN tenant.assets a ON a.id = w.asset_id LEFT JOIN tenant.asset_locations l ON l.id = a.location_id LEFT JOIN public.users t ON t.id = w.technician_user_id
    LEFT JOIN tenant.asset_maintenance_requests r ON r.id = w.request_id LEFT JOIN tenant.asset_maintenance_service_plans p ON p.id = w.plan_id`;
const woRow = (w, c) => ({ id: w.id, number: w.work_order_number, assetId: w.asset_id, asset: `${w.asset_number} · ${w.asset_name}`, location: w.location_name ?? null, title: w.title,
  type: w.maintenance_type, typeLabel: TYPE_LABEL[w.maintenance_type], priority: w.priority, execution: w.execution, status: w.status, statusLabel: WO_STATUS[w.status], outcome: w.outcome, outcomeLabel: w.outcome ? OUTCOME[w.outcome] : null,
  technicianUserId: w.technician_user_id, technician: w.technician ?? null, supplierId: w.supplier_id, supplier: w.supplier ?? null, request: w.request_number ?? null, requestId: w.request_id, plan: w.plan_number ?? null, planId: w.plan_id,
  scheduledStartAt: w.scheduled_start_at, expectedCompletionAt: w.expected_completion_at, actualStartAt: w.actual_start_at, workCompletedAt: w.work_completed_at, closedAt: w.closed_at,
  estimate: has(c, MT.cost) ? money(w.estimate_amount) : null, approvalRequired: w.approval_required, warrantyStatus: w.warranty_status, legacy: Boolean(w.legacy_order_id),
  overdue: Boolean(OPEN_WO.includes(w.status) && w.expected_completion_at && new Date(w.expected_completion_at) < new Date()), version: w.row_version, href: `/assets/maintenance/work-orders/${w.id}` });
// filters: { view?: all | open | mine | approval | scheduled | in_progress | waiting | verification | completed | cancelled | preventive | overdue, search?, assetId?, technicianUserId? }
export async function listMaintenanceWorkOrders(client, c, filters = {}) {
  requireSees(c);
  const values = [c.organizationId];
  let where = "w.organization_id = $1";
  if (filters.view === "mine") { values.push(c.userId); where += ` AND w.technician_user_id = $${values.length} AND w.status = ANY('{${OPEN_WO.join(",")}}'::text[])`; }
  else if (WO_VIEWS[filters.view]) where += ` AND ${WO_VIEWS[filters.view]}`;
  if (filters.search) { values.push(`%${String(filters.search).slice(0, 100)}%`); where += ` AND (w.work_order_number ILIKE $${values.length} OR a.asset_number ILIKE $${values.length} OR a.name ILIKE $${values.length} OR w.title ILIKE $${values.length})`; }
  if (filters.assetId) { values.push(idOf(filters.assetId, "Asset")); where += ` AND w.asset_id = $${values.length}`; }
  if (filters.technicianUserId) { values.push(idOf(filters.technicianUserId, "Technician")); where += ` AND w.technician_user_id = $${values.length}`; }
  const s = scope(c, where, values, { asset: "w.asset_id", mine: ["w.technician_user_id", "w.created_by", "r.reported_by"], wide: has(c, MT.parts) });
  const rows = (await client.query(`${WO_LIST} WHERE ${s.where} ORDER BY CASE w.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, w.created_at DESC LIMIT 500`, s.values)).rows;
  return { rows: rows.map((w) => woRow(w, c)), can: { create: has(c, MT.create), export: has(c, MT.export), cost: has(c, MT.cost) } };
}
async function eventsOf(client, c, column, id) {
  return (await client.query(`SELECT e.*, ${NAME("u")} AS actor FROM tenant.asset_maintenance_events e LEFT JOIN public.users u ON u.id = e.actor_user_id WHERE e.organization_id = $1 AND e.${column} = $2 ORDER BY e.occurred_at, e.id`,
    [c.organizationId, id])).rows.map((e) => ({ id: e.id, action: e.action, from: e.from_status, to: e.to_status, details: e.details, reason: e.reason, by: e.actor ?? "System", at: e.occurred_at }));
}
// The cost of a Work Order, from its sources only: the approved estimate, the confirmed purchase orders (committed), and the posted goods
// issues, supplier bills and capitalization adjustments (actual). A source no longer valid is shown as an exception, never counted.
export async function getMaintenanceCostSummary(client, c, workOrderId) {
  if (!has(c, MT.cost)) throw mtError(403, "ASSET_MAINTENANCE_PERMISSION_DENIED");
  const w = (await client.query(`SELECT * FROM tenant.asset_maintenance_work_orders WHERE organization_id = $1 AND id = $2`, [c.organizationId, idOf(workOrderId, "Work Order")])).rows[0];
  if (!w) throw mtError(404, "ASSET_MAINTENANCE_NOT_FOUND");
  return costOf(client, c, [w]).then((m) => m.get(w.id));
}
async function costOf(client, c, workOrders) {
  const ids = workOrders.map((w) => w.id);
  const links = ids.length ? (await client.query(`SELECT l.*,
        CASE l.source_type WHEN 'GOODS_ISSUE' THEN (SELECT g.status FROM tenant.goods_issues g WHERE g.id = l.source_id)
          WHEN 'SUPPLIER_BILL' THEN (SELECT b.status FROM tenant.accounting_vendor_bills b WHERE b.id = l.source_id)
          WHEN 'PURCHASE_ORDER' THEN (SELECT o.status FROM tenant.purchase_orders o WHERE o.id = l.source_id)
          WHEN 'CAPITALIZATION_ADJUSTMENT' THEN (SELECT j.status FROM tenant.asset_capitalization_adjustments j WHERE j.id = l.source_id) END AS source_status,
        CASE l.source_type WHEN 'GOODS_ISSUE' THEN (SELECT g.issued_value FROM tenant.goods_issues g WHERE g.id = l.source_id)
          WHEN 'SUPPLIER_BILL' THEN (SELECT b.subtotal - b.discount_total + b.charge_total FROM tenant.accounting_vendor_bills b WHERE b.id = l.source_id)
          WHEN 'PURCHASE_ORDER' THEN (SELECT o.taxable_total FROM tenant.purchase_orders o WHERE o.id = l.source_id)
          WHEN 'CAPITALIZATION_ADJUSTMENT' THEN (SELECT j.amount FROM tenant.asset_capitalization_adjustments j WHERE j.id = l.source_id) END AS amount,
        CASE l.source_type WHEN 'SUPPLIER_BILL' THEN (SELECT b.source_purchase_order_id FROM tenant.accounting_vendor_bills b WHERE b.id = l.source_id) END AS bill_po
      FROM tenant.asset_maintenance_cost_links l WHERE l.work_order_id = ANY($1::uuid[]) AND l.status = 'ACTIVE' ORDER BY l.linked_at`, [ids])).rows : [];
  const out = new Map();
  for (const w of workOrders) {
    const mine = links.filter((l) => l.work_order_id === w.id);
    const cents = (v) => Math.round(Number(v ?? 0) * 100);
    const valid = (l) => ({ GOODS_ISSUE: ["posted"], SUPPLIER_BILL: ["posted", "partially_paid", "paid", "overdue", "disputed"], PURCHASE_ORDER: ["confirmed", "closed"], CAPITALIZATION_ADJUSTMENT: ["POSTED"] }[l.source_type].includes(l.source_status));
    // A purchase order already billed on a linked bill is no longer a commitment: the bill is the cost (never both).
    const billedPos = new Set(mine.filter((l) => l.source_type === "SUPPLIER_BILL" && valid(l) && l.bill_po).map((l) => l.bill_po));
    let parts = 0; let external = 0; let committed = 0; let capital = 0;
    const lines = mine.map((l) => {
      const ok = valid(l);
      const superseded = l.source_type === "PURCHASE_ORDER" && billedPos.has(l.source_id);
      if (ok && !superseded) {
        if (l.cost_role === "PARTS") parts += cents(l.amount);
        else if (l.cost_role === "EXTERNAL_SERVICE") external += cents(l.amount);
        else if (l.cost_role === "COMMITMENT") committed += cents(l.amount);
        else capital += cents(l.amount);
      }
      return { id: l.id, sourceType: l.source_type, source: l.source_number, sourceId: l.source_id, role: l.cost_role, amount: money(l.amount), sourceStatus: l.source_status,
        counted: ok && !superseded, note: !ok ? "The source is no longer valid; it is not counted." : superseded ? "Billed — counted on the supplier bill." : null, linkedAt: l.linked_at };
    });
    const actual = parts + external;
    out.set(w.id, { estimate: money(w.estimate_amount), committed: committed / 100, actual: actual / 100, parts: parts / 100, externalService: external / 100, capitalImprovement: capital / 100,
      actualConfirmed: lines.some((l) => l.counted && l.role !== "COMMITMENT"), message: lines.some((l) => l.counted && l.role !== "COMMITMENT") ? null : "Actual accounting cost has not yet been confirmed.", lines,
      exceptions: lines.filter((l) => !l.counted && !l.note?.startsWith("Billed")).length });
  }
  return out;
}
export async function getMaintenanceWorkOrder(client, c, workOrderId) {
  requireSees(c);
  const s = scope(c, "w.organization_id = $1 AND w.id = $2", [c.organizationId, idOf(workOrderId, "Work Order")], { asset: "w.asset_id", mine: ["w.technician_user_id", "w.created_by", "r.reported_by"], wide: has(c, MT.parts) });
  const w = (await client.query(`${WO_LIST} WHERE ${s.where}`, s.values)).rows[0];
  if (!w) throw mtError(404, "ASSET_MAINTENANCE_NOT_FOUND");
  const a = (await client.query(`SELECT a.*, tenant.asset_effective_availability(a) AS effective FROM tenant.assets a WHERE a.id = $1`, [w.asset_id])).rows[0];
  const custodian = (await client.query(`SELECT COALESCE(NULLIF(u.full_name, ''), u.email, d.name, st.name) AS label FROM tenant.asset_custody_assignments k LEFT JOIN public.users u ON u.id = k.user_id
      LEFT JOIN public.departments d ON d.id = k.department_id LEFT JOIN tenant.asset_locations st ON st.id = k.store_location_id WHERE k.asset_id = $1 AND k.status = 'ACTIVE'`, [w.asset_id])).rows[0]?.label ?? null;
  const checklist = (await client.query(`SELECT k.*, ${NAME("u")} AS by_name FROM tenant.asset_maintenance_checklist_items k LEFT JOIN public.users u ON u.id = k.completed_by WHERE k.work_order_id = $1 ORDER BY k.line_number`, [w.id])).rows
    .map((k) => ({ lineNumber: k.line_number, text: k.item_text, mandatory: k.mandatory, result: k.result, notes: k.notes, by: k.by_name, at: k.completed_at }));
  const verifications = (await client.query(`SELECT v.*, ${NAME("u")} AS verifier FROM tenant.asset_maintenance_verifications v LEFT JOIN public.users u ON u.id = v.verifier_user_id WHERE v.work_order_id = $1 ORDER BY v.verified_at`, [w.id])).rows
    .map((v) => ({ id: v.id, verifier: v.verifier, at: v.verified_at, finalCondition: v.final_condition, testsPassed: v.tests_passed, testResults: v.test_results, decision: v.decision, notes: v.notes, evidence: v.evidence }));
  const restrictions = (await client.query(`SELECT r.*, w2.work_order_number AS source_wo, q.request_number AS source_req FROM tenant.asset_maintenance_restrictions r
      LEFT JOIN tenant.asset_maintenance_work_orders w2 ON r.source_type = 'WORK_ORDER' AND w2.id = r.source_id LEFT JOIN tenant.asset_maintenance_requests q ON r.source_type = 'SAFETY_REPORT' AND q.id = r.source_id
      WHERE r.asset_id = $1 AND (r.status = 'ACTIVE' OR r.source_id = $2 OR r.source_id = $3) ORDER BY r.started_at`, [w.asset_id, w.id, w.request_id])).rows
    .map((r) => ({ id: r.id, type: r.restriction_type, source: r.source_wo ?? r.source_req, own: r.source_id === w.id || r.source_id === w.request_id, status: r.status, since: r.started_at, ended: r.ended_at, reason: r.reason, releaseReason: r.release_reason }));
  const transfer = w.transfer_id ? (await client.query(`SELECT id, transfer_number, status FROM tenant.asset_transfer_orders WHERE id = $1`, [w.transfer_id])).rows[0] : null;
  const followUps = (await client.query(`SELECT id, work_order_number, status FROM tenant.asset_maintenance_work_orders WHERE follow_up_of_id = $1 ORDER BY created_at`, [w.id])).rows;
  const followUpOf = w.follow_up_of_id ? (await client.query(`SELECT id, work_order_number FROM tenant.asset_maintenance_work_orders WHERE id = $1`, [w.follow_up_of_id])).rows[0] : null;
  const cost = has(c, MT.cost) ? (await costOf(client, c, [w])).get(w.id) : null;
  const latest = verifications.at(-1);
  const assigned = !w.technician_user_id || w.technician_user_id === c.userId || has(c, MT.assign);
  const working = ["IN_PROGRESS", "WAITING_FOR_PARTS", "WAITING_FOR_VENDOR"].includes(w.status);
  return { ...woRow(w, c), problem: w.problem, diagnosis: w.diagnosis, rootCause: w.root_cause, workPerformed: w.work_performed, remainingIssues: w.remaining_issues, recommendation: w.recommendation,
    intakeCondition: w.intake_condition, completionCondition: w.completion_condition, restrictUse: w.restrict_use, cancelReason: w.cancel_reason, reopenedCount: w.reopened_count,
    warranty: { ...(await warrantyOf(client, a)), claimReference: w.warranty_claim_reference, claimStatus: w.warranty_claim_status },
    assetDetail: { id: a.id, number: a.asset_number, name: a.name, custodian, availability: a.effective, lifecycle: a.lifecycle_status, condition: a.condition },
    checklist, verifications, restrictions, transfer: transfer ? { id: transfer.id, number: transfer.transfer_number, status: transfer.status, href: `/assets/transfers/${transfer.id}` } : null,
    followUps: followUps.map((f) => ({ id: f.id, number: f.work_order_number, status: WO_STATUS[f.status] })), followUpOf: followUpOf ? { id: followUpOf.id, number: followUpOf.work_order_number } : null,
    cost, events: await eventsOf(client, c, "work_order_id", w.id),
    can: {
      submit: has(c, MT.create) && w.status === "DRAFT", approve: has(c, MT.approve) && w.status === "PENDING_APPROVAL", assign: has(c, MT.assign) && OPEN_WO.includes(w.status) && !["WORK_COMPLETED", "PENDING_VERIFICATION"].includes(w.status),
      schedule: has(c, MT.schedule) && ["APPROVED", "SCHEDULED"].includes(w.status), start: has(c, MT.execute) && assigned && ["APPROVED", "SCHEDULED"].includes(w.status),
      record: has(c, MT.execute) && assigned && working, complete: has(c, MT.complete) && assigned && working, verify: has(c, MT.verify) && w.status === "PENDING_VERIFICATION",
      release: has(c, MT.release) && w.status === "PENDING_VERIFICATION" && Boolean(latest?.decision?.startsWith("RETURN")), cancel: has(c, MT.cancel) && !["CLOSED", "CANCELLED"].includes(w.status),
      reopen: has(c, MT.reopen) && w.status === "CLOSED", parts: has(c, MT.parts) && w.status !== "CANCELLED", vendorCost: (has(c, MT.parts) || has(c, MT.create)) && Boolean(w.supplier_id), cost: has(c, MT.cost),
      followUp: has(c, MT.create) && w.status === "CLOSED", warranty: has(c, MT.create), audit: has(c, MT.audit) } };
}

// ------------------------------------------------------------------ plans
const PLAN_LIST = `SELECT p.*, a.asset_number, a.name AS asset_name, ${NAME("t")} AS technician, ${SUPPLIER("p.supplier_id")} AS supplier FROM tenant.asset_maintenance_service_plans p
    JOIN tenant.assets a ON a.id = p.asset_id LEFT JOIN public.users t ON t.id = p.technician_user_id`;
const every = (p) => (p.frequency_type === "ONCE" ? "Once" : `Every ${p.interval_value} ${p.frequency_type === "DAYS" ? (p.interval_value === 1 ? "day" : "days") : p.interval_value === 1 ? "month" : "months"}`);
const planRow = (p) => ({ id: p.id, number: p.plan_number, assetId: p.asset_id, asset: `${p.asset_number} · ${p.asset_name}`, name: p.name, type: p.maintenance_type, typeLabel: TYPE_LABEL[p.maintenance_type],
  frequency: every(p), frequencyType: p.frequency_type, interval: p.interval_value, startDate: dayOfDb(p.start_date), nextDueDate: dayOfDb(p.next_due_date), lastCompletedDate: dayOfDb(p.last_completed_date),
  dueRule: p.due_rule, dueRuleLabel: p.due_rule === "COMPLETION_DATE" ? "From the last completion" : "From the scheduled date", leadDays: p.lead_days, technician: p.technician ?? null, technicianUserId: p.technician_user_id,
  supplier: p.supplier ?? null, supplierId: p.supplier_id, priority: p.default_priority, checklist: p.checklist, estimatedMinutes: p.estimated_minutes, status: p.status, version: p.version,
  overdue: Boolean(p.status === "ACTIVE" && p.next_due_date && dayOfDb(p.next_due_date) < today()), legacy: Boolean(p.legacy_plan_id), href: `/assets/maintenance/plans/${p.id}` });
// filters: { view?: all | active | due | overdue | paused, assetId? }
export async function listMaintenancePlans(client, c, filters = {}) {
  requireSees(c);
  const values = [c.organizationId];
  let where = "p.organization_id = $1";
  if (filters.view === "active") where += " AND p.status = 'ACTIVE'";
  if (filters.view === "paused") where += " AND p.status IN ('PAUSED', 'INACTIVE')";
  if (filters.view === "due") where += " AND p.status = 'ACTIVE' AND p.next_due_date <= current_date + 30";
  if (filters.view === "overdue") where += " AND p.status = 'ACTIVE' AND p.next_due_date < current_date";
  if (filters.assetId) { values.push(idOf(filters.assetId, "Asset")); where += ` AND p.asset_id = $${values.length}`; }
  const s = scope(c, where, values, { asset: "p.asset_id", mine: ["p.technician_user_id"] });
  const rows = (await client.query(`${PLAN_LIST} WHERE ${s.where} ORDER BY p.next_due_date NULLS LAST, a.asset_number LIMIT 500`, s.values)).rows;
  return { rows: rows.map(planRow), can: { manage: has(c, MT.plans) } };
}
export async function getMaintenancePlan(client, c, planId) {
  requireSees(c);
  const p = (await client.query(`${PLAN_LIST} WHERE p.organization_id = $1 AND p.id = $2`, [c.organizationId, idOf(planId, "Plan")])).rows[0];
  if (!p) throw mtError(404, "ASSET_MAINTENANCE_NOT_FOUND");
  const occurrences = (await client.query(`SELECT o.*, w.work_order_number, w.status AS wo_status, w.outcome FROM tenant.asset_maintenance_occurrences o LEFT JOIN tenant.asset_maintenance_work_orders w ON w.id = o.work_order_id
      WHERE o.plan_id = $1 ORDER BY o.due_date DESC LIMIT 200`, [p.id])).rows.map((o) => ({ id: o.id, dueDate: dayOfDb(o.due_date), index: o.occurrence_index, status: o.status, workOrderId: o.work_order_id,
    workOrder: o.work_order_number, workOrderStatus: o.wo_status ? WO_STATUS[o.wo_status] : null, outcome: o.outcome ? OUTCOME[o.outcome] : null, completedAt: o.completed_at }));
  return { ...planRow(p), occurrences, events: await eventsOf(client, c, "plan_id", p.id), can: { manage: has(c, MT.plans) } };
}
// The upcoming service dates (the next few occurrences of each active plan, projected — nothing is generated by reading).
export async function getMaintenanceDue(client, c, filters = {}) {
  requireSees(c);
  const { addInterval } = await import("./mt-rules.js");
  const horizon = Number(filters.days ?? 90);
  const end = addInterval(today(), "DAYS", horizon);
  const out = [];
  for (const p of (await listMaintenancePlans(client, c, { view: "active" })).rows) {
    let d = p.nextDueDate;
    for (let i = 0; d && d <= end && i < 24; i += 1) {
      out.push({ plan: p.number, planId: p.id, asset: p.asset, name: p.name, dueDate: d, overdue: d < today(), technician: p.technician, supplier: p.supplier, href: p.href });
      if (p.frequencyType === "ONCE" || p.dueRule === "COMPLETION_DATE") break;
      d = addInterval(d, p.frequencyType, p.interval);
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

// ------------------------------------------------------------------ downtime
// Downtime is the union of the asset's maintenance and safety restrictions: overlapping ones never count the same hours twice.
export async function getAssetDowntime(client, c, assetId, filters = {}) {
  requireSees(c);
  const from = filters.from ? new Date(`${filters.from}T00:00:00Z`).getTime() : -Infinity;
  const to = filters.to ? new Date(`${filters.to}T23:59:59Z`).getTime() : Date.now();
  const rows = (await client.query(`SELECT asset_id, started_at, ended_at FROM tenant.asset_maintenance_restrictions WHERE organization_id = $1 AND restriction_type IN ('SAFETY', 'UNDER_MAINTENANCE') AND ($2::uuid IS NULL OR asset_id = $2)`,
    [c.organizationId, assetId ? idOf(assetId, "Asset") : null])).rows;
  const byAsset = new Map();
  for (const r of rows) {
    const start = Math.max(new Date(r.started_at).getTime(), from);
    const end = Math.min(r.ended_at ? new Date(r.ended_at).getTime() : Date.now(), to);
    if (!byAsset.has(r.asset_id)) byAsset.set(r.asset_id, []);
    byAsset.get(r.asset_id).push({ start, end });
  }
  const result = [...byAsset.entries()].map(([id, intervals]) => ({ assetId: id, hours: Math.round((unionMs(intervals) / 3600000) * 10) / 10, periods: intervals.length }));
  return assetId ? result[0] ?? { assetId, hours: 0, periods: 0 } : result;
}

// ------------------------------------------------------------------ asset panel and overview
export async function getAssetMaintenancePanel(client, c, assetId) {
  requireSees(c);
  const id = idOf(assetId, "Asset");
  const a = (await client.query(`SELECT a.*, tenant.asset_effective_availability(a) AS effective FROM tenant.assets a WHERE a.organization_id = $1 AND a.id = $2`, [c.organizationId, id])).rows[0];
  if (!a) throw mtError(404, "ASSET_MAINTENANCE_NOT_FOUND");
  const all = (await listMaintenanceWorkOrders(client, c, { assetId: id })).rows;
  const restrictions = (await client.query(`SELECT r.restriction_type, r.reason, r.started_at, r.source_type FROM tenant.asset_maintenance_restrictions r WHERE r.asset_id = $1 AND r.status = 'ACTIVE' ORDER BY r.started_at`, [id])).rows
    .map((r) => ({ type: r.restriction_type, reason: r.reason, since: r.started_at, source: r.source_type }));
  const plans = (await listMaintenancePlans(client, c, { assetId: id })).rows;
  const nextDue = plans.filter((p) => p.status === "ACTIVE" && p.nextDueDate).map((p) => p.nextDueDate).sort()[0] ?? null;
  let costs = null;
  if (has(c, MT.cost)) {
    const raw = (await client.query(`SELECT * FROM tenant.asset_maintenance_work_orders WHERE asset_id = $1 AND status <> 'CANCELLED'`, [id])).rows;
    const m = await costOf(client, c, raw);
    costs = [...m.values()].reduce((s, x) => ({ actual: s.actual + x.actual, committed: s.committed + x.committed, capitalImprovement: s.capitalImprovement + x.capitalImprovement }), { actual: 0, committed: 0, capitalImprovement: 0 });
    for (const k of Object.keys(costs)) costs[k] = Math.round(costs[k] * 100) / 100;
  }
  const requests = (await listMaintenanceRequests(client, c, { assetId: id, view: "open" })).rows;
  return { assetId: id, availability: a.effective, restrictions, active: all.filter((w) => OPEN_WO.includes(w.status)), history: all.filter((w) => !OPEN_WO.includes(w.status)).slice(0, 50),
    openRequests: requests, plans, nextServiceDate: nextDue, warranty: await warrantyOf(client, a), downtime: await getAssetDowntime(client, c, id), costs,
    can: { request: has(c, MT.request) && a.lifecycle_status !== "DISPOSED", create: has(c, MT.create) && a.lifecycle_status !== "DISPOSED", plans: has(c, MT.plans) } };
}
export async function getMaintenanceOverview(client, c) {
  requireSees(c);
  const n = async (sql, values = [c.organizationId]) => Number((await client.query(sql, values)).rows[0].n);
  const team = maintenanceTeam(c);
  return {
    openRequests: team ? await n(`SELECT count(*)::int AS n FROM tenant.asset_maintenance_requests WHERE organization_id = $1 AND status IN ('OPEN', 'NEEDS_INFORMATION')`) : (await listMaintenanceRequests(client, c, { view: "open" })).rows.length,
    safetyRequests: team ? await n(`SELECT count(*)::int AS n FROM tenant.asset_maintenance_restrictions WHERE organization_id = $1 AND status = 'ACTIVE' AND restriction_type = 'SAFETY'`) : null,
    openWorkOrders: (await listMaintenanceWorkOrders(client, c, { view: "open" })).rows.length,
    myWork: (await listMaintenanceWorkOrders(client, c, { view: "mine" })).rows.length,
    pendingApproval: (await listMaintenanceWorkOrders(client, c, { view: "approval" })).rows.length,
    waiting: (await listMaintenanceWorkOrders(client, c, { view: "waiting" })).rows.length,
    pendingVerification: (await listMaintenanceWorkOrders(client, c, { view: "verification" })).rows.length,
    overdue: (await listMaintenanceWorkOrders(client, c, { view: "overdue" })).rows.length,
    underMaintenance: team ? await n(`SELECT count(*)::int AS n FROM tenant.assets a WHERE a.organization_id = $1 AND tenant.asset_effective_availability(a) = 'UNDER_MAINTENANCE'`) : null,
    dueSoon: (await getMaintenanceDue(client, c, { days: 30 })).length,
    exceptions: team ? (await getMaintenanceExceptions(client, c)).length : null,
    can: { request: has(c, MT.request), create: has(c, MT.create), plans: has(c, MT.plans), triage: has(c, MT.triage), cost: has(c, MT.cost), export: has(c, MT.export), audit: has(c, MT.audit) },
  };
}

// ------------------------------------------------------------------ exceptions and reconciliation
export async function getMaintenanceExceptions(client, c) {
  requireSees(c);
  if (!maintenanceTeam(c)) return [];
  const out = [];
  for (const w of (await listMaintenanceWorkOrders(client, c, { view: "overdue" })).rows) out.push({ kind: "OVERDUE_WORK_ORDER", label: "Overdue Work Order", number: w.number, asset: w.asset, detail: `Expected ${String(w.expectedCompletionAt).slice(0, 10)}`, href: w.href });
  for (const p of (await listMaintenancePlans(client, c, { view: "overdue" })).rows) out.push({ kind: "OVERDUE_SERVICE", label: "Preventive service overdue", number: p.number, asset: p.asset, detail: `Due ${p.nextDueDate}`, href: p.href });
  const rows = (await client.query(`SELECT w.id, w.work_order_number, a.asset_number, a.name, w.status, w.outcome, w.updated_at,
      (SELECT v.decision FROM tenant.asset_maintenance_verifications v WHERE v.work_order_id = w.id ORDER BY v.verified_at DESC LIMIT 1) AS last_decision
      FROM tenant.asset_maintenance_work_orders w JOIN tenant.assets a ON a.id = w.asset_id WHERE w.organization_id = $1
        AND (w.outcome = 'UNREPAIRABLE' AND a.lifecycle_status NOT IN ('DISPOSED', 'RETIRED') OR (w.status IN ('WAITING_FOR_PARTS', 'WAITING_FOR_VENDOR') AND w.updated_at < now() - interval '14 days')
          OR (w.status = 'IN_PROGRESS' AND EXISTS (SELECT 1 FROM tenant.asset_maintenance_verifications v WHERE v.work_order_id = w.id AND v.decision = 'KEEP_RESTRICTED')))`, [c.organizationId])).rows;
  for (const w of rows) {
    const kind = w.outcome === "UNREPAIRABLE" ? "UNREPAIRABLE" : w.status.startsWith("WAITING") ? "LONG_WAIT" : "VERIFICATION_FAILED";
    out.push({ kind, label: { UNREPAIRABLE: "Unrepairable — retirement review", LONG_WAIT: "Waiting more than 14 days", VERIFICATION_FAILED: "Failed verification" }[kind], number: w.work_order_number, asset: `${w.asset_number} · ${w.name}`, detail: WO_STATUS[w.status], href: `/assets/maintenance/work-orders/${w.id}` });
  }
  for (const r of (await client.query(`SELECT q.id, q.request_number, a.asset_number, a.name, r.started_at FROM tenant.asset_maintenance_restrictions r JOIN tenant.asset_maintenance_requests q ON q.id = r.source_id
      JOIN tenant.assets a ON a.id = r.asset_id WHERE r.organization_id = $1 AND r.status = 'ACTIVE' AND r.source_type = 'SAFETY_REPORT' AND q.work_order_id IS NULL AND r.started_at < now() - interval '2 days'`, [c.organizationId])).rows) {
    out.push({ kind: "UNASSESSED_SAFETY", label: "Safety restriction without a Work Order", number: r.request_number, asset: `${r.asset_number} · ${r.name}`, detail: `Since ${String(r.started_at.toISOString?.() ?? r.started_at).slice(0, 10)}`, href: `/assets/maintenance/requests/${r.id}` });
  }
  for (const x of await reconcileMaintenanceSources(client, c)) out.push({ kind: "SOURCE_INVALID", label: "Linked source no longer valid", number: x.workOrder, asset: x.asset, detail: `${x.source} is ${x.sourceStatus}`, href: x.href });
  return out;
}
// Every active cost link whose authoritative document is no longer valid (cancelled, reversed): the link stays visible, its cost is not counted.
export async function reconcileMaintenanceSources(client, c) {
  if (!maintenanceTeam(c)) throw mtError(403, "ASSET_MAINTENANCE_PERMISSION_DENIED");
  const raw = (await client.query(`SELECT * FROM tenant.asset_maintenance_work_orders w WHERE w.organization_id = $1 AND EXISTS (SELECT 1 FROM tenant.asset_maintenance_cost_links l WHERE l.work_order_id = w.id AND l.status = 'ACTIVE')`, [c.organizationId])).rows;
  const assets = new Map((await client.query(`SELECT id, asset_number, name FROM tenant.assets WHERE id = ANY($1::uuid[])`, [raw.map((w) => w.asset_id)])).rows.map((a) => [a.id, `${a.asset_number} · ${a.name}`]));
  const m = await costOf(client, c, raw);
  const out = [];
  for (const w of raw) for (const l of m.get(w.id).lines.filter((x) => !x.counted && !x.note?.startsWith("Billed"))) {
    out.push({ workOrder: w.work_order_number, asset: assets.get(w.asset_id), sourceType: l.sourceType, source: l.source ?? l.sourceId, sourceStatus: l.sourceStatus ?? "missing", linkId: l.id, href: `/assets/maintenance/work-orders/${w.id}` });
  }
  return out;
}

// ------------------------------------------------------------------ reports, export, audit
export const MAINTENANCE_REPORTS = Object.freeze(["open-requests", "active-work-orders", "maintenance-due", "overdue-maintenance", "by-asset", "by-category", "by-technician", "by-vendor", "downtime",
  "repeated-failures", "costs-by-asset", "costs-by-period", "warranty", "waiting", "unrepairable", "verification-exceptions", "cost-reconciliation"]);
const COST_REPORTS = ["costs-by-asset", "costs-by-period", "cost-reconciliation"];
export async function getMaintenanceReport(client, c, kind) {
  if (!MAINTENANCE_REPORTS.includes(kind)) throw mtError(400, "ASSET_MAINTENANCE_INVALID", "Unknown report.");
  requireSees(c);
  if (COST_REPORTS.includes(kind) && !has(c, MT.cost)) throw mtError(403, "ASSET_MAINTENANCE_PERMISSION_DENIED");
  const wos = async (view) => (await listMaintenanceWorkOrders(client, c, { view })).rows;
  const brief = (w) => ({ workOrder: w.number, asset: w.asset, title: w.title, status: w.statusLabel, technician: w.technician ?? "—", vendor: w.supplier ?? "—", href: w.href });
  const groupBy = (rows, key) => [...rows.reduce((m, r) => m.set(r[key] ?? "—", [...(m.get(r[key] ?? "—") ?? []), r]), new Map()).entries()];
  switch (kind) {
    case "open-requests": return (await listMaintenanceRequests(client, c, { view: "open" })).rows.map((r) => ({ request: r.number, asset: r.asset, priority: r.priority, safety: r.safetyConcern, reported: r.reportedAt, by: r.reportedBy, href: r.href }));
    case "active-work-orders": return (await wos("open")).map(brief);
    case "maintenance-due": return getMaintenanceDue(client, c, { days: 90 });
    case "overdue-maintenance": return [...(await wos("overdue")).map((w) => ({ ...brief(w), due: w.expectedCompletionAt })),
      ...(await listMaintenancePlans(client, c, { view: "overdue" })).rows.map((p) => ({ plan: p.number, asset: p.asset, title: p.name, due: p.nextDueDate, href: p.href }))];
    case "by-asset": return groupBy(await wos("all"), "asset").map(([asset, rows]) => ({ asset, workOrders: rows.length, open: rows.filter((w) => OPEN_WO.includes(w.status)).length, repaired: rows.filter((w) => w.outcome?.startsWith("REPAIRED")).length }));
    case "by-category": {
      const rows = (await client.query(`SELECT COALESCE(cat.name, '—') AS category, count(*)::int AS n, count(*) FILTER (WHERE w.maintenance_type IN ('CORRECTIVE', 'EMERGENCY'))::int AS failures,
          count(DISTINCT w.asset_id)::int AS assets FROM tenant.asset_maintenance_work_orders w JOIN tenant.assets a ON a.id = w.asset_id LEFT JOIN tenant.asset_categories cat ON cat.id = a.category_id
          WHERE w.organization_id = $1 AND w.status <> 'CANCELLED' GROUP BY 1 ORDER BY 2 DESC`, [c.organizationId])).rows;
      return maintenanceTeam(c) ? rows.map((r) => ({ category: r.category, workOrders: r.n, failures: r.failures, assets: r.assets })) : [];
    }
    case "by-technician": return groupBy((await wos("all")).filter((w) => w.technician), "technician").map(([technician, rows]) => ({ technician, workOrders: rows.length, open: rows.filter((w) => OPEN_WO.includes(w.status)).length, closed: rows.filter((w) => w.status === "CLOSED").length }));
    case "by-vendor": return groupBy((await wos("all")).filter((w) => w.supplier), "supplier").map(([vendor, rows]) => ({ vendor, workOrders: rows.length, open: rows.filter((w) => OPEN_WO.includes(w.status)).length, closed: rows.filter((w) => w.status === "CLOSED").length }));
    case "downtime": {
      const d = maintenanceTeam(c) ? await getAssetDowntime(client, c, null) : [];
      const names = new Map((await client.query(`SELECT id, asset_number, name FROM tenant.assets WHERE id = ANY($1::uuid[])`, [d.map((x) => x.assetId)])).rows.map((a) => [a.id, `${a.asset_number} · ${a.name}`]));
      return d.sort((x, y) => y.hours - x.hours).map((x) => ({ asset: names.get(x.assetId), downtimeHours: x.hours, periods: x.periods }));
    }
    case "repeated-failures": {
      if (!maintenanceTeam(c)) return [];
      return (await client.query(`SELECT a.asset_number || ' · ' || a.name AS asset, count(*)::int AS n, max(w.created_at) AS last FROM tenant.asset_maintenance_work_orders w JOIN tenant.assets a ON a.id = w.asset_id
          WHERE w.organization_id = $1 AND w.maintenance_type IN ('CORRECTIVE', 'EMERGENCY') AND w.status <> 'CANCELLED' AND w.created_at > now() - interval '365 days' GROUP BY 1 HAVING count(*) >= 2 ORDER BY 2 DESC`, [c.organizationId])).rows
        .map((r) => ({ asset: r.asset, failures: r.n, lastReported: r.last }));
    }
    case "costs-by-asset": case "costs-by-period": {
      const raw = (await client.query(`SELECT w.*, a.asset_number, a.name AS asset_name FROM tenant.asset_maintenance_work_orders w JOIN tenant.assets a ON a.id = w.asset_id WHERE w.organization_id = $1 AND w.status <> 'CANCELLED'`, [c.organizationId])).rows;
      const m = await costOf(client, c, raw);
      const key = (w) => (kind === "costs-by-asset" ? `${w.asset_number} · ${w.asset_name}` : String((w.closed_at ?? w.created_at).toISOString?.() ?? w.created_at).slice(0, 7));
      const sums = new Map();
      for (const w of raw) {
        const x = m.get(w.id); const s = sums.get(key(w)) ?? { estimate: 0, committed: 0, actual: 0, capitalImprovement: 0, workOrders: 0 };
        sums.set(key(w), { estimate: s.estimate + (x.estimate ?? 0), committed: s.committed + x.committed, actual: s.actual + x.actual, capitalImprovement: s.capitalImprovement + x.capitalImprovement, workOrders: s.workOrders + 1 });
      }
      const r2 = (v) => Math.round(v * 100) / 100;
      return [...sums.entries()].sort((a, b) => (kind === "costs-by-period" ? b[0].localeCompare(a[0]) : b[1].actual - a[1].actual))
        .map(([k, s]) => ({ [kind === "costs-by-asset" ? "asset" : "month"]: k, workOrders: s.workOrders, approvedEstimate: r2(s.estimate), committed: r2(s.committed), actualConfirmed: r2(s.actual), capitalImprovement: r2(s.capitalImprovement) }));
    }
    case "warranty": return (await wos("all")).filter((w) => w.warrantyStatus === "POTENTIALLY_COVERED").map((w) => ({ ...brief(w), warranty: "Potentially covered — check coverage" }));
    case "waiting": return (await wos("waiting")).map(brief);
    case "unrepairable": return (await wos("completed")).filter((w) => w.outcome === "UNREPAIRABLE").map(brief);
    case "verification-exceptions": return (await getMaintenanceExceptions(client, c)).filter((e) => ["VERIFICATION_FAILED", "UNASSESSED_SAFETY"].includes(e.kind));
    case "cost-reconciliation": return reconcileMaintenanceSources(client, c);
    default: return [];
  }
}
export async function getMaintenanceAudit(client, c, filters = {}) {
  if (!has(c, MT.audit)) throw mtError(403, "ASSET_MAINTENANCE_PERMISSION_DENIED");
  const values = [c.organizationId];
  let where = "";
  if (filters.assetId) { values.push(idOf(filters.assetId, "Asset")); where = `AND e.asset_id = $${values.length}`; }
  return (await client.query(`SELECT e.*, ${NAME("u")} AS actor, a.asset_number, w.work_order_number, r.request_number, p.plan_number FROM tenant.asset_maintenance_events e LEFT JOIN public.users u ON u.id = e.actor_user_id
      LEFT JOIN tenant.assets a ON a.id = e.asset_id LEFT JOIN tenant.asset_maintenance_work_orders w ON w.id = e.work_order_id LEFT JOIN tenant.asset_maintenance_requests r ON r.id = e.request_id
      LEFT JOIN tenant.asset_maintenance_service_plans p ON p.id = e.plan_id WHERE e.organization_id = $1 ${where} ORDER BY e.occurred_at DESC LIMIT 1000`, values)).rows
    .map((e) => ({ id: e.id, action: e.action, record: e.work_order_number ?? e.request_number ?? e.plan_number, asset: e.asset_number, from: e.from_status, to: e.to_status, reason: e.reason, by: e.actor ?? "System", at: e.occurred_at }));
}
const csvCell = (value) => { const s = value === null || value === undefined ? "" : String(value); return /[",\r\n]/.test(s) || /^[=+@-]/.test(s) ? `"${(/^[=+@-]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
export async function exportMaintenance(client, c) {
  if (!has(c, MT.export)) throw mtError(403, "ASSET_MAINTENANCE_PERMISSION_DENIED");
  const rows = (await listMaintenanceWorkOrders(client, c, {})).rows;
  const header = ["Work Order", "Asset", "Title", "Type", "Priority", "Execution", "Status", "Outcome", "Technician", "Vendor", "Request", "Plan", "Started", "Completed", "Closed", ...(has(c, MT.cost) ? ["Estimate"] : [])];
  return { fileName: "asset-maintenance.csv", csv: [header, ...rows.map((w) => [w.number, w.asset, w.title, w.typeLabel, w.priority, w.execution, w.statusLabel, w.outcomeLabel ?? "", w.technician ?? "", w.supplier ?? "",
    w.request ?? "", w.plan ?? "", w.actualStartAt ?? "", w.workCompletedAt ?? "", w.closedAt ?? "", ...(has(c, MT.cost) ? [w.estimate ?? ""] : [])])].map((l) => l.map(csvCell).join(",")).join("\r\n") };
}
// The choices a maintenance form offers: eligible technicians (active members allowed to carry out maintenance) and active suppliers.
export async function getMaintenanceOptions(client, c) {
  requireSees(c);
  if (!maintenanceTeam(c)) return { technicians: [], suppliers: [] };
  const technicians = (await client.query(`SELECT DISTINCT u.id, ${NAME("u")} AS name FROM public.organization_memberships m JOIN public.users u ON u.id = m.user_id
      JOIN public.user_role_assignments a ON a.organization_id = m.organization_id AND a.user_id = m.user_id AND a.status = 'active' JOIN public.roles role ON role.id = a.role_id AND role.status = 'active'
      WHERE m.organization_id = $1 AND m.status = 'active' AND (role.slug = 'organization_owner' OR EXISTS (SELECT 1 FROM public.role_permissions p WHERE p.role_id = role.id AND p.permission_key = $2)) ORDER BY 2`, [c.organizationId, MT.execute])).rows;
  const suppliers = (await client.query(`SELECT s.id, p.display_name AS name FROM tenant.procurement_suppliers s JOIN tenant.business_parties p ON p.organization_id = s.organization_id AND p.id = s.party_id
      WHERE s.organization_id = $1 AND s.status = 'active' ORDER BY p.display_name LIMIT 2000`, [c.organizationId])).rows;
  return { technicians: technicians.map((t) => ({ value: t.id, label: t.name })), suppliers: suppliers.map((s) => ({ value: s.id, label: s.name })) };
}
