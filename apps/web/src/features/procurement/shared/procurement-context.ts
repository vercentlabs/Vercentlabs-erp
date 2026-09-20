import "server-only";

import { assertModuleAccessible, procurementContext as buildContext, requireBillingWriteAccess, requireSessionPermission } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/core/session";

type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };

// Same layered gate as Sales/CRM/POS: module entitlement, then a permission,
// then (for a business write only) an active subscription. The route-level
// permission is the module-wide procurement.view; every resource action is then
// re-checked against ITS OWN permission inside the domain (procurement.po.approve,
// procurement.receipts.approve, ...), which is where segregation of duties lives.
export async function requireProcurementAccess(
  client: QueryClient,
  session: WorkspaceSessionContext,
  permission: string,
  options: { mutation?: boolean } = {},
) {
  await assertModuleAccessible(client, session, "procurement", process.env);
  requireSessionPermission(session, permission);
  if (options.mutation) await requireBillingWriteAccess(client, session.organizationId, process.env);
}

export function procurementContext(session: WorkspaceSessionContext) {
  return buildContext(session);
}
