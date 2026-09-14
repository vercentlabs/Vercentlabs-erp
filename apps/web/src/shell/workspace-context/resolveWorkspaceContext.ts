import "server-only";

import { getAccessibleModules, type ModuleAccess } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { requireWorkspace, type WorkspaceSessionContext } from "@/core/session";

export type WorkspaceContext = {
  session: WorkspaceSessionContext;
  accessibleModules: ModuleAccess[];
};

// The one place a server component/layout resolves "who is this, which
// organization/company/branch are they in, and which of the 12 modules
// can they actually reach right now" — Phase 5's canonical workspace
// session contract. Not React `cache()`-wrapped here because
// getAccessibleModules() (services/api) already applies its own
// per-call-graph memoization; this function itself does no independent
// caching beyond a single DB round trip.
export async function resolveWorkspaceContext(): Promise<WorkspaceContext> {
  const session = await requireWorkspace();
  const accessibleModules = await withClient((client) =>
    getAccessibleModules(client, session, process.env),
  );
  return { session, accessibleModules };
}
