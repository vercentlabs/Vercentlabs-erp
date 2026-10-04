import { deleteOpportunity, getOpportunity, updateOpportunity } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

export async function GET(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session }) =>
    ok({ record: await getOpportunity(client, crmContext(session), (await route.params).id) }),
  );
}

// Body: the fields to change, plus expectedUpdatedAt to refuse a stale save.
// Stage, status, probability, owner and team change through their own routes.
export async function PATCH(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesEdit, billingWrite: true }, async ({ client, session }) => {
    const { expectedUpdatedAt, ...input } = await readBody(request);
    return ok({ record: await updateOpportunity(client, crmContext(session), (await route.params).id, input, { expectedUpdatedAt: typeof expectedUpdatedAt === "string" ? expectedUpdatedAt : null }) });
  });
}

// Deletes an opportunity created by mistake and never used; anything else is archived.
export async function DELETE(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesDelete, billingWrite: true }, async ({ client, session }) =>
    ok(await deleteOpportunity(client, crmContext(session), (await route.params).id)),
  );
}
