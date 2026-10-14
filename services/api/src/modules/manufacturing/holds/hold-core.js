// Production Hold — the shared core: permissions, reasons and who clears them, errors, loaders, the company's policy, the central execution
// policy every Manufacturing command consults while an order is on hold, and the notifications a hold sends.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { D, MO, STATUS_LABEL, ZERO, has, max, moError, q, settingsOf, sub, text, uuid } from "../orders/mo-core.js";

export const HOLD = Object.freeze({
  place: MO.hold, view: "manufacturing.hold.view", resolve: "manufacturing.hold.resolve", clearQuality: "manufacturing.hold.clear_quality",
  clearSafety: "manufacturing.hold.clear_safety", resume: "manufacturing.hold.resume", approveResume: "manufacturing.hold.approve_resume", export: "manufacturing.hold.export",
});
export const REASONS = Object.freeze({
  MATERIAL_SHORTAGE: "Material shortage", QUALITY_FAILURE: "Quality failure", EQUIPMENT_BREAKDOWN: "Equipment breakdown", SAFETY_CONCERN: "Safety concern",
  WORKFORCE_UNAVAILABLE: "Workforce unavailable", CUSTOMER_CHANGE: "Customer change", PRODUCTION_PRIORITY: "Production priority", EXCESS_CONSUMPTION: "Excess consumption",
  INVENTORY_DISCREPANCY: "Inventory discrepancy", COSTING_EXCEPTION: "Costing exception", OTHER: "Other",
});
// The simplified line a customer-facing user sees: never the internal detail.
export const SALES_MESSAGE = Object.freeze({
  MATERIAL_SHORTAGE: "Production delayed — awaiting materials.", QUALITY_FAILURE: "Production delayed — under quality review.", EQUIPMENT_BREAKDOWN: "Production delayed — equipment unavailable.",
  SAFETY_CONCERN: "Production delayed.", WORKFORCE_UNAVAILABLE: "Production delayed — capacity.", CUSTOMER_CHANGE: "Production paused — awaiting the customer's change.",
  PRODUCTION_PRIORITY: "Production rescheduled.", EXCESS_CONSUMPTION: "Production delayed — materials under review.", INVENTORY_DISCREPANCY: "Production delayed — materials under review.",
  COSTING_EXCEPTION: "Production delayed.", OTHER: "Production delayed.",
});
export const SEVERITIES = Object.freeze(["NORMAL", "HIGH", "CRITICAL"]);
export const SOURCE_TYPES = new Set(["MATERIAL_SHORTAGE", "QUALITY_INSPECTION", "QUALITY_HOLD", "EQUIPMENT_INCIDENT", "SAFETY_INCIDENT", "SALES_DEMAND", "OTHER"]);
export const AUTHORITY_LABEL = Object.freeze({ PRODUCTION: "Production", QUALITY: "Quality", SAFETY: "Safety" });
export const AUTHORITY_PERMISSION = Object.freeze({ PRODUCTION: HOLD.resolve, QUALITY: HOLD.clearQuality, SAFETY: HOLD.clearSafety });
// Who clears a reason: a quality failure is Quality's; a safety concern — or anything critical that is not a quality failure — is Safety's;
// the rest is Production's. A general resume permission never clears the other two.
export const authorityOf = (reasonCode, severity) => (reasonCode === "QUALITY_FAILURE" ? "QUALITY" : reasonCode === "SAFETY_CONCERN" || severity === "CRITICAL" ? "SAFETY" : "PRODUCTION");
export const rank = (severity) => SEVERITIES.indexOf(severity);
export const higher = (a, b) => (rank(a) >= rank(b) ? a : b);
// The existing order columns keep a category; a hold reason maps to the closest one.
export const LEGACY_CATEGORY = Object.freeze({ MATERIAL_SHORTAGE: "MATERIAL_SHORTAGE", QUALITY_FAILURE: "QUALITY_ISSUE", EQUIPMENT_BREAKDOWN: "EQUIPMENT_DOWNTIME",
  PRODUCTION_PRIORITY: "PRIORITY_CHANGE", COSTING_EXCEPTION: "COST_VARIANCE", EXCESS_CONSUMPTION: "QUANTITY_VARIANCE" });
