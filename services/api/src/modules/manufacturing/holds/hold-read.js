// Production Hold — the reads: one hold (its reasons with who clears each, the resume request, readiness while active, the customer demand
// and parent or child orders it affects, evidence and its timeline), an order's active hold and its history, the held-orders queue, downtime
// and the reports. Downtime counts each episode once: reasons inside one episode overlap and never add up.
import {
  AUTHORITY_LABEL, AUTHORITY_PERMISSION, D, HOLD, REASONS, SALES_MESSAGE, STATUS_LABEL, ZERO, activeHoldOf, has, holdError, holdSettings, hoursBetween, loadHold, loadHoldOrder,
  loadReasons, max, needHold, q, sub, uuid,
} from "./hold-core.js";
import { getResumeReadiness, linkedClearance } from "./hold-service.js";

const names = async (client, ids) => {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  return new Map((await client.query(`SELECT id, COALESCE(NULLIF(full_name, ''), email) AS name FROM public.users WHERE id = ANY($1::uuid[])`, [list])).rows.map((row) => [row.id, row.name]));
};
const ACTION_LABEL = Object.freeze({ HOLD_CREATED: "Put on hold", REASON_ADDED: "Reason added", SEVERITY_CHANGED: "Severity raised", CORRECTIVE_ACTION: "Corrective action recorded",
  REASON_RESOLVED: "Reason cleared", ALL_REASONS_RESOLVED: "Every reason cleared", RESUME_REQUESTED: "Resume requested", RESUME_APPROVED: "Resume approved", RESUME_REJECTED: "Resume rejected",
  RESUMED: "Production resumed", CLOSED: "Closed (order cancelled)", OVERDUE: "Overdue", EVIDENCE_ADDED: "Evidence added", EVIDENCE_REMOVED: "Evidence removed", MIGRATED: "Recorded from the earlier hold" });
const STATUS = Object.freeze({ ACTIVE: "On hold", RESUMED: "Resumed", CLOSED: "Closed" });
const hours = (value) => Number(value.toFixed(1));

