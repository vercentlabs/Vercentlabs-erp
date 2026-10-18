import { reorderActivityTypes } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Body: { ids } — the active types in the order every list shows them.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    const { ids } = await readBody(request);
    return ok({ types: await reorderActivityTypes(client, crmContext(session, snapshot), Array.isArray(ids) ? ids.map(String) : []) });
  });
}
