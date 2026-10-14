// Production Hold — the commands: an order put on hold (an episode remembering the status it interrupted, with its first blocking reason);
// more reasons added to the episode in force; corrective action recorded and each reason cleared by its own authority (a reason linked to a
// quality hold or an inspection only once that record is itself released or finalized); resume readiness re-checked on the server (every
// reason cleared, materials for what remains, nothing awaiting recovery, an approval where the company asks); resume to the interrupted
// status; and a hold closed when its order is cancelled. A hold moves no stock, releases no reservation and posts nothing to Finance.
import { randomUUID } from "node:crypto";

import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { atomically, event as orderEvent, nextNumber, setStatus } from "../orders/mo-core.js";
import {
  AUTHORITY_LABEL, AUTHORITY_PERMISSION, D, HOLD, LEGACY_CATEGORY, REASONS, SEVERITIES, SOURCE_TYPES, ZERO, activeHoldOf, authorityOf, has, higher, holdError, holdEvent, holdSettings,
  loadHold, loadHoldOrder, loadReasons, needHold, notifyHold, q, text, uuid,
} from "./hold-core.js";

const FILE_ENTITY = "manufacturing.production_hold";
const versionCheck = (order, expected) => {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(order.version)) throw holdError(409, "MFG_HOLD_MO_CHANGED");
};
const bump = (client, c, holdId) => client.query(`UPDATE tenant.manufacturing_production_holds SET row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, holdId]);

// A reason as given: its code, severity, explanation and what it is linked to — checked against the order.
async function reasonOf(client, c, order, input) {
  const code = String(input.reasonCode ?? "").toUpperCase();
  if (!REASONS[code]) throw holdError(400, "MFG_HOLD_REASON_REQUIRED");
  const severity = String(input.severity ?? "NORMAL").toUpperCase();
  if (!SEVERITIES.includes(severity)) throw holdError(400, "MFG_HOLD_REASON_REQUIRED", "Choose normal, high or critical.");
  const description = text(input.description, 2000);
  if (description.length < (code === "OTHER" ? 10 : 3)) throw holdError(400, "MFG_HOLD_DESCRIPTION_REQUIRED", code === "OTHER" ? "Explain the interruption (at least a short sentence)." : undefined);
  const sourceType = input.sourceType ? String(input.sourceType).toUpperCase() : null;
  if (sourceType && !SOURCE_TYPES.has(sourceType)) throw holdError(400, "MFG_HOLD_SOURCE_INVALID", "Choose what the reason is linked to.");
  let sourceId = null;
  if (sourceType === "QUALITY_INSPECTION" || sourceType === "QUALITY_HOLD") {
    sourceId = uuid(input.sourceId, "Linked record");
    const table = sourceType === "QUALITY_INSPECTION" ? "manufacturing_quality_inspections" : "manufacturing_quality_holds";
    if (!(await client.query(`SELECT 1 FROM tenant.${table} WHERE organization_id = $1 AND id = $2 AND manufacturing_order_id = $3`, [c.organizationId, sourceId, order.id])).rows[0]) {
      throw holdError(400, "MFG_HOLD_SOURCE_INVALID");
    }
  }
  const materials = Array.isArray(input.affectedMaterialIds) ? [...new Set(input.affectedMaterialIds.map((id) => uuid(id, "Material")))] : [];
  if (materials.length) {
    const found = (await client.query(`SELECT count(*)::int AS n FROM tenant.manufacturing_order_materials WHERE organization_id = $1 AND manufacturing_order_id = $2 AND id = ANY($3::uuid[])`,
      [c.organizationId, order.id, materials])).rows[0].n;
    if (found !== materials.length) throw holdError(400, "MFG_HOLD_SOURCE_INVALID", "Choose materials of this order.");
  }
  return { code, severity, description, sourceType, sourceId, sourceReference: text(input.sourceReference, 200) || null, materials, authority: authorityOf(code, severity) };
}
async function insertReason(client, c, hold, order, reason, key) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO tenant.manufacturing_production_hold_reasons (id, organization_id, production_hold_id, manufacturing_order_id, reason_code, severity, description, clearance_authority,
       source_type, source_id, source_reference, affected_material_ids, added_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::uuid[],$13,$14)`,
    [id, c.organizationId, hold.id, order.id, reason.code, reason.severity, reason.description, reason.authority, reason.sourceType, reason.sourceId, reason.sourceReference, reason.materials,
      c.userId ?? null, key]);
  return id;
}
async function userInOrganization(client, c, userId) {
  return Boolean((await client.query(`SELECT 1 FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`, [c.organizationId, userId])).rows[0]);
}

