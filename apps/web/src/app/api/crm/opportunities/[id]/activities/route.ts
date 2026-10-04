import { addOpportunityActivity, listOpportunityActivities } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

export async function GET(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session }) =>
    ok({ activities: await listOpportunityActivities(client, crmContext(session), (await route.params).id) }),
  );
}

// Logs a call, email, meeting, demo or general activity. Body: { type, subject?, notes?, outcome?, occurredAt?, contactId?, nextAction? }
export async function POST(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesEdit, billingWrite: true }, async ({ client, session }) =>
    ok(await addOpportunityActivity(client, crmContext(session), (await route.params).id, await readBody(request)), 201),
  );
}
