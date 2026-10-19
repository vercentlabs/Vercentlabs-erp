// The approval request lifecycle: the ONLY code that writes
// public.approval_requests and public.approval_decisions.
//
//   Platform (here)   request identity, status, requester, assignee, command
//                     key, version, decision evidence, cancellation, SoD.
//   Business module   whether its document may be approved, the business
//                     permission, the document transition and side effects.
//                     It raises requests with createApprovalRequest() and, in
//                     the SAME transaction as its own approve/reject, closes
//                     them with finalizeApprovalRequest().
//   Orchestration     the global inbox: dispatches a decision to the owning
//                     module, then confirms the request with recordApprovalDecision().
//
// No business-module imports here.
import { assertApprovalDecision, assertSeparationOfDuties, WorkflowConflictError } from "@vercentlabs/workflows";

import { getApprovalCommand } from "./catalog.js";

export class ApprovalError extends Error {
  constructor(status, message, code = "APPROVAL_ERROR") {
    super(message);
    this.name = "ApprovalError";
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validatePayload(command, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ApprovalError(500, "The approval payload is invalid.", "APPROVAL_PAYLOAD_INVALID");
  for (const name of command.payload) {
    const value = payload[name];
    if (typeof value !== "string" || !value.trim() || value.length > 200) {
      throw new ApprovalError(500, `The approval payload is missing ${name}.`, "APPROVAL_PAYLOAD_INVALID");
    }
  }
}

// Raises a pending approval request for a registered command. A second call for
// the same logical target while one is pending returns the existing request.
export async function createApprovalRequest(client, { id = null, organizationId, commandKey, entityId, title, requestedBy, assignedTo = null, payload, approverRoleId = null, approvalLevel = null, approvalRuleId = null }) {
  const command = getApprovalCommand(commandKey);
  if (!command) throw new ApprovalError(500, `Unknown approval command "${commandKey}".`, "APPROVAL_COMMAND_UNKNOWN");
  if (!UUID.test(String(organizationId || ""))) throw new ApprovalError(500, "An organisation is required.", "APPROVAL_INVALID");
  if (!requestedBy || !UUID.test(String(requestedBy))) throw new ApprovalError(500, "A requester is required.", "APPROVAL_INVALID");
  if (!entityId) throw new ApprovalError(500, "The approval target is required.", "APPROVAL_INVALID");
  validatePayload(command, payload);
  if (assignedTo) {
    const member = await client.query(`SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`, [organizationId, assignedTo]);
    if (!member.rows[0]) throw new ApprovalError(422, "The approver must be an active member of this organisation.", "APPROVAL_APPROVER_INVALID");
  }
  const dedupeKey = command.dedupeKey(payload);
  const inserted = await client.query(
    `INSERT INTO public.approval_requests (id, organization_id, entity_type, entity_id, title, status, requested_by, assigned_to, command_key, command_payload, dedupe_key,
       approver_role_id, approval_level, approval_rule_id)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, 'pending', $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
     ON CONFLICT (organization_id, command_key, dedupe_key) WHERE status = 'pending' DO NOTHING
     RETURNING id, status, version`,
    [id, organizationId, command.entityType, String(entityId), String(title || command.label).slice(0, 300), requestedBy, assignedTo, command.key, JSON.stringify(payload), dedupeKey,
      approverRoleId, approvalLevel, approvalRuleId],
  );
  if (inserted.rows[0]) {
    await notifyApprovers(client, { organizationId, command, requestedBy, assignedTo, approverRoleId, title: String(title || command.label).slice(0, 300) }).catch(() => undefined);
    return { ...inserted.rows[0], created: true };
  }
  const existing = await client.query(
    `SELECT id, status, version FROM public.approval_requests WHERE organization_id = $1 AND command_key = $2 AND dedupe_key = $3 AND status = 'pending'`,
    [organizationId, command.key, dedupeKey],
  );
  return { ...existing.rows[0], created: false };
}

// The people who can decide a request: its assignee, else every active member holding the command's permission (and the owner),
// never the requester (separation of duties).
async function notifyApprovers(client, { organizationId, command, requestedBy, assignedTo, approverRoleId = null, title }) {
  const { createNotification, permissionHolders } = await import("../notifications/index.js");
  const approvers = assignedTo ? [assignedTo] : approverRoleId ? await roleMembers(client, organizationId, approverRoleId) : await permissionHolders(client, organizationId, command.requiredPermission);
  const requester = (await client.query(`SELECT full_name FROM users WHERE id = $1`, [requestedBy])).rows[0]?.full_name ?? "Someone";
  for (const userId of approvers.filter((user) => user !== requestedBy)) {
    await createNotification(client, { organizationId, userId, category: "approval_request", title: `Waiting for your approval: ${title}`, message: `${requester} asked for ${command.label.toLowerCase()}.`,
      href: "/approvals", entityType: command.entityType, entityId: null });
  }
}

// The active members holding a role (an approval rule's "anyone with this role").
export async function roleMembers(client, organizationId, roleId) {
  return (await client.query(
    `SELECT DISTINCT assignment.user_id FROM user_role_assignments assignment
       JOIN organization_memberships membership ON membership.organization_id = assignment.organization_id AND membership.user_id = assignment.user_id AND membership.status = 'active'
      WHERE assignment.organization_id = $1 AND assignment.role_id = $2 AND assignment.status = 'active' AND (assignment.expires_at IS NULL OR assignment.expires_at > now())`,
    [organizationId, roleId])).rows.map((row) => row.user_id);
}

async function notifyRequester(client, request, decision, actorUserId, note) {
  if (!request.requested_by || request.requested_by === actorUserId || decision === "cancelled") return;
  const { createNotification } = await import("../notifications/index.js");
  const command = getApprovalCommand(request.command_key);
  const decider = actorUserId ? (await client.query(`SELECT full_name FROM users WHERE id = $1`, [actorUserId])).rows[0]?.full_name : null;
  await createNotification(client, {
    organizationId: request.organization_id, userId: request.requested_by, category: "approval_decided",
    title: `${decision === "approved" ? "Approved" : "Rejected"}: ${request.title ?? command?.label ?? "your request"}`,
    message: `${decider ?? "An approver"} ${decision} it${note ? `: ${String(note).slice(0, 300)}` : "."}`, href: "/approvals", entityType: command?.entityType ?? null, entityId: null,
  });
}

async function applyDecision(client, request, { decision, actorUserId, note }) {
  const updated = await client.query(
    `UPDATE public.approval_requests
        SET status = $3, decided_at = now(), decided_by = $4, decision_note = COALESCE($5, decision_note), version = version + 1, updated_at = now()
      WHERE id = $1 AND organization_id = $2 AND status = 'pending'
      RETURNING id, status, version, decided_at, decided_by`,
    [request.id, request.organization_id, decision, actorUserId || null, note],
  );
  if (!updated.rows[0]) return null;
  await client.query(
    `INSERT INTO public.approval_decisions (organization_id, approval_request_id, version, decision, note, decided_by)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (approval_request_id, version) DO NOTHING`,
    [request.organization_id, request.id, request.version, decision, note, actorUserId || null],
  );
  await notifyRequester(client, request, decision, actorUserId, note).catch(() => undefined);
  return updated.rows[0];
}

// Called by a business module inside the transaction that approves, rejects or
// withdraws its document, so a decision made from ANY screen closes the shared
// request. Targets the exact request when the module stored its id, otherwise
// the pending request for (command, entity). A no-op when nothing is pending.
export async function finalizeApprovalRequest(client, { organizationId, commandKey, entityId, approvalRequestId = null, decision, actorUserId, note = null }) {
  if (!["approved", "rejected", "cancelled"].includes(decision)) throw new ApprovalError(500, "Unsupported approval decision.", "APPROVAL_INVALID");
  const command = getApprovalCommand(commandKey);
  if (!command) throw new ApprovalError(500, `Unknown approval command "${commandKey}".`, "APPROVAL_COMMAND_UNKNOWN");
  const rows = (
    await client.query(
      `SELECT * FROM public.approval_requests
        WHERE organization_id = $1 AND status = 'pending' AND command_key = $2
          AND (($3::uuid IS NOT NULL AND id = $3::uuid) OR ($3::uuid IS NULL AND entity_type = $4 AND entity_id = $5))
        ORDER BY requested_at FOR UPDATE`,
      [organizationId, command.key, approvalRequestId, command.entityType, String(entityId)],
    )
  ).rows;
  const closed = [];
  for (const row of rows) {
    const result = await applyDecision(client, row, { decision, actorUserId, note: note ? String(note).slice(0, 2000) : null });
    if (result) closed.push(result);
  }
  return closed;
}

// Locks a request for a decision made from the global inbox.
export async function lockApprovalRequest(client, organizationId, approvalId) {
  if (!UUID.test(String(approvalId || ""))) throw new ApprovalError(404, "Approval request not found.", "APPROVAL_NOT_FOUND");
  const row = (await client.query(`SELECT * FROM public.approval_requests WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [approvalId, organizationId])).rows[0];
  if (!row) throw new ApprovalError(404, "Approval request not found.", "APPROVAL_NOT_FOUND");
  return row;
}

// Generic decision validation + separation of duties (from @vercentlabs/workflows).
export function validateApprovalDecision(request, { decision, note, expectedVersion, actorUserId }) {
  if (request.status !== "pending") throw new ApprovalError(409, "This approval has already been decided.", "APPROVAL_ALREADY_DECIDED");
  let validated;
  try {
    validated = assertApprovalDecision({ decision, note, expectedVersion: expectedVersion ?? request.version });
  } catch (error) {
    throw new ApprovalError(422, error.message, "APPROVAL_DECISION_INVALID");
  }
  if (validated.expectedVersion !== request.version) throw new ApprovalError(409, "This approval changed since you opened it. Refresh and try again.", "APPROVAL_VERSION_CONFLICT");
  if (validated.decision !== "cancelled") {
    try {
      assertSeparationOfDuties({ requestedBy: request.requested_by, actorUserId });
    } catch (error) {
      if (error instanceof WorkflowConflictError) throw new ApprovalError(403, "You cannot decide on your own request.", "SELF_APPROVAL_DENIED");
      throw error;
    }
  }
  return validated;
}

// Completes a request decided through the global inbox, after the business
// module has run. Idempotent when the module already closed it in this
// transaction with the same decision by the same person.
export async function recordApprovalDecision(client, request, { decision, actorUserId, note }) {
  const current = (await client.query(`SELECT * FROM public.approval_requests WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [request.id, request.organization_id])).rows[0];
  if (current.status === "pending") return applyDecision(client, current, { decision, actorUserId, note });
  if (current.status === decision && current.decided_by === (actorUserId || null)) {
    // The module closed it in this transaction; keep the inbox's note as evidence.
    if (note && !current.decision_note) {
      await client.query(`UPDATE public.approval_requests SET decision_note = $3, updated_at = now() WHERE id = $1 AND organization_id = $2`, [current.id, current.organization_id, note]);
      await client.query(`UPDATE public.approval_decisions SET note = $2 WHERE approval_request_id = $1 AND version = $3 AND note IS NULL`, [current.id, note, current.version - 1]);
    }
    return { id: current.id, status: current.status, version: current.version, decided_at: current.decided_at, decided_by: current.decided_by };
  }
  throw new ApprovalError(409, "This approval has already been decided.", "APPROVAL_ALREADY_DECIDED");
}

// ------------------------------------------------------------------ reads
// Rows visible to one viewer: their own requests, requests assigned to them,
// unassigned requests for commands they hold the business permission for, or
// everything when they have organisation oversight (approvals.manage).
export async function listApprovalRequestsForViewer(client, { organizationId, userId, oversight, decidableCommandKeys }, { status = "pending", limit = 100 } = {}) {
  if (!["pending", "approved", "rejected", "cancelled", "all"].includes(status)) throw new ApprovalError(400, "Unsupported approval filter.", "APPROVAL_FILTER_INVALID");
  const bounded = Math.min(250, Math.max(1, Number(limit) || 100));
  const result = await client.query(
    `SELECT request.id, request.entity_type, request.entity_id, request.title, request.status, request.requested_by, request.assigned_to,
            request.requested_at, request.decided_at, request.decided_by, request.decision_note, request.command_key, request.command_payload, request.version,
            requester.full_name AS requested_by_name, assignee.full_name AS assigned_to_name, decider.full_name AS decided_by_name,
            request.approval_level, request.approver_role_id,
            (request.assigned_to = $4 OR request.approver_role_id IN (SELECT role_id FROM user_role_assignments WHERE organization_id = $1 AND user_id = $4 AND status = 'active')) AS routed_to_viewer
       FROM public.approval_requests request
       LEFT JOIN users requester ON requester.id = request.requested_by
       LEFT JOIN users assignee ON assignee.id = request.assigned_to
       LEFT JOIN users decider ON decider.id = request.decided_by
      WHERE request.organization_id = $1 AND ($2::text IS NULL OR request.status = $2)
        AND ($3::boolean OR request.requested_by = $4 OR request.assigned_to = $4
             OR request.approver_role_id IN (SELECT role_id FROM user_role_assignments WHERE organization_id = $1 AND user_id = $4 AND status = 'active')
             OR (request.assigned_to IS NULL AND request.approver_role_id IS NULL AND request.command_key = ANY($5::text[])))
      ORDER BY request.requested_at DESC, request.id DESC
      LIMIT $6`,
    [organizationId, status === "all" ? null : status, Boolean(oversight), userId, decidableCommandKeys || [], bounded],
  );
  return result.rows;
}

export async function countPendingApprovalsForViewer(client, { organizationId, userId, oversight, decidableCommandKeys }) {
  const result = await client.query(
    `SELECT count(*)::int AS count FROM public.approval_requests
      WHERE organization_id = $1 AND status = 'pending'
        AND ($2::boolean OR assigned_to = $3
             OR approver_role_id IN (SELECT role_id FROM user_role_assignments WHERE organization_id = $1 AND user_id = $3 AND status = 'active')
             OR (assigned_to IS NULL AND approver_role_id IS NULL AND command_key = ANY($4::text[])))
        AND requested_by IS DISTINCT FROM (CASE WHEN $2::boolean THEN NULL ELSE $3::uuid END)`,
    [organizationId, Boolean(oversight), userId, decidableCommandKeys || []],
  );
  return result.rows[0]?.count ?? 0;
}
