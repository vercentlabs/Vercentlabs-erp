import type { WorkspaceSessionContext } from "@/core/auth";

export function pointOfSaleContext(session: WorkspaceSessionContext) {
  if (!session.activeCompanyId) {
    throw new Error("Select an active company before using Point of Sale.");
  }
  return {
    organizationId: session.organizationId,
    companyId: session.activeCompanyId,
    userId: session.userId,
    permissions: session.permissions,
    roleSlugs: session.roleSlugs,
  };
}