// ------------------------------------------------------------------ placing a hold
// input: { reasonCode, severity, description, sourceType?, sourceId?, sourceReference?, affectedMaterialIds?, holdOwnerId?, affectedLocationId?, expectedResolutionAt?,
//          notes?, expectedMoVersion?, idempotencyKey? }. Effective at once, under the order's lock: a production posting that waits for the lock
// sees the hold and is refused; one that got the lock first completed before the hold. An order already on hold gets the reason added
// to its episode (never a second episode, never a new start).
export async function placeManufacturingOrderOnHold(client, c, orderId, input = {}) {
  needHold(c, HOLD.place);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const done = (await client.query(`SELECT id FROM tenant.manufacturing_production_holds WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0]
      ?? (await client.query(`SELECT production_hold_id AS id FROM tenant.manufacturing_production_hold_reasons WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { holdId: done.id, orderId, replayed: true };
  }
  const order = await loadHoldOrder(client, c, orderId, { lock: true });
  versionCheck(order, input.expectedMoVersion);
  if (order.status === "ON_HOLD") return addProductionHoldReason(client, c, order.id, input, { order, key });
  if (!["RELEASED", "IN_PROGRESS"].includes(order.status)) {
    throw holdError(409, "MFG_HOLD_STATUS_INVALID", order.status === "COMPLETION_PENDING" ? `${order.mo_number} is being completed: resolve its completion blockers instead.`
      : order.status === "RECOVERY_REQUIRED" ? `${order.mo_number} needs recovery first.` : `${order.mo_number} is ${order.status.toLowerCase().replace(/_/g, " ")}: only a released or in-progress order is put on hold.`);
  }
  const reason = await reasonOf(client, c, order, input);
  const ownerId = input.holdOwnerId ? uuid(input.holdOwnerId, "Hold owner") : order.production_owner_id ?? c.userId ?? null;
  if (ownerId && input.holdOwnerId && !(await userInOrganization(client, c, ownerId))) throw holdError(400, "MFG_HOLD_SOURCE_INVALID", "Choose a member of the company as the hold owner.");
  const locationId = input.affectedLocationId ? uuid(input.affectedLocationId, "Location") : null;
  if (locationId && !(await client.query(`SELECT 1 FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2`, [c.organizationId, locationId])).rows[0]) {
    throw holdError(400, "MFG_HOLD_SOURCE_INVALID", "That location was not found.");
  }
  const expected = input.expectedResolutionAt && !Number.isNaN(Date.parse(input.expectedResolutionAt)) ? new Date(input.expectedResolutionAt).toISOString() : null;
  const id = randomUUID();
  const number = await nextNumber(client, c, "manufacturing_production_hold");
  await client.query(
    `INSERT INTO tenant.manufacturing_production_holds (id, organization_id, hold_number, manufacturing_order_id, previous_mo_status, severity, hold_owner_id, affected_location_id,
       expected_resolution_at, notes, requested_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, c.organizationId, number, order.id, order.status, reason.severity, ownerId, locationId, expected, text(input.notes, 2000) || null, c.userId ?? null, key]);
  const hold = await loadHold(client, c, id);
  const reasonId = await insertReason(client, c, hold, order, reason, null);
  // The order's own exception list keeps its open hold (completion lists it), as before.
  await client.query(`INSERT INTO tenant.manufacturing_order_exceptions (organization_id, manufacturing_order_id, category, reason, source_type, raised_by) VALUES ($1,$2,$3,$4,'hold',$5)`,
    [c.organizationId, order.id, LEGACY_CATEGORY[reason.code] ?? "OTHER", reason.description.slice(0, 1000), c.userId ?? null]);
  const summary = `${number}: ${REASONS[reason.code].toLowerCase()} (${reason.severity.toLowerCase()}) — ${reason.description}`;
  await setStatus(client, c, order, "ON_HOLD", { held_from_status: order.status, hold_reason: reason.description.slice(0, 1000), hold_category: LEGACY_CATEGORY[reason.code] ?? "OTHER" },
    { action: "HELD", summary, details: { holdId: id, holdNumber: number } });
  await holdEvent(client, c, id, "HOLD_CREATED", { reasonId, summary: `${order.mo_number} stopped from ${order.status.toLowerCase().replace(/_/g, " ")}: ${REASONS[reason.code]}`, details: { severity: reason.severity } });
  await notifyHold(client, c, { order, hold, title: `${order.mo_number} is on hold`, message: `${REASONS[reason.code]} (${reason.severity.toLowerCase()}): ${reason.description}`,
    authorities: reason.authority === "PRODUCTION" ? [] : [reason.authority] });
  return { holdId: id, holdNumber: number, orderId: order.id };
}

// input: as for placing, plus { holdId? }. Adds a blocker to the episode in force; the start does not move. The same reason, linked to the
// same record, is not added twice.
export async function addProductionHoldReason(client, c, orderId, input = {}, { order: lockedOrder = null, key: givenKey } = {}) {
  needHold(c, HOLD.place);
  const key = givenKey !== undefined ? givenKey : text(input.idempotencyKey, 200) || null;
  if (key && givenKey === undefined) {
    const done = (await client.query(`SELECT production_hold_id AS id FROM tenant.manufacturing_production_hold_reasons WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { holdId: done.id, orderId, replayed: true };
  }
  const order = lockedOrder ?? await loadHoldOrder(client, c, orderId, { lock: true });
  if (order.status !== "ON_HOLD") throw holdError(409, "MFG_HOLD_STATUS_INVALID", `${order.mo_number} is not on hold: put it on hold first.`);
  const hold = await activeHoldOf(client, c, order.id, { lock: true });
  if (!hold) throw holdError(409, "MFG_HOLD_OPERATION_UNKNOWN", `${order.mo_number} is on hold without a recorded hold: ask a manager to recover it.`);
  if (input.holdId && input.holdId !== hold.id) throw holdError(409, "MFG_HOLD_MO_CHANGED");
  const reason = await reasonOf(client, c, order, input);
  const reasons = await loadReasons(client, c, hold.id);
  if (reasons.some((row) => row.status === "ACTIVE" && row.reason_code === reason.code && (row.source_id ?? null) === reason.sourceId && (row.source_reference ?? null) === reason.sourceReference)) {
    throw holdError(409, "MFG_HOLD_ALREADY_ACTIVE", `${order.mo_number} is already on hold for ${REASONS[reason.code].toLowerCase()}: add evidence to that reason instead.`);
  }
  const reasonId = await insertReason(client, c, hold, order, reason, key);
  await client.query(`UPDATE tenant.manufacturing_production_holds SET severity = $3, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, hold.id, higher(hold.severity, reason.severity)]);
  await holdEvent(client, c, hold.id, "REASON_ADDED", { reasonId, summary: `${REASONS[reason.code]} (${reason.severity.toLowerCase()}): ${reason.description}` });
  if (reason.severity !== hold.severity && higher(hold.severity, reason.severity) === reason.severity) {
    await holdEvent(client, c, hold.id, "SEVERITY_CHANGED", { summary: `${hold.severity.toLowerCase()} → ${reason.severity.toLowerCase()}` });
  }
  await orderEvent(client, c, order.id, "HOLD_REASON_ADDED", { summary: `${hold.hold_number}: ${REASONS[reason.code].toLowerCase()} — ${reason.description}` });
  await notifyHold(client, c, { order, hold, title: `${order.mo_number}: another reason to stay on hold`, message: `${REASONS[reason.code]} (${reason.severity.toLowerCase()}): ${reason.description}`,
    authorities: reason.authority === "PRODUCTION" ? [] : [reason.authority] });
  return { holdId: hold.id, holdNumber: hold.hold_number, orderId: order.id, reasonId, added: true };
}

// ------------------------------------------------------------------ corrective action and clearance
async function lockedReason(client, c, reasonId) {
  const reason = (await client.query(`SELECT * FROM tenant.manufacturing_production_hold_reasons WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(reasonId, "Hold reason")])).rows[0];
  if (!reason) throw holdError(404, "MFG_HOLD_NOT_FOUND", "That hold reason was not found.");
  const order = await loadHoldOrder(client, c, reason.manufacturing_order_id, { lock: true });
  const hold = await loadHold(client, c, reason.production_hold_id, { lock: true });
  const current = (await client.query(`SELECT * FROM tenant.manufacturing_production_hold_reasons WHERE id = $1 FOR UPDATE`, [reason.id])).rows[0];
  return { reason: current, order, hold };
}
const mayClear = (c, reason) => has(c, AUTHORITY_PERMISSION[reason.clearance_authority]);
// Whether a reason's linked record is itself cleared (the authoritative clearance lives there, not in a flag here).
export async function linkedClearance(client, c, reason) {
  if (reason.source_type === "QUALITY_HOLD" && reason.source_id) {
    const row = (await client.query(`SELECT status FROM tenant.manufacturing_quality_holds WHERE organization_id = $1 AND id = $2`, [c.organizationId, reason.source_id])).rows[0];
    return row?.status === "RELEASED" ? null : "The linked quality hold is still active: Quality releases or reinspects it first.";
  }
  if (reason.source_type === "QUALITY_INSPECTION" && reason.source_id) {
    const row = (await client.query(`SELECT status, inspection_number FROM tenant.manufacturing_quality_inspections WHERE organization_id = $1 AND id = $2`, [c.organizationId, reason.source_id])).rows[0];
    return ["FINALIZED", "CANCELLED"].includes(row?.status) ? null : `${row?.inspection_number ?? "The linked inspection"} is still open: Quality finalizes it first.`;
  }
  return null;
}

