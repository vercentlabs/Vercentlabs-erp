import { archiveOpportunity } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

export async function POST(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesDelete, billingWrite: true }, async ({ client, session }) =>
    ok(await archiveOpportunity(client, crmContext(session), (await route.params).id)),
  );
}