// ------------------------------------------------------------------ demand and dependencies
// The customer lines this order makes for: what is still to come, when it is wanted, and the simplified line Sales may see.
export async function getAffectedSalesDemand(client, c, orderId, { reasonCode = null } = {}) {
  needHold(c, HOLD.view);
  const order = await loadHoldOrder(client, c, orderId);
  const rows = (await client.query(
    `SELECT allocation.allocated_quantity, allocation.received_quantity, allocation.fulfilled_quantity, allocation.status, demand.id AS demand_id, demand.required_date, demand.outstanding_quantity,
            sales_order.id AS sales_order_id, sales_order.sales_order_number, version.customer_snapshot->>'displayName' AS customer
       FROM tenant.manufacturing_demand_allocations allocation JOIN tenant.manufacturing_sales_demands demand ON demand.id = allocation.demand_id
       JOIN tenant.sales_orders sales_order ON sales_order.id = demand.sales_order_id LEFT JOIN tenant.sales_order_versions version ON version.id = sales_order.current_version_id
      WHERE allocation.organization_id = $1 AND allocation.manufacturing_order_id = $2 AND allocation.status NOT IN ('RELEASED', 'FULFILLED') ORDER BY demand.required_date NULLS LAST`,
    [c.organizationId, order.id])).rows;
  const today = new Date().toISOString().slice(0, 10);
  const plannedEnd = order.planned_end_at ? new Date(order.planned_end_at).toISOString().slice(0, 10) : null;
  return rows.map((row) => {
    const required = row.required_date ? (row.required_date instanceof Date ? `${row.required_date.getFullYear()}-${String(row.required_date.getMonth() + 1).padStart(2, "0")}-${String(row.required_date.getDate()).padStart(2, "0")}` : String(row.required_date).slice(0, 10)) : null;
    const unfinished = max(sub(D(row.allocated_quantity), D(row.received_quantity)), ZERO);
    const risk = unfinished === ZERO ? "NONE" : required && required < today ? "LATE" : required && plannedEnd && plannedEnd >= required ? "AT_RISK" : order.status === "ON_HOLD" ? "AT_RISK" : "ON_TRACK";
    return { demandId: row.demand_id, salesOrderId: row.sales_order_id, salesOrderNumber: row.sales_order_number, customer: row.customer, requiredDate: required,
      allocated: q(D(row.allocated_quantity)), received: q(D(row.received_quantity)), unfinished: q(unfinished), risk,
      salesMessage: order.status === "ON_HOLD" ? SALES_MESSAGE[reasonCode ?? "OTHER"] ?? SALES_MESSAGE.OTHER : null };
  });
}
// The order this one makes a subassembly for, and the subassembly orders of this one that are on hold. Visible only: nothing is paused.
export async function getAffectedParentOrders(client, c, orderId) {
  needHold(c, HOLD.view);
  const order = await loadHoldOrder(client, c, orderId);
  const parents = order.parent_order_id ? (await client.query(
    `SELECT mo.id, mo.mo_number, mo.status, item.code, item.name FROM tenant.manufacturing_orders mo JOIN tenant.items item ON item.id = mo.finished_item_id WHERE mo.organization_id = $1 AND mo.id = $2`,
    [c.organizationId, order.parent_order_id])).rows : [];
  const children = (await client.query(
    `SELECT mo.id, mo.mo_number, mo.status, item.code, item.name, hold.hold_number, hold.started_at FROM tenant.manufacturing_orders mo JOIN tenant.items item ON item.id = mo.finished_item_id
       LEFT JOIN tenant.manufacturing_production_holds hold ON hold.manufacturing_order_id = mo.id AND hold.status = 'ACTIVE'
      WHERE mo.organization_id = $1 AND mo.parent_order_id = $2 ORDER BY mo.mo_number`, [c.organizationId, order.id])).rows;
  return {
    parents: parents.map((row) => ({ id: row.id, number: row.mo_number, status: row.status, statusLabel: STATUS_LABEL[row.status], item: `${row.code} · ${row.name}`,
      note: order.status === "ON_HOLD" ? `${row.mo_number} waits for ${order.mo_number}'s subassemblies: check its material availability. It is not paused automatically.` : null })),
    children: children.map((row) => ({ id: row.id, number: row.mo_number, status: row.status, statusLabel: STATUS_LABEL[row.status], item: `${row.code} · ${row.name}`,
      holdNumber: row.hold_number ?? null, heldSince: row.started_at ?? null })),
  };
}

