// Assets — Asset Assignment, the commands. A request names the recipient (an employee, a department or an asset store), the purpose and
// whether it is temporary; it is validated when made and again at approval and at issue; once submitted the asset is reserved (one active
// operation per asset, shared with Asset Transfers). Approval is the asset team's, never the requester's own. The physical issue goes
// through the Custodian handover — custody changes then, and the recipient's acknowledgment (or dispute) is the Custodian workflow's. A
// recipient at another site receives it through an Asset Transfer. Returns are physical receipts with their condition; a damaged return is
// held, never back in the pool.
import { has, nextNumber, recordAssetEvent, text, uuid } from "../common.js";
import { createNotification } from "../../../core/platform/notifications/index.js";
import { ASG, CONDITIONS, OPEN, asgError, assetTeam, dayOfDb, requireAsg } from "./asg-rules.js";

const idOf = (v, label, code = "ASSET_ASSIGNMENT_NOT_FOUND") => { try { return uuid(v, label); } catch { throw asgError(404, code); } };
const dayOf = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? String(v) : null);
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const conditionOf = (v, label = "condition") => { const x = String(v ?? "").toUpperCase(); if (!CONDITIONS.includes(x)) throw asgError(400, "ASSET_ASSIGNMENT_INVALID", `Record the asset's ${label}.`, { field: "condition" }); return x; };
// The authority a confirmed assignment step carries into the custody, status and transfer workflows it coordinates.
const agent = (c) => ({ ...c, permissions: [...new Set([...(c.permissions ?? []), "assets.verify", "assets.custody.assign", "assets.custody.reassign", "assets.custody.return", "assets.status.place_hold",
  "assets.status.condition_update", "assets.transfer.create", "assets.transfer.submit"])] });
export async function logAssignmentEvent(client, c, requestId, action, { assetId = null, from = null, to = null, details = {}, reason = null, commandId = null } = {}) {
  await client.query(`INSERT INTO tenant.asset_assignment_events (organization_id, request_id, asset_id, action, from_status, to_status, details, reason, actor_user_id, command_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [c.organizationId, requestId, assetId, action, from, to, JSON.stringify(details), reason, c.userId, commandId]);
}
async function usersWith(client, c, permission) {
  return (await client.query(`SELECT DISTINCT assignment.user_id FROM user_role_assignments assignment JOIN role_permissions grant_row ON grant_row.role_id = assignment.role_id
      WHERE assignment.organization_id = $1 AND assignment.status = 'active' AND grant_row.permission_key = $2`, [c.organizationId, permission]).catch(() => ({ rows: [] }))).rows.map((r) => r.user_id);
}
async function tell(client, c, userIds, r, title, message) {
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    if (userId === c.userId) continue;
    await createNotification(client, { organizationId: c.organizationId, userId, category: "asset_register", title: `${r.request_number}: ${title}`, message: message ?? null, href: `/assets/assignments/${r.id}`, entityType: null, entityId: null });
  }
}
export async function loadRequest(client, c, id, { lock = true } = {}) {
  const r = (await client.query(`SELECT * FROM tenant.asset_assignment_requests WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, idOf(id, "Assignment")])).rows[0];
  if (!r) throw asgError(404, "ASSET_ASSIGNMENT_NOT_FOUND");
  return r;
}
const versionCheck = (r, expected) => { if (expected !== undefined && expected !== null && Number(expected) !== Number(r.row_version)) throw asgError(409, "ASSET_ASSIGNMENT_VERSION_CONFLICT"); };
const view = (r) => ({ requestId: r.id, number: r.request_number, status: r.status, approvalStatus: r.approval_status, assetId: r.asset_id, version: r.row_version });

