import { setPipelineActive, updatePipeline } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

// Body: any of { name, description, teamId, isDefault }, or { isActive, moveOpenTo? } to switch the pipeline off or on.
export async function PATCH(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView, billingWrite: true }, async ({ client, session, snapshot }) => {
    const context = crmContext(session, snapshot);
    const id = (await route.params).id;
    const body = await readBody(request);
    if (typeof body.isActive === "boolean")
      return ok({ pipeline: await setPipelineActive(client, context, id, body.isActive, { moveOpenTo: body.moveOpenTo ? String(body.moveOpenTo) : null }) });
    return ok({ pipeline: await updatePipeline(client, context, id, body) });
  });
}
