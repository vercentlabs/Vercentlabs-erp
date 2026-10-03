import "server-only";

import { stockContext } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/core/session";

// One context serves both the stock domain and the shared master-data engine.
export function inventoryContext(session: WorkspaceSessionContext) {
  return stockContext(session);
}
