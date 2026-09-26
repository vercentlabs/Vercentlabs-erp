import { activateLeadScoringModel } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

// Activating a model retires the previously active one and enqueues a
// bulk recalculation job (enqueueLeadScoreRecalcJob) so every existing
// Lead is re-scored under the new model — both handled inside
// activateLeadScoringModel itself, not duplicated here.
export async function POST(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const result = await activateLeadScoringModel(client, crmContext(session), id);
    return ok(result);
  });
}