// ------------------------------------------------------------------ validation
async function recipientOf(client, c, input) {
  const { resolveCustodian } = await import("../asset-custody/custody-commands.js");
  try {
    return await resolveCustodian(client, c, { toType: input.recipientType, userId: input.toUserId, departmentId: input.toDepartmentId, storeLocationId: input.toStoreLocationId });
  } catch (failure) {
    throw asgError(failure.code === "ASSET_CUSTODY_EMPLOYEE_INACTIVE" ? 409 : 400, failure.code === "ASSET_CUSTODY_EMPLOYEE_INACTIVE" ? "ASSET_ASSIGNMENT_EMPLOYEE_INACTIVE" : failure.code === "ASSET_CUSTODY_COMPANY_MISMATCH" ? "ASSET_ASSIGNMENT_COMPANY_MISMATCH" : "ASSET_ASSIGNMENT_RECIPIENT_INVALID", failure.message);
  }
}
async function assetOf(client, c, input) {
  let id = input.assetId;
  if (!id && input.asset) {
    const { normalizeIdentifier } = await import("../asset-identification/ident-rules.js");
    const n = normalizeIdentifier(input.asset);
    id = n ? (await client.query(`SELECT id FROM tenant.assets WHERE organization_id = $1 AND (upper(asset_number) = $2 OR serial_normalized = $2 OR tag_normalized = $2) LIMIT 1`, [c.organizationId, n])).rows[0]?.id : null;
    if (!id) throw asgError(404, "ASSET_ASSIGNMENT_ASSET_UNAVAILABLE", `${input.asset} was not found.`);
  }
  if (!id) return null;
  const a = (await client.query(`SELECT a.*, tenant.asset_effective_availability(a) AS effective, cat.custodian_policy, cat.name AS category_name FROM tenant.assets a JOIN tenant.asset_categories cat ON cat.id = a.category_id
      WHERE a.organization_id = $1 AND a.id = $2`, [c.organizationId, idOf(id, "Asset", "ASSET_ASSIGNMENT_ASSET_UNAVAILABLE")])).rows[0];
  if (!a) throw asgError(404, "ASSET_ASSIGNMENT_COMPANY_MISMATCH", "That asset belongs to another Company.");
  return a;
}
// May this asset go to this recipient now? (Again at approval and at issue: it may have been held, moved or assigned meanwhile.)
async function assertAssignable(client, c, a, target, { ownRequestId = null } = {}) {
  const fail = (code, message) => { throw asgError(409, code, message); };
  if (a.archived_at || ["DISPOSED", "LOST", "RETIRED"].includes(a.lifecycle_status)) fail("ASSET_ASSIGNMENT_ASSET_UNAVAILABLE", `${a.asset_number} is ${a.lifecycle_status.toLowerCase()}.`);
  if (a.lifecycle_status === "ON_HOLD") fail("ASSET_ASSIGNMENT_ASSET_UNAVAILABLE", `${a.asset_number} is on hold.`);
  const pendingDisposal = (await client.query(`SELECT tenant.asset_disposal_pending($1) AS p`, [a.id])).rows[0].p;
  if (pendingDisposal) fail("ASSET_ASSIGNMENT_ASSET_UNAVAILABLE", `${a.asset_number} is committed to disposal ${pendingDisposal}.`);
  if (target.type !== "ASSET_STORE" && a.lifecycle_status !== "ACTIVE") fail("ASSET_ASSIGNMENT_ASSET_UNAVAILABLE", `${a.asset_number} is not commissioned; it can only go to a store.`);
  if (a.effective === "UNDER_MAINTENANCE") fail("ASSET_ASSIGNMENT_ASSET_UNAVAILABLE", `${a.asset_number} is under maintenance.`);
  if (target.type !== "ASSET_STORE" && a.condition === "UNSERVICEABLE") fail("ASSET_ASSIGNMENT_ASSET_UNAVAILABLE", `${a.asset_number} is unserviceable.`);
  if (target.type === "EMPLOYEE" && a.custodian_policy === "NOT_APPLICABLE") fail("ASSET_ASSIGNMENT_RECIPIENT_INVALID", `${a.category_name} assets are not assigned to people.`);
  const reserved = (await client.query(`SELECT source_type, source_id FROM tenant.asset_operation_reservations WHERE asset_id = $1 AND status = 'ACTIVE'`, [a.id])).rows[0];
  if (reserved && !(reserved.source_type === "ASSIGNMENT" && reserved.source_id === ownRequestId)) fail("ASSET_ASSIGNMENT_ALREADY_RESERVED");
  if (a.effective === "IN_TRANSFER") fail("ASSET_ASSIGNMENT_ALREADY_RESERVED");
  const holder = (await client.query(`SELECT * FROM tenant.asset_custody_assignments WHERE asset_id = $1 AND status = 'ACTIVE'`, [a.id])).rows[0] ?? null;
  if (holder && holder.custodian_type === target.type && (holder.user_id ?? null) === (target.userId ?? null) && (holder.store_location_id ?? null) === (target.storeLocationId ?? null)
    && (target.type !== "DEPARTMENT" || holder.department_id === target.departmentId)) fail("ASSET_ASSIGNMENT_RECIPIENT_INVALID", `${target.label} already holds ${a.asset_number}.`);
  if ((await client.query(`SELECT 1 FROM tenant.asset_custody_handovers WHERE asset_id = $1 AND status = 'PENDING_HANDOVER'`, [a.id])).rows[0]) fail("ASSET_ASSIGNMENT_ALREADY_RESERVED", "A custody handover of this asset is already being prepared.");
}
async function reserve(client, c, r, assetId) {
  try {
    const res = (await client.query(`INSERT INTO tenant.asset_operation_reservations (organization_id, asset_id, source_type, source_id) VALUES ($1,$2,'ASSIGNMENT',$3) RETURNING id`, [c.organizationId, assetId, r.id])).rows[0];
    return res.id;
  } catch (failure) { if (failure.code === "23505") throw asgError(409, "ASSET_ASSIGNMENT_ALREADY_RESERVED"); throw failure; }
}
async function release(client, r, status, reason) {
  await client.query(`UPDATE tenant.asset_operation_reservations SET status = $2, released_at = clock_timestamp(), release_reason = $3 WHERE source_type = 'ASSIGNMENT' AND source_id = $1 AND status = 'ACTIVE'`, [r.id, status, reason]);
}