export const FROM_LEGACY = Object.freeze({ MATERIAL_SHORTAGE: "MATERIAL_SHORTAGE", QUALITY_ISSUE: "QUALITY_FAILURE", EQUIPMENT_DOWNTIME: "EQUIPMENT_BREAKDOWN",
  PRIORITY_CHANGE: "PRODUCTION_PRIORITY", COST_VARIANCE: "COSTING_EXCEPTION", QUANTITY_VARIANCE: "EXCESS_CONSUMPTION", OTHER: "OTHER" });

const MESSAGES = Object.freeze({
  MFG_HOLD_MO_NOT_FOUND: "Manufacturing Order could not be found.",
  MFG_HOLD_NOT_FOUND: "The production hold could not be found.",
  MFG_HOLD_STATUS_INVALID: "This Manufacturing Order cannot be put on Hold in its current status.",
  MFG_HOLD_ALREADY_ACTIVE: "Production is already on Hold.",
  MFG_HOLD_REASON_REQUIRED: "Select a reason for stopping production.",
  MFG_HOLD_DESCRIPTION_REQUIRED: "Explain why production must stop.",
  MFG_HOLD_PERMISSION_DENIED: "You are not authorized to put this order on Hold.",
  MFG_HOLD_REASON_UNRESOLVED: "Resolve all blocking issues before resuming.",
  MFG_HOLD_QUALITY_BLOCKED: "Quality clearance is still required.",
  MFG_HOLD_SAFETY_BLOCKED: "Safety authorization is still required.",
  MFG_HOLD_MATERIAL_NOT_READY: "Required materials are not ready for the next production batch.",
  MFG_HOLD_INVENTORY_RECOVERY: "An Inventory operation must be reconciled before production resumes.",
  MFG_HOLD_RESUME_APPROVAL_REQUIRED: "An authorized manager must approve resuming production.",
  MFG_HOLD_MO_CHANGED: "This order changed. Refresh and review the current state.",
  MFG_HOLD_ALREADY_RESUMED: "Production has already resumed.",
  MFG_HOLD_OPERATION_UNKNOWN: "Checking whether the previous operation succeeded. Do not submit it again.",
  MFG_HOLD_SOURCE_INVALID: "The linked record does not belong to this order.",
  MFG_HOLD_CLEARANCE_PENDING: "The linked record must be cleared first.",
  MFG_HOLD_RESOLUTION_REQUIRED: "Say how the issue was resolved.",
});
export const holdError = (status, code, message, details) => moError(status, code, message ?? MESSAGES[code], details);
export const needHold = (c, permission, code = "MFG_HOLD_PERMISSION_DENIED", message) => {
  if (!has(c, permission)) throw holdError(403, code, message ?? (permission === HOLD.place ? undefined : "You are not authorized for this action."));
};

