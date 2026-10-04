import { removeOpportunityProduct, updateOpportunityProduct } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/opportunities/server/opportunity-http";

type LineParams = { params: Promise<{ id: string; lineId: string }> };

export async function PATCH(request: Request, route: LineParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesEdit, billingWrite: true }, async ({ client, session }) => {
    const { id, lineId } = await route.params;
    return ok({ line: await updateOpportunityProduct(client, crmContext(session), id, lineId, await readBody(request)) });
  });
}

export async function DELETE(request: Request, route: LineParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesEdit, billingWrite: true }, async ({ client, session }) => {
    const { id, lineId } = await route.params;
    return ok(await removeOpportunityProduct(client, crmContext(session), id, lineId));
  });
}
