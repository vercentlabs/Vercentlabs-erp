// Assets — Custodian, the commands: the handover engine. A handover is prepared (the current custodian stays accountable), then
// physically handed over — custody moves at that moment, recorded with the time it really happened — then acknowledged by the recipient,
// disputed, or confirmed by an authorized exception. A return goes back to a store or a department after the asset's identity and
// condition are checked. Nothing here changes the legal owner or the registered location, or charges anyone for anything.
import { has, recordAssetEvent, text, uuid } from "../common.js";
import { createNotification } from "../../../core/platform/notifications/index.js";
import { CONDITIONS, CUSTODY, DISPUTE_REASON, custodyError, managesCustody, requireCustody } from "./custody-rules.js";

const keyOf = (input) => text(input?.idempotencyKey, 200) || null;
const NAME = (alias) => `COALESCE(NULLIF(${alias}.full_name, ''), ${alias}.email)`;
async function notify(client, c, userIds, asset, title, message) {
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    if (userId === c.userId) continue;
    await createNotification(client, { organizationId: c.organizationId, userId, category: "asset_register", title: `${asset.asset_number}: ${title}`, message: message ?? null,
      href: `/assets/register/${asset.id}?tab=custody`, entityType: "assets.asset", entityId: asset.id });
  }
}
async function usersWith(client, c, permission) {
  return (await client.query(`SELECT DISTINCT assignment.user_id FROM user_role_assignments assignment JOIN role_permissions grant_row ON grant_row.role_id = assignment.role_id
      WHERE assignment.organization_id = $1 AND assignment.status = 'active' AND grant_row.permission_key = $2`, [c.organizationId, permission]).catch(() => ({ rows: [] }))).rows.map((r) => r.user_id);
}
async function assetRow(client, c, assetId) {
  const { loadAssetRow } = await import("../asset-register/register-commands.js");
  return loadAssetRow(client, c, assetId, { lock: true });
}
export async function currentAssignment(client, assetId) {
  return (await client.query(`SELECT * FROM tenant.asset_custody_assignments WHERE asset_id = $1 AND status = 'ACTIVE' FOR UPDATE`, [assetId])).rows[0] ?? null;
}
async function openHandover(client, assetId) {
  return (await client.query(`SELECT * FROM tenant.asset_custody_handovers WHERE asset_id = $1 AND status IN ('PENDING_HANDOVER', 'AWAITING_ACKNOWLEDGMENT', 'DISPUTED') FOR UPDATE`, [assetId])).rows[0] ?? null;
}
async function loadHandover(client, c, handoverId) {
  let id;
  try { id = uuid(handoverId, "Handover"); } catch { throw custodyError(404, "ASSET_CUSTODY_NOT_FOUND"); }
  const h = (await client.query(`SELECT * FROM tenant.asset_custody_handovers WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!h) throw custodyError(404, "ASSET_CUSTODY_NOT_FOUND");
  return h;
}

// The custodian a request names, validated: an active Company member; a department with its accountable person; an active asset store
// with a manager. → { type, userId, departmentId, storeLocationId, accountableUserId, label }
export async function resolveCustodian(client, c, input) {
  const type = String(input.toType ?? input.custodianType ?? "");
  if (type === "EMPLOYEE") {
    if (!input.userId) throw custodyError(400, "ASSET_CUSTODY_INVALID_CUSTODIAN", "Choose the employee.", { field: "userId" });
    const user = (await client.query(`SELECT u.id, u.status AS user_status, m.status AS member_status, ${NAME("u")} AS name FROM public.users u LEFT JOIN public.organization_memberships m ON m.user_id = u.id AND m.organization_id = $1
        WHERE u.id = $2`, [c.organizationId, uuid(input.userId, "Employee")])).rows[0];
    if (!user || !user.member_status) throw custodyError(400, "ASSET_CUSTODY_COMPANY_MISMATCH", "This person is not a member of the Company.");
    if (user.member_status !== "active" || user.user_status !== "active") throw custodyError(409, "ASSET_CUSTODY_EMPLOYEE_INACTIVE");
    const departmentId = input.departmentId ? (await department(client, c, input.departmentId)).id : null;
    return { type, userId: user.id, departmentId, storeLocationId: null, accountableUserId: user.id, label: user.name };
  }
  if (type === "DEPARTMENT") {
    const dept = await department(client, c, input.departmentId);
    const accountable = (await client.query(`SELECT accountable_user_id FROM tenant.asset_department_custody WHERE organization_id = $1 AND department_id = $2`, [c.organizationId, dept.id])).rows[0]?.accountable_user_id;
    if (!accountable) throw custodyError(409, "ASSET_CUSTODY_INVALID_CUSTODIAN", `${dept.name} has no accountable person for asset custody yet; set one in Custody settings.`);
    return { type, userId: null, departmentId: dept.id, storeLocationId: null, accountableUserId: accountable, label: dept.name };
  }
  if (type === "ASSET_STORE") {
    if (!input.storeLocationId) throw custodyError(400, "ASSET_CUSTODY_INVALID_CUSTODIAN", "Choose the asset store.", { field: "storeLocationId" });
    const store = (await client.query(`SELECT id, name, active, is_asset_store, manager_user_id FROM tenant.asset_locations WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(input.storeLocationId, "Asset store")])).rows[0];
    if (!store) throw custodyError(400, "ASSET_CUSTODY_COMPANY_MISMATCH", "This store belongs to another Company.");
    if (!store.active || !store.is_asset_store) throw custodyError(400, "ASSET_CUSTODY_INVALID_CUSTODIAN", "Choose an active location marked as an asset store.");
    if (!store.manager_user_id) throw custodyError(409, "ASSET_CUSTODY_INVALID_CUSTODIAN", `${store.name} has no manager to be accountable for it.`);
    return { type, userId: null, departmentId: null, storeLocationId: store.id, accountableUserId: store.manager_user_id, label: store.name };
  }
  throw custodyError(400, "ASSET_CUSTODY_INVALID_CUSTODIAN");
}
async function department(client, c, departmentId) {
  if (!departmentId) throw custodyError(400, "ASSET_CUSTODY_INVALID_CUSTODIAN", "Choose the department.", { field: "departmentId" });
  const dept = (await client.query(`SELECT id, name, status FROM public.departments WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(departmentId, "Department")])).rows[0];
  if (!dept) throw custodyError(400, "ASSET_CUSTODY_COMPANY_MISMATCH", "This department belongs to another Company.");
  if (dept.status && dept.status !== "active") throw custodyError(409, "ASSET_CUSTODY_INVALID_CUSTODIAN", "This department is inactive.");
  return dept;
}
const sameHolder = (assignment, target) => assignment && assignment.custodian_type === target.type && (assignment.user_id ?? null) === (target.userId ?? null)
  && (target.type !== "DEPARTMENT" || assignment.department_id === target.departmentId) && (assignment.store_location_id ?? null) === (target.storeLocationId ?? null);
// Who may receive the asset now: people and departments only once it is in service and free to use; a store also before commissioning.
async function assertEligible(client, asset, target, kind) {
  if (asset.archived_at || ["DISPOSED", "LOST"].includes(asset.lifecycle_status)) throw custodyError(409, "ASSET_CUSTODY_ASSET_UNAVAILABLE", "A disposed, lost or archived asset takes no new custodian.");
  if (target.type === "ASSET_STORE") return;
  if (asset.lifecycle_status !== "ACTIVE") throw custodyError(409, "ASSET_CUSTODY_ASSET_UNAVAILABLE", asset.lifecycle_status === "ON_HOLD" ? "The asset is on hold." : "Only a commissioned asset in service can be issued.");
  if (asset.condition === "UNSERVICEABLE") throw custodyError(409, "ASSET_CUSTODY_ASSET_UNAVAILABLE", "The asset is recorded as unserviceable.");
  const effective = (await client.query(`SELECT tenant.asset_effective_availability(a) AS v FROM tenant.assets a WHERE a.id = $1`, [asset.id])).rows[0].v;
  if (["UNDER_MAINTENANCE", "IN_TRANSFER"].includes(effective) && kind !== "RETURN") throw custodyError(409, "ASSET_CUSTODY_ASSET_UNAVAILABLE", effective === "UNDER_MAINTENANCE" ? "The asset is under maintenance." : "A transfer of this asset is in progress.");
}
// Moves custody now: the current period ends, the new one starts, the asset's custodian fields follow (under the engine's own context, so
// the database does not record it a second time). The registered location never changes here.
async function applyCustody(client, c, asset, target, { at, condition, expectedReturnAt, handoverId, conditionAtReturn, acknowledgment }) {
  const current = await currentAssignment(client, asset.id);
  if (current) {
    await client.query(`UPDATE tenant.asset_custody_assignments SET status = 'ENDED', effective_to = $2, condition_at_return = COALESCE($3, condition_at_return) WHERE id = $1`, [current.id, at, conditionAtReturn ?? null]);
  }
  const made = (await client.query(`INSERT INTO tenant.asset_custody_assignments (organization_id, asset_id, custodian_type, user_id, department_id, store_location_id, accountable_user_id, effective_from, condition_at_issue,
      expected_return_at, source, source_handover_id, acknowledgment, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'HANDOVER',$11,$12,$13) RETURNING id`,
    [c.organizationId, asset.id, target.type, target.userId, target.departmentId, target.storeLocationId, target.accountableUserId, at, condition, expectedReturnAt ?? null, handoverId, acknowledgment, c.userId])).rows[0];
  const { withStatusContext } = await import("../asset-status/status-commands.js");
  await client.query(`SELECT set_config('vercent.custody_engine', 'on', true)`);
  try {
    await withStatusContext(client, c, { action: "custody", reason: null, sourceType: "asset_custody_handover", sourceId: handoverId },
      () => client.query(`UPDATE tenant.assets SET current_user_id = $3, current_department_id = $4, current_store_location_id = $5, availability_status = $6 WHERE organization_id = $1 AND id = $2`,
        [c.organizationId, asset.id, target.userId, target.type === "EMPLOYEE" ? (target.departmentId ?? asset.current_department_id) : target.departmentId, target.storeLocationId,
          target.type === "ASSET_STORE" ? "AVAILABLE" : "ASSIGNED"]));
  } finally { await client.query(`SELECT set_config('vercent.custody_engine', '', true)`); }
  if (condition && condition !== asset.condition) {
    const { recordAssetCondition } = await import("../asset-status/status-commands.js");
    await recordAssetCondition(client, c, asset.id, { condition, reason: "Recorded at the custody handover" }, { fromVerification: true, source: "INSPECTION" });
  }
  return made.id;
}
const conditionOf = (value, required = true) => {
  const v = String(value ?? "");
  if (CONDITIONS.includes(v)) return v;
  if (required) throw custodyError(400, "ASSET_CUSTODY_INVALID", "Record the asset's condition.", { field: "condition" });
  return null;
};
const timeOf = (value) => {
  if (!value) return new Date().toISOString();
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw custodyError(400, "ASSET_CUSTODY_INVALID", "Enter a valid handover time.");
  if (d.getTime() > Date.now() + 60_000) throw custodyError(400, "ASSET_CUSTODY_INVALID", "The handover cannot be in the future.");
  return d.toISOString();
};

// ------------------------------------------------------------------ issue and reassign
// input: { toType, userId? | departmentId? | storeLocationId?, expectedReturnAt?, notes?, handOverNow?, condition?, handedOverAt?, accessories?, idempotencyKey? }
export async function requestCustodyHandover(client, c, assetId, input = {}) {
  const key = keyOf(input);
  if (key) {
    const done = (await client.query(`SELECT id, status FROM tenant.asset_custody_handovers WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { handoverId: done.id, status: done.status, replayed: true };
  }
  const asset = await assetRow(client, c, assetId);
  const current = await currentAssignment(client, asset.id);
  const kind = !current || current.custodian_type === "ASSET_STORE" ? "ISSUE" : "REASSIGN";
  requireCustody(has(c, kind === "ISSUE" ? CUSTODY.assign : CUSTODY.reassign));
  const target = await resolveCustodian(client, c, input);
  if (sameHolder(current, target)) throw custodyError(409, "ASSET_CUSTODY_ALREADY_ASSIGNED", `${target.label} is already the custodian.`);
  if (await openHandover(client, asset.id)) throw custodyError(409, "ASSET_CUSTODY_CONFLICT");
  await assertEligible(client, asset, target, kind);
  const expected = input.expectedReturnAt ? String(input.expectedReturnAt).slice(0, 10) : null;
  if (expected && !/^\d{4}-\d{2}-\d{2}$/.test(expected)) throw custodyError(400, "ASSET_CUSTODY_INVALID", "Enter the return date as YYYY-MM-DD.");
  const h = (await client.query(`INSERT INTO tenant.asset_custody_handovers (organization_id, asset_id, kind, from_assignment_id, to_type, to_user_id, to_department_id, to_store_location_id, recipient_user_id, status,
      expected_return_at, notes, idempotency_key, created_by, issued_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING_HANDOVER',$10,$11,$12,$13,$13) RETURNING id, handover_number`,
    [c.organizationId, asset.id, kind, current?.id ?? null, target.type, target.userId, target.departmentId, target.storeLocationId, target.accountableUserId, expected, text(input.notes, 1000) || null, key, c.userId])).rows[0];
  await recordAssetEvent(client, c, asset.id, "asset.custody_handover_prepared", { handoverId: h.id, kind, to: target.label });
  if (input.handOverNow) return confirmPhysicalHandover(client, c, h.id, input);
  return { handoverId: h.id, number: `HND-${h.handover_number}`, status: "PENDING_HANDOVER", kind };
}
// input: { condition, handedOverAt?, accessories? } — the moment possession changes; custody moves now, acknowledgment follows.
export async function confirmPhysicalHandover(client, c, handoverId, input = {}) {
  const h = await loadHandover(client, c, handoverId);
  requireCustody(managesCustody(c));
  if (h.status !== "PENDING_HANDOVER") return { handoverId: h.id, status: h.status, replayed: true };
  const asset = await assetRow(client, c, h.asset_id);
  const target = await resolveCustodian(client, c, { toType: h.to_type, userId: h.to_user_id, departmentId: h.to_department_id, storeLocationId: h.to_store_location_id });
  await assertEligible(client, asset, target, h.kind);
  const at = timeOf(input.handedOverAt);
  const condition = conditionOf(input.condition ?? asset.condition ?? null);
  const self = target.accountableUserId === c.userId;
  const assignmentId = await applyCustody(client, c, asset, target, { at, condition, expectedReturnAt: h.expected_return_at, handoverId: h.id, acknowledgment: self ? "ACKNOWLEDGED" : "PENDING",
    conditionAtReturn: h.kind === "RETURN" ? condition : null });
  await client.query(`UPDATE tenant.asset_custody_handovers SET status = $2, physical_handover_at = $3, condition_at_handover = $4, accessories = $5, received_by = $6, to_assignment_id = $7, acknowledged_at = $8 WHERE id = $1`,
    [h.id, self ? "CONFIRMED" : "AWAITING_ACKNOWLEDGMENT", at, condition, text(input.accessories, 500) || null, self ? c.userId : target.accountableUserId, assignmentId, self ? new Date().toISOString() : null]);
  if (self) await client.query(`INSERT INTO tenant.asset_custody_acknowledgments (organization_id, handover_id, user_id, decision, condition_confirmed) VALUES ($1,$2,$3,'ACKNOWLEDGED',true)`, [c.organizationId, h.id, c.userId]);
  await recordAssetEvent(client, c, asset.id, "asset.custody_handed_over", { handoverId: h.id, kind: h.kind, to: target.label, at, condition });
  if (!self) await notify(client, c, [target.accountableUserId], asset, "please confirm receipt", `You have received ${asset.name} (${asset.asset_number}). Please confirm the asset and its condition (${condition.toLowerCase()}).`);
  const location = asset.location_id && target.storeLocationId && target.storeLocationId !== asset.location_id ? "The store is somewhere other than the registered location; request an Asset Transfer if the asset moved." : null;
  return { handoverId: h.id, status: self ? "CONFIRMED" : "AWAITING_ACKNOWLEDGMENT", assignmentId, warning: location, warningCode: location ? "ASSET_CUSTODY_LOCATION_TRANSFER_REQUIRED" : undefined };
}
export async function cancelCustodyHandover(client, c, handoverId, input = {}) {
  const h = await loadHandover(client, c, handoverId);
  requireCustody(managesCustody(c) || h.created_by === c.userId);
  if (h.status === "CANCELLED") return { handoverId: h.id, status: "CANCELLED", replayed: true };
  if (h.status !== "PENDING_HANDOVER") throw custodyError(409, "ASSET_CUSTODY_CONFLICT", "The asset was already handed over; record a return or reassignment instead.");
  const reason = text(input.reason, 500);
  if (reason.length < 3) throw custodyError(400, "ASSET_CUSTODY_INVALID", "Give the reason.", { field: "reason" });
  await client.query(`UPDATE tenant.asset_custody_handovers SET status = 'CANCELLED', cancel_reason = $2 WHERE id = $1`, [h.id, reason]);
  await recordAssetEvent(client, c, h.asset_id, "asset.custody_handover_cancelled", { handoverId: h.id, reason });
  return { handoverId: h.id, status: "CANCELLED" };
}

// ------------------------------------------------------------------ acknowledgment
// input: { conditionConfirmed?, comment? } — by the recipient only (or the accountable person of a department or store).
export async function acknowledgeCustody(client, c, handoverId, input = {}) {
  requireCustody(has(c, CUSTODY.acknowledge));
  const h = await loadHandover(client, c, handoverId);
  if (h.recipient_user_id !== c.userId) throw custodyError(403, "ASSET_CUSTODY_WRONG_RECIPIENT");
  if (h.status === "CONFIRMED") return { handoverId: h.id, status: "CONFIRMED", replayed: true };
  if (h.status !== "AWAITING_ACKNOWLEDGMENT") throw custodyError(409, h.status === "DISPUTED" ? "ASSET_CUSTODY_DISPUTED" : "ASSET_CUSTODY_RETURN_NOT_CONFIRMED", h.status === "PENDING_HANDOVER" ? "The asset has not been handed over yet." : undefined);
  await client.query(`INSERT INTO tenant.asset_custody_acknowledgments (organization_id, handover_id, user_id, decision, condition_confirmed, comment) VALUES ($1,$2,$3,'ACKNOWLEDGED',$4,$5)`,
    [c.organizationId, h.id, c.userId, input.conditionConfirmed !== false, text(input.comment, 1000) || null]);
  await client.query(`UPDATE tenant.asset_custody_handovers SET status = 'CONFIRMED', acknowledged_at = clock_timestamp() WHERE id = $1`, [h.id]);
  if (h.to_assignment_id) await client.query(`UPDATE tenant.asset_custody_assignments SET acknowledgment = 'ACKNOWLEDGED' WHERE id = $1 AND status = 'ACTIVE'`, [h.to_assignment_id]);
  const asset = (await client.query(`SELECT id, asset_number, name FROM tenant.assets WHERE id = $1`, [h.asset_id])).rows[0];
  await recordAssetEvent(client, c, h.asset_id, "asset.custody_acknowledged", { handoverId: h.id });
  await notify(client, c, [h.issued_by], asset, "receipt acknowledged", null);
  return { handoverId: h.id, status: "CONFIRMED" };
}
// input: { reason: NOT_RECEIVED | WRONG_ASSET | WRONG_CONDITION | MISSING_ACCESSORIES | OTHER, comment } — a review, not an acceptance.
export async function disputeCustody(client, c, handoverId, input = {}) {
  requireCustody(has(c, CUSTODY.dispute));
  const h = await loadHandover(client, c, handoverId);
  if (h.recipient_user_id !== c.userId) throw custodyError(403, "ASSET_CUSTODY_WRONG_RECIPIENT");
  if (h.status === "DISPUTED") return { handoverId: h.id, status: "DISPUTED", replayed: true };
  if (h.status !== "AWAITING_ACKNOWLEDGMENT") throw custodyError(409, "ASSET_CUSTODY_CONFLICT", "Only a handover awaiting your acknowledgment can be disputed.");
  const reason = String(input.reason ?? "");
  if (!DISPUTE_REASON[reason]) throw custodyError(400, "ASSET_CUSTODY_INVALID", "Choose what is wrong.", { field: "reason" });
  const comment = text(input.comment, 1000);
  if (reason === "OTHER" && comment.length < 3) throw custodyError(400, "ASSET_CUSTODY_INVALID", "Describe the problem.", { field: "comment" });
  await client.query(`INSERT INTO tenant.asset_custody_acknowledgments (organization_id, handover_id, user_id, decision, dispute_reason, comment) VALUES ($1,$2,$3,'DISPUTED',$4,$5)`, [c.organizationId, h.id, c.userId, reason, comment || null]);
  await client.query(`UPDATE tenant.asset_custody_handovers SET status = 'DISPUTED' WHERE id = $1`, [h.id]);
  if (h.to_assignment_id) await client.query(`UPDATE tenant.asset_custody_assignments SET acknowledgment = 'DISPUTED' WHERE id = $1 AND status = 'ACTIVE'`, [h.to_assignment_id]);
  const ex = (await client.query(`INSERT INTO tenant.asset_custody_exceptions (organization_id, asset_id, handover_id, assignment_id, kind, description, owner_user_id, created_by) VALUES ($1,$2,$3,$4,'DISPUTED',$5,$6,$7) RETURNING id`,
    [c.organizationId, h.asset_id, h.id, h.to_assignment_id, `${DISPUTE_REASON[reason]}${comment ? `: ${comment}` : ""}`, h.issued_by, c.userId])).rows[0];
  const asset = (await client.query(`SELECT id, asset_number, name FROM tenant.assets WHERE id = $1`, [h.asset_id])).rows[0];
  await recordAssetEvent(client, c, h.asset_id, "asset.custody_disputed", { handoverId: h.id, reason, comment });
  await notify(client, c, [h.issued_by, ...await usersWith(client, c, CUSTODY.exceptions)], asset, `handover disputed (${DISPUTE_REASON[reason].toLowerCase()})`, comment || null);
  return { handoverId: h.id, status: "DISPUTED", exceptionId: ex.id };
}
// input: { reason } — the recipient cannot acknowledge (away, no account access); an authorized person confirms with the reason recorded.
export async function waiveCustodyAcknowledgment(client, c, handoverId, input = {}) {
  requireCustody(has(c, CUSTODY.exceptions));
  const h = await loadHandover(client, c, handoverId);
  if (h.status !== "AWAITING_ACKNOWLEDGMENT") throw custodyError(409, "ASSET_CUSTODY_CONFLICT", "Only a handover awaiting acknowledgment can be confirmed by exception.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw custodyError(400, "ASSET_CUSTODY_INVALID", "Record why the acknowledgment is waived.", { field: "reason" });
  await client.query(`INSERT INTO tenant.asset_custody_acknowledgments (organization_id, handover_id, user_id, decision, comment, on_behalf) VALUES ($1,$2,$3,'EXCEPTION',$4,true)`, [c.organizationId, h.id, c.userId, reason]);
  await client.query(`UPDATE tenant.asset_custody_handovers SET status = 'CONFIRMED' WHERE id = $1`, [h.id]);
  if (h.to_assignment_id) await client.query(`UPDATE tenant.asset_custody_assignments SET acknowledgment = 'EXCEPTION' WHERE id = $1 AND status = 'ACTIVE'`, [h.to_assignment_id]);
  await client.query(`INSERT INTO tenant.asset_custody_exceptions (organization_id, asset_id, handover_id, assignment_id, kind, description, status, resolution, resolved_by, resolved_at, created_by)
      VALUES ($1,$2,$3,$4,'ACKNOWLEDGMENT_WAIVED',$5,'RESOLVED',$5,$6,clock_timestamp(),$6)`, [c.organizationId, h.asset_id, h.id, h.to_assignment_id, reason, c.userId]);
  await recordAssetEvent(client, c, h.asset_id, "asset.custody_acknowledgment_waived", { handoverId: h.id, reason });
  return { handoverId: h.id, status: "CONFIRMED", acknowledgment: "EXCEPTION" };
}
// input: { resolution: CONFIRM | REVERT | CLOSE, note } — a dispute is confirmed (custody stands), reverted (back to the previous custodian),
// or another exception is closed with its note.
export async function resolveCustodyException(client, c, exceptionId, input = {}) {
  requireCustody(has(c, CUSTODY.exceptions));
  const ex = (await client.query(`SELECT * FROM tenant.asset_custody_exceptions WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(exceptionId, "Exception")])).rows[0];
  if (!ex) throw custodyError(404, "ASSET_CUSTODY_NOT_FOUND", "That exception was not found.");
  if (ex.status === "RESOLVED") return { exceptionId: ex.id, status: "RESOLVED", replayed: true };
  const note = text(input.note, 1000);
  if (note.length < 3) throw custodyError(400, "ASSET_CUSTODY_INVALID", "Explain the resolution.", { field: "note" });
  const resolution = String(input.resolution ?? "CLOSE").toUpperCase();
  if (ex.kind === "DISPUTED" && ex.handover_id) {
    const h = await loadHandover(client, c, ex.handover_id);
    if (resolution === "CONFIRM") {
      await client.query(`UPDATE tenant.asset_custody_handovers SET status = 'CONFIRMED' WHERE id = $1`, [h.id]);
      if (h.to_assignment_id) await client.query(`UPDATE tenant.asset_custody_assignments SET acknowledgment = 'EXCEPTION' WHERE id = $1 AND status = 'ACTIVE'`, [h.to_assignment_id]);
    } else if (resolution === "REVERT") {
      const previous = h.from_assignment_id ? (await client.query(`SELECT * FROM tenant.asset_custody_assignments WHERE id = $1`, [h.from_assignment_id])).rows[0] : null;
      if (!previous) throw custodyError(409, "ASSET_CUSTODY_INVALID", "There is no previous custodian to return the asset to; reassign it instead.");
      const asset = await assetRow(client, c, h.asset_id);
      await client.query(`UPDATE tenant.asset_custody_handovers SET status = 'CANCELLED', cancel_reason = $2 WHERE id = $1`, [h.id, `Dispute reverted: ${note}`]);
      await applyCustody(client, c, asset, { type: previous.custodian_type, userId: previous.user_id, departmentId: previous.department_id, storeLocationId: previous.store_location_id, accountableUserId: previous.accountable_user_id },
        { at: new Date().toISOString(), condition: asset.condition, handoverId: h.id, acknowledgment: "NOT_REQUIRED" });
    } else throw custodyError(400, "ASSET_CUSTODY_INVALID", "Confirm the handover or revert it.");
  }
  await client.query(`UPDATE tenant.asset_custody_exceptions SET status = 'RESOLVED', resolution = $2, resolved_by = $3, resolved_at = clock_timestamp() WHERE id = $1`, [ex.id, `${resolution}: ${note}`, c.userId]);
  await recordAssetEvent(client, c, ex.asset_id, "asset.custody_exception_resolved", { exceptionId: ex.id, resolution, note });
  return { exceptionId: ex.id, status: "RESOLVED", resolution };
}

// ------------------------------------------------------------------ returns
// input: { toType: ASSET_STORE | DEPARTMENT, storeLocationId? | departmentId?, condition, identityVerified, receivedAt?, accessories?, notes?, idempotencyKey? }
// — never to nobody; works for a deactivated employee's assets.
export async function returnAssetCustody(client, c, assetId, input = {}) {
  requireCustody(has(c, CUSTODY.return));
  const key = keyOf(input);
  if (key) {
    const done = (await client.query(`SELECT id, status FROM tenant.asset_custody_handovers WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { handoverId: done.id, status: done.status, replayed: true };
  }
  const asset = await assetRow(client, c, assetId);
  if (asset.lifecycle_status === "DISPOSED") throw custodyError(409, "ASSET_CUSTODY_ASSET_UNAVAILABLE", "A disposed asset has no custody to return.");
  if (input.identityVerified !== true) throw custodyError(409, "ASSET_CUSTODY_RETURN_NOT_CONFIRMED", "Check the asset code or serial of the item received.");
  const current = await currentAssignment(client, asset.id);
  if (!current) throw custodyError(409, "ASSET_CUSTODY_INVALID", "The asset has no custodian to return it from.");
  if (current.custodian_type === "ASSET_STORE") throw custodyError(409, "ASSET_CUSTODY_ALREADY_ASSIGNED", "The asset is already in store custody.");
  const open = await openHandover(client, asset.id);
  if (open && open.status !== "AWAITING_ACKNOWLEDGMENT") throw custodyError(409, "ASSET_CUSTODY_CONFLICT");
  if (open) await client.query(`UPDATE tenant.asset_custody_handovers SET status = 'CANCELLED', cancel_reason = 'Superseded by a return' WHERE id = $1`, [open.id]);
  const target = await resolveCustodian(client, c, { toType: input.toType ?? "ASSET_STORE", storeLocationId: input.storeLocationId, departmentId: input.departmentId });
  if (target.type === "EMPLOYEE") throw custodyError(400, "ASSET_CUSTODY_INVALID_CUSTODIAN", "A return goes to an asset store or a department.");
  const condition = conditionOf(input.condition);
  const h = (await client.query(`INSERT INTO tenant.asset_custody_handovers (organization_id, asset_id, kind, from_assignment_id, to_type, to_department_id, to_store_location_id, recipient_user_id, status, notes, idempotency_key, created_by, issued_by)
      VALUES ($1,$2,'RETURN',$3,$4,$5,$6,$7,'PENDING_HANDOVER',$8,$9,$10,$11) RETURNING id, handover_number`, [c.organizationId, asset.id, current.id, target.type, target.departmentId, target.storeLocationId, target.accountableUserId,
    text(input.notes, 1000) || null, key, c.userId, current.user_id ?? current.accountable_user_id ?? c.userId])).rows[0];
  const done = await confirmPhysicalHandover(client, c, h.id, { condition, handedOverAt: input.receivedAt, accessories: input.accessories });
  await notify(client, c, [current.user_id], asset, "return received", `Received back in ${condition.toLowerCase()} condition.`);
  return { ...done, number: `HND-${h.handover_number}`, kind: "RETURN", previousCustodianInactive: current.user_id ? !(await client.query(`SELECT 1 FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`, [c.organizationId, current.user_id])).rows[0] : false };
}
// The custodian asks to give the asset back; the asset team is told.
export async function requestCustodyReturn(client, c, assetId, input = {}) {
  const asset = await assetRow(client, c, assetId);
  const current = await currentAssignment(client, asset.id);
  if (!current || current.user_id !== c.userId) throw custodyError(403, "ASSET_CUSTODY_PERMISSION_DENIED", "Only the asset's custodian can ask to return it.");
  if (current.return_requested_at) return { assetId: asset.id, alreadyRequested: true };
  await client.query(`UPDATE tenant.asset_custody_assignments SET return_requested_at = clock_timestamp() WHERE id = $1`, [current.id]);
  await recordAssetEvent(client, c, asset.id, "asset.custody_return_requested", { note: text(input.note, 500) || null });
  await notify(client, c, await usersWith(client, c, CUSTODY.return), asset, "return requested", text(input.note, 500) || null);
  return { assetId: asset.id, requested: true };
}
// input: { assetId, note } — an asset an offboarding employee cannot return: recorded for the asset team; never a charge.
export async function recordCannotReturn(client, c, assetId, input = {}) {
  requireCustody(has(c, CUSTODY.exceptions));
  const asset = await assetRow(client, c, assetId);
  const note = text(input.note, 1000);
  if (note.length < 3) throw custodyError(400, "ASSET_CUSTODY_INVALID", "Describe why it cannot be returned.", { field: "note" });
  const current = await currentAssignment(client, asset.id);
  const ex = (await client.query(`INSERT INTO tenant.asset_custody_exceptions (organization_id, asset_id, assignment_id, kind, description, owner_user_id, created_by) VALUES ($1,$2,$3,'CANNOT_RETURN',$4,$5,$5) RETURNING id`,
    [c.organizationId, asset.id, current?.id ?? null, note, c.userId])).rows[0];
  await recordAssetEvent(client, c, asset.id, "asset.custody_cannot_return", { note });
  return { exceptionId: ex.id };
}

// ------------------------------------------------------------------ accountability settings
export async function setDepartmentCustodian(client, c, departmentId, input = {}) {
  requireCustody(has(c, CUSTODY.exceptions) || has(c, CUSTODY.assign));
  const dept = await department(client, c, departmentId);
  const person = await resolveCustodian(client, c, { toType: "EMPLOYEE", userId: input.accountableUserId });
  await client.query(`INSERT INTO tenant.asset_department_custody (organization_id, department_id, accountable_user_id, updated_by) VALUES ($1,$2,$3,$4)
      ON CONFLICT (organization_id, department_id) DO UPDATE SET accountable_user_id = EXCLUDED.accountable_user_id, updated_by = EXCLUDED.updated_by, updated_at = clock_timestamp()`, [c.organizationId, dept.id, person.userId, c.userId]);
  return { departmentId: dept.id, accountableUserId: person.userId };
}

// ------------------------------------------------------------------ bulk
async function eachRow(client, rows, run) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 200) throw custodyError(400, "ASSET_CUSTODY_INVALID", "Choose between 1 and 200 assets.");
  const results = [];
  for (const [i, row] of rows.entries()) {
    await client.query(`SAVEPOINT bulk_custody_${i}`);
    try { const done = await run(row, i); await client.query(`RELEASE SAVEPOINT bulk_custody_${i}`); results.push({ assetId: row.assetId ?? row.asset ?? row.assetCode, ok: true, status: done.status, replayed: Boolean(done.replayed) }); }
    catch (failure) { await client.query(`ROLLBACK TO SAVEPOINT bulk_custody_${i}`); results.push({ assetId: row.assetId ?? row.asset ?? row.assetCode, ok: false, errorCode: failure.code ?? "ASSET_CUSTODY_INVALID", message: failure.message }); }
  }
  const ids = results.map((r) => r.assetId).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)));
  const codes = new Map((await client.query(`SELECT id, asset_number FROM tenant.assets WHERE id = ANY($1::uuid[])`, [ids])).rows.map((r) => [r.id, r.asset_number]));
  return { results: results.map((r) => ({ ...r, assetNumber: codes.get(r.assetId) ?? null })), succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}
