import { scheduleOpportunityFollowUp } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

// Body: { type, dueAt, assignedTo?, notes?, subject? }
export async function POST(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesEdit, billingWrite: true }, async ({ client, session }) =>
    ok({ followUp: await scheduleOpportunityFollowUp(client, crmContext(session), (await route.params).id, await readBody(request)) }, 201),
  );
}