// ------------------------------------------------------------------ requests
// input: { assetId? | asset? | categoryId?, recipientType, toUserId? | toDepartmentId? | toStoreLocationId?, deliverToLocationId?, purpose, assignmentType: INDEFINITE | TEMPORARY,
//   requestedIssueDate?, expectedReturnDate?, accessories?, idempotencyKey?, submit? } — an employee requests for themselves (an asset, or one of a category for the asset team to choose).
export async function createAssignmentRequest(client, c, input = {}) {
  requireAsg(c, ASG.request);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const done = (await client.query(`SELECT * FROM tenant.asset_assignment_requests WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { ...view(done), replayed: true };
  }
  const type = String(input.recipientType ?? "EMPLOYEE").toUpperCase();
  if (!assetTeam(c) && (type !== "EMPLOYEE" || (input.toUserId && input.toUserId !== c.userId))) throw asgError(403, "ASSET_ASSIGNMENT_PERMISSION_DENIED", "You can request equipment for yourself; the asset team assigns it to others.");
  const target = await recipientOf(client, c, { ...input, recipientType: type, toUserId: input.toUserId ?? (type === "EMPLOYEE" && !assetTeam(c) ? c.userId : input.toUserId) });
  const purpose = text(input.purpose, 1000);
  if (purpose.length < 3) throw asgError(400, "ASSET_ASSIGNMENT_INVALID", "Say what the asset is needed for.", { field: "purpose" });
  const kind = String(input.assignmentType ?? "INDEFINITE").toUpperCase();
  if (!["INDEFINITE", "TEMPORARY"].includes(kind)) throw asgError(400, "ASSET_ASSIGNMENT_INVALID", "Choose a temporary or an ongoing assignment.");
  const issueDate = input.requestedIssueDate ? dayOf(input.requestedIssueDate) : todayIso();
  if (!issueDate) throw asgError(400, "ASSET_ASSIGNMENT_INVALID", "Enter the requested issue date.", { field: "requestedIssueDate" });
  const returnDate = input.expectedReturnDate ? dayOf(input.expectedReturnDate) : null;
  if (kind === "TEMPORARY" && (!returnDate || returnDate < issueDate)) throw asgError(400, "ASSET_ASSIGNMENT_INVALID", "A temporary assignment needs its expected return date (after the issue date).", { field: "expectedReturnDate" });
  if (kind === "INDEFINITE" && returnDate) throw asgError(400, "ASSET_ASSIGNMENT_INVALID", "An ongoing assignment has no return date; make it temporary instead.");
  const a = await assetOf(client, c, input);
  const category = !a && input.categoryId ? (await client.query(`SELECT id FROM tenant.asset_categories WHERE organization_id = $1 AND id = $2 AND active`, [c.organizationId, idOf(input.categoryId, "Category", "ASSET_ASSIGNMENT_INVALID")])).rows[0] : null;
  if (!a && !category) throw asgError(400, "ASSET_ASSIGNMENT_INVALID", "Choose the asset, or the kind of asset you need.", { field: "assetId" });
  if (a) await assertAssignable(client, c, a, target);
  const deliver = input.deliverToLocationId ? (await client.query(`SELECT id FROM tenant.asset_locations WHERE organization_id = $1 AND id = $2 AND active`, [c.organizationId, idOf(input.deliverToLocationId, "Location", "ASSET_ASSIGNMENT_INVALID")])).rows[0]?.id : null;
  if (input.deliverToLocationId && !deliver) throw asgError(400, "ASSET_ASSIGNMENT_INVALID", "Choose an active location to deliver to.");
  const number = await nextNumber(client, c, "asset_assignment", "ASG");
  const r = (await client.query(`INSERT INTO tenant.asset_assignment_requests (organization_id, request_number, batch_id, asset_id, category_id, recipient_type, to_user_id, to_department_id, to_store_location_id, deliver_to_location_id,
      purpose, assignment_type, requested_issue_date, expected_return_date, original_expected_return_date, accessories, requested_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16,$17) RETURNING *`,
    [c.organizationId, number, input.batchId ?? null, a?.id ?? null, category?.id ?? a?.category_id ?? null, target.type, target.userId, target.departmentId, target.storeLocationId, deliver ?? null, purpose, kind, issueDate, returnDate,
      text(input.accessories, 500) || null, c.userId, key])).rows[0];
  await logAssignmentEvent(client, c, r.id, "CREATED", { assetId: a?.id, to: "DRAFT", details: { recipient: target.label } });
  if (input.submit) return submitAssignmentRequest(client, c, r.id, {});
  return view(r);
}
// Submitted: the asset is reserved. The asset team's own requests need no separate approval; self-service requests (and requests for a
// kind of asset, which the team chooses) do.
export async function submitAssignmentRequest(client, c, requestId, input = {}) {
  requireAsg(c, ASG.request);
  const r = await loadRequest(client, c, requestId);
  versionCheck(r, input.expectedVersion);
  if (!["DRAFT", "CHANGES_REQUESTED"].includes(r.status)) throw asgError(409, "ASSET_ASSIGNMENT_INVALID", "Only a draft is submitted.");
  if (r.requested_by !== c.userId && !has(c, ASG.manage)) throw asgError(403, "ASSET_ASSIGNMENT_PERMISSION_DENIED");
  const target = await recipientOf(client, c, { recipientType: r.recipient_type, toUserId: r.to_user_id, toDepartmentId: r.to_department_id, toStoreLocationId: r.to_store_location_id });
  let reservationId = r.reservation_id;
  if (r.asset_id) {
    const a = await assetOf(client, c, { assetId: r.asset_id });
    await assertAssignable(client, c, a, target, { ownRequestId: r.id });
    if (!(await client.query(`SELECT 1 FROM tenant.asset_operation_reservations WHERE source_type = 'ASSIGNMENT' AND source_id = $1 AND status = 'ACTIVE'`, [r.id])).rows[0]) reservationId = await reserve(client, c, r, r.asset_id);
  }
  const needsApproval = !r.asset_id || !(has(c, ASG.issue) || has(c, ASG.approve));
  const next = needsApproval ? "PENDING_APPROVAL" : "READY_TO_ISSUE";
  await client.query(`UPDATE tenant.asset_assignment_requests SET status = $2, approval_status = $3, reservation_id = $4 WHERE id = $1`, [r.id, next, needsApproval ? "PENDING" : "NOT_REQUIRED", reservationId]);
  await logAssignmentEvent(client, c, r.id, "SUBMITTED", { assetId: r.asset_id, from: r.status, to: next });
  await tell(client, c, await usersWith(client, c, needsApproval ? ASG.approve : ASG.issue), r, needsApproval ? "assignment to approve" : "ready to issue", r.purpose);
  return view(await loadRequest(client, c, r.id, { lock: false }));
}
// input: { assetId? (required when the request names only a kind of asset), note?, expectedVersion? }
export async function approveAssignmentRequest(client, c, requestId, input = {}) {
  requireAsg(c, ASG.approve);
  const r = await loadRequest(client, c, requestId);
  versionCheck(r, input.expectedVersion);
  if (r.status === "READY_TO_ISSUE") return { ...view(r), replayed: true };
  if (r.status !== "PENDING_APPROVAL") throw asgError(409, "ASSET_ASSIGNMENT_INVALID", "Only a request waiting for approval is approved.");
  if (r.requested_by === c.userId) throw asgError(403, "ASSET_ASSIGNMENT_PERMISSION_DENIED", "The person who requested an assignment cannot approve it.");
  const target = await recipientOf(client, c, { recipientType: r.recipient_type, toUserId: r.to_user_id, toDepartmentId: r.to_department_id, toStoreLocationId: r.to_store_location_id });
  let assetId = r.asset_id;
  let reservationId = r.reservation_id;
  if (!assetId) {
    if (!input.assetId && !input.asset) throw asgError(400, "ASSET_ASSIGNMENT_INVALID", "Choose the asset to assign.", { field: "assetId" });
    const a = await assetOf(client, c, input);
    if (r.category_id && a.category_id !== r.category_id) throw asgError(409, "ASSET_ASSIGNMENT_ASSET_UNAVAILABLE", `${a.asset_number} is not of the requested kind.`);
    await assertAssignable(client, c, a, target, { ownRequestId: r.id });
    reservationId = await reserve(client, c, r, a.id);
    assetId = a.id;
  } else {
    const a = await assetOf(client, c, { assetId });
    await assertAssignable(client, c, a, target, { ownRequestId: r.id });
  }
  await client.query(`UPDATE tenant.asset_assignment_requests SET status = 'READY_TO_ISSUE', approval_status = 'APPROVED', approved_by = $2, approved_at = clock_timestamp(), decision_note = $3, asset_id = $4, reservation_id = $5 WHERE id = $1`,
    [r.id, c.userId, text(input.note, 1000) || null, assetId, reservationId]);
  await logAssignmentEvent(client, c, r.id, "APPROVED", { assetId, from: r.status, to: "READY_TO_ISSUE", reason: text(input.note, 1000) || null });
  await tell(client, c, [r.requested_by, r.to_user_id, ...(await usersWith(client, c, ASG.issue))], r, "approved — ready to issue", null);
  return view(await loadRequest(client, c, r.id, { lock: false }));
}
export async function requestAssignmentChanges(client, c, requestId, input = {}) {
  requireAsg(c, ASG.approve);
  const r = await loadRequest(client, c, requestId);
  if (r.status !== "PENDING_APPROVAL") throw asgError(409, "ASSET_ASSIGNMENT_INVALID", "Only a request waiting for approval is sent back.");
  const note = text(input.note, 1000);
  if (note.length < 3) throw asgError(400, "ASSET_ASSIGNMENT_INVALID", "Say what needs to change.", { field: "note" });
  await client.query(`UPDATE tenant.asset_assignment_requests SET status = 'CHANGES_REQUESTED', approval_status = 'CHANGES_REQUESTED', decision_note = $2 WHERE id = $1`, [r.id, note]);
  await logAssignmentEvent(client, c, r.id, "CHANGES_REQUESTED", { assetId: r.asset_id, from: r.status, to: "CHANGES_REQUESTED", reason: note });
  await tell(client, c, [r.requested_by], r, "changes requested", note);
  return view(await loadRequest(client, c, r.id, { lock: false }));
}
export async function rejectAssignmentRequest(client, c, requestId, input = {}) {
  requireAsg(c, ASG.approve);
  const r = await loadRequest(client, c, requestId);
  if (!["PENDING_APPROVAL", "CHANGES_REQUESTED"].includes(r.status)) throw asgError(409, "ASSET_ASSIGNMENT_INVALID", "Only a request waiting for a decision is rejected.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw asgError(400, "ASSET_ASSIGNMENT_INVALID", "Give the reason.", { field: "reason" });
  await release(client, r, "RELEASED", `Rejected: ${reason}`);
  await client.query(`UPDATE tenant.asset_assignment_requests SET status = 'REJECTED', approval_status = 'REJECTED', decision_note = $2 WHERE id = $1`, [r.id, reason]);
  await logAssignmentEvent(client, c, r.id, "REJECTED", { assetId: r.asset_id, from: r.status, to: "REJECTED", reason });
  await tell(client, c, [r.requested_by], r, "rejected", reason);
  return view({ ...r, status: "REJECTED" });
}
// Before the asset is handed over: the reservation is released and nothing changes in custody.
export async function cancelAssignmentRequest(client, c, requestId, input = {}) {
  const r = await loadRequest(client, c, requestId);
  if (r.status === "CANCELLED") return { ...view(r), replayed: true };
  if (r.requested_by !== c.userId && !has(c, ASG.manage)) throw asgError(403, "ASSET_ASSIGNMENT_PERMISSION_DENIED");
  if (!["DRAFT", "PENDING_APPROVAL", "CHANGES_REQUESTED", "READY_TO_ISSUE"].includes(r.status)) throw asgError(409, "ASSET_ASSIGNMENT_INVALID", "An issued assignment is ended by a return, not cancelled.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw asgError(400, "ASSET_ASSIGNMENT_INVALID", "Give the reason.", { field: "reason" });
  await release(client, r, "RELEASED", `Cancelled: ${reason}`);
  await client.query(`UPDATE tenant.asset_assignment_requests SET status = 'CANCELLED', cancel_reason = $2 WHERE id = $1`, [r.id, reason]);
  await logAssignmentEvent(client, c, r.id, "CANCELLED", { assetId: r.asset_id, from: r.status, to: "CANCELLED", reason });
  return view({ ...r, status: "CANCELLED" });
}

// ------------------------------------------------------------------ issue
// input: { identifier, condition, accessories?, issuedAt?, commandId? } — the issuer checks the asset in hand and records its condition; custody moves at this
// handover. A recipient at another site gets it through an Asset Transfer instead (location and custody together, received there).
export async function issueAssignedAsset(client, c, requestId, input = {}) {
  requireAsg(c, ASG.issue);
  const r = await loadRequest(client, c, requestId);
  const command = text(input.commandId, 200) || null;
  if (command && (await client.query(`SELECT 1 FROM tenant.asset_assignment_events WHERE organization_id = $1 AND command_id = $2`, [c.organizationId, command])).rows[0]) return { ...view(r), replayed: true };
  if (["PENDING_APPROVAL", "CHANGES_REQUESTED", "DRAFT"].includes(r.status)) throw asgError(409, "ASSET_ASSIGNMENT_APPROVAL_REQUIRED");
  if (r.status !== "READY_TO_ISSUE") throw asgError(409, "ASSET_ASSIGNMENT_INVALID", r.issued_at ? "This assignment is already issued." : "This request cannot be issued.");
  const target = await recipientOf(client, c, { recipientType: r.recipient_type, toUserId: r.to_user_id, toDepartmentId: r.to_department_id, toStoreLocationId: r.to_store_location_id });
  const a = await assetOf(client, c, { assetId: r.asset_id });
  await assertAssignable(client, c, a, target, { ownRequestId: r.id });
  const { identifies } = await import("../asset-transfers/tr-commands.js");
  const scanned = text(input.identifier, 200);
  if (!scanned || !(await identifies(client, c, a, scanned))) throw asgError(409, "ASSET_ASSIGNMENT_ISSUE_NOT_CONFIRMED", `Scan or type ${a.asset_number}'s code, serial or tag to confirm the asset in hand.`);
  const condition = conditionOf(input.condition, "condition at issue");
  const accessories = text(input.accessories, 500) || r.accessories || null;
  const issuedAt = input.issuedAt ? new Date(String(input.issuedAt)).toISOString() : new Date().toISOString();
  if (r.deliver_to_location_id && r.deliver_to_location_id !== a.location_id) {
    await release(client, r, "CONSUMED", "Handed to an Asset Transfer");
    const { createAssetTransfer } = await import("../asset-transfers/tr-commands.js");
    const t = await createAssetTransfer(client, agent(c), { transferType: "COMBINED", reasonCode: "EMPLOYEE_REASSIGNMENT", reasonDetail: `Assignment ${r.request_number}: ${r.purpose}`, toLocationId: r.deliver_to_location_id,
      toCustodianType: target.type, toUserId: target.userId ?? undefined, toDepartmentId: target.departmentId ?? undefined, toStoreLocationId: target.storeLocationId ?? undefined, lines: [{ assetId: a.id }], submit: true });
    await client.query(`UPDATE tenant.asset_assignment_requests SET status = 'IN_TRANSFER', transfer_id = $2, issue_condition = $3, accessories = $4, issued_by = $5 WHERE id = $1`, [r.id, t.transferId, condition, accessories, c.userId]);
    await logAssignmentEvent(client, c, r.id, "SENT_BY_TRANSFER", { assetId: a.id, from: r.status, to: "IN_TRANSFER", details: { transferId: t.transferId, number: t.number }, commandId: command });
    return { ...view({ ...r, status: "IN_TRANSFER" }), transferId: t.transferId, transferNumber: t.number };
  }
  const { requestCustodyHandover } = await import("../asset-custody/custody-commands.js");
  const h = await requestCustodyHandover(client, agent(c), a.id, { toType: target.type, userId: target.userId, departmentId: target.departmentId, storeLocationId: target.storeLocationId, handOverNow: true, condition,
    handedOverAt: issuedAt, accessories, expectedReturnAt: dayOfDb(r.expected_return_date) ?? undefined, notes: `Assignment ${r.request_number}` });
  await release(client, r, "CONSUMED", "Issued");
  const status = target.type === "EMPLOYEE" || target.type === "DEPARTMENT" ? "ISSUED_AWAITING_ACKNOWLEDGMENT" : "FULFILLED";
  await client.query(`UPDATE tenant.asset_assignment_requests SET status = $2, custody_handover_id = $3, issued_at = $4, issued_by = $5, issue_condition = $6, accessories = $7, acknowledgment = $8 WHERE id = $1`,
    [r.id, status, h.handoverId, issuedAt, c.userId, condition, accessories, status === "FULFILLED" ? null : "PENDING"]);
  await logAssignmentEvent(client, c, r.id, "ISSUED", { assetId: a.id, from: r.status, to: status, details: { handoverId: h.handoverId, condition }, commandId: command });
  await recordAssetEvent(client, c, a.id, "asset.assignment_issued", { requestId: r.id, number: r.request_number });
  return { ...view({ ...r, status }), handoverId: h.handoverId };
}
// The request's state from the custody records it points to: acknowledged (or confirmed by exception), disputed, received through a transfer,
// or ended (returned or reassigned). Never the other way round.
export async function syncAssignment(client, c, r) {
  let row = r;
  if (row.status === "IN_TRANSFER" && row.transfer_id) {
    const line = (await client.query(`SELECT line_status, custody_handover_id, received_at FROM tenant.asset_transfer_lines WHERE transfer_id = $1 AND asset_id = $2 ORDER BY line_number LIMIT 1`, [row.transfer_id, row.asset_id])).rows[0];
    if (line?.line_status === "COMPLETED" && line.custody_handover_id) {
      row = (await client.query(`UPDATE tenant.asset_assignment_requests SET status = 'ISSUED_AWAITING_ACKNOWLEDGMENT', custody_handover_id = $2, issued_at = COALESCE(issued_at, $3), acknowledgment = 'PENDING' WHERE id = $1 RETURNING *`,
        [row.id, line.custody_handover_id, line.received_at ?? new Date().toISOString()])).rows[0];
      await logAssignmentEvent(client, c, row.id, "RECEIVED_BY_TRANSFER", { assetId: row.asset_id, from: "IN_TRANSFER", to: row.status });
    } else if (line && ["CANCELLED", "REJECTED", "RETURNED"].includes(line.line_status)) {
      row = (await client.query(`UPDATE tenant.asset_assignment_requests SET status = 'RECOVERY_REQUIRED' WHERE id = $1 RETURNING *`, [row.id])).rows[0];
      await logAssignmentEvent(client, c, row.id, "TRANSFER_NOT_COMPLETED", { assetId: row.asset_id, from: "IN_TRANSFER", to: "RECOVERY_REQUIRED" });
    }
  }
  if (row.custody_handover_id && ["ISSUED_AWAITING_ACKNOWLEDGMENT", "FULFILLED"].includes(row.status)) {
    const h = (await client.query(`SELECT h.status, (SELECT decision FROM tenant.asset_custody_acknowledgments k WHERE k.handover_id = h.id ORDER BY k.recorded_at DESC LIMIT 1) AS decision FROM tenant.asset_custody_handovers h WHERE h.id = $1`, [row.custody_handover_id])).rows[0];
    const ack = h?.decision === "ACKNOWLEDGED" ? "ACKNOWLEDGED" : h?.decision === "EXCEPTION" ? "EXCEPTION" : h?.status === "DISPUTED" || h?.decision === "DISPUTED" ? "DISPUTED" : row.acknowledgment;
    const status = h?.status === "CONFIRMED" ? "FULFILLED" : row.status;
    const period = (await client.query(`SELECT status, effective_to, condition_at_return FROM tenant.asset_custody_assignments WHERE source_handover_id = $1 ORDER BY effective_from DESC LIMIT 1`, [row.custody_handover_id])).rows[0];
    const ended = period?.status === "ENDED" && !row.returned_at ? period : null;
    if (ack !== row.acknowledgment || status !== row.status || ended) {
      row = (await client.query(`UPDATE tenant.asset_assignment_requests SET acknowledgment = $2, status = $3, returned_at = COALESCE(returned_at, $4), return_condition = COALESCE(return_condition, $5) WHERE id = $1 RETURNING *`,
        [row.id, ack, ended ? "FULFILLED" : status, ended?.effective_to ?? null, ended?.condition_at_return ?? null])).rows[0];
    }
  }
  return row;
}

// ------------------------------------------------------------------ returns, extension, bulk
// The recipient (or the asset team) asks to give it back; the Custodian workflow records it and tells the asset team.
export async function requestAssignmentReturn(client, c, requestId, input = {}) {
  const r = await syncAssignment(client, c, await loadRequest(client, c, requestId));
  if (!r.issued_at || r.returned_at) throw asgError(409, "ASSET_ASSIGNMENT_INVALID", "Only an asset currently assigned is returned.");
  if (r.to_user_id !== c.userId && !has(c, ASG.manage)) throw asgError(403, "ASSET_ASSIGNMENT_PERMISSION_DENIED");
  if (r.to_user_id === c.userId) {
    const { requestCustodyReturn } = await import("../asset-custody/custody-commands.js");
    await requestCustodyReturn(client, c, r.asset_id, { note: text(input.note, 500) || undefined });
  }
  await logAssignmentEvent(client, c, r.id, "RETURN_REQUESTED", { assetId: r.asset_id, reason: text(input.note, 500) || null });
  await tell(client, c, await usersWith(client, c, ASG.return), r, "return requested", input.note);
  return { requestId: r.id, status: "RETURN_REQUESTED" };
}
// input: { identifier, condition, toType: ASSET_STORE | DEPARTMENT, storeLocationId? | departmentId?, accessories?, notes?, placeOnHold? } — a physical receipt with its
// condition; damaged or unserviceable it is placed on hold for repair assessment (never back in the pool on its own).
export async function completeAssignmentReturn(client, c, requestId, input = {}) {
  requireAsg(c, ASG.return);
  const r = await syncAssignment(client, c, await loadRequest(client, c, requestId));
  if (r.returned_at) return { requestId: r.id, status: "RETURNED", replayed: true };
  if (!r.issued_at || !["ISSUED_AWAITING_ACKNOWLEDGMENT", "FULFILLED"].includes(r.status)) throw asgError(409, "ASSET_ASSIGNMENT_ISSUE_NOT_CONFIRMED");
  const a = await assetOf(client, c, { assetId: r.asset_id });
  const { identifies } = await import("../asset-transfers/tr-commands.js");
  const scanned = text(input.identifier, 200);
  if (!scanned || !(await identifies(client, c, a, scanned))) throw asgError(409, "ASSET_ASSIGNMENT_RETURN_NOT_RECEIVED", `Scan or type ${a.asset_number}'s code, serial or tag to confirm what was returned.`);
  const condition = conditionOf(input.condition, "condition at return");
  const { returnAssetCustody } = await import("../asset-custody/custody-commands.js");
  await returnAssetCustody(client, agent(c), a.id, { toType: String(input.toType ?? "ASSET_STORE").toUpperCase(), storeLocationId: input.storeLocationId, departmentId: input.departmentId, condition, identityVerified: true,
    accessories: input.accessories, notes: text(input.notes, 1000) || `Return of ${r.request_number}` });
  let held = false;
  if (["DAMAGED", "UNSERVICEABLE"].includes(condition) && input.placeOnHold !== false) {
    const { placeAssetOnHold } = await import("../asset-status/status-commands.js");
    await placeAssetOnHold(client, agent(c), a.id, { reasonCode: "REPAIR_ASSESSMENT", description: `Returned ${condition.toLowerCase()} (${r.request_number})${input.notes ? `: ${text(input.notes, 300)}` : ""}` });
    held = true;
  }
  const row = await syncAssignment(client, c, await loadRequest(client, c, r.id));
  await client.query(`UPDATE tenant.asset_assignment_requests SET returned_at = COALESCE(returned_at, clock_timestamp()), return_condition = $2 WHERE id = $1`, [row.id, condition]);
  await logAssignmentEvent(client, c, r.id, "RETURNED", { assetId: a.id, details: { condition, held } });
  return { requestId: r.id, status: "RETURNED", condition, held };
}
// input: { expectedReturnDate, reason } — a temporary assignment kept longer; the original date stays on record.
export async function extendAssignment(client, c, requestId, input = {}) {
  requireAsg(c, ASG.extend);
  const r = await syncAssignment(client, c, await loadRequest(client, c, requestId));
  if (r.assignment_type !== "TEMPORARY") throw asgError(409, "ASSET_ASSIGNMENT_INVALID", "Only a temporary assignment has a return date to extend.");
  if (r.returned_at || ["REJECTED", "CANCELLED"].includes(r.status)) throw asgError(409, "ASSET_ASSIGNMENT_INVALID", "This assignment has ended.");
  const next = dayOf(input.expectedReturnDate);
  const reason = text(input.reason, 1000);
  if (!next || next <= dayOfDb(r.expected_return_date)) throw asgError(400, "ASSET_ASSIGNMENT_INVALID", "Choose a later return date.", { field: "expectedReturnDate" });
  if (reason.length < 3) throw asgError(400, "ASSET_ASSIGNMENT_INVALID", "Give the reason.", { field: "reason" });
  await client.query(`UPDATE tenant.asset_assignment_requests SET expected_return_date = $2 WHERE id = $1`, [r.id, next]);
  if (r.custody_handover_id) await client.query(`UPDATE tenant.asset_custody_assignments SET expected_return_at = $2 WHERE source_handover_id = $1 AND status = 'ACTIVE'`, [r.custody_handover_id, next]);
  await logAssignmentEvent(client, c, r.id, "EXTENDED", { assetId: r.asset_id, details: { from: dayOfDb(r.expected_return_date), to: next, original: dayOfDb(r.original_expected_return_date) }, reason });
  return { requestId: r.id, expectedReturnDate: next, originalExpectedReturnDate: dayOfDb(r.original_expected_return_date) };
}
// input: { rows: [{ assetId? | asset?, userId? | email? }], purpose, assignmentType?, expectedReturnDate?, issueNow?, condition?, idempotencyKey } — one request per asset and
// recipient, each validated on its own; a retry returns the same batch.
export async function bulkAssignAssets(client, c, input = {}) {
  requireAsg(c, ASG.bulk);
  const key = text(input.idempotencyKey, 200);
  if (!key) throw asgError(400, "ASSET_ASSIGNMENT_INVALID", "A batch key is required so a retry cannot assign twice.");
  const done = (await client.query(`SELECT * FROM tenant.asset_assignment_batches WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
  if (done) return { batchId: done.id, number: done.batch_number, status: done.status, results: done.results, succeeded: done.succeeded, failed: done.failed, replayed: true };
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length || rows.length > 300) throw asgError(400, "ASSET_ASSIGNMENT_INVALID", "Give between 1 and 300 rows.");
  const number = await nextNumber(client, c, "asset_assignment_batch", "ASB");
  const batchId = (await client.query(`SELECT gen_random_uuid() AS id`)).rows[0].id;
  const results = [];
  for (const [i, row] of rows.entries()) {
    await client.query(`SAVEPOINT bulk_assign_${i}`);
    try {
      let userId = row.userId;
      if (!userId && row.email) userId = (await client.query(`SELECT u.id FROM public.users u JOIN public.organization_memberships m ON m.user_id = u.id AND m.organization_id = $1 WHERE lower(u.email) = lower($2)`, [c.organizationId, String(row.email)])).rows[0]?.id;
      if (!userId) throw asgError(400, "ASSET_ASSIGNMENT_RECIPIENT_INVALID", `${row.email ?? "The recipient"} is not a member of the Company.`);
      const made = await createAssignmentRequest(client, c, { assetId: row.assetId, asset: row.asset, recipientType: "EMPLOYEE", toUserId: userId, purpose: input.purpose, assignmentType: input.assignmentType,
        expectedReturnDate: input.expectedReturnDate, batchId, idempotencyKey: `${key}:${i + 1}`, submit: true });
      let issued = null;
      if (input.issueNow && made.status === "READY_TO_ISSUE") {
        const a = (await client.query(`SELECT asset_number FROM tenant.assets WHERE id = $1`, [made.assetId])).rows[0];
        issued = await issueAssignedAsset(client, c, made.requestId, { identifier: a.asset_number, condition: input.condition ?? "GOOD" });
      }
      await client.query(`RELEASE SAVEPOINT bulk_assign_${i}`);
      results.push({ row: i + 1, ok: true, requestId: made.requestId, number: made.number, status: issued?.status ?? made.status });
    } catch (failure) {
      await client.query(`ROLLBACK TO SAVEPOINT bulk_assign_${i}`);
      results.push({ row: i + 1, ok: false, asset: row.asset ?? row.assetId ?? null, code: failure.code ?? "ASSET_ASSIGNMENT_INVALID", message: failure.message });
    }
  }
  const succeeded = results.filter((x) => x.ok).length;
  const status = succeeded === results.length ? "COMPLETED" : succeeded ? "PARTIAL" : "FAILED";
  await client.query(`INSERT INTO tenant.asset_assignment_batches (id, organization_id, batch_number, idempotency_key, status, results, succeeded, failed, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [batchId, c.organizationId, number, key, status, JSON.stringify(results), succeeded, results.length - succeeded, c.userId]);
  return { batchId, number, status, results, succeeded, failed: results.length - succeeded };
}
// Reminders (to be scheduled): temporary returns now overdue, and reservations approved but not issued for a week.
export async function sendAssignmentReminders(client, c) {
  requireAsg(c, ASG.manage);
  const overdue = (await client.query(`SELECT * FROM tenant.asset_assignment_requests WHERE organization_id = $1 AND assignment_type = 'TEMPORARY' AND issued_at IS NOT NULL AND returned_at IS NULL AND expected_return_date < current_date`, [c.organizationId])).rows;
  const team = await usersWith(client, c, ASG.return);
  for (const r of overdue) await tell(client, c, [r.to_user_id, ...team], r, "return overdue", `Expected back ${dayOfDb(r.expected_return_date)}.`);
  const stuck = (await client.query(`SELECT * FROM tenant.asset_assignment_requests WHERE organization_id = $1 AND status = 'READY_TO_ISSUE' AND updated_at < now() - interval '7 days'`, [c.organizationId])).rows;
  for (const r of stuck) await tell(client, c, team, r, "reserved but not issued for a week", null);
  return { overdueReturns: overdue.length, notIssued: stuck.length };
}
export { OPEN as OPEN_REQUESTS };
