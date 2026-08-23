import type { WorkspaceSessionContext } from "@/core/auth";

export function supportContext(session: WorkspaceSessionContext) {
  if (!session.activeCompanyId) {
    throw new Error("Select an active company before using Support.");
  }
  return {
    organizationId: session.organizationId,
    companyId: session.activeCompanyId,
    userId: session.userId,
    permissions: session.permissions,
    roleSlugs: session.roleSlugs,
  };
}