export async function loadHoldOrder(client, c, orderId, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_orders WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, uuid(orderId, "Manufacturing order")])).rows[0];
  if (!row) throw holdError(404, "MFG_HOLD_MO_NOT_FOUND");
  return row;
}
export async function loadHold(client, c, id, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_production_holds WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, uuid(id, "Production hold")])).rows[0];
  if (!row) throw holdError(404, "MFG_HOLD_NOT_FOUND");
  return row;
}
export async function activeHoldOf(client, c, orderId, { lock = false } = {}) {
  return (await client.query(`SELECT * FROM tenant.manufacturing_production_holds WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status = 'ACTIVE'${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, orderId])).rows[0] ?? null;
}
export async function loadReasons(client, c, holdId, { lock = false } = {}) {
  return (await client.query(`SELECT * FROM tenant.manufacturing_production_hold_reasons WHERE organization_id = $1 AND production_hold_id = $2 ORDER BY added_at${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, holdId])).rows;
}
export async function holdSettings(client, c) {
  const settings = await settingsOf(client, c);
  const row = (await client.query(`SELECT ph_resume_approval_required, ph_overdue_after_hours FROM tenant.manufacturing_settings WHERE organization_id = $1`, [c.organizationId])).rows[0] ?? {};
  return { ...settings, resumeApprovalRequired: Boolean(row.ph_resume_approval_required), overdueHours: Number(row.ph_overdue_after_hours ?? 24) };
}
export async function holdEvent(client, c, holdId, action, { reasonId = null, summary = null, details = {} } = {}) {
  await client.query(`INSERT INTO tenant.manufacturing_production_hold_events (organization_id, production_hold_id, reason_id, action, summary, details, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [c.organizationId, holdId, reasonId, action, summary ? String(summary).slice(0, 1000) : null, JSON.stringify(details), c.userId ?? null]);
}
export const hoursBetween = (from, to) => Math.max(0, (new Date(to ?? Date.now()).getTime() - new Date(from).getTime()) / 36e5);

// ------------------------------------------------------------------ the execution policy while an order is on hold
// One policy for every command: what may still happen to a held order. Commands that move it forward stop; those that resolve the hold,
// account for what is already in production or decide what was already produced continue.
export const EXECUTION_ON_HOLD = Object.freeze({
  issue: false, consume: false, produce: false, batch: false, start: false, complete: false,
  reserve: true, releaseReservation: true, return: true, extraRequest: true, shortageRequest: true, inspect: true, scrap: true, correct: true, receive: "policy",
});
const ACTION_TEXT = Object.freeze({ issue: "new material issues", consume: "material consumption", produce: "new production output", batch: "new production batches",
  start: "starting production", complete: "completion", receive: "receiving finished goods" });
// The refusal for an action a held order may not take (null when it may), naming the hold and its reasons.
export function heldRefusal(order, action) {
  if (order.status !== "ON_HOLD" || EXECUTION_ON_HOLD[action] === true) return null;
  return `${order.mo_number} is on hold${order.hold_reason ? ` (${String(order.hold_reason).slice(0, 120)})` : ""}: ${ACTION_TEXT[action] ?? "this"} waits until production resumes.`;
}

// ------------------------------------------------------------------ notifications
// To the order's production owner, the hold owner, the person who placed it and those holding the permission that clears a reason —
// minus the actor. Each event is sent once: it is written in the same transaction as the change it reports.
export async function notifyHold(client, c, { order, hold, title, message, authorities = [], extraUsers = [] }) {
  const users = new Set([order.production_owner_id, hold.hold_owner_id, hold.requested_by, ...extraUsers].filter(Boolean));
  const permissions = [...new Set(authorities.map((authority) => AUTHORITY_PERMISSION[authority]).filter(Boolean))];
  if (permissions.length) {
    // The owners hold every permission without a grant row; they hear of safety blockers (theirs to clear unless a role is granted it).
    const rows = (await client.query(
      `SELECT DISTINCT membership.user_id FROM public.organization_memberships membership
         JOIN public.user_role_assignments assignment ON assignment.organization_id = membership.organization_id AND assignment.user_id = membership.user_id AND assignment.status = 'active'
          AND (assignment.starts_at IS NULL OR assignment.starts_at <= now()) AND (assignment.expires_at IS NULL OR assignment.expires_at > now())
         JOIN public.roles role ON role.id = assignment.role_id AND role.status = 'active'
        WHERE membership.organization_id = $1 AND membership.status = 'active'
          AND (EXISTS (SELECT 1 FROM public.role_permissions grant_row WHERE grant_row.role_id = role.id AND grant_row.permission_key = ANY($2::text[]))
               OR ($3 AND role.slug IN ('organization_owner', 'system_administrator')))
        LIMIT 50`, [c.organizationId, permissions, permissions.includes(HOLD.clearSafety)])).rows;
    for (const row of rows) users.add(row.user_id);
  }
  users.delete(c.userId);
  for (const userId of users) {
    await createNotification(client, { organizationId: c.organizationId, userId, category: "manufacturing_production_hold", title, message,
      href: `/manufacturing/production-holds/${hold.id}`, entityType: "manufacturing_production_hold", entityId: hold.id });
  }
}

export { D, MO, STATUS_LABEL, ZERO, has, max, q, sub, text, uuid };
