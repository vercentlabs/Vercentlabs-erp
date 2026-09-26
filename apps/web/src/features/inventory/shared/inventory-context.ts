import "server-only";

import { stockContext } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/core/session";

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
