import { moveOpportunityToPipeline } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

// Body: { pipelineId, stageId?, note?, expectedUpdatedAt? } — moves an open deal into another pipeline (CRM plan 5.1), into the stage
// given or the pipeline's first.
export async function POST(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesChangeStage, billingWrite: true }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    return ok(await moveOpportunityToPipeline(client, crmContext(session, snapshot), (await route.params).id, {
      pipelineId: String(body.pipelineId ?? ""), stageId: body.stageId ? String(body.stageId) : null, note: body.note ? String(body.note) : undefined,
      expectedUpdatedAt: body.expectedUpdatedAt ? String(body.expectedUpdatedAt) : undefined,
    }));
  });
}
