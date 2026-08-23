// Shared approvals read path (Prompt 8, Part 9: "integrate, do not rebuild
// notifications/approvals"). This is the exact query
// apps/web/src/app/api/approvals/route.ts's GET already ran inline — moved
// here so My Work/Home can reuse it instead of hitting the API route over
// HTTP from a server component, with zero change to its scoping (still
// exactly the caller's own assigned-or-unassigned pending items).
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import type { WorkspaceSessionContext } from "@/core/auth";
import { query } from "@/core/db";
import type { WorkItem } from "@/shared/work/types";

export type ApprovalRequestRow = {
  id: string;
  title: string;
  entity_type: string;
  entity_id: string;
  command_key: string;
  status: string;
  version: number;
  requested_at: Date;
  decided_at: Date | null;
  requester: string | null;
  assignee: string | null;
};

export async function listMyApprovals(
  session: WorkspaceSessionContext,
  limit = 100,
): Promise<ApprovalRequestRow[]> {
  if (!hasPermission(session, PERMISSIONS.approvalsManage)) return [];
  return query<ApprovalRequestRow>(
    `SELECT approval.id, approval.title, approval.entity_type,
            approval.entity_id, approval.command_key, approval.status,
            approval.version, approval.requested_at, approval.decided_at,
            requester.full_name AS requester, assignee.full_name AS assignee
       FROM approval_requests approval
       LEFT JOIN users requester ON requester.id = approval.requested_by
       LEFT JOIN users assignee ON assignee.id = approval.assigned_to
      WHERE approval.organization_id = $1
        AND (approval.assigned_to = $2 OR approval.assigned_to IS NULL)
      ORDER BY CASE approval.status WHEN 'pending' THEN 0 ELSE 1 END,
               approval.requested_at DESC
      LIMIT ${Math.min(Math.max(Number(limit) || 100, 1), 200)}`,
    [session.organizationId, session.userId],
  );
}

export function pendingApprovalsAsWorkItems(
  rows: ApprovalRequestRow[],
  limit = 50,
): WorkItem[] {
  return rows
    .filter((row) => row.status === "pending")
    .slice(0, limit)
    .map((row) => ({
      id: `approval:${row.id}`,
      kind: "approval" as const,
      source: "Approval",
      title: row.title,
      subtitle: row.requester ? `Requested by ${row.requester}` : undefined,
      dueAt: undefined,
      urgency: "none" as const,
      status: row.status,
      href: "/approvals",
    }));
}
