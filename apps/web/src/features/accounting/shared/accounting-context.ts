import "server-only";

import { assertModuleAccessible, requireBillingWriteAccess, requireSessionPermission } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import type { WorkspaceSessionContext } from "@/core/session";

type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };

// Layered gate: module entitlement, then a route-level permission, then (for a business write only) an
// active subscription. Each domain function re-checks ITS OWN permission and segregation-of-duties rule.
export async function requireAccountingAccess(client: QueryClient, session: WorkspaceSessionContext, permission: string, options: { mutation?: boolean } = {}) {
  await assertModuleAccessible(client, session, "accounting", process.env);
  if (permission) requireSessionPermission(session, permission);
  if (options.mutation) await requireBillingWriteAccess(client, session.organizationId, process.env);
}

export function accountingContext(session: WorkspaceSessionContext) {
  const raw = session as unknown as Record<string, unknown>;
  const activeCompanyId = String(raw.activeCompanyId || raw.companyId || "");
  if (!activeCompanyId) throw new HttpError(400, "Select an active company before using Accounting.", "ACTIVE_COMPANY_REQUIRED");
  return {
    organizationId: session.organizationId,
    userId: String(raw.userId),
    activeCompanyId,
    activeBranchId: (raw.activeBranchId as string | null | undefined) ?? null,
    allowAllCompanies: false,
    permissions: (raw.permissions as string[] | undefined) ?? [],
    roleSlugs: (raw.roleSlugs as string[] | undefined) ?? [],
  };
}
