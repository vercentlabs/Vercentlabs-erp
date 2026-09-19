import { activateLeadScoringModel, assertSameOriginOrMobile } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string }> };

// Activating a model retires the previously active one and enqueues a
// bulk recalculation job (enqueueLeadScoreRecalcJob) so every existing
// Lead is re-scored under the new model — both handled inside
// activateLeadScoringModel itself, not duplicated here.
export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, undefined, { mutation: true });
      return activateLeadScoringModel(client, crmContext(session), id);
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