// A scanned label, an asset code or a serial → the asset (with the scan's own access checks); an e-mail → the Company member.
async function assetIdOf(client, c, row) {
  if (row.assetId) return row.assetId;
  const { resolveAssetIdentifier } = await import("../asset-identification/ident-read.js");
  const found = await resolveAssetIdentifier(client, c, row.asset ?? row.assetCode ?? "");
  if (!found.assetId) throw custodyError(409, "ASSET_CUSTODY_INVALID", "Several assets match; use the asset code.");
  return found.assetId;
}
async function userIdOf(client, c, row) {
  if (row.userId || !row.email) return row.userId;
  const user = (await client.query(`SELECT u.id FROM public.users u JOIN public.organization_memberships m ON m.user_id = u.id WHERE m.organization_id = $1 AND lower(u.email) = lower($2)`, [c.organizationId, String(row.email).trim()])).rows[0];
  if (!user) throw custodyError(400, "ASSET_CUSTODY_INVALID_CUSTODIAN", `${row.email} is not a member of the Company.`);
  return user.id;
}
// input: { rows: [{ assetId? | asset?, toType?, userId? | email? | departmentId? | storeLocationId? }], condition?, handOverNow?, expectedReturnAt?, idempotencyKey? }
export async function bulkCustodyHandovers(client, c, input = {}) {
  requireCustody(has(c, CUSTODY.bulk));
  const base = text(input.idempotencyKey, 150) || null;
  const seen = new Set();
  return eachRow(client, input.rows, async (row) => {
    const assetId = await assetIdOf(client, c, row);
    row.assetId = assetId;
    if (seen.has(assetId)) throw custodyError(409, "ASSET_CUSTODY_CONFLICT", "This asset appears twice in the list.");
    seen.add(assetId);
    const userId = await userIdOf(client, c, row);
    return requestCustodyHandover(client, c, assetId, { ...row, userId, toType: row.toType ?? (userId ? "EMPLOYEE" : row.departmentId ? "DEPARTMENT" : "ASSET_STORE"), condition: row.condition ?? input.condition,
      handOverNow: input.handOverNow !== false, expectedReturnAt: row.expectedReturnAt ?? input.expectedReturnAt, idempotencyKey: base ? `${base}:${assetId}` : undefined });
  });
}
// input: { assets: [{ assetId, condition? }], toType, storeLocationId? | departmentId?, condition?, identityVerified, idempotencyKey? } — each scanned asset on its own.
export async function bulkCustodyReturns(client, c, input = {}) {
  requireCustody(has(c, CUSTODY.bulk));
  const base = text(input.idempotencyKey, 150) || null;
  return eachRow(client, input.assets, async (row) => {
    const assetId = await assetIdOf(client, c, row);
    row.assetId = assetId;
    return returnAssetCustody(client, c, assetId, { toType: input.toType, storeLocationId: input.storeLocationId, departmentId: input.departmentId,
      condition: row.condition ?? input.condition, identityVerified: input.identityVerified === true, idempotencyKey: base ? `${base}:${assetId}` : undefined });
  });
}

