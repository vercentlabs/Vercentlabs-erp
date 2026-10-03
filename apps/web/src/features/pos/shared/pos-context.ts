import "server-only";

import type { WorkspaceSessionContext } from "@/core/session";

// Builds the context shape services/api/src/modules/point-of-sale/index.js
// expects.
export function posContext(session: WorkspaceSessionContext) {
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    roleSlugs: session.roleSlugs,
    permissions: session.permissions,
  };
}
