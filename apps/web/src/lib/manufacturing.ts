import type { WorkspaceSessionContext } from "@/lib/auth";

export function manufacturingContext(session: WorkspaceSessionContext) {
  if (!session.activeCompanyId) {
    throw new Error("Select an active company before using Manufacturing.");
  }
  return {
    organizationId: session.organizationId,
    companyId: session.activeCompanyId,
    userId: session.userId,
    permissions: session.permissions,
  };
}
