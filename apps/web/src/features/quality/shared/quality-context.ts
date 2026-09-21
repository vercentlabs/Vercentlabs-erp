import "server-only";

import { assertModuleAccessible, requireBillingWriteAccess, requireSessionPermission, qualityContext as domainContext } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/core/session";

type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };

// Same layered gate as every other module: entitlement, then a permission, then (for a business write
// only) an active subscription. The route-level permission is quality.view; each operation is
// re-checked against ITS OWN permission inside the domain, which is where segregation of duties lives.
export async function requireQualityAccess(client: QueryClient, session: WorkspaceSessionContext, permission: string, options: { mutation?: boolean } = {}) {
  await assertModuleAccessible(client, session, "quality", process.env);
  if (permission) requireSessionPermission(session, permission);
  if (options.mutation) await requireBillingWriteAccess(client, session.organizationId, process.env);
}

export function qualityContext(session: WorkspaceSessionContext) {
  return domainContext(session as unknown as Record<string, unknown>);
}
