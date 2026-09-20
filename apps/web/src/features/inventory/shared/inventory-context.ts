import "server-only";

import { assertModuleAccessible, requireBillingWriteAccess, requireSessionPermission, stockContext } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/core/session";

type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };

// Same layered gate as Sales/Procurement: module entitlement, then a permission, then (for a
// business write only) an active subscription. The route-level permission is stock.view; each
// operation is then re-checked against ITS OWN permission inside the domain (stock.receive,
// stock.adjust, stock.settings.manage, ...), and master-data writes against items.manage /
// inventory_setup.manage in the route.
export async function requireInventoryAccess(client: QueryClient, session: WorkspaceSessionContext, permission: string, options: { mutation?: boolean } = {}) {
  await assertModuleAccessible(client, session, "stock", process.env);
  requireSessionPermission(session, permission);
  if (options.mutation) await requireBillingWriteAccess(client, session.organizationId, process.env);
}

// One context serves both the stock domain (organisation + ACTIVE company) and the shared
// master-data engine (which also wants the branch). Company scoping is never widened: even an
// owner sees and maintains the active company's records here.
export function inventoryContext(session: WorkspaceSessionContext) {
  return {
    ...stockContext(session),
    activeCompanyId: session.activeCompanyId as string,
    activeBranchId: (session.activeBranchId ?? null) as string | null,
    allowAllCompanies: false,
  };
}
