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
  // Sequential, not Promise.all: all three calls issue real queries
  // against this same withClient() connection, and a single pg
  // client/connection can only run one query at a time. Running them
  // concurrently here is what actually produced the "client.query() when
  // the client is already executing a query" deprecation warning (this
  // function is the direct caller WorkspaceLayout's own stack trace
  // names) -- getAccessibleModules alone issues up to 12 sequential
  // queries internally (one per module), so this was compounding the
  // same mistake at three levels. This runs once per workspace page load,
  // so the small latency cost of sequential resolution here is not
  // meaningful.
  const accessibleModules = await withClient((client) => getAccessibleModules(client, session, process.env));
  const pendingApprovalCount = hasSessionPermission(session, "approvals.manage")
    ? await withClient((client) => getPendingApprovalCount(client, session.organizationId))
    : 0;
  const unreadNotificationCount = await withClient((client) => getUnreadNotificationCount(client, session));
  return {
    session,
    accessibleModules,
    pendingApprovalCount,
    unreadNotificationCount,
  };
}
