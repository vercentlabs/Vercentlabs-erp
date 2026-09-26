import { getCrmEmailThread } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

// F018 gap-closure — listThreadMessages (the conversation view) had no
// route; it enforces shared-inbox membership and per-message projection.
export async function GET(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { id } = await context.params;
    const result = await getCrmEmailThread(client, crmContext(session), id);
    return ok(result);
  });
}
