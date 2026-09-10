import type { CrmContext } from "@vercentlabs/shared-types";
import type { SessionContext, WorkspaceSessionContext } from "@/core/auth";
import { assertModuleAccessible } from "@/core/module-access";

export function crmContext(session: SessionContext): CrmContext {
  return {
    organizationId: session.organizationId as string,
    userId: session.userId,
    activeCompanyId: session.activeCompanyId,
    activeBranchId: session.activeBranchId,
    allowAllCompanies:
      session.roleSlugs.includes("organization_owner") ||
      session.roleSlugs.includes("system_administrator"),
    // Prompt 14 fix: these were previously omitted, so
    // canViewAllCrmRecords() (services/api/src/modules/crm/index.js) always evaluated
    // false — every real request was silently restricted to owner/assignee
    // scope even for users holding crm.records.view_all. Permission truth
    // comes from the already-resolved session (auth.ts); this is not a
    // second authorization query and does not synthesize permissions from
    // role names.
    permissions: session.permissions,
    roleSlugs: session.roleSlugs,
  };
}
// Entitlement-gated CRM context used by API routes, server-rendered CRM pages,
// search and orchestration boundaries. crmContext() remains the synchronous
// mapper used only after module accessibility has been established.
export async function crmApiContext(
  session: SessionContext,
): Promise<CrmContext> {
  await assertModuleAccessible(session as WorkspaceSessionContext, "crm");
  return crmContext(session);
}
