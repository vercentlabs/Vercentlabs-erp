import "server-only";

import type { WorkspaceSessionContext } from "@/core/session";

// Builds the CrmContext shape services/api/src/modules/crm/*.js functions
// expect (@vercentlabs/shared-types' CrmContext), from the already-
// resolved workspace session — the same allowAllCompanies computation
// used everywhere else in the shell (services/api/src/core/approvals.js,
// the ported access-administration module).
export function crmContext(session: WorkspaceSessionContext) {
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    activeCompanyId: session.activeCompanyId,
    activeBranchId: session.activeBranchId,
    allowAllCompanies:
      session.roleSlugs.includes("organization_owner") ||
      session.roleSlugs.includes("system_administrator"),
    permissions: session.permissions,
    roleSlugs: session.roleSlugs,
  };
}

export type CrmApiContext = ReturnType<typeof crmContext>;
