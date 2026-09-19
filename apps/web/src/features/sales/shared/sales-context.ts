import "server-only";

import { assertModuleAccessible, requireBillingWriteAccess, requireSessionPermission } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/core/session";

type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };

// Same two-layer gate as requireCrmAccess/requirePosAccess: module
// entitlement first, then the specific permission, then (for a genuine
// business write only) an active subscription.
export async function requireSalesAccess(
  client: QueryClient,
  session: WorkspaceSessionContext,
  permission?: string,
  options: { mutation?: boolean } = {},
) {
  await assertModuleAccessible(client, session, "sales", process.env);
  if (permission) requireSessionPermission(session, permission);
  if (options.mutation) await requireBillingWriteAccess(client, session.organizationId, process.env);
}

export function salesContext(session: WorkspaceSessionContext) {
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    activeCompanyId: session.activeCompanyId,
    activeBranchId: session.activeBranchId,
    allowAllCompanies: session.roleSlugs.includes("organization_owner") || session.roleSlugs.includes("system_administrator"),
    permissions: session.permissions,
    roleSlugs: session.roleSlugs,
  };
}
