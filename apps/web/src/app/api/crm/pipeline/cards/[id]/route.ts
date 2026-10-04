import { quickEditOpportunity } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

// Quick edit from a pipeline card. Body: any of { stageId, expectedCloseDate, ownerUserId, priority, probability, nextStep }, plus expectedUpdatedAt.
// Each field is checked by the opportunity operation that owns it; all are saved together or not at all.
export async function PATCH(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView, billingWrite: true }, async ({ client, session }) =>
    ok({ record: await quickEditOpportunity(client, crmContext(session), (await route.params).id, await readBody(request)) }),
  );
}
