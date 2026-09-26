import "server-only";

import { cache } from "react";

import { authorize, buildWorkspaceAccessSnapshot, denialToError, type WorkspaceAccessSnapshot } from "@vercentlabs/api";
import type { PoolClient } from "pg";

import { tenantTransaction } from "@/core/db";
import { requireWorkspace, type WorkspaceSessionContext } from "@/core/session";

export type { AccessPrincipal, WorkspaceAccessSnapshot } from "@vercentlabs/api";

// Request-scoped only: React cache() memoizes within one server render and
// never across requests, so permission/module/subscription changes take
// effect on the next request. Keyed by the (itself request-cached) session
// object.
const snapshotForSession = cache(
  async (session: WorkspaceSessionContext): Promise<WorkspaceAccessSnapshot> =>
    tenantTransaction(session.organizationId, (client) => buildWorkspaceAccessSnapshot(client, session, { env: process.env })),
);

// Server Components/layouts: the workspace access snapshot for the current
// request (redirects to login/verification/onboarding like requireWorkspace).
// Route handlers use workspaceRoute() from core/workspace-route.ts instead.
export async function getWorkspaceAccessSnapshot(): Promise<WorkspaceAccessSnapshot> {
  return snapshotForSession(await requireWorkspace());
}

// Server Components that load module data (edit pages): the same Shared
// Access decision as workspaceRoute({ module, permission }) — snapshot, then
// authorize() — inside ONE organisation-context transaction that then runs
// the load. A denial throws the same 403/404 error a route would return.
export async function workspaceModuleTransaction<T>(
  session: WorkspaceSessionContext,
  options: { module: string; permission?: string },
  handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return tenantTransaction(session.organizationId, async (client) => {
    const snapshot = await buildWorkspaceAccessSnapshot(client, session, { env: process.env });
    const decision = authorize({ principal: snapshot.principal, snapshot, module: options.module, permission: options.permission });
    if (!decision.allowed) throw denialToError(decision);
    return handler(client);
  });
}