// ------------------------------------------------------------------ one hold
export async function getProductionHold(client, c, holdId) {
  needHold(c, HOLD.view);
  const hold = await loadHold(client, c, holdId);
  const order = await loadHoldOrder(client, c, hold.manufacturing_order_id);
  const reasons = await loadReasons(client, c, hold.id);
  const events = (await client.query(`SELECT * FROM tenant.manufacturing_production_hold_events WHERE organization_id = $1 AND production_hold_id = $2 ORDER BY occurred_at`, [c.organizationId, hold.id])).rows;
  const settings = await holdSettings(client, c);
  const item = (await client.query(`SELECT code, name FROM tenant.items WHERE id = $1`, [order.finished_item_id])).rows[0] ?? {};
  const location = hold.affected_location_id ? (await client.query(`SELECT code, name FROM tenant.warehouse_locations WHERE id = $1`, [hold.affected_location_id])).rows[0] : null;
  const materials = reasons.some((row) => row.affected_material_ids?.length) ? new Map((await client.query(
    `SELECT material.id, item.code FROM tenant.manufacturing_order_materials material JOIN tenant.items item ON item.id = material.component_item_id WHERE material.manufacturing_order_id = $1`,
    [order.id])).rows.map((row) => [row.id, row.code])) : new Map();
  const people = await names(client, [hold.requested_by, hold.hold_owner_id, hold.resumed_by, hold.resume_requested_by, hold.resume_approved_by, order.production_owner_id,
    ...reasons.flatMap((row) => [row.added_by, row.resolved_by]), ...events.map((row) => row.actor_user_id)]);
  const active = hold.status === "ACTIVE";
  const duration = hoursBetween(hold.started_at, hold.resolved_at);
  const clearances = active ? await Promise.all(reasons.map((row) => (row.status === "ACTIVE" ? linkedClearance(client, c, row) : null))) : reasons.map(() => null);
  const readiness = active && order.status === "ON_HOLD" ? await getResumeReadiness(client, c, order.id) : null;
  const primary = reasons[0]?.reason_code ?? "OTHER";
  const demand = await getAffectedSalesDemand(client, c, order.id, { reasonCode: primary });
  const dependencies = await getAffectedParentOrders(client, c, order.id);
  const selfApproval = hold.resume_requested_by === c.userId && !settings.varianceSelfApproval;
  return {
    id: hold.id, number: hold.hold_number, status: hold.status, statusLabel: STATUS[hold.status], severity: hold.severity, rowVersion: hold.row_version,
    order: { id: order.id, number: order.mo_number, status: order.status, statusLabel: STATUS_LABEL[order.status], version: order.version, item: `${item.code ?? ""} · ${item.name ?? ""}`,
      planned: q(D(order.planned_base_quantity)), accepted: q(D(order.accepted_quantity)), remaining: q(max(sub(D(order.planned_base_quantity), D(order.accepted_quantity)), ZERO)),
      productionOwner: people.get(order.production_owner_id) ?? null, plannedEndAt: order.planned_end_at },
    previousStatus: hold.previous_mo_status, previousStatusLabel: STATUS_LABEL[hold.previous_mo_status], resumedTo: hold.resumed_to_status,
    owner: people.get(hold.hold_owner_id) ?? null, ownerId: hold.hold_owner_id, location: location ?? null, notes: hold.notes, expectedResolutionAt: hold.expected_resolution_at,
    startedAt: hold.started_at, requestedBy: people.get(hold.requested_by) ?? null, resolvedAt: hold.resolved_at, resumedBy: people.get(hold.resumed_by) ?? null,
    resolutionNotes: hold.resolution_notes, closedReason: hold.closed_reason,
    durationHours: hours(duration), overdue: active && duration > settings.overdueHours, overdueAfterHours: settings.overdueHours,
    reasons: reasons.map((row, index) => ({
      id: row.id, code: row.reason_code, label: REASONS[row.reason_code], severity: row.severity, description: row.description, authority: row.clearance_authority,
      authorityLabel: AUTHORITY_LABEL[row.clearance_authority], sourceType: row.source_type, sourceId: row.source_id, sourceReference: row.source_reference,
      materials: (row.affected_material_ids ?? []).map((id) => materials.get(id) ?? id), status: row.status, correctiveAction: row.corrective_action, resolutionNotes: row.resolution_notes,
      evidence: row.resolution_evidence, addedBy: people.get(row.added_by) ?? null, addedAt: row.added_at, resolvedBy: people.get(row.resolved_by) ?? null, resolvedAt: row.resolved_at,
      pendingClearance: clearances[index],
      can: { resolve: active && row.status === "ACTIVE" && has(c, AUTHORITY_PERMISSION[row.clearance_authority]) && !clearances[index],
        act: active && row.status === "ACTIVE" && (has(c, AUTHORITY_PERMISSION[row.clearance_authority]) || has(c, HOLD.place)) },
    })),
    resumeRequest: hold.resume_requested_at ? { by: people.get(hold.resume_requested_by) ?? null, at: hold.resume_requested_at, note: hold.resume_request_note,
      current: hold.resume_request_version === hold.row_version, approvedBy: people.get(hold.resume_approved_by) ?? null, approvedAt: hold.resume_approved_at } : null,
    readiness, salesDemand: demand, dependencies,
    history: events.map((row) => ({ action: row.action, label: ACTION_LABEL[row.action] ?? row.action, summary: row.summary, actor: people.get(row.actor_user_id) ?? null, at: row.occurred_at })),
    can: {
      addReason: active && has(c, HOLD.place),
      resume: active && has(c, HOLD.resume) && !settings.resumeApprovalRequired,
      requestResume: active && has(c, HOLD.resume) && settings.resumeApprovalRequired,
      decideResume: active && Boolean(hold.resume_requested_at) && hold.resume_request_version === hold.row_version && has(c, HOLD.approveResume) && !selfApproval,
      attach: [HOLD.place, HOLD.resolve, HOLD.clearQuality, HOLD.clearSafety].some((permission) => has(c, permission)),
      seeCost: has(c, "manufacturing.mo.cost_view"),
    },
    policy: { resumeApprovalRequired: settings.resumeApprovalRequired, releaseWithShortages: settings.releaseWithShortages },
  };
}
export async function getActiveProductionHold(client, c, orderId) {
  needHold(c, HOLD.view);
  const order = await loadHoldOrder(client, c, orderId);
  const hold = await activeHoldOf(client, c, order.id);
  return hold ? getProductionHold(client, c, hold.id) : null;
}
// Every episode of one order, newest first, with its downtime (and the order's total).
export async function getProductionHoldHistory(client, c, orderId) {
  needHold(c, HOLD.view);
  const order = await loadHoldOrder(client, c, orderId);
  const rows = (await listRows(client, c, { orderId: order.id }));
  const total = rows.reduce((sum, row) => sum + row.durationHours, 0);
  return { orderId: order.id, orderNumber: order.mo_number, episodes: rows, totalDowntimeHours: hours(total) };
}
export async function calculateProductionHoldDuration(client, c, orderId) {
  return (await getProductionHoldHistory(client, c, orderId)).totalDowntimeHours;
}

