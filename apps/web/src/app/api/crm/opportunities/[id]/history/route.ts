import { listOpportunityHistory } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

// The audit trail, newest first.
export async function GET(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session }) =>
    ok({ history: await listOpportunityHistory(client, crmContext(session), (await route.params).id) }),
  );
}
