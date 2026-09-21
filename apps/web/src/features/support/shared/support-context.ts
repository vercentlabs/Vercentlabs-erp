import "server-only";

import { assertModuleAccessible, requireBillingWriteAccess, requireSessionPermission, supportContext as domainContext } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/core/session";

type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };

// Same layered gate as HR: module entitlement, then a permission, then (for a business write only) an
// active subscription. The route-level permission is support.view; each operation is re-checked
// against ITS OWN permission inside the domain, which is where segregation of duties lives.
// permission "" = customer portal self-service: any signed-in workspace member may reach the route;
// the domain then requires an actual support_portal_users link and scopes every read/write to it.
export async function requireSupportAccess(client: QueryClient, session: WorkspaceSessionContext, permission: string, options: { mutation?: boolean } = {}) {
  try {
    await assertModuleAccessible(client, session, "support", process.env);
  } catch (error) {
    if (!(permission === "" && (error as { code?: string }).code === "MODULE_NOT_PERMITTED")) throw error;
  }
  if (permission) requireSessionPermission(session, permission);
  if (options.mutation) await requireBillingWriteAccess(client, session.organizationId, process.env);
}

export function supportContext(session: WorkspaceSessionContext) {
  return domainContext(session as unknown as Record<string, unknown>);
}
