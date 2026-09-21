import "server-only";

import { assertModuleAccessible, requireBillingWriteAccess, requireSessionPermission, projectsContext as domainContext } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/core/session";

type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };

// Layered gate: module entitlement, then a route-level permission (projects.view), then (for a business write
// only) an active subscription. Every domain function re-checks ITS OWN permission, project scope and
// segregation-of-duties rule, which is where the real controls live.
export async function requireProjectsAccess(client: QueryClient, session: WorkspaceSessionContext, permission: string, options: { mutation?: boolean } = {}) {
  await assertModuleAccessible(client, session, "projects", process.env);
  if (permission) requireSessionPermission(session, permission);
  if (options.mutation) await requireBillingWriteAccess(client, session.organizationId, process.env);
}

export function projectsContext(session: WorkspaceSessionContext) {
  return domainContext(session as unknown as Record<string, unknown>);
}
