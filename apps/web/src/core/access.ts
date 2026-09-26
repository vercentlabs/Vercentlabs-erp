import "server-only";

import { cache } from "react";

import { buildWorkspaceAccessSnapshot, type WorkspaceAccessSnapshot } from "@vercentlabs/api";

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
