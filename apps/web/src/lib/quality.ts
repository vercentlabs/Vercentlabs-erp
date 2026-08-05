import type { WorkspaceSessionContext } from "@/lib/auth";

export function qualityContext(session: WorkspaceSessionContext) {
  if (!session.activeCompanyId) {
    throw new Error("Select an active company before using Quality.");
  }
  return {
    organizationId: session.organizationId,
    companyId: session.activeCompanyId,
    userId: session.userId,
    permissions: session.permissions,
    roleSlugs: session.roleSlugs,
  };
}