// input: { correctiveAction } — what is being done about it; by whoever may clear it or place holds.
export async function recordCorrectiveAction(client, c, reasonId, input = {}) {
  const { reason, order, hold } = await lockedReason(client, c, reasonId);
  if (!mayClear(c, reason) && !has(c, HOLD.place)) throw holdError(403, "MFG_HOLD_PERMISSION_DENIED", "You may not record action on this hold.");
  if (hold.status !== "ACTIVE" || reason.status !== "ACTIVE") throw holdError(409, "MFG_HOLD_ALREADY_RESUMED", "This reason is no longer active.");
  const action = text(input.correctiveAction, 2000);
  if (action.length < 3) throw holdError(400, "MFG_HOLD_RESOLUTION_REQUIRED", "Say what is being done.");
  await client.query(`UPDATE tenant.manufacturing_production_hold_reasons SET corrective_action = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, reason.id, action]);
  await bump(client, c, hold.id);
  await holdEvent(client, c, hold.id, "CORRECTIVE_ACTION", { reasonId: reason.id, summary: action });
  return { holdId: hold.id, orderId: order.id, reasonId: reason.id };
}

// input: { resolutionNotes, evidence?, correctiveAction?, idempotencyKey? } — by the reason's own authority; a linked quality record must be
// cleared first. Clearing the last reason makes the order ready to resume; it does not resume it.
export async function resolveProductionHoldReason(client, c, reasonId, input = {}) {
  const { reason, order, hold } = await lockedReason(client, c, reasonId);
  if (reason.status === "RESOLVED") return { holdId: hold.id, orderId: order.id, reasonId: reason.id, replayed: true };
  if (!mayClear(c, reason)) {
    throw holdError(403, reason.clearance_authority === "QUALITY" ? "MFG_HOLD_QUALITY_BLOCKED" : reason.clearance_authority === "SAFETY" ? "MFG_HOLD_SAFETY_BLOCKED" : "MFG_HOLD_PERMISSION_DENIED",
      `${AUTHORITY_LABEL[reason.clearance_authority]} clears this reason: ${REASONS[reason.reason_code].toLowerCase()}.`);
  }
  if (hold.status !== "ACTIVE") throw holdError(409, "MFG_HOLD_ALREADY_RESUMED");
  const notes = text(input.resolutionNotes, 2000);
  if (notes.length < 3) throw holdError(400, "MFG_HOLD_RESOLUTION_REQUIRED");
  const pending = await linkedClearance(client, c, reason);
  if (pending) throw holdError(409, "MFG_HOLD_CLEARANCE_PENDING", pending);
  await client.query(`UPDATE tenant.manufacturing_production_hold_reasons SET status = 'RESOLVED', resolution_notes = $3, resolution_evidence = $4, corrective_action = COALESCE($5, corrective_action),
      resolved_by = $6, resolved_at = clock_timestamp() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, reason.id, notes, text(input.evidence, 1000) || null, text(input.correctiveAction, 2000) || null, c.userId ?? null]);
  await bump(client, c, hold.id);
  await holdEvent(client, c, hold.id, "REASON_RESOLVED", { reasonId: reason.id, summary: `${REASONS[reason.reason_code]} cleared by ${AUTHORITY_LABEL[reason.clearance_authority].toLowerCase()}: ${notes}` });
  await orderEvent(client, c, order.id, "HOLD_REASON_RESOLVED", { summary: `${hold.hold_number}: ${REASONS[reason.reason_code].toLowerCase()} cleared — ${notes}` });
  const open = (await loadReasons(client, c, hold.id)).filter((row) => row.status === "ACTIVE");
  if (!open.length) {
    await holdEvent(client, c, hold.id, "ALL_REASONS_RESOLVED", { summary: "Every reason is cleared: the order may be resumed after its readiness check." });
    await notifyHold(client, c, { order, hold, title: `${order.mo_number} is ready to resume`, message: `Every reason for ${hold.hold_number} is cleared. Check readiness and resume production.` });
  }
  return { holdId: hold.id, orderId: order.id, reasonId: reason.id, remaining: open.length };
}

