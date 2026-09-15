import "server-only";

import {
  getAccessibleModules,
  getPendingApprovalCount,
  getUnreadNotificationCount,
  hasSessionPermission,
  type ModuleAccess,
} from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { requireWorkspace, type WorkspaceSessionContext } from "@/core/session";

export type WorkspaceContext = {
  session: WorkspaceSessionContext;
  accessibleModules: ModuleAccess[];
  pendingApprovalCount: number;
  unreadNotificationCount: number;
};

// The one place a server component/layout resolves "who is this, which
// organization/company/branch are they in, which of the 12 modules can
// they reach, and what actionable counts (pending approvals, unread
// notifications) belong in the shell's badges" — Phase 5's canonical
// workspace session contract. Badge counts are only computed when the
// session actually holds the relevant permission (approvals.manage) or is
// always-safe (a user's own unread count), never a decorative volume.
export async function resolveWorkspaceContext(): Promise<WorkspaceContext> {
  const session = await requireWorkspace();
  const [accessibleModules, pendingApprovalCount, unreadNotificationCount] =
    await withClient((client) =>
      Promise.all([
        getAccessibleModules(client, session, process.env),
        hasSessionPermission(session, "approvals.manage")
          ? getPendingApprovalCount(client, session.organizationId)
          : Promise.resolve(0),
        getUnreadNotificationCount(client, session),
      ]),
    );
  return {
    session,
    accessibleModules,
    pendingApprovalCount,
    unreadNotificationCount,
  };
}