// ------------------------------------------------------------------ the queue
// filters: { status (ACTIVE default | RESUMED | CLOSED | all), severity, reason, orderId, overdue, search, from, to }
async function listRows(client, c, filters = {}) {
  const settings = await holdSettings(client, c);
  const values = [c.organizationId];
  const where = ["hold.organization_id = $1"];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const status = filters.status === undefined ? (filters.orderId ? "all" : "ACTIVE") : String(filters.status);
  if (status !== "all") where.push(`hold.status = ${bind(status.toUpperCase())}`);
  if (filters.severity) where.push(`hold.severity = ${bind(String(filters.severity).toUpperCase())}`);
  if (filters.reason) where.push(`EXISTS (SELECT 1 FROM tenant.manufacturing_production_hold_reasons reason WHERE reason.production_hold_id = hold.id AND reason.reason_code = ${bind(String(filters.reason).toUpperCase())})`);
  if (filters.orderId) where.push(`hold.manufacturing_order_id = ${bind(uuid(filters.orderId, "Manufacturing order"))}`);
  if (filters.overdue === "true" || filters.overdue === true) where.push(`hold.status = 'ACTIVE' AND hold.started_at < now() - make_interval(hours => ${bind(settings.overdueHours)})`);
  if (filters.from) where.push(`hold.started_at >= ${bind(String(filters.from))}::date`);
  if (filters.to) where.push(`hold.started_at < (${bind(String(filters.to))}::date + 1)`);
  if (filters.search) {
    const term = bind(`%${String(filters.search).trim().toLowerCase()}%`);
    where.push(`(lower(hold.hold_number) LIKE ${term} OR lower(mo.mo_number) LIKE ${term} OR lower(item.code) LIKE ${term} OR lower(item.name) LIKE ${term})`);
  }
  const rows = (await client.query(
    `SELECT hold.*, mo.mo_number, mo.status AS order_status, mo.planned_base_quantity, mo.accepted_quantity, mo.planned_end_at, item.code AS item_code, item.name AS item_name,
            COALESCE(NULLIF(owner.full_name, ''), owner.email) AS owner_name,
            (SELECT array_agg(reason.reason_code ORDER BY reason.added_at) FROM tenant.manufacturing_production_hold_reasons reason WHERE reason.production_hold_id = hold.id) AS codes,
            (SELECT count(*)::int FROM tenant.manufacturing_production_hold_reasons reason WHERE reason.production_hold_id = hold.id AND reason.status = 'ACTIVE') AS open_reasons,
            (SELECT array_agg(DISTINCT reason.clearance_authority) FROM tenant.manufacturing_production_hold_reasons reason WHERE reason.production_hold_id = hold.id AND reason.status = 'ACTIVE') AS waiting_on,
            (SELECT count(*)::int FROM tenant.manufacturing_demand_allocations allocation WHERE allocation.manufacturing_order_id = mo.id AND allocation.status NOT IN ('RELEASED', 'FULFILLED')
               AND allocation.allocated_quantity > allocation.received_quantity) AS customer_lines
       FROM tenant.manufacturing_production_holds hold JOIN tenant.manufacturing_orders mo ON mo.id = hold.manufacturing_order_id JOIN tenant.items item ON item.id = mo.finished_item_id
       LEFT JOIN public.users owner ON owner.id = hold.hold_owner_id
      WHERE ${where.join(" AND ")} ORDER BY hold.started_at DESC LIMIT 500`, values)).rows;
  return rows.map((row) => {
    const duration = hoursBetween(row.started_at, row.resolved_at);
    return {
      id: row.id, number: row.hold_number, status: row.status, statusLabel: STATUS[row.status], severity: row.severity, orderId: row.manufacturing_order_id, orderNumber: row.mo_number,
      orderStatus: row.order_status, orderStatusLabel: STATUS_LABEL[row.order_status], item: `${row.item_code} · ${row.item_name}`, reasons: (row.codes ?? []).map((code) => REASONS[code]),
      primaryReason: row.codes?.[0] ?? null, openReasons: row.open_reasons, waitingOn: (row.waiting_on ?? []).map((authority) => AUTHORITY_LABEL[authority]),
      owner: row.owner_name ?? null, startedAt: row.started_at, resolvedAt: row.resolved_at, durationHours: hours(duration), overdue: row.status === "ACTIVE" && duration > settings.overdueHours,
      previousStatus: row.previous_mo_status, remaining: q(max(sub(D(row.planned_base_quantity), D(row.accepted_quantity)), ZERO)), customerLines: row.customer_lines,
      plannedEndAt: row.planned_end_at, expectedResolutionAt: row.expected_resolution_at, resumeRequested: Boolean(row.resume_requested_at),
    };
  });
}
export async function getHeldManufacturingOrders(client, c, filters = {}) {
  needHold(c, HOLD.view);
  return listRows(client, c, filters);
}

