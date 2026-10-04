import { updateSalesStage } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

// Body: any of { name, description, guidance, probability, isActive }, plus moveOpenTo when deactivating a stage that has open opportunities.
export async function PATCH(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView, billingWrite: true }, async ({ client, session }) =>
    ok({ stage: await updateSalesStage(client, crmContext(session), (await route.params).id, await readBody(request)) }),
  );
}
