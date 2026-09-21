import "server-only";

import { assertModuleAccessible, requireBillingWriteAccess, requireSessionPermission, assetsContext as domainContext } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/core/session";

type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };

// Layered gate: module entitlement, then a route-level permission (assets.view), then (for a business write
// only) an active subscription. Every domain function re-checks ITS OWN permission and segregation-of-duties
// rule, which is where maker-checker actually lives.
export async function requireAssetsAccess(client: QueryClient, session: WorkspaceSessionContext, permission: string, options: { mutation?: boolean } = {}) {
  await assertModuleAccessible(client, session, "assets", process.env);
  if (permission) requireSessionPermission(session, permission);
  if (options.mutation) await requireBillingWriteAccess(client, session.organizationId, process.env);
}

export function assetsContext(session: WorkspaceSessionContext) {
  return domainContext(session as unknown as Record<string, unknown>);
}