// ------------------------------------------------------------------ readiness
// What resuming needs now, checked on the server: each check { code, ok, blocking, message }. input: { proceedWithShortages? }.
export async function getResumeReadiness(client, c, orderId, input = {}, { forApproval = false } = {}) {
  needHold(c, HOLD.view);
  const order = await loadHoldOrder(client, c, orderId);
  const hold = await activeHoldOf(client, c, order.id);
  const checks = [];
  const add_ = (code, ok, message, { blocking = true } = {}) => checks.push({ code, ok, blocking: !ok && blocking, message });
  if (order.status !== "ON_HOLD" || !hold) {
    add_(["COMPLETED", "CANCELLED"].includes(order.status) ? "MFG_HOLD_STATUS_INVALID" : "MFG_HOLD_ALREADY_RESUMED", false,
      ["COMPLETED", "CANCELLED"].includes(order.status) ? `${order.mo_number} is ${order.status.toLowerCase()}: it cannot be resumed.` : `${order.mo_number} is not on hold.`);
    return { orderId: order.id, orderNumber: order.mo_number, holdId: hold?.id ?? null, ready: false, checks, warnings: [], approval: null, targetStatus: null, orderVersion: order.version };
  }
  const settings = await holdSettings(client, c);
  const reasons = await loadReasons(client, c, hold.id);
  const open = reasons.filter((row) => row.status === "ACTIVE");
  for (const authority of ["SAFETY", "QUALITY", "PRODUCTION"]) {
    const mine = open.filter((row) => row.clearance_authority === authority);
    if (!mine.length) continue;
    add_(authority === "SAFETY" ? "MFG_HOLD_SAFETY_BLOCKED" : authority === "QUALITY" ? "MFG_HOLD_QUALITY_BLOCKED" : "MFG_HOLD_REASON_UNRESOLVED", false,
      `${AUTHORITY_LABEL[authority]} has not cleared: ${mine.map((row) => REASONS[row.reason_code].toLowerCase()).join(", ")}.`);
  }
  if (!open.length) add_("REASONS", true, "Every reason is cleared.");
  // Materials for what remains: blocking when the hold was for a shortage (unless the company lets an order run short and the person says so).
  const warnings = [];
  const { getMaterialAvailability } = await import("../availability/material-availability.js");
  const view = { ...c, permissions: [...new Set([...(c.permissions ?? []), "manufacturing.material.view", "manufacturing.mo.view"])] };
  const availability = await getMaterialAvailability(client, view, order.id);
  const shortageHold = reasons.some((row) => row.reason_code === "MATERIAL_SHORTAGE");
  const short = availability.materials.filter((row) => D(row.shortage ?? 0) > ZERO);
  if (!availability.availabilityAuthoritative) {
    add_("MFG_HOLD_MATERIAL_NOT_READY", false, `Stock cannot be verified right now: ${availability.failure ?? "try again shortly"}.`);
  } else if (short.length) {
    const text_ = `Short for the remaining ${q(D(availability.remainingOutput))}: ${short.map((row) => `${row.code} ${q(D(row.shortage))}`).join(", ")}. At most ${q(D(availability.maximumFeasibleOutput))} can be made now.`;
    if (shortageHold && !(input.proceedWithShortages === true && settings.releaseWithShortages)) add_("MFG_HOLD_MATERIAL_NOT_READY", false, text_);
    else { add_("MATERIALS", true, text_); warnings.push(text_); }
  } else add_("MATERIALS", true, "Materials cover the remaining output.");
  // Anything posted with an unknown outcome or disagreeing with its records stops a restart.
  const recovery = (await client.query(
    `SELECT (SELECT count(*) FROM tenant.manufacturing_material_issues WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status IN ('RECOVERY_REQUIRED', 'POSTING'))
          + (SELECT count(*) FROM tenant.manufacturing_material_consumptions WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status IN ('RECOVERY_REQUIRED', 'POSTING'))
          + (SELECT count(*) FROM tenant.manufacturing_finished_goods_receipts WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status IN ('RECOVERY_REQUIRED', 'POSTING'))
          + (SELECT count(*) FROM tenant.manufacturing_scraps WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status IN ('RECOVERY_REQUIRED', 'POSTING'))
          + (SELECT count(*) FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status = 'RECOVERY_REQUIRED')
          + (SELECT count(*) FROM tenant.manufacturing_quality_inspections WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status = 'RECOVERY_REQUIRED') AS n`,
    [c.organizationId, order.id])).rows[0];
  add_("MFG_HOLD_INVENTORY_RECOVERY", Number(recovery.n) === 0, Number(recovery.n) ? `${recovery.n} posting(s) of this order need recovery first.` : "No posting awaits recovery.");
  // Quality holds on produced output stay as they are: resuming production does not release them.
  const qualityHolds = (await client.query(`SELECT count(*)::int AS n, COALESCE(sum(quantity), 0) AS quantity FROM tenant.manufacturing_quality_holds WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status = 'ACTIVE'`,
    [c.organizationId, order.id])).rows[0];
  if (qualityHolds.n) warnings.push(`${q(D(qualityHolds.quantity))} produced unit(s) stay on quality hold after the order resumes; Quality releases them.`);
  const approval = { required: settings.resumeApprovalRequired, requested: Boolean(hold.resume_requested_at), requestedBy: hold.resume_requested_by,
    current: hold.resume_request_version === hold.row_version, approved: Boolean(hold.resume_approved_at) && hold.resume_request_version === hold.row_version };
  if (settings.resumeApprovalRequired && !forApproval) {
    add_("MFG_HOLD_RESUME_APPROVAL_REQUIRED", approval.approved, approval.approved ? "Resume approved." : approval.requested && !approval.current
      ? "The hold changed after resuming was requested: request it again." : approval.requested ? "Resuming waits for a manager's approval." : "Request resuming: a manager approves it.");
  }
  return { orderId: order.id, orderNumber: order.mo_number, holdId: hold.id, holdNumber: hold.hold_number, holdVersion: hold.row_version, orderVersion: order.version,
    ready: checks.every((row) => !row.blocking), checks, warnings, approval, targetStatus: hold.previous_mo_status, checkedAt: new Date().toISOString(),
    materials: { remaining: availability.remainingOutput, feasible: availability.maximumFeasibleOutput, short: short.length } };
}