// ------------------------------------------------------------------ reports
export const HOLD_REPORTS = Object.freeze(["active", "by-reason", "by-severity", "downtime", "by-mo", "aging", "material-shortage", "quality", "equipment", "sales-risk", "subassembly", "audit"]);
export async function getProductionHoldReport(client, c, kind = "active", filters = {}) {
  needHold(c, HOLD.view);
  if (!HOLD_REPORTS.includes(kind)) throw holdError(400, "MFG_HOLD_REASON_REQUIRED", "Choose a hold report.");
  const all = await listRows(client, c, { ...filters, status: kind === "active" || kind === "aging" || kind === "sales-risk" ? "ACTIVE" : "all" });
  const group = (key) => {
    const map = new Map();
    for (const row of all) for (const k of [].concat(key(row))) {
      const entry = map.get(k) ?? { key: k, holds: 0, active: 0, hours: 0 };
      entry.holds += 1; entry.active += row.status === "ACTIVE" ? 1 : 0; entry.hours += row.durationHours;
      map.set(k, entry);
    }
    return [...map.values()].map((entry) => ({ ...entry, hours: hours(entry.hours), averageHours: entry.holds ? hours(entry.hours / entry.holds) : 0 })).sort((a, b) => b.hours - a.hours);
  };
  const withReason = async (code) => {
    const ids = all.map((row) => row.id);
    if (!ids.length) return [];
    const reasons = (await client.query(`SELECT * FROM tenant.manufacturing_production_hold_reasons WHERE organization_id = $1 AND production_hold_id = ANY($2::uuid[]) AND reason_code = $3 ORDER BY added_at DESC`,
      [c.organizationId, ids, code])).rows;
    const byId = new Map(all.map((row) => [row.id, row]));
    return reasons.map((reason) => ({ ...byId.get(reason.production_hold_id), reasonId: reason.id, description: reason.description, reasonStatus: reason.status, reasonSeverity: reason.severity,
      sourceReference: reason.source_reference, correctiveAction: reason.corrective_action, resolvedAt: reason.resolved_at }));
  };
  switch (kind) {
    case "active": return all;
    case "aging": return [...all].sort((a, b) => b.durationHours - a.durationHours);
    // Reasons of one episode overlap: a hold counts its own downtime once, under each reason it carried.
    case "by-reason": return group((row) => [...new Set(row.reasons)]);
    case "by-severity": return group((row) => row.severity);
    case "downtime": {
      const byOrder = new Map();
      for (const row of all) {
        const entry = byOrder.get(row.orderId) ?? { orderId: row.orderId, orderNumber: row.orderNumber, item: row.item, episodes: 0, hours: 0, active: false };
        entry.episodes += 1; entry.hours += row.durationHours; entry.active ||= row.status === "ACTIVE";
        byOrder.set(row.orderId, entry);
      }
      return [...byOrder.values()].map((entry) => ({ ...entry, hours: hours(entry.hours) })).sort((a, b) => b.hours - a.hours);
    }
    case "by-mo": return all;
    case "material-shortage": return withReason("MATERIAL_SHORTAGE");
    case "quality": return withReason("QUALITY_FAILURE");
    case "equipment": return withReason("EQUIPMENT_BREAKDOWN");
    case "sales-risk": {
      const out = [];
      for (const row of all.filter((entry) => entry.customerLines > 0)) {
        for (const line of await getAffectedSalesDemand(client, c, row.orderId, { reasonCode: row.primaryReason })) out.push({ ...line, holdId: row.id, holdNumber: row.number, orderId: row.orderId, orderNumber: row.orderNumber, startedAt: row.startedAt });
      }
      return out;
    }
    case "subassembly": {
      const rows = (await client.query(
        `SELECT hold.id, hold.hold_number, hold.started_at, child.id AS child_id, child.mo_number AS child_number, parent.id AS parent_id, parent.mo_number AS parent_number, parent.status AS parent_status
           FROM tenant.manufacturing_production_holds hold JOIN tenant.manufacturing_orders child ON child.id = hold.manufacturing_order_id
           JOIN tenant.manufacturing_orders parent ON parent.id = child.parent_order_id WHERE hold.organization_id = $1 AND hold.status = 'ACTIVE' ORDER BY hold.started_at`, [c.organizationId])).rows;
      return rows.map((row) => ({ holdId: row.id, holdNumber: row.hold_number, startedAt: row.started_at, orderId: row.child_id, orderNumber: row.child_number, parentId: row.parent_id,
        parentNumber: row.parent_number, parentStatusLabel: STATUS_LABEL[row.parent_status] }));
    }
    case "audit": {
      const ids = all.map((row) => row.id);
      if (!ids.length) return [];
      const events = (await client.query(`SELECT * FROM tenant.manufacturing_production_hold_events WHERE organization_id = $1 AND production_hold_id = ANY($2::uuid[]) ORDER BY occurred_at DESC LIMIT 2000`,
        [c.organizationId, ids])).rows;
      const people = await names(client, events.map((row) => row.actor_user_id));
      const byId = new Map(all.map((row) => [row.id, row]));
      return events.map((row) => ({ holdId: row.production_hold_id, holdNumber: byId.get(row.production_hold_id)?.number, orderId: byId.get(row.production_hold_id)?.orderId,
        orderNumber: byId.get(row.production_hold_id)?.orderNumber, action: ACTION_LABEL[row.action] ?? row.action, summary: row.summary, actor: people.get(row.actor_user_id) ?? null, at: row.occurred_at }));
    }
    default: return [];
  }
}
// Key figures for the queue's header.
export async function getProductionHoldSummary(client, c) {
  needHold(c, HOLD.view);
  const active = await listRows(client, c, { status: "ACTIVE" });
  const resumed = await listRows(client, c, { status: "RESUMED" });
  const ended = resumed.filter((row) => row.resolvedAt);
  return { active: active.length, critical: active.filter((row) => row.severity === "CRITICAL").length, overdue: active.filter((row) => row.overdue).length,
    longestActiveHours: active.reduce((longest, row) => Math.max(longest, row.durationHours), 0), averageHours: ended.length ? hours(ended.reduce((sum, row) => sum + row.durationHours, 0) / ended.length) : 0,
    affectedQuantity: q(active.reduce((sum, row) => sum + D(row.remaining), ZERO)), customerOrdersAtRisk: active.filter((row) => row.customerLines > 0).length };
}
