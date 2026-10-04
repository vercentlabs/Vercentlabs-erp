import { reorderSalesStages } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/opportunities/server/opportunity-http";

// Body: { ids } — every active stage id, in process order.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView, billingWrite: true }, async ({ client, session }) => {
    const { ids } = await readBody(request);
    return ok({ stages: await reorderSalesStages(client, crmContext(session), Array.isArray(ids) ? ids.map(String) : []) });
  });
}
