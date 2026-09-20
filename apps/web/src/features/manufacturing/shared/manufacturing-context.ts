import "server-only";

import { assertModuleAccessible, requireBillingWriteAccess, requireSessionPermission, manufacturingContext as domainContext } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/core/session";

type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };

// Same layered gate as Inventory/Procurement: module entitlement, then a permission, then (for a
// business write only) an active subscription. The route-level permission is manufacturing.view; each
// operation is re-checked against ITS OWN permission inside the domain (bom.manage, work_order.release,
// production.post, ...), which is where segregation of duties lives.
export async function requireManufacturingAccess(client: QueryClient, session: WorkspaceSessionContext, permission: string, options: { mutation?: boolean } = {}) {
  await assertModuleAccessible(client, session, "manufacturing", process.env);
  requireSessionPermission(session, permission);
  if (options.mutation) await requireBillingWriteAccess(client, session.organizationId, process.env);
}

export function manufacturingContext(session: WorkspaceSessionContext) {
  return domainContext(session as unknown as Record<string, unknown>);
}
