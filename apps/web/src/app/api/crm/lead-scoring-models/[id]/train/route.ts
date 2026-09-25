import { assertSameOriginOrMobile, trainLeadScoringModel } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string }> };

// Trains (or retrains) a predictive scoring model's Naive Bayes priors from
// the org's own qualified/unqualified Lead history. Only a draft predictive
// model can be trained (trainLeadScoringModel enforces this); activating it
// afterwards (the existing [id]/activate/route.ts) requires trained_at to
// be set.
export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, undefined, { mutation: true });
      return trainLeadScoringModel(client, crmContext(session), id);
    });
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