// ------------------------------------------------------------------ resume
// input: { productionHoldId?, resolutionNotes, expectedMoVersion?, proceedWithShortages?, resolveRemaining?, idempotencyKey? }. Under the order's
// lock: still on hold under this episode, every reason cleared (resolveRemaining clears those the person may clear, with the notes), ready,
// approved where the company asks; then back to the status it interrupted — once.
export async function resumeManufacturingOrder(client, c, orderId, input = {}, { approvedBy = null } = {}) {
  needHold(c, HOLD.resume, "MFG_HOLD_PERMISSION_DENIED", "You are not authorized to resume production.");
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const done = (await client.query(`SELECT id, manufacturing_order_id FROM tenant.manufacturing_production_holds WHERE organization_id = $1 AND resume_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { holdId: done.id, orderId: done.manufacturing_order_id, replayed: true };
  }
  const order = await loadHoldOrder(client, c, orderId, { lock: true });
  versionCheck(order, input.expectedMoVersion);
  if (order.status !== "ON_HOLD") {
    throw holdError(409, ["COMPLETED", "CANCELLED"].includes(order.status) ? "MFG_HOLD_STATUS_INVALID" : "MFG_HOLD_ALREADY_RESUMED",
      ["COMPLETED", "CANCELLED"].includes(order.status) ? `${order.mo_number} is ${order.status.toLowerCase()}: it cannot be resumed.` : undefined);
  }
  const hold = await activeHoldOf(client, c, order.id, { lock: true });
  if (!hold) throw holdError(409, "MFG_HOLD_OPERATION_UNKNOWN", `${order.mo_number} is on hold without a recorded hold: ask a manager to recover it.`);
  if (input.productionHoldId && input.productionHoldId !== hold.id) throw holdError(409, "MFG_HOLD_MO_CHANGED");
  const notes = text(input.resolutionNotes ?? input.note, 2000);
  if (input.resolveRemaining) {
    if (notes.length < 3) throw holdError(400, "MFG_HOLD_RESOLUTION_REQUIRED", "Say how the hold was resolved.");
    for (const reason of (await loadReasons(client, c, hold.id)).filter((row) => row.status === "ACTIVE" && mayClear(c, row))) {
      if (await linkedClearance(client, c, reason)) continue;
      await resolveProductionHoldReason(client, c, reason.id, { resolutionNotes: notes });
    }
  }
  const readiness = await getResumeReadiness(client, { ...c, permissions: [...new Set([...(c.permissions ?? []), HOLD.view])] }, order.id, input, { forApproval: Boolean(approvedBy) });
  const blocking = readiness.checks.find((row) => row.blocking);
  if (blocking) throw holdError(409, blocking.code, blocking.message, { checks: readiness.checks });
  if (notes.length < 3) throw holdError(400, "MFG_HOLD_RESOLUTION_REQUIRED", "Say how the hold was resolved.");
  const target = hold.previous_mo_status;
  await client.query(`UPDATE tenant.manufacturing_production_holds SET status = 'RESUMED', resolution_notes = $3, resumed_to_status = $4, resumed_by = $5, resolved_at = clock_timestamp(),
      resume_approved_by = COALESCE($6, resume_approved_by), resume_approved_at = CASE WHEN $6::uuid IS NULL THEN resume_approved_at ELSE clock_timestamp() END, resume_key = $7,
      row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, hold.id, notes, target, c.userId ?? null, approvedBy, key]);
  await client.query(`UPDATE tenant.manufacturing_order_exceptions SET status = 'RESOLVED', resolved_by = $3, resolved_at = clock_timestamp(), resolution = $4
      WHERE organization_id = $1 AND manufacturing_order_id = $2 AND source_type = 'hold' AND status = 'OPEN'`, [c.organizationId, order.id, c.userId ?? null, notes.slice(0, 1000)]);
  await setStatus(client, c, order, target, { held_from_status: null, hold_reason: null, hold_category: null }, { action: "RESUMED", summary: `${hold.hold_number}: ${notes}`, details: { holdId: hold.id } });
  await holdEvent(client, c, hold.id, "RESUMED", { summary: `Back to ${target.toLowerCase().replace(/_/g, " ")}: ${notes}`, details: { warnings: readiness.warnings } });
  await notifyHold(client, c, { order, hold, title: `${order.mo_number} resumed`, message: `${hold.hold_number} is resolved: ${notes}`, extraUsers: [hold.resume_requested_by] });
  return { holdId: hold.id, orderId: order.id, resumedTo: target, warnings: readiness.warnings };
}

