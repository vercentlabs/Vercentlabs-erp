import "server-only";

import {
  getActionablePendingApprovalCount,
  getUnreadNotificationCount,
  type ModuleAccess,
} from "@vercentlabs/api";

import { getWorkspaceAccessSnapshot, type WorkspaceAccessSnapshot } from "@/core/access";
import { withClient } from "@/core/db";
import { requireWorkspace, type WorkspaceSessionContext } from "@/core/session";

export type WorkspaceContext = {
  session: WorkspaceSessionContext;
  access: WorkspaceAccessSnapshot;
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
  // One request-scoped WorkspaceAccessSnapshot (core/access.ts): module
  // enablement, billing entitlement and company scope are each read once
  // for all 12 modules. The badge counts below run sequentially on their
  // own client — a single pg connection runs one query at a time.
  const access = await getWorkspaceAccessSnapshot();
  const accessibleModules = [...access.modules];
  // Pending approvals this person can act on (or oversee with approvals.manage);
  // the same visibility rule as the approvals inbox.
  const pendingApprovalCount = await withClient((client) => getActionablePendingApprovalCount(client, session));
  const unreadNotificationCount = await withClient((client) => getUnreadNotificationCount(client, session));
  return {
    session,
    access,
    accessibleModules,
    pendingApprovalCount,
    unreadNotificationCount,
  };
}
