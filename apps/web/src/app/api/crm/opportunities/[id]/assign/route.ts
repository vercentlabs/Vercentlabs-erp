import { assignOpportunity } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

// Body: { ownerUserId?, teamId?, reason?, expectedUpdatedAt?, moveOpenActivities? }. Moving an existing owner needs crm.opportunities.reassign, which the operation checks.
export async function POST(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesAssign, billingWrite: true }, async ({ client, session }) =>
    ok(await assignOpportunity(client, crmContext(session), (await route.params).id, await readBody(request))),
  );
}
