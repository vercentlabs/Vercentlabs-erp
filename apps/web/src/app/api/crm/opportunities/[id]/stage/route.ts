import { changeOpportunityStage } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

// Body: { stageId, note?, expectedUpdatedAt? } — open stages only; a deal is closed with /won or /lost.
export async function POST(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesChangeStage, billingWrite: true }, async ({ client, session }) =>
    ok(await changeOpportunityStage(client, crmContext(session), (await route.params).id, await readBody(request))),
  );
}
