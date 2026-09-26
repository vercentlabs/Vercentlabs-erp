import { trainLeadScoringModel } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

// Trains (or retrains) a predictive scoring model's Naive Bayes priors from
// the org's own qualified/unqualified Lead history. Only a draft predictive
// model can be trained (trainLeadScoringModel enforces this); activating it
// afterwards (the existing [id]/activate/route.ts) requires trained_at to
// be set.
export async function POST(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const record = await trainLeadScoringModel(client, crmContext(session), id);
    return ok({ record });
  });
}