// ------------------------------------------------------------------ reminders
// Returns due in three days or overdue, acknowledgments outstanding for two days, custodians no longer active: each is told to the people
// concerned. Run by a scheduler; returns what it sent.
export async function sendCustodyReminders(client, c) {
  const due = (await client.query(`SELECT x.*, a.asset_number, a.name, a.id AS aid FROM tenant.asset_custody_assignments x JOIN tenant.assets a ON a.id = x.asset_id
      WHERE x.organization_id = $1 AND x.status = 'ACTIVE' AND x.expected_return_at IS NOT NULL AND x.expected_return_at <= current_date + 3`, [c.organizationId])).rows;
  for (const r of due) await notify(client, { ...c, userId: null }, [r.user_id, r.created_by], { id: r.aid, asset_number: r.asset_number, name: r.name }, r.expected_return_at < new Date() ? "return overdue" : "return due soon", `Due ${String(r.expected_return_at).slice(0, 10)}.`);
  const unack = (await client.query(`SELECT h.*, a.asset_number, a.name FROM tenant.asset_custody_handovers h JOIN tenant.assets a ON a.id = h.asset_id
      WHERE h.organization_id = $1 AND h.status = 'AWAITING_ACKNOWLEDGMENT' AND h.physical_handover_at < now() - interval '2 days'`, [c.organizationId])).rows;
  for (const h of unack) await notify(client, { ...c, userId: null }, [h.recipient_user_id, h.issued_by], { id: h.asset_id, asset_number: h.asset_number, name: h.name }, "receipt still to acknowledge", null);
  const inactive = (await client.query(`SELECT x.asset_id, a.asset_number, a.name FROM tenant.asset_custody_assignments x JOIN tenant.assets a ON a.id = x.asset_id
      LEFT JOIN public.organization_memberships m ON m.user_id = x.user_id AND m.organization_id = x.organization_id WHERE x.organization_id = $1 AND x.status = 'ACTIVE' AND x.custodian_type = 'EMPLOYEE'
        AND (m.status IS DISTINCT FROM 'active')`, [c.organizationId])).rows;
  const managers = await usersWith(client, c, CUSTODY.return);
  for (const r of inactive) await notify(client, { ...c, userId: null }, managers, { id: r.asset_id, asset_number: r.asset_number, name: r.name }, "custodian has left — clearance needed", null);
  return { returnsDue: due.length, unacknowledged: unack.length, inactiveCustodians: inactive.length };
}