// input: { note, expectedMoVersion?, proceedWithShortages? } — where the company asks for an approval: everything else ready, the request is bound
// to the hold as it stands. Without that policy it resumes at once.
export async function requestResume(client, c, orderId, input = {}) {
  needHold(c, HOLD.resume, "MFG_HOLD_PERMISSION_DENIED", "You are not authorized to resume production.");
  const settings = await holdSettings(client, c);
  if (!settings.resumeApprovalRequired) return resumeManufacturingOrder(client, c, orderId, { ...input, resolutionNotes: input.note ?? input.resolutionNotes });
  const order = await loadHoldOrder(client, c, orderId, { lock: true });
  versionCheck(order, input.expectedMoVersion);
  const hold = await activeHoldOf(client, c, order.id, { lock: true });
  if (order.status !== "ON_HOLD" || !hold) throw holdError(409, "MFG_HOLD_ALREADY_RESUMED");
  const note = text(input.note ?? input.resolutionNotes, 2000);
  if (note.length < 3) throw holdError(400, "MFG_HOLD_RESOLUTION_REQUIRED", "Say how the hold was resolved.");
  const readiness = await getResumeReadiness(client, { ...c, permissions: [...new Set([...(c.permissions ?? []), HOLD.view])] }, order.id, input, { forApproval: true });
  const blocking = readiness.checks.find((row) => row.blocking);
  if (blocking) throw holdError(409, blocking.code, blocking.message, { checks: readiness.checks });
  await client.query(`UPDATE tenant.manufacturing_production_holds SET resume_requested_by = $3, resume_requested_at = clock_timestamp(), resume_request_note = $4, resume_request_version = row_version + 1,
      resume_approved_by = NULL, resume_approved_at = NULL, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, hold.id, c.userId ?? null, note]);
  await holdEvent(client, c, hold.id, "RESUME_REQUESTED", { summary: note });
  await notifyHold(client, c, { order, hold, title: `${order.mo_number}: resume waits for approval`, message: note, authorities: [] });
  return { holdId: hold.id, orderId: order.id, requested: true };
}

// input: { decision: APPROVE | REJECT, note? } — by someone other than the person who asked (unless the company allows self-approval); an
// approval resumes the order, re-checking everything; a request made before the hold changed is refused.
export async function decideResume(client, c, orderId, input = {}) {
  needHold(c, HOLD.approveResume, "MFG_HOLD_RESUME_APPROVAL_REQUIRED", "You may not approve resuming production.");
  const order = await loadHoldOrder(client, c, orderId, { lock: true });
  const hold = await activeHoldOf(client, c, order.id, { lock: true });
  if (order.status !== "ON_HOLD" || !hold) throw holdError(409, "MFG_HOLD_ALREADY_RESUMED");
  if (!hold.resume_requested_at) throw holdError(409, "MFG_HOLD_RESUME_APPROVAL_REQUIRED", "Nobody has asked to resume this order.");
  if (hold.resume_request_version !== hold.row_version) throw holdError(409, "MFG_HOLD_MO_CHANGED", "The hold changed after resuming was requested: it is requested again.");
  const settings = await holdSettings(client, c);
  if (hold.resume_requested_by === c.userId && !settings.varianceSelfApproval) throw holdError(403, "MFG_HOLD_RESUME_APPROVAL_REQUIRED", "Someone other than the person who asked approves resuming.");
  const decision = String(input.decision ?? "").toUpperCase();
  if (decision === "REJECT") {
    const note = text(input.note, 1000);
    if (note.length < 3) throw holdError(400, "MFG_HOLD_RESOLUTION_REQUIRED", "Say why production stays on hold.");
    await client.query(`UPDATE tenant.manufacturing_production_holds SET resume_requested_by = NULL, resume_requested_at = NULL, resume_request_note = NULL, resume_request_version = NULL,
        row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, hold.id]);
    await holdEvent(client, c, hold.id, "RESUME_REJECTED", { summary: note });
    await notifyHold(client, c, { order, hold, title: `${order.mo_number} stays on hold`, message: note, extraUsers: [hold.resume_requested_by] });
    return { holdId: hold.id, orderId: order.id, rejected: true };
  }
  if (decision !== "APPROVE") throw holdError(400, "MFG_HOLD_RESUME_APPROVAL_REQUIRED", "Approve or reject resuming.");
  await holdEvent(client, c, hold.id, "RESUME_APPROVED", { summary: text(input.note, 1000) || "Approved" });
  const ctx = { ...c, permissions: [...new Set([...(c.permissions ?? []), HOLD.resume])] };
  return resumeManufacturingOrder(client, ctx, order.id, { resolutionNotes: hold.resume_request_note, proceedWithShortages: input.proceedWithShortages }, { approvedBy: c.userId ?? null });
}

