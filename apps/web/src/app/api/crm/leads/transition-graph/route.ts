import { listLeadStageTransitions } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F007: the governed, admin-authored directed edges between Lead stages —
// the "Move to stage…" UI must only ever offer a legal next stage, never
// every active stage in the pipeline.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const transitions = await listLeadStageTransitions(client, crmContext(session));
    return ok({ transitions });
  });
}
