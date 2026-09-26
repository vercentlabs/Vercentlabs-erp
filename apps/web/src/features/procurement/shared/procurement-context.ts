import "server-only";

import { procurementContext as buildContext } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/core/session";

export function procurementContext(session: WorkspaceSessionContext) {
  return buildContext(session);
}