// ------------------------------------------------------------------ cancellation, overdue, legacy entry points
// The order was cancelled through its own workflow: the episode ends (its reasons stay as recorded); a stale resume finds nothing to resume.
export async function closeHoldOnCancel(client, c, order, reason) {
  const hold = await activeHoldOf(client, c, order.id, { lock: true });
  if (!hold) return;
  await client.query(`UPDATE tenant.manufacturing_production_holds SET status = 'CLOSED', closed_reason = $3, resolved_at = clock_timestamp(), row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, hold.id, `Order cancelled: ${String(reason).slice(0, 500)}`]);
  await holdEvent(client, c, hold.id, "CLOSED", { summary: `Order cancelled: ${reason}` });
}

// Holds older than the company's limit tell the order's owner and the hold owner once (run by the worker on its tick).
export async function notifyOverdueProductionHolds(client, c, { limit = 200 } = {}) {
  const settings = await holdSettings(client, c);
  const rows = (await client.query(
    `SELECT hold.*, mo.mo_number, mo.production_owner_id FROM tenant.manufacturing_production_holds hold JOIN tenant.manufacturing_orders mo ON mo.id = hold.manufacturing_order_id
      WHERE hold.organization_id = $1 AND hold.status = 'ACTIVE' AND hold.overdue_notified_at IS NULL AND hold.started_at < now() - make_interval(hours => $2)
      ORDER BY hold.started_at LIMIT $3 FOR UPDATE OF hold SKIP LOCKED`, [c.organizationId, settings.overdueHours, limit])).rows;
  for (const hold of rows) {
    await client.query(`UPDATE tenant.manufacturing_production_holds SET overdue_notified_at = now() WHERE id = $1`, [hold.id]);
    await holdEvent(client, c, hold.id, "OVERDUE", { summary: `On hold for more than ${settings.overdueHours} hours` });
    await notifyHold(client, c, { order: { production_owner_id: hold.production_owner_id }, hold, title: `${hold.mo_number} has been on hold over ${settings.overdueHours} hours`,
      message: `${hold.hold_number} started ${new Date(hold.started_at).toISOString().slice(0, 16).replace("T", " ")} UTC and is still active.`, authorities: ["PRODUCTION"] });
  }
  return { overdue: rows.length };
}

// The order's own "Put on hold" (input: { category, reason }) and "Resume" (input: { note }): the same path, with the older field names.
export async function holdThroughProductionHold(client, c, orderId, input = {}) {
  const category = String(input.category ?? "OTHER").toUpperCase();
  const reasonCode = input.reasonCode ?? ({ MATERIAL_SHORTAGE: "MATERIAL_SHORTAGE", QUALITY_ISSUE: "QUALITY_FAILURE", EQUIPMENT_DOWNTIME: "EQUIPMENT_BREAKDOWN", PRIORITY_CHANGE: "PRODUCTION_PRIORITY",
    COST_VARIANCE: "COSTING_EXCEPTION", QUANTITY_VARIANCE: "EXCESS_CONSUMPTION" }[category] ?? "OTHER");
  return placeManufacturingOrderOnHold(client, c, orderId, { ...input, reasonCode, description: input.description ?? input.reason });
}

// ------------------------------------------------------------------ evidence
const FILE_TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", csv: "text/csv", txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
export async function prepareHoldFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(String(fileName ?? ""))?.[1] ?? "").toLowerCase();
  const mimeType = FILE_TYPES[extension];
  if (!mimeType) throw holdError(400, "MFG_HOLD_SOURCE_INVALID", "Upload a photo, PDF, spreadsheet, document or text file.");
  return prepareFileUpload({ fileName, mimeType, bytes, maximumBytes: 10 * 1024 * 1024, allowedTypes: [...new Set(Object.values(FILE_TYPES))] }, env);
}
const toFile = (row) => ({ id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0), uploadedAt: row.created_at ?? row.createdAt });
export async function listHoldFiles(client, c, holdId) {
  needHold(c, HOLD.view);
  const hold = await loadHold(client, c, holdId);
  return (await listFiles(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: hold.id })).map(toFile);
}
export async function uploadHoldFile(client, c, holdId, input = {}, options = {}) {
  if (![HOLD.place, HOLD.resolve, HOLD.clearQuality, HOLD.clearSafety].some((permission) => has(c, permission))) throw holdError(403, "MFG_HOLD_PERMISSION_DENIED", "You may not add evidence to this hold.");
  const hold = await loadHold(client, c, holdId);
  const file = await storeFile(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: hold.id, prepared: input.prepared, uploadedBy: c.userId ?? null }, options);
  await holdEvent(client, c, hold.id, "EVIDENCE_ADDED", { summary: file.fileName ?? file.file_name });
  return toFile(file);
}
export async function removeHoldFile(client, c, holdId, fileId) {
  if (!has(c, HOLD.place)) throw holdError(403, "MFG_HOLD_PERMISSION_DENIED", "You may not remove evidence.");
  const hold = await loadHold(client, c, holdId);
  if (hold.status !== "ACTIVE") throw holdError(409, "MFG_HOLD_ALREADY_RESUMED", "Evidence of an ended hold is kept.");
  await archiveFile(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: hold.id, fileId: uuid(fileId, "File"), actorUserId: c.userId ?? null });
  await holdEvent(client, c, hold.id, "EVIDENCE_REMOVED", { summary: fileId });
  return { removed: true };
}
export async function readHoldFile(client, c, holdId, fileId, options = {}) {
  needHold(c, HOLD.view);
  const hold = await loadHold(client, c, holdId);
  const row = (await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [c.organizationId, FILE_ENTITY, hold.id, uuid(fileId, "File")])).rows[0];
  if (!row) throw holdError(404, "MFG_HOLD_NOT_FOUND", "File not found.");
  const content = await readFileContent(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: hold.id, fileId: row.id }, options);
  return { fileName: row.file_name, mimeType: row.mime_type, body: content.body };
}

export { atomically };
