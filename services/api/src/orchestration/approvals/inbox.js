// The global approval inbox.
//   list:   rows the viewer may see, with server-decided capabilities
//           (canApprove / canReject / canCancel) and a deep link only when the
//           viewer can open the owning module.
//   decide: load + lock -> generic validation and SoD -> dispatch to the
//           owning business module (which applies its own permission, state
//           rules and closes the shared request) -> confirm the shared request.
//           One transaction: a failed business decision leaves it pending.
// approvals.manage is oversight (see and cancel), never business authority.
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

import { hasSessionPermission } from "../../core/access/index.js";
import { requireBillingWriteAccess } from "../../core/billing/index.js";
import {
  APPROVAL_COMMANDS,
  ApprovalError,
  countPendingApprovalsForViewer,
  getApprovalCommand,
  listApprovalRequestsForViewer,
  lockApprovalRequest,
  recordApprovalDecision,
  validateApprovalDecision,
} from "../../core/platform/approvals/index.js";
import { APPROVAL_COMMAND_REGISTRY, approvalHref } from "./registry.js";

const MODULE_NAME = new Map(ERP_MODULE_CATALOG.map((module) => [module.key, module.name]));

function moduleContext(session) {
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    activeCompanyId: session.activeCompanyId,
    activeBranchId: session.activeBranchId,
    allowAllCompanies: session.roleSlugs.includes("organization_owner") || session.roleSlugs.includes("system_administrator"),
    permissions: session.permissions,
    roleSlugs: session.roleSlugs,
  };
}

export function approvalViewer(session) {
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    oversight: hasSessionPermission(session, "approvals.manage"),
    decidableCommandKeys: APPROVAL_COMMANDS.filter((command) => hasSessionPermission(session, command.requiredPermission)).map((command) => command.key),
  };
}

function project(row, session, viewer, accessible) {
  const command = getApprovalCommand(row.command_key);
  const moduleKey = command?.moduleKey ?? null;
  const moduleAccessible = Boolean(moduleKey && accessible.has(moduleKey));
  const pending = row.status === "pending";
  const mine = row.requested_by === session.userId;
  const canDecide =
    pending && !mine && moduleAccessible && Boolean(command) && APPROVAL_COMMAND_REGISTRY.get(row.command_key) !== null && hasSessionPermission(session, command.requiredPermission);
  const hidden = !moduleAccessible && !viewer.oversight;
  return {
    id: row.id,
    label: command?.label ?? "Approval",
    moduleKey,
    moduleLabel: moduleKey ? MODULE_NAME.get(moduleKey) ?? moduleKey : null,
    documentLabel: hidden ? `Approval in ${MODULE_NAME.get(moduleKey) ?? "a module you cannot open"}` : row.title,
    requestedByName: row.requested_by_name ?? null,
    assignedToName: row.assigned_to_name ?? null,
    decidedByName: row.decided_by_name ?? null,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    decisionNote: hidden ? null : row.decision_note,
    status: row.status,
    version: row.version,
    isMine: mine,
    href: moduleAccessible ? approvalHref(row.command_key, row.command_payload) : null,
    canApprove: canDecide,
    canReject: canDecide,
    canCancel: pending && (mine || viewer.oversight),
    rejectionNoteRequired: true,
  };
}

export async function listApprovalInbox(client, session, { status = "pending", accessibleModules = [] } = {}) {
  const viewer = approvalViewer(session);
  const rows = await listApprovalRequestsForViewer(client, viewer, { status });
  const accessible = new Set(accessibleModules);
  return rows.map((row) => project(row, session, viewer, accessible));
}

export async function getActionablePendingApprovalCount(client, session) {
  return countPendingApprovalsForViewer(client, approvalViewer(session));
}

export async function decideApproval(client, session, approvalId, { decision, note = null, expectedVersion = null }, { accessibleModules = [], env = process.env } = {}) {
  const request = await lockApprovalRequest(client, session.organizationId, approvalId);
  const viewer = approvalViewer(session);
  // Someone who cannot see a request cannot act on it (and learns nothing about it).
  const visible =
    viewer.oversight || request.requested_by === session.userId || request.assigned_to === session.userId ||
    (request.assigned_to === null && viewer.decidableCommandKeys.includes(request.command_key));
  if (!visible) throw new ApprovalError(404, "Approval request not found.", "APPROVAL_NOT_FOUND");
  const validated = validateApprovalDecision(request, { decision, note, expectedVersion, actorUserId: session.userId });

  if (validated.decision === "cancelled") {
    // Cancellation withdraws the request only; it never changes the business document.
    if (request.requested_by !== session.userId && !viewer.oversight) {
      throw new ApprovalError(403, "Only the requester or an approvals manager can cancel this request.", "CANCEL_NOT_PERMITTED");
    }
    const approval = await recordApprovalDecision(client, request, { decision: "cancelled", actorUserId: session.userId, note: validated.note });
    return { approval, outcome: null };
  }

  const command = getApprovalCommand(request.command_key);
  if (!command || !APPROVAL_COMMAND_REGISTRY.get(request.command_key)) {
    throw new ApprovalError(501, "This approval type cannot be decided from the approvals inbox. Open the record in its own module.", "APPROVAL_COMMAND_NOT_SUPPORTED");
  }
  if (!accessibleModules.includes(command.moduleKey)) {
    throw new ApprovalError(403, "You do not have access to the module this approval belongs to.", "APPROVAL_MODULE_UNAVAILABLE");
  }
  // A business decision is a business write: the same subscription gate the module's own screens apply.
  await requireBillingWriteAccess(client, session.organizationId, env);
  const outcome = await APPROVAL_COMMAND_REGISTRY.execute(
    request.command_key,
    { client, context: moduleContext(session), decision: validated.decision, note: validated.note },
    request.command_payload || {},
  );
  const approval = await recordApprovalDecision(client, request, { decision: validated.decision, actorUserId: session.userId, note: validated.note });
  return { approval, outcome };
}
