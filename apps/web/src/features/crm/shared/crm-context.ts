import "server-only";

import { assertModuleAccessible, requireSessionPermission } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/core/session";

type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };

// Checkpoint audit (Prompt 3 continuation): every CRM route built so far
// only called requireWorkspace() — authentication + org membership — and
// then went straight to the domain function. Neither the module-
// entitlement layer (released/tenant-enabled/billing-entitled/crm.view,
// see module-entitlements.js's documented pipeline, which explicitly says
// "any server-side guard must call assertModuleAccessible() rather than
// re-implement any part of this pipeline") nor the resource-specific
// action permission (crm.leads.manage/crm.opportunities.manage/
// crm.accounts.manage/crm.activities.manage) was ever checked at the route
// layer. Most CRM domain functions don't check a baseline permission
// internally either (Lead's assign/qualify actions are the exception) --
// task-operations.js even says outright "gated by crm.activities.manage at
// the route level". This was a real, session-wide gap: any authenticated
// member of any organization could call any CRM mutation. This helper is
// the one place that closes it — call it first, inside the same
// withClient/tenantTransaction callback that runs the actual domain call,
// for every CRM route (mutating or not).
export async function requireCrmAccess(client: QueryClient, session: WorkspaceSessionContext, permission?: string) {
  await assertModuleAccessible(client, session, "crm", process.env);
  if (permission) requireSessionPermission(session, permission);
}

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
