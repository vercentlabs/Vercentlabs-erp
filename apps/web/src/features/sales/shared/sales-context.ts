import "server-only";

import type { WorkspaceSessionContext } from "@/core/session";

export function salesContext(session: WorkspaceSessionContext) {
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    permissions: session.permissions,
    roleSlugs: session.roleSlugs,
  };
}
