import { markOpportunityLost } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

// Body: { reasonId (lost reason), actualCloseDate?, notes?, competitorName?, duplicateOfOpportunityId?, followUp?: { date, subject? }, expectedUpdatedAt?, openTasks?, openFollowUps? }
export async function POST(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesMarkLost, billingWrite: true }, async ({ client, session }) =>
    ok(await markOpportunityLost(client, crmContext(session), (await route.params).id, await readBody(request))),
  );
}
